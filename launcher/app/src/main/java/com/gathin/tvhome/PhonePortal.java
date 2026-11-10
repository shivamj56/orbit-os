package com.gathin.tvhome;

import android.accessibilityservice.AccessibilityService;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.content.res.Resources;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.media.AudioManager;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.net.ConnectivityManager;
import android.net.LinkAddress;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.Settings;
import android.util.DisplayMetrics;
import android.view.KeyEvent;
import android.view.accessibility.AccessibilityNodeInfo;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.text.Collator;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

/**
 * The phone to TV door: a private page the owner opens on his phone over the home Wi-Fi to run the TV from it. It shows
 * what is playing, with play and pause, skips and the volume; it sends a link (YouTube's open in the YouTube app) or a
 * line of text into the box on the screen; it opens the TV's apps; and it has Back, Home and Sleep. The page itself is
 * assets/portal/index.html, and {@link PortalHttp} serves it.
 *
 * <p>It lives in the key helper, which runs for as long as the TV is on, and costs nothing while nobody has the page
 * open: one thread waits for a connection and nothing polls. The page asks for the state every two seconds, and only
 * while it is on the phone's screen.
 *
 * <p>A phone pairs once. The TV shows a six-digit code for three minutes ({@link #beginPairing}), the page sends it back
 * and gets a random 128-bit token, which it keeps and sends with every request after that. Five wrong codes end the
 * code. Only a SHA-256 of each token is kept here, in the "portal" preferences, and the eight newest count, so an old
 * phone drops off by itself in time. Codes and tokens never go to the log.
 *
 * <p>The Orbit app (phone/ in this repository, phone/SPEC.md) uses the same door with the same pairing, plus the remote's
 * arrows and OK, the pointer it moves in Cursor mode, and pointer moves as datagrams on {@link #POINTER_PORT}, so that a
 * slow one never holds up the next. The door says it is here on the Wi-Fi as {@code _orbit._tcp}, so the app finds it.
 */
final class PhonePortal {

    interface Host {
        /** Show this pairing code on the TV, with the address to open there (null off the home network). Main thread. */
        void showPairingCode(String code, String url);

        /** The pairing code is no longer needed (paired, or 3 minutes passed). Main thread. */
        void hidePairingCode();

        /**
         * A remote key from the phone that the TV's own windows take before any app: the recent apps row while it is
         * open, Home with its way back into the app's card, the row itself. True when taken. Main thread.
         */
        boolean takeKey(String key);

        /** The ring the phone moves in Cursor mode, or null on a TV without one. */
        PointerCursor pointer();

        /** Help mode on or off (POST /api/help). Any thread. */
        void help(boolean on);

        /** The newest picture of the screen as {jpeg bytes, number}, or null while help is off (GET /api/screen). */
        Object[] screen();
    }

    static final int PORT = 8090;
    static final int POINTER_PORT = 8091;
    private static final String SERVICE_TYPE = "_orbit._tcp";
    /** How long a token that a datagram carried counts as checked, so that 60 moves a second are not 60 hashes. */
    private static final long TOKEN_TRUST_MS = 10_000L;
    /** A phone that was quiet this long may start its numbering again (the app was closed and opened). */
    private static final long SEQ_FORGET_MS = 3_000L;

    /** When an unpaired phone last asked for a code (askCode). Under {@code lock}. */
    private long lastAsk;
    private static final long PAIRING_MS = 3 * 60_000L, ASK_GAP_MS = 20_000L;
    private static final int PAIRING_TRIES = 5;
    private static final int TOKENS_KEPT = 8;
    private static final String PREFS = "portal", KEY_TOKENS = "tokens";
    private static final String OWN_PACKAGE = "com.gathin.tvhome";
    private static final String YOUTUBE_TV = "com.google.android.youtube.tv";
    /** App pictures for the page's grid: a banner's own size at xhdpi, and how many are kept between requests. */
    private static final int ART_W = 320, ART_H = 180, ART_KEPT = 30;
    private static final long SKIP_MS = 10_000L;
    private static final int TEXT_MAX = 4000;
    /** How long a request waits for the main thread, which is also drawing Home and taking the remote's keys. */
    private static final long MAIN_WAIT_MS = 6_000L;
    private static final String PAGE = "portal/index.html";
    /** The page is one file with its style and script inside, and it talks to nothing but this TV. */
    private static final String PAGE_HEADERS = "Content-Security-Policy: default-src 'none'; script-src 'unsafe-inline'; "
            + "style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; "
            + "frame-ancestors 'none'\r\n";

    private final AccessibilityService service;
    private final Host host;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final SecureRandom random = new SecureRandom();
    private final PortalHttp http = new PortalHttp(PORT, this::answer);
    private final Runnable pairingOver = this::endPairing;

    /** Guards the pairing code, the tokens and the QR code. */
    private final Object lock = new Object();
    private String code;
    private long codeUntil;
    private int wrongCodes;
    /** SHA-256 of each paired phone's token, oldest first. */
    private final List<byte[]> tokenHashes = new ArrayList<>();
    private boolean tokensRead;
    private String qrFor;
    private boolean[][] qrCode;

