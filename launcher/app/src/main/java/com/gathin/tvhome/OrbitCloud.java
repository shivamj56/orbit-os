package com.gathin.tvhome;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Iterator;
import java.util.Locale;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Orbit from anywhere (phone/SPEC.md, "From anywhere"): the phone and this TV sign in to the same Firebase project as
 * the same Google account, and the phone's commands come through its Realtime Database, as the door's come over the
 * Wi-Fi. No Firebase SDK on the TV: REST, and one streaming GET (server-sent events) of the account's node, on a thread
 * of its own. While the screen is on that is one idle connection; with the screen off nothing runs at all.
 *
 * <p>Linking, once: not linked yet, the TV signs in anonymously and puts an eight-digit code under /link, which the
 * Island shows when Home comes back. Orbit on the phone, signed in with Google, writes its Google ID token under that
 * code (an iPhone signed in with Apple writes {@code apple.com|<nonce>|<Apple's identity token>}); the TV reads it,
 * takes the code away while still anonymous, and signs in with the token: from then on it is that account, and its
 * session (a Firebase refresh token, nothing of Google's or Apple's) is kept in this app's own storage. Tokens never go
 * to the log.
 *
 * <p>Linked: the TV says it is online (every minute, every 15 s while a phone watches), takes the commands that arrive
 * while its stream is open (a command already waiting when it connects is stale, and only deleted), answers each through
 * the door's own routes, and while Orbit is open (the phone's watch heartbeat) writes the state every two seconds.
 */
final class OrbitCloud {

    interface Host {
        /** Show the eight-digit link code in the Island, or take it away (null). Main thread. */
        void showLinkCode(String code);

        /** The TV is now this account's (Google, or an iPhone's Apple ID). Main thread. */
        void linked(String email);

        /** One of the door's routes, for a command from the cloud. On the cloud's work thread. */
        PortalHttp.Response handle(String path, JSONObject body);
    }

    private static final String PREFS = "orbit-cloud";
    private static final long CODE_MS = 10 * 60_000L, SHOW_AGAIN_MS = 3 * 60_000L;
    private static final long ONLINE_MS = 60_000L, ONLINE_WATCHED_MS = 15_000L, STATE_MS = 2_000L, WATCHED_MS = 25_000L;
    /** Firebase sends a keep-alive event every 30 s or so: a stream silent this long is dead. */
    private static final int STREAM_READ_MS = 90_000;
    private static final int CONNECT_MS = 10_000, READ_MS = 15_000;
    private static final String IDENTITY = "https://identitytoolkit.googleapis.com/v1/accounts:";
    private static final String SECURE_TOKEN = "https://securetoken.googleapis.com/v1/token?key=";
    /** How an iPhone signed in with Apple marks its link token. */
    static final String APPLE_PREFIX = "apple.com|";

    private final Context context;
    private final Host host;
    private final String key, db;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final SecureRandom random = new SecureRandom();
    private final ScheduledExecutorService work = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "orbit-cloud-work");
        t.setDaemon(true);
        return t;
    });
    /** Help mode's pictures go up on their own thread, so a slow upload never holds up a command. */
    private final java.util.concurrent.ExecutorService uploads = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "orbit-cloud-screen");
        t.setDaemon(true);
        return t;
    });
    private volatile boolean uploading;
    private final Object signal = new Object();
    private final BroadcastReceiver screen = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent intent) {
            setScreenOn(Intent.ACTION_SCREEN_ON.equals(intent.getAction()));
        }
    };

    private volatile boolean running, screenOn = true, codeWanted;
    private Thread loop;
    private volatile HttpURLConnection stream;

    /** The session, under {@code this}. */
    private String uid, refresh, idToken, email;
    private long idUntil;
    private boolean linked;
    private volatile String code;
    private volatile long codeUntil, codeShownAt, watchedUntil, lastOnline;

    /** Null when the theme gives no Firebase project: then Orbit works over the Wi-Fi only. */
    static OrbitCloud create(Context context, Host host) {
        String key = Config.themeString(context, "orbit_api_key", context.getString(R.string.orbit_api_key)).trim();
        String db = Config.themeString(context, "orbit_database_url", context.getString(R.string.orbit_database_url)).trim();
        if (key.isEmpty() || !db.startsWith("https://")) return null;
        return new OrbitCloud(context, host, key, db.replaceAll("/+$", ""));
    }

    private OrbitCloud(Context context, Host host, String key, String db) {
        this.context = context;
        this.host = host;
        this.key = key;
        this.db = db;
    }

    void start() {
        if (running) return;
        running = true;
        PowerManager power = context.getSystemService(PowerManager.class);
        screenOn = power == null || power.isInteractive();
        IntentFilter filter = new IntentFilter(Intent.ACTION_SCREEN_ON);
        filter.addAction(Intent.ACTION_SCREEN_OFF);
        context.registerReceiver(screen, filter);
        restore();
        loop = new Thread(this::run, "orbit-cloud");
        loop.setDaemon(true);
        loop.start();
        work.scheduleWithFixedDelay(this::beat, 5, 15, TimeUnit.SECONDS);
    }

    void stop() {
        running = false;
        try {
            context.unregisterReceiver(screen);
        } catch (RuntimeException notRegistered) {
            // Never started.
        }
        closeStream();
        wake();
        work.shutdownNow();
        uploads.shutdownNow();
        main.post(() -> host.showLinkCode(null));
    }

    /** Home came back: a TV not linked yet shows its code (a new one when the last ran out), at most every 3 minutes. */
    void homeResumed() {
        if (!running || isLinked()) return;
        long now = SystemClock.elapsedRealtime();
        if (codeShownAt != 0L && now - codeShownAt < SHOW_AGAIN_MS) return;
        String current = code;
        if (current != null && now < codeUntil - 60_000L) {
            codeShownAt = now;
            main.post(() -> host.showLinkCode(current));
            return;
        }
        codeWanted = true;
        wake();
    }

    private synchronized boolean isLinked() {
        return linked;
    }

    /** For the Control Center's Orbit pill. */
    boolean linkedNow() {
        return isLinked();
    }

    /** A phone watched through the cloud within the last half minute (its heartbeat comes every 10 s). */
    boolean watchedRecently() {
        return running && isLinked() && SystemClock.elapsedRealtime() < watchedUntil + 5_000L;
    }

    /** Help mode: the newest picture of the screen for the phone; dropped while the last one is still going up. */
    void sendScreen(byte[] jpeg, int w, int h, int seq) {
        if (!running || !isLinked() || uploading) return;
        uploading = true;
        try {
            uploads.execute(() -> {
                try {
                    JSONObject frame = new JSONObject().put("at", serverTime()).put("seq", seq).put("w", w).put("h", h)
                            .put("jpg", Base64.encodeToString(jpeg, Base64.NO_WRAP));
                    quietly("PUT", "/orbit/" + currentUid() + "/screen", frame.toString());
                } catch (JSONException impossible) {
                    // A picture that cannot be written as JSON is not sent.
                } finally {
                    uploading = false;
                }
            });
        } catch (RuntimeException shutDown) {
            uploading = false;
        }
    }

    /** Help is over: the last picture does not stay in the database. */
    void clearScreen() {
        if (!running || !isLinked()) return;
        try {
            uploads.execute(() -> quietly("DELETE", "/orbit/" + currentUid() + "/screen", null));
        } catch (RuntimeException shutDown) {
            // Stopping anyway.
        }
    }

    /** The linked Google account's first name, from the ID token's own "name" claim (no request); null without one. */
    String firstName() {
        String token = token();
        if (!isLinked() || token == null) return null;
        try {
            String[] parts = token.split("\\.");
            if (parts.length < 2) return null;
            byte[] json = Base64.decode(parts[1], Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
            String name = new JSONObject(new String(json, StandardCharsets.UTF_8)).optString("name", "").trim();
            if (name.isEmpty()) return null;
            int space = name.indexOf(' ');
            String first = space > 0 ? name.substring(0, space) : name;
            // Google keeps the name as it was typed ("shivam"); on the TV it is a name, so it starts with a capital.
            return first.substring(0, 1).toUpperCase(Locale.ROOT) + first.substring(1);
        } catch (IllegalArgumentException | JSONException unreadable) {
            return null;
        }
    }

    private void setScreenOn(boolean on) {
        screenOn = on;
        if (!on) closeStream();
        wake();
    }

    // ---- the loop ----

    private void run() {
        long backoff = 2_000L;
        while (running) {
            if (!screenOn) {
                pause(0L);
                continue;
            }
            try {
                if (isLinked()) follow();
                else waitForLink();
                backoff = 2_000L;
            } catch (IOException | JSONException | RuntimeException failed) {
                if (!running) return;
                pause(backoff);
                backoff = Math.min(60_000L, backoff * 2);
            }
        }
    }

    private void pause(long ms) {
        synchronized (signal) {
            try {
                if (ms <= 0L) signal.wait();
                else signal.wait(ms);
            } catch (InterruptedException stop) {
                Thread.currentThread().interrupt();
            }
        }
    }

    private void wake() {
        synchronized (signal) {
            signal.notifyAll();
        }
    }

    // ---- linking ----

    private void waitForLink() throws IOException, JSONException {
        if (!codeWanted && code == null) {
            pause(0L);
            return;
        }
        ensureSession(true);
        long now = SystemClock.elapsedRealtime();
        if (code == null || now >= codeUntil) {
            String fresh = String.format(Locale.ROOT, "%08d", random.nextInt(100_000_000));
            JSONObject entry = new JSONObject().put("tv", currentUid()).put("at", serverTime());
            write("PUT", "/link/" + fresh, entry.toString());
            code = fresh;
            codeUntil = now + CODE_MS;
            codeShownAt = now;
            codeWanted = false;
            main.post(() -> host.showLinkCode(fresh));
        }
        String token = awaitToken(code, codeUntil - SystemClock.elapsedRealtime());
        String used = code;
        if (token == null) {
            if (SystemClock.elapsedRealtime() >= codeUntil) {
                quietly("DELETE", "/link/" + used, null);
                code = null;
                main.post(() -> host.showLinkCode(null));
            }
            return;
        }
        // Taken away while still the anonymous TV that put it there; after the sign-in the rules no longer let it.
        quietly("DELETE", "/link/" + used, null);
        code = null;
        signInWithLinkToken(token);
        String mail = email();
        main.post(() -> {
            host.showLinkCode(null);
            host.linked(mail);
        });
    }

    /** The token the phone wrote under the code, or null when the code ran out first (or the screen went off). */
    private String awaitToken(String linkCode, long ms) throws IOException, JSONException {
        if (ms <= 0L) return null;
        long until = SystemClock.elapsedRealtime() + ms;
        HttpURLConnection c = openStream("/link/" + linkCode + "/token");
        try (BufferedReader in = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
            String event = null;
            StringBuilder data = new StringBuilder();
            for (String line; (line = in.readLine()) != null; ) {
                if (!running || !screenOn || SystemClock.elapsedRealtime() > until) return null;
                if (line.startsWith("event:")) {
                    event = line.substring(6).trim();
                } else if (line.startsWith("data:")) {
                    data.append(line.substring(5).trim());
                } else if (line.isEmpty()) {
                    if ("put".equals(event) && data.length() > 0) {
                        Object value = new JSONObject(data.toString()).opt("data");
                        if (value instanceof String && ((String) value).length() > 20) return (String) value;
                    } else if ("cancel".equals(event) || "auth_revoked".equals(event)) {
                        return null;
                    }
                    event = null;
                    data.setLength(0);
                }
            }
            return null;
        } finally {
            c.disconnect();
            stream = null;
        }
    }

    // ---- following the account's node ----

    private void follow() throws IOException, JSONException {
        ensureSession(false);
        String me = currentUid();
        work.execute(() -> {
            quietly("PUT", "/orbit/" + me + "/tv/name", JSONObject.quote(deviceName()));
            online();
        });
        HttpURLConnection c = openStream("/orbit/" + me);
        try (BufferedReader in = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
            String event = null;
            StringBuilder data = new StringBuilder();
            boolean first = true;
            for (String line; (line = in.readLine()) != null; ) {
                if (!running || !screenOn || !isLinked()) return;
                if (line.startsWith("event:")) {
                    event = line.substring(6).trim();
                } else if (line.startsWith("data:")) {
                    data.append(line.substring(5).trim());
                } else if (line.isEmpty()) {
                    if ("auth_revoked".equals(event) || "cancel".equals(event)) return;
                    // Help mode's own pictures come back on this stream too: 30 KB each, never read.
                    boolean ownPicture = data.indexOf("{\"path\":\"/screen") == 0;
                    if (("put".equals(event) || "patch".equals(event)) && data.length() > 0 && !ownPicture) {
                        JSONObject message = new JSONObject(data.toString());
                        took(message.optString("path", "/"), message.opt("data"), "patch".equals(event), first);
                        first = false;
                    }
                    event = null;
                    data.setLength(0);
                }
            }
        } finally {
            c.disconnect();
            stream = null;
        }
    }

    /** One change under /orbit/{uid}: path is relative to it. The TV's own writes (tv/state, res) come back too. */
    private void took(String path, Object value, boolean patch, boolean first) throws JSONException {
        if (patch && value instanceof JSONObject) {
            JSONObject map = (JSONObject) value;
            for (Iterator<String> keys = map.keys(); keys.hasNext(); ) {
                String child = keys.next();
                took(join(path, child), map.opt(child), false, first);
            }
            return;
        }
        if (path.equals("/")) {
            if (!(value instanceof JSONObject)) return;
            JSONObject all = (JSONObject) value;
            JSONObject waiting = all.optJSONObject("cmd");
            if (waiting != null) {
                // Stale: they waited while this TV was not listening. Only taken away.
                for (Iterator<String> ids = waiting.keys(); ids.hasNext(); ) {
                    String id = ids.next();
                    work.execute(() -> quietly("DELETE", "/orbit/" + currentUid() + "/cmd/" + id, null));
                }
            }
            JSONObject tv = all.optJSONObject("tv");
            if (tv != null && tv.optBoolean("unlink", false)) unlink();
            return;
        }
        if (path.equals("/cmd") && value instanceof JSONObject) {
            JSONObject map = (JSONObject) value;
            for (Iterator<String> ids = map.keys(); ids.hasNext(); ) {
                String id = ids.next();
                took("/cmd/" + id, map.opt(id), false, first);
            }
            return;
        }
        if (path.startsWith("/cmd/") && value instanceof JSONObject) {
            String id = path.substring(5);
            if (id.contains("/")) return;
            JSONObject command = (JSONObject) value;
            if (first) {
                work.execute(() -> quietly("DELETE", "/orbit/" + currentUid() + "/cmd/" + id, null));
                return;
            }
            work.execute(() -> answer(id, command));
            return;
        }
        if (path.equals("/watch") && value != null && value != JSONObject.NULL && !first) {
            watched();
            return;
        }
        if (path.equals("/tv/unlink") && Boolean.TRUE.equals(value)) unlink();
        else if (path.equals("/tv") && value instanceof JSONObject && ((JSONObject) value).optBoolean("unlink", false)) unlink();
    }

    private static String join(String path, String child) {
        return (path.endsWith("/") ? path : path + "/") + child;
    }

    /** On the work thread: one command, answered through the door's own route. */
    private void answer(String id, JSONObject command) {
        String me = currentUid();
        try {
            JSONObject body = command.optJSONObject("body");
            PortalHttp.Response r = host.handle(command.optString("path", ""), body != null ? body : new JSONObject());
            JSONObject res = new JSONObject().put("status", r.status);
            if (r.type.startsWith("image/")) {
                res.put("body", new JSONObject().put("png", Base64.encodeToString(r.body, Base64.NO_WRAP)));
            } else {
                Object parsed = r.body.length == 0 ? new JSONObject()
                        : new JSONTokener(new String(r.body, StandardCharsets.UTF_8)).nextValue();
                res.put("body", parsed instanceof JSONObject || parsed instanceof JSONArray ? parsed : new JSONObject());
            }
            write("PUT", "/orbit/" + me + "/res/" + id, res.toString());
        } catch (IOException | JSONException | RuntimeException failed) {
            // No answer: the phone gives up after 8 s and says the TV did not answer.
        }
        quietly("DELETE", "/orbit/" + me + "/cmd/" + id, null);
        if (SystemClock.elapsedRealtime() < watchedUntil) pushState();
    }

    private void watched() {
        long now = SystemClock.elapsedRealtime();
        boolean idle = now > watchedUntil;
        watchedUntil = now + WATCHED_MS;
        if (idle) {
            work.execute(this::online);
            work.execute(this::stateTick);
        }
    }

    private void stateTick() {
        if (!running || !screenOn || !isLinked() || SystemClock.elapsedRealtime() > watchedUntil) return;
        pushState();
        try {
            work.schedule(this::stateTick, STATE_MS, TimeUnit.MILLISECONDS);
        } catch (RuntimeException shutDown) {
            // Stopping.
        }
    }

    private void pushState() {
        try {
            PortalHttp.Response r = host.handle("/api/state", new JSONObject());
            JSONObject state = new JSONObject(new String(r.body, StandardCharsets.UTF_8));
            state.remove("ok");
            write("PUT", "/orbit/" + currentUid() + "/tv/state", state.toString());
        } catch (IOException | JSONException | RuntimeException failed) {
            // The next tick tries again.
        }
    }

    /** Every 15 s on the work thread: "online" at its own pace, only while linked and awake. */
    private void beat() {
        if (!running || !screenOn || !isLinked()) return;
        long gap = SystemClock.elapsedRealtime() < watchedUntil ? ONLINE_WATCHED_MS : ONLINE_MS;
        if (SystemClock.elapsedRealtime() - lastOnline >= gap - 1_000L) online();
    }

    private void online() {
        if (quietly("PUT", "/orbit/" + currentUid() + "/tv/online", serverTime().toString())) {
            lastOnline = SystemClock.elapsedRealtime();
        }
    }

    /** The phone asked (tv/unlink): back to a TV that belongs to nobody and shows a code. */
    private void unlink() {
        String me = currentUid();
        work.execute(() -> {
            quietly("DELETE", "/orbit/" + me + "/tv", null);
            synchronized (this) {
                linked = false;
                uid = refresh = idToken = email = null;
                idUntil = 0L;
            }
            save();
            closeStream();
            codeWanted = false;
            wake();
        });
    }

    // ---- the session ----

    /** A fresh ID token: an anonymous account when not linked (made on first use), the Google account's when linked. */
    private void ensureSession(boolean anonymousIfNone) throws IOException, JSONException {
        String keep;
        synchronized (this) {
            if (idToken != null && SystemClock.elapsedRealtime() < idUntil - 5 * 60_000L) return;
            keep = refresh;
        }
        if (keep == null) {
            if (!anonymousIfNone) throw new IOException("no session");
            JSONObject out = post(IDENTITY + "signUp?key=" + key, new JSONObject().put("returnSecureToken", true));
            setSession(out.getString("localId"), out.getString("refreshToken"), out.getString("idToken"),
                    out.optLong("expiresIn", 3600L), null, false);
            return;
        }
        String form = "grant_type=refresh_token&refresh_token=" + URLEncoder.encode(keep, "UTF-8");
        JSONObject out = request("POST", SECURE_TOKEN + key, form, "application/x-www-form-urlencoded");
        synchronized (this) {
            setSession(out.getString("user_id"), out.getString("refresh_token"), out.getString("id_token"),
                    out.optLong("expires_in", 3600L), email, linked);
        }
    }

    /** Signs in as the account whose token the phone wrote under the link code ({@link #idpPostBody}). */
    private void signInWithLinkToken(String token) throws IOException, JSONException {
        JSONObject body = new JSONObject()
                .put("postBody", idpPostBody(token))
                .put("requestUri", "http://localhost")
                .put("returnSecureToken", true);
        JSONObject out = post(IDENTITY + "signInWithIdp?key=" + key, body);
        setSession(out.getString("localId"), out.getString("refreshToken"), out.getString("idToken"),
                out.optLong("expiresIn", 3600L), out.optString("email", null), true);
    }

    /**
     * The signInWithIdp postBody for a link token: a Google ID token as it is, or an iPhone's Sign in with Apple
     * {@code apple.com|<nonce>|<identity token>}, whose nonce Firebase checks the token against (phone/SPEC.md, "Sign in
     * with Apple"). Neither a nonce (base64url) nor a JWT holds a {@code |}.
     */
    static String idpPostBody(String token) throws IOException {
        if (token.startsWith(APPLE_PREFIX)) {
            String[] parts = token.split("\\|", -1);
            if (parts.length != 3 || parts[1].isEmpty() || parts[2].isEmpty()) throw new IOException("unreadable Apple token");
            return "id_token=" + URLEncoder.encode(parts[2], "UTF-8") + "&providerId=apple.com&nonce="
                    + URLEncoder.encode(parts[1], "UTF-8");
        }
        return "id_token=" + URLEncoder.encode(token, "UTF-8") + "&providerId=google.com";
    }

    private synchronized void setSession(String id, String refreshToken, String token, long expiresIn, String mail,
                                         boolean isLinked) {
        uid = id;
        refresh = refreshToken;
        idToken = token;
        idUntil = SystemClock.elapsedRealtime() + expiresIn * 1000L;
        email = mail;
        linked = isLinked;
        save();
    }

    private synchronized String currentUid() {
        return uid;
    }

    private synchronized String email() {
        return email;
    }

    private synchronized String token() {
        return idToken;
    }

    private void restore() {
        SharedPreferences p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        synchronized (this) {
            uid = p.getString("uid", null);
            refresh = p.getString("refresh", null);
            email = p.getString("email", null);
            linked = p.getBoolean("linked", false) && uid != null && refresh != null;
        }
    }

    private synchronized void save() {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString("uid", uid).putString("refresh", refresh).putString("email", email)
                .putBoolean("linked", linked).apply();
    }

    // ---- HTTP ----

    private static JSONObject serverTime() {
        try {
            return new JSONObject().put(".sv", "timestamp");
        } catch (JSONException impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    private HttpURLConnection openStream(String path) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(db + path + ".json?auth=" + token()).openConnection();
        c.setConnectTimeout(CONNECT_MS);
        c.setReadTimeout(STREAM_READ_MS);
        c.setRequestProperty("Accept", "text/event-stream");
        stream = c;
        int status = c.getResponseCode();
        if (status == 401) {
            synchronized (this) {
                idUntil = 0L;
            }
            c.disconnect();
            throw new IOException("token refused");
        }
        if (status >= 400) {
            c.disconnect();
            throw new IOException("stream " + status);
        }
        return c;
    }

    private void closeStream() {
        HttpURLConnection c = stream;
        if (c != null) c.disconnect();
    }

    /** A database write; true when it went through. Never throws. */
    private boolean quietly(String method, String path, String json) {
        try {
            write(method, path, json);
            return true;
        } catch (IOException | JSONException | RuntimeException failed) {
            return false;
        }
    }

    private void write(String method, String path, String json) throws IOException, JSONException {
        String url = db + path + ".json?auth=" + token();
        try {
            request(method, url, json, "application/json");
        } catch (HttpStatus refused) {
            if (refused.status != 401) throw refused;
            synchronized (this) {
                idUntil = 0L;
            }
            ensureSession(false);
            request(method, db + path + ".json?auth=" + token(), json, "application/json");
        }
    }

    private JSONObject post(String url, JSONObject body) throws IOException, JSONException {
        return request("POST", url, body.toString(), "application/json");
    }

    private static final class HttpStatus extends IOException {
        final int status;

        HttpStatus(int status) {
            super("HTTP " + status);
            this.status = status;
        }
    }

    private static JSONObject request(String method, String url, String body, String type) throws IOException, JSONException {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        try {
            c.setRequestMethod(method);
            c.setConnectTimeout(CONNECT_MS);
            c.setReadTimeout(READ_MS);
            if (body != null) {
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", type + "; charset=utf-8");
                byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
                c.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream out = c.getOutputStream()) {
                    out.write(bytes);
                }
            }
            int status = c.getResponseCode();
            if (status >= 400) throw new HttpStatus(status);
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream all = new ByteArrayOutputStream();
                byte[] chunk = new byte[4096];
                for (int n; (n = in.read(chunk)) > 0; ) all.write(chunk, 0, n);
                Object value = new JSONTokener(all.toString("UTF-8")).nextValue();
                return value instanceof JSONObject ? (JSONObject) value : new JSONObject();
            }
        } finally {
            c.disconnect();
        }
    }

    private String deviceName() {
        try {
            String name = android.provider.Settings.Global.getString(context.getContentResolver(),
                    android.provider.Settings.Global.DEVICE_NAME);
            return name != null && !name.trim().isEmpty() ? name.trim() : "TV";
        } catch (RuntimeException unreadable) {
            return "TV";
        }
    }
}