    /** PNGs by package, least recently asked for first. */
    private final Map<String, byte[]> art = new LinkedHashMap<String, byte[]>(ART_KEPT + 2, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, byte[]> eldest) {
            return size() > ART_KEPT;
        }
    };
    private final Map<String, String> labels = new HashMap<>();

    /** The level the phone asked for last, while one answering thread is in the audio service with an earlier one. */
    private final Object volumeLock = new Object();
    private int volumeWanted = -1;
    private boolean volumeBusy;

    /** The pointer's datagram door and the Wi-Fi advert. Under {@code lock}. */
    private DatagramSocket pointerSocket;
    private boolean pointerOpen;
    private NsdManager.RegistrationListener advert;
    /** Only on the datagram thread: the token checked last and when, and the newest number taken from it. */
    private String trustedToken;
    private long trustedAt, lastSeqAt;
    private long lastSeq;

    PhonePortal(AccessibilityService service, Host host) {
        this.service = service;
        this.host = host;
    }

    /** Opens the door; it binds on a thread of its own, so this returns at once. */
    void start() {
        http.start();
        openPointerDoor();
        advertise();
    }

    void stop() {
        http.stop();
        closePointerDoor();
        unadvertise();
        endPairing();
        synchronized (art) {
            art.clear();
        }
        synchronized (labels) {
            labels.clear();
        }
    }

    /** The address to open on the phone, e.g. http://192.168.1.7:8090/, or null when the TV is not on a home network. */
    String url() {
        String address = homeAddress();
        return address == null ? null : "http://" + address + ":" + PORT + "/";
    }

    /**
     * A QR code of {@link #url()}, true for dark, or null. There is no quiet zone in it: draw it dark on light, with at
     * least four modules of light margin, or many phone cameras will not see it.
     */
    boolean[][] qr() {
        String address = url();
        if (address == null) return null;
        synchronized (lock) {
            if (!address.equals(qrFor)) {
                qrCode = PortalQr.encode(address);
                qrFor = address;
            }
            if (qrCode == null) return null;
            boolean[][] copy = new boolean[qrCode.length][];
            for (int i = 0; i < copy.length; i++) copy[i] = qrCode[i].clone();
            return copy;
        }
    }

    /** A fresh code for three minutes, shown through the host; any earlier code stops counting. Opens the door too. */
    void beginPairing() {
        start();
        String fresh = String.format(Locale.ROOT, "%06d", random.nextInt(1_000_000));
        synchronized (lock) {
            code = fresh;
            codeUntil = SystemClock.elapsedRealtime() + PAIRING_MS;
            wrongCodes = 0;
        }
        String address = url();
        onMainSoon(() -> {
            synchronized (lock) {
                if (!fresh.equals(code)) return;
            }
            main.removeCallbacks(pairingOver);
            main.postDelayed(pairingOver, PAIRING_MS);
            host.showPairingCode(fresh, address);
        });
    }

    private void endPairing() {
        boolean showing;
        synchronized (lock) {
            showing = code != null;
            code = null;
        }
        if (showing) hideCode();
        else onMainSoon(() -> main.removeCallbacks(pairingOver));
    }

    private void hideCode() {
        onMainSoon(() -> {
            main.removeCallbacks(pairingOver);
            host.hidePairingCode();
        });
    }

    private void onMainSoon(Runnable work) {
        if (Looper.myLooper() == Looper.getMainLooper()) work.run();
        else main.post(work);
    }

    // ---- routes ----

    /** On an answering thread. */
    private PortalHttp.Response answer(PortalHttp.Request request) {
        String path = request.path;
        boolean get = request.method.equals("GET");
        switch (path) {
            case "/":
                return get ? page() : notAllowed();
            case "/api/pair":
                return get ? notAllowed() : pair(request);
            case "/api/askcode":
                return get ? notAllowed() : askCode();
            case "/api/state":
            case "/api/apps":
            case "/api/icon":
            case "/api/screen":
                if (!get) return notAllowed();
                break;
            case "/api/help":
                if (get) return notAllowed();
                break;
            case "/api/media":
            case "/api/volume":
            case "/api/key":
            case "/api/type":
            case "/api/open":
            case "/api/launch":
            case "/api/sleep":
            case "/api/pointer":
                if (get) return notAllowed();
                break;
            default:
                return fail(404, "There is nothing here.");
        }
        String token = request.header("x-portal-token");
        // An <img> cannot send a header, so the apps grid passes the token in the address instead.
        if (token == null && (path.equals("/api/apps") || path.equals("/api/icon"))) token = request.param("t");
        if (!isPaired(token)) return path.equals("/api/state") ? notPaired() : fail(401, "This phone is not paired with the TV.");
        try {
            switch (path) {
                case "/api/state":
                    return state();
                case "/api/apps":
                    return apps();
                case "/api/icon":
                    return icon(request.param("pkg"));
                case "/api/sleep":
                    return sleep();
                case "/api/screen":
                    return screen();
                default:
                    break;
            }
            JSONObject body = body(request);
            if (body == null) return fail(400, "The request was not a JSON object.");
            switch (path) {
                case "/api/media":
                    return media(body);
                case "/api/volume":
                    return volume(body);
                case "/api/key":
                    return key(body);
                case "/api/type":
                    return type(body);
                case "/api/open":
                    return open(body);
                case "/api/pointer":
                    return pointer(body);
                case "/api/help":
                    return help(body);
                default:
                    return launch(body);
            }
        } catch (JSONException broken) {
            return fail(500, "Something went wrong on the TV.");
        }
    }

    private PortalHttp.Response page() {
        try (InputStream in = service.getAssets().open(PAGE)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream(64 * 1024);
            byte[] chunk = new byte[8 * 1024];
            for (int n; (n = in.read(chunk)) > 0; ) out.write(chunk, 0, n);
            return new PortalHttp.Response(200, "text/html; charset=utf-8", out.toByteArray(), PAGE_HEADERS);
        } catch (IOException missing) {
            return fail(500, "The page is missing from this build.");
        }
    }

    // ---- pairing ----

    /**
     * A phone that is not paired asks the TV to show a code, so nobody has to find a button on the TV for it. At most
     * every 20 seconds, so that nothing on the Wi-Fi can keep the screen busy with codes; it still cannot pair without
     * seeing the TV.
     */
    private PortalHttp.Response askCode() {
        long now = SystemClock.elapsedRealtime();
        synchronized (lock) {
            if (lastAsk != 0L && now - lastAsk < ASK_GAP_MS) return ok();
            lastAsk = now;
        }
        beginPairing();
        return ok();
    }

    private PortalHttp.Response pair(PortalHttp.Request request) {
        JSONObject body = body(request);
        String given = body != null ? body.optString("code", "").trim() : "";
        boolean right, over = false;
        int left;
        synchronized (lock) {
            if (code == null || SystemClock.elapsedRealtime() > codeUntil) {
                return fail(409, "There is no pairing code on the TV now. Ask the TV for one.");
            }
            right = given.length() == code.length() && MessageDigest.isEqual(
                    given.getBytes(StandardCharsets.UTF_8), code.getBytes(StandardCharsets.UTF_8));
            if (right) {
                // Taken here, under the lock: two phones sending the same code at once cannot both pair with it.
                code = null;
            } else {
                wrongCodes++;
                over = wrongCodes >= PAIRING_TRIES;
                if (over) code = null;
            }
            left = PAIRING_TRIES - wrongCodes;
        }
        if (!right) {
            if (over) {
                hideCode();
                return fail(429, "Too many wrong codes. Ask the TV for a new one.");
            }
            return fail(403, "That is not the code on the TV. " + (left == 1 ? "One try left." : left + " tries left."));
        }
        hideCode();
        byte[] raw = new byte[16];
        random.nextBytes(raw);
        String token = hex(raw);
        remember(token);
        try {
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("token", token);
            return ok(out);
        } catch (JSONException broken) {
            return fail(500, "Something went wrong on the TV.");
        }
    }

    private boolean isPaired(String token) {
        if (token == null || token.length() != 32) return false;
        byte[] hash = hashOf(token.toLowerCase(Locale.ROOT));
        if (hash == null) return false;
        boolean known = false;
        synchronized (lock) {
            readTokens();
            // Every kept hash is compared, all the way through, whatever matched before it.
            for (byte[] kept : tokenHashes) known |= MessageDigest.isEqual(kept, hash);
        }
        return known;
    }

    private void remember(String token) {
        byte[] hash = hashOf(token);
        if (hash == null) return;
        synchronized (lock) {
            readTokens();
            tokenHashes.add(hash);
            while (tokenHashes.size() > TOKENS_KEPT) tokenHashes.remove(0);
            // Storage that could not be read cannot be written either: the phone stays paired until the next restart.
            if (!tokensRead) return;
            StringBuilder saved = new StringBuilder();
            for (byte[] kept : tokenHashes) {
                if (saved.length() > 0) saved.append(',');
                saved.append(hex(kept));
            }
            try {
                prefs().edit().putString(KEY_TOKENS, saved.toString()).apply();
            } catch (RuntimeException locked) {
                // As above.
            }
        }
    }

    /** Under the lock. */
    private void readTokens() {
        if (tokensRead) return;
        String saved;
        try {
            saved = prefs().getString(KEY_TOKENS, "");
        } catch (RuntimeException locked) {
            // The key helper starts before the first unlock after a boot, and this app's own storage opens only then.
            return;
        }
        List<byte[]> kept = new ArrayList<>();
        for (String part : saved.split(",")) {
            byte[] hash = unhex(part);
            if (hash != null && hash.length == 32) kept.add(hash);
        }
        kept.addAll(tokenHashes);
        tokenHashes.clear();
        tokenHashes.addAll(kept);
        while (tokenHashes.size() > TOKENS_KEPT) tokenHashes.remove(0);
        tokensRead = true;
    }

    private SharedPreferences prefs() {
        return service.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static byte[] hashOf(String token) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException impossible) {
            return null;
        }
    }

    // ---- what is on ----

    private PortalHttp.Response state() throws JSONException {
        PackageManager pm = service.getPackageManager();
        JSONObject out = new JSONObject();
        out.put("ok", true);
        String tv = deviceName();
        out.put("tv", tv != null ? tv : JSONObject.NULL);
        String front = frontPackage();
        String frontLabel = front != null ? label(pm, front) : null;
        out.put("app", frontLabel != null ? frontLabel : JSONObject.NULL);
        out.put("pkg", front != null ? front : JSONObject.NULL);
        boolean pointer = host.pointer() != null;
        out.put("pointer", pointer);
        out.put("udp", pointer ? POINTER_PORT : JSONObject.NULL);

        String title = "", artist = "", player = null;
        boolean playing = false;
        long position = 0L, duration = 0L;
        MediaController session = session();
        if (session != null) {
            player = label(pm, session.getPackageName());
            MediaMetadata meta = session.getMetadata();
            if (meta != null) {
                title = text(meta, MediaMetadata.METADATA_KEY_TITLE, MediaMetadata.METADATA_KEY_DISPLAY_TITLE);
                artist = text(meta, MediaMetadata.METADATA_KEY_ARTIST, MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE,
                        MediaMetadata.METADATA_KEY_ALBUM_ARTIST, MediaMetadata.METADATA_KEY_AUTHOR);
                duration = Math.max(0L, meta.getLong(MediaMetadata.METADATA_KEY_DURATION));
            }
            PlaybackState playback = session.getPlaybackState();
            if (playback != null) {
                playing = isPlaying(playback.getState());
                position = positionNow(playback);
            }
            if (duration > 0L) position = Math.min(position, duration);
        }
        out.put("title", title);
        out.put("artist", artist);
        out.put("playing", playing);
        out.put("position", position);
        out.put("duration", duration);
        out.put("player", player != null ? player : JSONObject.NULL);

        AudioManager audio = service.getSystemService(AudioManager.class);
        out.put("volume", audio.getStreamVolume(AudioManager.STREAM_MUSIC));
        out.put("max", audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
        out.put("muted", audio.isStreamMute(AudioManager.STREAM_MUSIC));
        return ok(out);
    }

    /**
     * The app on the screen, from the active window's root, which the service sees only with canRetrieveWindowContent.
     * Asked here on an answering thread, not the main one: the answer comes from that app's own main thread, and an app
     * that hangs must not take Home's keys with it. Nothing below the root is fetched.
     */
    private String frontPackage() {
        AccessibilityNodeInfo root;
        try {
            root = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                    ? service.getRootInActiveWindow(0) : service.getRootInActiveWindow();
        } catch (RuntimeException noWindowAccess) {
            return null;
        }
        if (root == null) return null;
        CharSequence pkg = root.getPackageName();
        return pkg != null ? pkg.toString() : null;
    }

    /** The session playing now, or else the one Android ranks first; null without the listener grant or any session. */
    private MediaController session() {
        MediaSessionManager manager = service.getSystemService(MediaSessionManager.class);
        if (manager == null) return null;
        List<MediaController> sessions;
        try {
            sessions = manager.getActiveSessions(new ComponentName(service, GuardRevival.class));
        } catch (SecurityException notAllowed) {
            // GuardRevival's notification listener grant is what lets this see other apps' sessions.
            return null;
        }
        MediaController first = null;
        for (MediaController session : sessions) {
            PlaybackState playback = session.getPlaybackState();
            if (playback != null && isPlaying(playback.getState())) return session;
            if (first == null) first = session;
        }
        return first;
    }

    private static boolean isPlaying(int state) {
        return state == PlaybackState.STATE_PLAYING || state == PlaybackState.STATE_BUFFERING
                || state == PlaybackState.STATE_FAST_FORWARDING || state == PlaybackState.STATE_REWINDING;
    }

    /** A session reports where it was at its last update; while it plays, the time since then counts too. */
    private static long positionNow(PlaybackState playback) {
        long position = playback.getPosition();
        if (position < 0L) return 0L;
        long updated = playback.getLastPositionUpdateTime();
        if (playback.getState() == PlaybackState.STATE_PLAYING && updated > 0L) {
            long since = SystemClock.elapsedRealtime() - updated;
            if (since > 0L) position += (long) (since * playback.getPlaybackSpeed());
        }
        return Math.max(0L, position);
    }

    private static String text(MediaMetadata meta, String... keys) {
        for (String key : keys) {
            CharSequence value = meta.getText(key);
            if (value != null && value.toString().trim().length() > 0) return value.toString().trim();
        }
        return "";
    }

    private String label(PackageManager pm, String pkg) {
        if (pkg == null) return null;
        if (pkg.equals(service.getPackageName())) return "Home";
        synchronized (labels) {
            String known = labels.get(pkg);
            if (known != null) return known;
        }
        String name;
        try {
            name = pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString().trim();
        } catch (PackageManager.NameNotFoundException hidden) {
            return null;
        }
        synchronized (labels) {
            if (labels.size() >= 64) labels.clear();
            labels.put(pkg, name);
        }
        return name;
    }

    private String deviceName() {
        try {
            String name = Settings.Global.getString(service.getContentResolver(), Settings.Global.DEVICE_NAME);
            return name != null && name.trim().length() > 0 ? name.trim() : null;
        } catch (RuntimeException unreadable) {
            return null;
        }
    }

    // ---- playing and volume ----

    private PortalHttp.Response media(JSONObject body) {
        int key;
        switch (body.optString("action", "")) {
            case "play_pause": key = KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE; break;
            case "next": key = KeyEvent.KEYCODE_MEDIA_NEXT; break;
            case "previous": key = KeyEvent.KEYCODE_MEDIA_PREVIOUS; break;
            case "forward": key = KeyEvent.KEYCODE_MEDIA_FAST_FORWARD; break;
            case "rewind": key = KeyEvent.KEYCODE_MEDIA_REWIND; break;
            default: return fail(400, "Unknown action.");
        }
        // The page's buttons say 10 s, and what an app does with a fast-forward key is its own choice (YouTube jumps
        // further), so a session that allows seeking is moved by exactly that; any other gets the key.
        if (key == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD || key == KeyEvent.KEYCODE_MEDIA_REWIND) {
            if (seekBy(session(), key == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD ? SKIP_MS : -SKIP_MS)) return ok();
        }
        AudioManager audio = service.getSystemService(AudioManager.class);
        long down = SystemClock.uptimeMillis();
        audio.dispatchMediaKeyEvent(new KeyEvent(down, down, KeyEvent.ACTION_DOWN, key, 0));
        audio.dispatchMediaKeyEvent(new KeyEvent(down, SystemClock.uptimeMillis(), KeyEvent.ACTION_UP, key, 0));
        return ok();
    }

    private static boolean seekBy(MediaController session, long by) {
        if (session == null) return false;
        PlaybackState playback = session.getPlaybackState();
        if (playback == null || (playback.getActions() & PlaybackState.ACTION_SEEK_TO) == 0 || playback.getPosition() < 0L) {
            return false;
        }
        MediaMetadata meta = session.getMetadata();
        long duration = meta != null ? meta.getLong(MediaMetadata.METADATA_KEY_DURATION) : 0L;
        // A live stream, or one that does not say how long it is: the app's own key knows better.
        if (duration <= 0L) return false;
        session.getTransportControls().seekTo(Math.max(0L, Math.min(duration, positionNow(playback) + by)));
        return true;
    }

    private PortalHttp.Response volume(JSONObject body) throws JSONException {
        // Only a number: a level that cannot be read must not turn the TV down to nothing.
        Object asked = body.opt("level");
        if (!(asked instanceof Number)) return fail(400, "The level must be a number.");
        AudioManager audio = service.getSystemService(AudioManager.class);
        int max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        int level = (int) Math.max(0L, Math.min(max, Math.round(((Number) asked).doubleValue())));
        setVolume(audio, level);
        JSONObject out = new JSONObject();
        out.put("ok", true);
        out.put("volume", level);
        out.put("max", max);
        return ok(out);
    }

    /**
     * On an answering thread, never the main one: the audio service on this TV can hold a caller for tens of ms. A slider
     * dragged on the phone sends one level after another, and the one that is in the audio service carries on with the
     * newest that came in meanwhile, so the TV always ends at the last level asked for.
     */
    private void setVolume(AudioManager audio, int level) {
        synchronized (volumeLock) {
            volumeWanted = level;
            if (volumeBusy) return;
            volumeBusy = true;
        }
        while (true) {
            int next;
            synchronized (volumeLock) {
                next = volumeWanted;
                volumeWanted = -1;
                if (next < 0) {
                    volumeBusy = false;
                    return;
                }
            }
            try {
                audio.setStreamVolume(AudioManager.STREAM_MUSIC, next, 0);
            } catch (RuntimeException refused) {
                // Do Not Disturb or the firmware said no; the page shows the real level at its next look.
            }
        }
    }

    // ---- keys, text and links ----

    private PortalHttp.Response key(JSONObject body) throws JSONException {
        String key = body.optString("key", "");
        int action;
        switch (key) {
            case "volup":
            case "voldown":
            case "mute":
                return volumeKey(key);
            case "settings":
                // The remote's Settings button opens the Control Center on this TV; the phone's does the same.
                Intent settings = SystemSettings.intent(service, Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                return onMain(() -> host.takeKey("settings") || startNow(settings) ? ok() : fail(409, "Settings did not open."));
            case "back": action = AccessibilityService.GLOBAL_ACTION_BACK; break;
            case "home": action = AccessibilityService.GLOBAL_ACTION_HOME; break;
            // Only the TV's own row can take it: there is no global action for it.
            case "recents": action = -1; break;
            case "up": action = AccessibilityService.GLOBAL_ACTION_DPAD_UP; break;
            case "down": action = AccessibilityService.GLOBAL_ACTION_DPAD_DOWN; break;
            case "left": action = AccessibilityService.GLOBAL_ACTION_DPAD_LEFT; break;
            case "right": action = AccessibilityService.GLOBAL_ACTION_DPAD_RIGHT; break;
            case "ok": action = AccessibilityService.GLOBAL_ACTION_DPAD_CENTER; break;
            default: return fail(400, "Unknown key.");
        }
        boolean arrow = action >= AccessibilityService.GLOBAL_ACTION_DPAD_UP;
        if (arrow && Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return fail(409, "This TV takes the arrows from the phone from Android 13 on.");
        }
        return onMain(() -> {
            // The keys Android plays for a global action skip this helper's own key filter, so the TV's own windows are
            // asked first, the way the remote's keys reach them.
            if (host.takeKey(key)) return ok();
            if (action < 0) return fail(409, "The TV has no recent apps row.");
            return service.performGlobalAction(action) ? ok() : fail(409, "The TV did not take the key.");
        });
    }

    /** The phone's own volume keys: a step of about 3% (the TV counts to 100, and one of those is not heard). */
    private PortalHttp.Response volumeKey(String key) throws JSONException {
        AudioManager audio = service.getSystemService(AudioManager.class);
        int max = audio.getStreamMaxVolume(AudioManager.STREAM_MUSIC);
        try {
            if (key.equals("mute")) {
                audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_TOGGLE_MUTE, 0);
            } else {
                int step = Math.max(1, Math.round(max / 30f));
                int now = audio.getStreamVolume(AudioManager.STREAM_MUSIC);
                if (audio.isStreamMute(AudioManager.STREAM_MUSIC)) {
                    audio.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_UNMUTE, 0);
                }
                setVolume(audio, Math.max(0, Math.min(max, now + (key.equals("volup") ? step : -step))));
            }
        } catch (RuntimeException refused) {
            return fail(409, "The TV did not change the volume.");
        }
        JSONObject out = new JSONObject();
        out.put("ok", true);
        out.put("volume", audio.getStreamVolume(AudioManager.STREAM_MUSIC));
        out.put("max", max);
        out.put("muted", audio.isStreamMute(AudioManager.STREAM_MUSIC));
        return ok(out);
    }

    // ---- Orbit from anywhere ----

    /**
     * A command that came through Orbit's cloud path (OrbitCloud), after the cloud's own sign-in: the same routes as the
     * door, on the cloud's work thread. Pointer moves come here too (no datagrams over the internet), a few a second.
     */
    PortalHttp.Response handleCloud(String path, JSONObject body) {
        try {
            switch (path) {
                case "/api/state": return state();
                case "/api/apps": return apps();
                case "/api/icon": return icon(body.optString("pkg", ""));
                case "/api/sleep": return sleep();
                case "/api/media": return media(body);
                case "/api/volume": return volume(body);
                case "/api/key": return key(body);
                case "/api/type": return type(body);
                case "/api/open": return open(body);
                case "/api/launch": return launch(body);
                case "/api/pointer": return cloudPointer(body);
                case "/api/help": return help(body);
                default: return fail(404, "There is nothing here.");
            }
        } catch (JSONException broken) {
            return fail(500, "Something went wrong on the TV.");
        }
    }

    private PortalHttp.Response cloudPointer(JSONObject body) {
        PointerCursor ring = host.pointer();
        String action = body.optString("action", "");
        if (ring == null || !(action.equals("move") || action.equals("scroll"))) return pointer(body);
        // The phone sums 100 ms of moves into one command: a fast swipe goes further than one datagram's ±400.
        float dx = (float) Math.max(-2000, Math.min(2000, body.optDouble("dx", 0)));
        float dy = (float) Math.max(-2000, Math.min(2000, body.optDouble("dy", 0)));
        if (!Float.isFinite(dx) || !Float.isFinite(dy)) return fail(400, "Not a move.");
        if (action.equals("move")) ring.move(dx, dy);
        else ring.scroll(dx, dy);
        return ok();
    }

    // ---- help mode ----

    private PortalHttp.Response help(JSONObject body) throws JSONException {
        boolean on = body.optBoolean("on", false);
        host.help(on);
        return PortalHttp.Response.json(200, new JSONObject().put("ok", true).put("on", on).toString());
    }

    private PortalHttp.Response screen() {
        Object[] shot = host.screen();
        if (shot == null) return fail(404, "Help is off, or the first picture is not ready yet.");
        return new PortalHttp.Response(200, "image/jpeg", (byte[]) shot[0],
                "x-screen-seq: " + shot[1] + "\r\nCache-Control: no-store\r\n");
    }

    // ---- the pointer ----

    private PortalHttp.Response pointer(JSONObject body) {
        PointerCursor ring = host.pointer();
        if (ring == null) return fail(409, "This TV has no pointer.");
        switch (body.optString("action", "")) {
            case "click":
                ring.click(false);
                return ok();
            case "longpress":
                ring.click(true);
                return ok();
            case "hide":
                ring.hide();
                return ok();
            case "tap": {
                // Help mode: a tap on the phone's picture of the screen, in 1280 x 720 TV pixels.
                double x = body.optDouble("x", Double.NaN), y = body.optDouble("y", Double.NaN);
                if (!Double.isFinite(x) || !Double.isFinite(y)) return fail(400, "A tap needs x and y.");
                ring.tapAt((float) Math.max(0, Math.min(1279, x)), (float) Math.max(0, Math.min(719, y)));
                return ok();
            }
            default:
                return fail(400, "Unknown action.");
        }
    }

    /** The datagram door for pointer moves, on a thread of its own that sleeps in receive() while nobody moves. */
    private void openPointerDoor() {
        if (host.pointer() == null) return;
        synchronized (lock) {
            if (pointerOpen) return;
            pointerOpen = true;
        }
        Thread thread = new Thread(this::pointerLoop, "orbit-pointer-door");
        thread.setDaemon(true);
        thread.start();
    }

    private void closePointerDoor() {
        DatagramSocket socket;
        synchronized (lock) {
            socket = pointerSocket;
            pointerSocket = null;
            pointerOpen = false;
        }
        if (socket != null) socket.close();
    }

    private void pointerLoop() {
        DatagramSocket socket;
        try {
            socket = new DatagramSocket(null);
            socket.setReuseAddress(true);
            socket.bind(new InetSocketAddress(POINTER_PORT));
        } catch (IOException taken) {
            synchronized (lock) {
                pointerOpen = false;
            }
            return;
        }
        synchronized (lock) {
            if (!pointerOpen) {
                socket.close();
                return;
            }
            pointerSocket = socket;
        }
        byte[] buffer = new byte[256];
        DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
        while (!socket.isClosed()) {
            try {
                packet.setLength(buffer.length);
                socket.receive(packet);
            } catch (IOException closed) {
                break;
            }
            // The same rule as the page: nothing from outside the home network gets an answer, or even a look.
            if (!PortalHttp.isHomeAddress(packet.getAddress())) continue;
            onDatagram(new String(buffer, 0, packet.getLength(), StandardCharsets.US_ASCII));
        }
    }

    /** "o1 <token> <seq> m|s <dx> <dy>", see phone/SPEC.md. Anything else, an unknown token or an old number: dropped. */
    private void onDatagram(String line) {
        String[] f = line.trim().split(" ");
        if (f.length != 6 || !f[0].equals("o1") || f[1].length() != 32) return;
        long seq;
        float dx, dy;
        try {
            seq = Long.parseLong(f[2]);
            dx = Float.parseFloat(f[4]);
            dy = Float.parseFloat(f[5]);
        } catch (NumberFormatException broken) {
            return;
        }
        if (!Float.isFinite(dx) || !Float.isFinite(dy)) return;
        long now = SystemClock.elapsedRealtime();
        String token = f[1].toLowerCase(Locale.ROOT);
        if (!token.equals(trustedToken) || now - trustedAt > TOKEN_TRUST_MS) {
            if (!isPaired(token)) return;
            if (!token.equals(trustedToken)) lastSeqAt = 0L;
            trustedToken = token;
            trustedAt = now;
        }
        // A datagram can overtake the one before it: only a newer number moves the ring.
        if (lastSeqAt != 0L && now - lastSeqAt < SEQ_FORGET_MS && seq <= lastSeq && lastSeq - seq < (1L << 30)) return;
        lastSeq = seq;
        lastSeqAt = now;
        PointerCursor ring = host.pointer();
        if (ring == null) return;
        dx = Math.max(-400f, Math.min(400f, dx));
        dy = Math.max(-400f, Math.min(400f, dy));
        if (f[3].equals("m")) ring.move(dx, dy);
        else if (f[3].equals("s")) ring.scroll(dx, dy);
    }

    // ---- the Wi-Fi advert ----

    /** "This TV is here" on the Wi-Fi (mDNS), named as the TV is in its settings, so the app needs no address typed. */
    private void advertise() {
        NsdManager nsd = service.getSystemService(NsdManager.class);
        if (nsd == null) return;
        NsdManager.RegistrationListener listener;
        synchronized (lock) {
            if (advert != null) return;
            listener = new NsdManager.RegistrationListener() {
                @Override
                public void onRegistrationFailed(NsdServiceInfo info, int error) {
                    synchronized (lock) {
                        if (advert == this) advert = null;
                    }
                }

                @Override
                public void onUnregistrationFailed(NsdServiceInfo info, int error) {
                }

                @Override
                public void onServiceRegistered(NsdServiceInfo info) {
                }

                @Override
                public void onServiceUnregistered(NsdServiceInfo info) {
                }
            };
            advert = listener;
        }
        NsdServiceInfo info = new NsdServiceInfo();
        String name = deviceName();
        info.setServiceName(name != null ? name : "TV");
        info.setServiceType(SERVICE_TYPE);
        info.setPort(PORT);
        info.setAttribute("v", "1");
        if (host.pointer() != null) info.setAttribute("udp", String.valueOf(POINTER_PORT));
        try {
            nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener);
        } catch (RuntimeException refused) {
            synchronized (lock) {
                if (advert == listener) advert = null;
            }
        }
    }

    private void unadvertise() {
        NsdManager.RegistrationListener listener;
        synchronized (lock) {
            listener = advert;
            advert = null;
        }
        if (listener == null) return;
        NsdManager nsd = service.getSystemService(NsdManager.class);
        try {
            if (nsd != null) nsd.unregisterService(listener);
        } catch (RuntimeException notRegistered) {
            // It never got through: nothing to take back.
        }
    }

    private PortalHttp.Response sleep() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return fail(409, "This TV cannot be put to sleep from here.");
        // On this firmware the lock screen action is the power button's short press: the TV goes to standby.
        return onMain(() -> service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_LOCK_SCREEN)
                ? ok() : fail(409, "The TV did not go to sleep."));
    }

    private PortalHttp.Response type(JSONObject body) {
        String text = body.optString("text", "");
        boolean submit = body.optBoolean("submit", false);
        if (text.length() > TEXT_MAX) return fail(413, "That is more text than the TV takes.");
        // Looked for here, off the main thread, as frontPackage() is: the answers come from the app on the screen.
        AccessibilityNodeInfo box = textBox();
        String front = frontPackage();
        return onMain(() -> {
            Bundle arguments = new Bundle();
            arguments.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text);
            if (box == null || !box.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, arguments)) {
                return searchWith(front, text, submit, box != null);
            }
            boolean entered = false;
            if (submit && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                entered = box.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.getId());
            }
            JSONObject out = new JSONObject();
            out.put("ok", true);
            out.put("entered", entered);
            return ok(out);
        });
    }

    /**
     * The box with the cursor, or else the first one on the screen: a search page whose focus has moved on to its results
     * still has its box. Null while the service cannot see window content, and on screens with no box at all.
     */
    private AccessibilityNodeInfo textBox() {
        try {
            AccessibilityNodeInfo focused = service.findFocus(AccessibilityNodeInfo.FOCUS_INPUT);
            if (focused != null && focused.isEditable()) return focused;
            AccessibilityNodeInfo root = service.getRootInActiveWindow();
            return root != null ? firstBox(root, 0, new int[1]) : null;
        } catch (RuntimeException noWindowAccess) {
            return null;
        }
    }

    /** Depth first, the way the screen reads, and only so far: a screen with thousands of rows answers null. */
    private static AccessibilityNodeInfo firstBox(AccessibilityNodeInfo node, int depth, int[] seen) {
        if (node.isEditable() && node.isVisibleToUser()) return node;
        if (depth >= 24) return null;
        for (int i = 0; i < node.getChildCount(); i++) {
            if (++seen[0] > 400) return null;
            AccessibilityNodeInfo child = node.getChild(i);
            if (child == null) continue;
            AccessibilityNodeInfo box = firstBox(child, depth + 1, seen);
            if (box != null) return box;
        }
        return null;
    }

    /**
     * No box took the words. On Home its own search opens with them; YouTube and Prime Video draw their letters
     * themselves, so they get the words in the address Home's search uses for their results.
     */
    private PortalHttp.Response searchWith(String front, String text, boolean submit, boolean refused) throws JSONException {
        String words = text.trim();
        if (!words.isEmpty() && service.getPackageName().equals(front)) {
            Intent search = new Intent(service, SearchActivity.class)
                    .putExtra(SearchActivity.EXTRA_QUERY, words)
                    .putExtra(SearchActivity.EXTRA_RESULTS, submit)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (startNow(search)) return opened("search");
        }
        String link = words.isEmpty() ? null : SearchActivity.resultsLink(front, words);
        if (link != null) {
            Intent results = new Intent(Intent.ACTION_VIEW, Uri.parse(link)).setPackage(front)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            if (startNow(results)) return opened(YOUTUBE_TV.equals(front) ? "YouTube" : "Prime Video");
        }
        return fail(409, refused ? "The text box on the TV did not take the text." : "no text box on the TV");
    }

    private PortalHttp.Response open(JSONObject body) {
        String raw = body.optString("url", "").trim();
        if (raw.isEmpty() || raw.length() > 4096) return fail(400, "Send a link.");
        // Intent filters match schemes case by case, so HTTPS://... must become https://... first.
        Uri link = Uri.parse(raw).normalizeScheme();
        String scheme = link.getScheme();
        String linkHost = link.getHost();
        if (!("https".equals(scheme) || "http".equals(scheme)) || linkHost == null || linkHost.isEmpty()) {
            return fail(400, "Only http and https links can be opened.");
        }
        Intent youTube = null;
        String video = youTubeVideo(link);
        if (video != null) {
            Uri.Builder watch = new Uri.Builder().scheme("https").authority("www.youtube.com").path("/watch")
                    .appendQueryParameter("v", video);
            String start = link.getQueryParameter("t");
            if (start != null && isStartTime(start)) watch.appendQueryParameter("t", start);
            youTube = new Intent(Intent.ACTION_VIEW, watch.build()).setPackage(YOUTUBE_TV)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        }
        Intent any = new Intent(Intent.ACTION_VIEW, link).addCategory(Intent.CATEGORY_BROWSABLE)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        Intent inYouTube = youTube;
        return onMain(() -> {
            if (inYouTube != null && startNow(inYouTube)) return opened("YouTube");
            if (startNow(any)) return opened("link");
            return fail(409, "Nothing on the TV can open that link.");
        });
    }

    private static PortalHttp.Response opened(String where) throws JSONException {
        JSONObject out = new JSONObject();
        out.put("ok", true);
        out.put("opened", where);
        return ok(out);
    }

    /** The video of a youtube.com/watch?v=, youtu.be/ or youtube.com/shorts/ link, or null for any other link. */
    private static String youTubeVideo(Uri link) {
        String name = link.getHost().toLowerCase(Locale.ROOT);
        if (name.startsWith("www.")) name = name.substring(4);
        else if (name.startsWith("m.")) name = name.substring(2);
        List<String> path = link.getPathSegments();
        String id = null;
        if (name.equals("youtu.be")) {
            if (!path.isEmpty()) id = path.get(0);
        } else if (name.equals("youtube.com")) {
            if (path.size() == 1 && path.get(0).equals("watch")) {
                id = link.getQueryParameter("v");
            } else if (path.size() >= 2 && path.get(0).equals("shorts")) {
                id = path.get(1);
            }
        }
        return id != null && isVideoId(id) ? id : null;
    }

    private static boolean isVideoId(String id) {
        if (id.length() < 6 || id.length() > 20) return false;
        for (int i = 0; i < id.length(); i++) {
            char c = id.charAt(i);
            boolean allowed = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_';
            if (!allowed) return false;
        }
        return true;
    }

    private static boolean isStartTime(String start) {
        if (start.isEmpty() || start.length() > 12) return false;
        for (int i = 0; i < start.length(); i++) {
            char c = start.charAt(i);
            if (!(c >= '0' && c <= '9') && c != 'h' && c != 'm' && c != 's') return false;
        }
        return true;
    }

    // ---- apps ----

    private PortalHttp.Response apps() throws JSONException {
        PackageManager pm = service.getPackageManager();
        List<ResolveInfo> found = pm.queryIntentActivities(
                new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER), 0);
        Map<String, String> byPackage = new HashMap<>();
        for (ResolveInfo info : found) {
            String pkg = info.activityInfo.packageName;
            if (pkg.equals(service.getPackageName()) || pkg.equals(OWN_PACKAGE) || byPackage.containsKey(pkg)) continue;
            CharSequence name = info.loadLabel(pm);
            byPackage.put(pkg, name != null && name.toString().trim().length() > 0 ? name.toString().trim() : pkg);
        }
        List<Map.Entry<String, String>> sorted = new ArrayList<>(byPackage.entrySet());
        Collator collator = Collator.getInstance();
        Collections.sort(sorted, (a, b) -> collator.compare(a.getValue(), b.getValue()));
        JSONArray out = new JSONArray();
        for (Map.Entry<String, String> app : sorted) {
            JSONObject entry = new JSONObject();
            entry.put("pkg", app.getKey());
            entry.put("label", app.getValue());
            out.put(entry);
        }
        return PortalHttp.Response.json(200, out.toString());
    }

    private PortalHttp.Response icon(String pkg) {
        if (!isPackageName(pkg)) return fail(400, "That is not an app.");
        byte[] png;
        synchronized (art) {
            png = art.get(pkg);
        }
        if (png == null) {
            png = drawArt(pkg);
            if (png == null) return fail(404, "That app has no picture.");
            synchronized (art) {
                art.put(pkg, png);
            }
        }
        return new PortalHttp.Response(200, "image/png", png, null);
    }

    /** The app's TV banner, or its icon when it has none, as a PNG that fits 320 x 180. Only for apps the TV lists. */
    private byte[] drawArt(String pkg) {
        PackageManager pm = service.getPackageManager();
        List<ResolveInfo> found = pm.queryIntentActivities(
                new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LEANBACK_LAUNCHER).setPackage(pkg), 0);
        if (found.isEmpty()) return null;
        ResolveInfo info = found.get(0);
        Drawable picture = banner(pm, info);
        if (picture == null) picture = icon(pm, info);
        if (picture == null) return null;
        int w = picture.getIntrinsicWidth(), h = picture.getIntrinsicHeight();
        if (w <= 0 || h <= 0) {
            // A colour or a shape has no size of its own: it fills the frame.
            w = ART_W;
            h = ART_H;
        }
        float scale = Math.min(ART_W / (float) w, ART_H / (float) h);
        int width = Math.max(1, Math.round(w * scale)), height = Math.max(1, Math.round(h * scale));
        Bitmap bitmap;
        try {
            bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        } catch (RuntimeException | OutOfMemoryError noRoom) {
            return null;
        }
        try {
            picture.setBounds(0, 0, width, height);
            picture.draw(new Canvas(bitmap));
            ByteArrayOutputStream out = new ByteArrayOutputStream(32 * 1024);
            if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)) return null;
            return out.toByteArray();
        } catch (RuntimeException broken) {
            return null;
        } finally {
            bitmap.recycle();
        }
    }

    private static Drawable banner(PackageManager pm, ResolveInfo info) {
        int id = info.activityInfo.banner != 0 ? info.activityInfo.banner : info.activityInfo.applicationInfo.banner;
        Drawable banner = id != 0 ? atDensity(pm, info.activityInfo.applicationInfo, id, DisplayMetrics.DENSITY_XHIGH) : null;
        if (banner == null) banner = info.activityInfo.loadBanner(pm);
        if (banner == null) return null;
        // Some apps declare a small square image as their banner (the same rule as the tiles on Home): the icon is better.
        int w = banner.getIntrinsicWidth(), h = banner.getIntrinsicHeight();
        return w <= 0 || h <= 0 || w >= h * 1.4f ? banner : null;
    }

    private static Drawable icon(PackageManager pm, ResolveInfo info) {
        int id = info.activityInfo.getIconResource();
        Drawable icon = id != 0 ? atDensity(pm, info.activityInfo.applicationInfo, id, DisplayMetrics.DENSITY_XXHIGH) : null;
        return icon != null ? icon : info.loadIcon(pm);
    }

    /** At a density above the TV's own, so the picture is sharp at the phone's pixel density. */
    private static Drawable atDensity(PackageManager pm, ApplicationInfo app, int id, int density) {
        try {
            Resources resources = pm.getResourcesForApplication(app);
            return resources.getDrawableForDensity(id, density, null);
        } catch (PackageManager.NameNotFoundException | RuntimeException unavailable) {
            return null;
        }
    }

    private PortalHttp.Response launch(JSONObject body) {
        String pkg = body.optString("pkg", "");
        if (!isPackageName(pkg)) return fail(400, "That is not an app.");
        Intent open = service.getPackageManager().getLeanbackLaunchIntentForPackage(pkg);
        if (open == null) return fail(409, "That app cannot be opened on the TV.");
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return onMain(() -> startNow(open) ? ok() : fail(409, "That app did not open."));
    }

    private static boolean isPackageName(String pkg) {
        if (pkg == null || pkg.isEmpty() || pkg.length() > 255) return false;
        for (int i = 0; i < pkg.length(); i++) {
            char c = pkg.charAt(i);
            if (!(c >= 'a' && c <= 'z') && !(c >= 'A' && c <= 'Z') && !(c >= '0' && c <= '9') && c != '.' && c != '_') {
                return false;
            }
        }
        return true;
    }

    // ---- the main thread ----

    /**
     * Global actions, the focused text box and activity starts, on the main thread, where the service's own work runs.
     * The request waits for it a while; one that comes too late is not done at all, so a Back pressed on the phone
     * never lands seconds later on whatever is on the screen by then.
     */
    private PortalHttp.Response onMain(Callable<PortalHttp.Response> work) {
        FutureTask<PortalHttp.Response> task = new FutureTask<>(work);
        if (!main.post(task)) return fail(503, "The TV is closing the door.");
        try {
            return task.get(MAIN_WAIT_MS, TimeUnit.MILLISECONDS);
        } catch (TimeoutException late) {
            task.cancel(false);
            return fail(503, "The TV is busy. Try again.");
        } catch (InterruptedException closing) {
            task.cancel(false);
            Thread.currentThread().interrupt();
            return fail(503, "The TV is closing the door.");
        } catch (ExecutionException failed) {
            return fail(500, "The TV could not do that.");
        }
    }

    /** On the main thread. False when nothing on the TV takes the intent. */
    private boolean startNow(Intent intent) {
        try {
            service.startActivity(intent);
            return true;
        } catch (ActivityNotFoundException | SecurityException refused) {
            return false;
        }
    }

    // ---- the network ----

    /**
     * The TV's IPv4 address on Wi-Fi, or on Ethernet when there is no Wi-Fi, never a VPN's: with a VPN up, the VPN is
     * the active network, and its address means nothing to a phone on the sofa.
     */
    @SuppressWarnings("deprecation")
    private String homeAddress() {
        ConnectivityManager connectivity = service.getSystemService(ConnectivityManager.class);
        if (connectivity == null) return null;
        String wired = null;
        try {
            for (Network network : connectivity.getAllNetworks()) {
                NetworkCapabilities caps = connectivity.getNetworkCapabilities(network);
                if (caps == null || caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN)) continue;
                boolean wifi = caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);
                if (!wifi && !caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) continue;
                LinkProperties link = connectivity.getLinkProperties(network);
                if (link == null) continue;
                for (LinkAddress address : link.getLinkAddresses()) {
                    InetAddress ip = address.getAddress();
                    if (!(ip instanceof Inet4Address) || ip.isLoopbackAddress() || !PortalHttp.isHomeAddress(ip)) continue;
                    if (wifi) return ip.getHostAddress();
                    if (wired == null) wired = ip.getHostAddress();
                }
            }
        } catch (RuntimeException noAnswer) {
            // The connectivity service is restarting: whatever was found so far.
        }
        return wired;
    }

    // ---- small helpers ----

    private static JSONObject body(PortalHttp.Request request) {
        if (request.body.length == 0) return new JSONObject();
        try {
            Object value = new JSONTokener(new String(request.body, StandardCharsets.UTF_8)).nextValue();
            return value instanceof JSONObject ? (JSONObject) value : null;
        } catch (JSONException malformed) {
            return null;
        }
    }

    private static PortalHttp.Response ok() {
        return PortalHttp.Response.json(200, "{\"ok\":true}");
    }

    private static PortalHttp.Response ok(JSONObject out) {
        return PortalHttp.Response.json(200, out.toString());
    }

    private static PortalHttp.Response fail(int status, String message) {
        return PortalHttp.Response.error(status, message);
    }

    /**
     * The 401 of the state, with the TV's name: a phone looking for TVs on the Wi-Fi shows it before pairing. Nothing
     * else in it, and the name is no secret (the TV's own Google remote service says it on the Wi-Fi already).
     */
    private PortalHttp.Response notPaired() {
        String message = "This phone is not paired with the TV.";
        try {
            JSONObject out = new JSONObject();
            out.put("ok", false);
            out.put("error", message);
            String tv = deviceName();
            if (tv != null) out.put("tv", tv);
            return PortalHttp.Response.json(401, out.toString());
        } catch (JSONException broken) {
            return fail(401, message);
        }
    }

    private static PortalHttp.Response notAllowed() {
        return fail(405, "Not with this method.");
    }

    private static final char[] HEX = "0123456789abcdef".toCharArray();

    private static String hex(byte[] bytes) {
        char[] out = new char[bytes.length * 2];
        for (int i = 0; i < bytes.length; i++) {
            out[2 * i] = HEX[(bytes[i] >> 4) & 0xF];
            out[2 * i + 1] = HEX[bytes[i] & 0xF];
        }
        return new String(out);
    }

    private static byte[] unhex(String text) {
        if (text.isEmpty() || text.length() % 2 != 0) return null;
        byte[] out = new byte[text.length() / 2];
        for (int i = 0; i < out.length; i++) {
            int high = Character.digit(text.charAt(2 * i), 16), low = Character.digit(text.charAt(2 * i + 1), 16);
            if (high < 0 || low < 0) return null;
            out[i] = (byte) (high << 4 | low);
        }
        return out;
    }
}
