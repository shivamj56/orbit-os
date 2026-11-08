package com.gathin.tvhome;

import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.graphics.Bitmap;
import android.media.MediaMetadata;
import android.media.session.MediaController;
import android.media.session.MediaSessionManager;
import android.media.session.PlaybackState;
import android.os.Build;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.Process;
import android.os.SystemClock;
import android.util.AtomicFile;

import androidx.annotation.RequiresApi;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * What has been playing on this TV, kept here because most apps publish little of it: YouTube has no Continue watching
 * rows at all. Android tells a notification listener what every app's media session is playing, with its title and
 * picture, and {@link GuardRevival} is that listener once allowed
 * ({@code cmd notification allow_listener com.gathin.tvhome/.GuardRevival}). Without that, the list stays empty and
 * nothing else changes. An app that plays without saying what still counts: it gets an entry of its own, with its name
 * for a title, because going back to it still continues what was playing.
 *
 * <p>It lives in the key helper, which runs all the time, and everything stays on the TV, in this app's own files.
 */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
final class WatchHistory {

    static final class Entry {
        String pkg = "", title = "", detail = "", artUri = "", link = "";
        long lastMs, position, duration;

        String key() {
            return keyOf(pkg, title);
        }
    }

    static String keyOf(String pkg, String title) {
        return pkg + "|" + title.trim().toLowerCase(Locale.ROOT);
    }

    private static final int KEEP = 24;
    /** Less than this is a preview playing by itself or a look at something, not something being watched. */
    private static final long WATCHED_MS = 15_000L;
    private static final long TICK_MS = 10_000L;
    private static final long SAVE_EVERY_MS = 30_000L;
    private static final long LISTEN_AGAIN_MS = 20_000L;
    private static final int ART_W = 384;
    private static final String FILE = "watch-history.json";
    private static final String ART_DIR = "watch-art";

    private static Context app;
    private static HandlerThread thread;
    private static Handler handler;
    private static MediaSessionManager sessions;
    private static boolean loaded;
    private static long savedAt;
    private static boolean unsaved;
    private static final List<Watched> watching = new ArrayList<>();
    private static final List<Entry> entries = new ArrayList<>();
    private static final Map<String, PendingIntent> players = new HashMap<>();
    /** Told, on the main thread, when the list has changed: the owner may be looking at it already. */
    private static Runnable onChange;
    private static final Handler MAIN = new Handler(android.os.Looper.getMainLooper());
    private static boolean changeWaiting;

    private WatchHistory() {
    }

    private static final MediaSessionManager.OnActiveSessionsChangedListener CHANGED = WatchHistory::follow;
    private static final Runnable TRY_AGAIN = WatchHistory::listen;

    private static final Runnable TICK = new Runnable() {
        @Override
        public void run() {
            boolean playing = false;
            for (Watched w : watching) {
                w.note();
                playing |= w.playingSince != 0L;
            }
            if (playing) handler.postDelayed(this, TICK_MS);
        }
    };

    static synchronized void start(Context context) {
        if (thread != null) return;
        app = context.getApplicationContext();
        thread = new HandlerThread("watch-history", Process.THREAD_PRIORITY_BACKGROUND);
        thread.start();
        handler = new Handler(thread.getLooper());
        handler.post(() -> {
            synchronized (WatchHistory.class) {
                load(app);
            }
            listen();
        });
    }

    /** The listener's connection can come after this: an install takes its approval away for a moment. */
    static synchronized void listenerConnected() {
        if (thread != null) handler.post(WatchHistory::listen);
    }

    private static void listen() {
        if (sessions != null) return;
        MediaSessionManager manager = app.getSystemService(MediaSessionManager.class);
        ComponentName listener = new ComponentName(app, GuardRevival.class);
        try {
            manager.addOnActiveSessionsChangedListener(CHANGED, listener, handler);
            sessions = manager;
            follow(manager.getActiveSessions(listener));
        } catch (SecurityException notAllowedYet) {
            handler.removeCallbacks(TRY_AGAIN);
            handler.postDelayed(TRY_AGAIN, LISTEN_AGAIN_MS);
        }
    }

    static synchronized void stop() {
        if (thread == null) return;
        Handler h = handler;
        HandlerThread t = thread;
        h.post(() -> {
            if (sessions != null) sessions.removeOnActiveSessionsChangedListener(CHANGED);
            sessions = null;
            for (Watched w : watching) w.controller.unregisterCallback(w);
            watching.clear();
            h.removeCallbacks(TICK);
            h.removeCallbacks(TRY_AGAIN);
            save();
            t.quitSafely();
        });
        thread = null;
    }

    static synchronized void setOnChange(Runnable listener) {
        onChange = listener;
    }

    private static synchronized void tellChanged() {
        if (onChange == null || changeWaiting) return;
        changeWaiting = true;
        MAIN.postDelayed(() -> {
            Runnable listener;
            synchronized (WatchHistory.class) {
                changeWaiting = false;
                listener = onChange;
            }
            if (listener != null) listener.run();
        }, 300L);
    }

    /** Newest first. */
    static synchronized List<Entry> snapshot(Context context) {
        load(context.getApplicationContext());
        return new ArrayList<>(entries);
    }

    /** The app's own way back to its player, for as long as that app is running; null otherwise. */
    static synchronized PendingIntent player(String key) {
        return players.get(key);
    }

    private static void follow(List<MediaController> controllers) {
        if (controllers == null) return;
        List<Watched> gone = new ArrayList<>(watching);
        for (MediaController c : controllers) {
            Watched known = null;
            for (Watched w : watching) {
                if (w.controller.getSessionToken().equals(c.getSessionToken())) known = w;
            }
            if (known != null) {
                gone.remove(known);
            } else {
                Watched w = new Watched(c);
                watching.add(w);
                c.registerCallback(w, handler);
                w.note();
            }
        }
        for (Watched w : gone) {
            w.note();
            w.controller.unregisterCallback(w);
            watching.remove(w);
        }
        save();
    }

    private static final class Watched extends MediaController.Callback {
        final MediaController controller;
        String title;
        long playingSince, watchedMs;
        MediaMetadata lastGood;
        PlaybackState lastState;

        Watched(MediaController controller) {
            this.controller = controller;
        }

        @Override
        public void onMetadataChanged(MediaMetadata metadata) {
            note();
        }

        @Override
        public void onPlaybackStateChanged(PlaybackState state) {
            note();
        }

        void note() {
            long now = SystemClock.elapsedRealtime();
            MediaMetadata m;
            PlaybackState s;
            try {
                m = controller.getMetadata();
                s = controller.getPlaybackState();
            } catch (RuntimeException sessionGone) {
                return;
            }
            String shown = titleOf(m);
            boolean playing = s != null && s.getState() == PlaybackState.STATE_PLAYING;
            // A changed title is a new video, unless the app is only clearing its title because it has been left.
            boolean sameVideo = shown == null ? title == null || !playing : shown.equals(title);
            if (playingSince != 0L) watchedMs += now - playingSince;
            if (!sameVideo) {
                if (title != null && watchedMs >= WATCHED_MS && lastGood != null) {
                    record(controller, lastGood, lastState, title, now);
                }
                title = shown;
                watchedMs = 0L;
            }
            boolean started = playing && playingSince == 0L;
            boolean stopped = !playing && playingSince != 0L;
            playingSince = playing ? now : 0L;
            if (m != null && shown != null) {
                lastGood = m;
                lastState = s;
            } else if (s != null && s.getPosition() > 0L) {
                lastState = s;
            }
            if (watchedMs >= WATCHED_MS) {
                if (title != null && lastGood != null) record(controller, lastGood, lastState, title, now);
                else if (title == null) recordApp(controller, m, s);
            }
            if (started) {
                handler.removeCallbacks(TICK);
                handler.postDelayed(TICK, TICK_MS);
            }
            if (stopped) {
                save();
                tellChanged();
            }
        }
    }

    /** Playing, with no word of what. The app itself is what there is to go back to. */
    private static synchronized void recordApp(MediaController c, MediaMetadata m, PlaybackState s) {
        String pkg = c.getPackageName();
        String key = keyOf(pkg, "");
        Entry e = null;
        for (Entry candidate : entries) {
            if (candidate.key().equals(key)) e = candidate;
        }
        boolean isNew = e == null;
        if (isNew) {
            e = new Entry();
            e.pkg = pkg;
        } else {
            entries.remove(e);
        }
        entries.add(0, e);
        e.lastMs = System.currentTimeMillis();
        if (s != null && s.getPosition() > 0L) e.position = s.getPosition();
        if (m != null) {
            String link = linkOf(pkg, m);
            if (!link.isEmpty()) e.link = link;
            long duration = m.getLong(MediaMetadata.METADATA_KEY_DURATION);
            if (duration > 0L) e.duration = duration;
        }
        PendingIntent player = c.getSessionActivity();
        if (player != null) players.put(key, player);
        unsaved = true;
        if (isNew) tellChanged();
    }

    private static String titleOf(MediaMetadata m) {
        if (m == null) return null;
        CharSequence t = m.getText(MediaMetadata.METADATA_KEY_DISPLAY_TITLE);
        if (t == null || t.toString().trim().isEmpty()) t = m.getText(MediaMetadata.METADATA_KEY_TITLE);
        if (t == null) return null;
        String title = t.toString().trim();
        return title.length() < 2 ? null : title;
    }

    private static String textOf(MediaMetadata m, String... keys) {
        for (String key : keys) {
            CharSequence t = m.getText(key);
            if (t != null && !t.toString().trim().isEmpty()) return t.toString().trim();
        }
        return "";
    }

    private static synchronized void record(MediaController c, MediaMetadata m, PlaybackState s, String title, long nowElapsed) {
        String pkg = c.getPackageName();
        String key = keyOf(pkg, title);
        Entry e = null;
        for (Entry candidate : entries) {
            if (candidate.key().equals(key)) e = candidate;
        }
        boolean isNew = e == null;
        if (isNew) {
            e = new Entry();
            e.pkg = pkg;
            e.title = title;
        } else {
            entries.remove(e);
        }
        entries.add(0, e);
        // The app says what it plays after all: its entry with no title has served its purpose.
        String appOnly = keyOf(pkg, "");
        for (int i = entries.size() - 1; i >= 0; i--) {
            if (entries.get(i).key().equals(appOnly)) entries.remove(i);
        }
        e.lastMs = System.currentTimeMillis();
        e.detail = textOf(m, MediaMetadata.METADATA_KEY_DISPLAY_SUBTITLE, MediaMetadata.METADATA_KEY_ARTIST,
                MediaMetadata.METADATA_KEY_ALBUM);
        long duration = m.getLong(MediaMetadata.METADATA_KEY_DURATION);
        if (duration > 0L) e.duration = duration;
        if (s != null && s.getPosition() >= 0L) {
            float elapsed = s.getPlaybackSpeed() * (nowElapsed - s.getLastPositionUpdateTime());
            e.position = Math.max(0L, s.getPosition() + (s.getState() == PlaybackState.STATE_PLAYING ? (long) elapsed : 0L));
        }
        if (e.artUri.isEmpty()) e.artUri = artOf(m, key);
        if (e.link.isEmpty()) e.link = linkOf(pkg, m);
        PendingIntent player = c.getSessionActivity();
        if (player != null) players.put(key, player);
        while (entries.size() > KEEP) {
            Entry old = entries.remove(entries.size() - 1);
            players.remove(old.key());
            if (old.artUri.startsWith("file:")) new File(old.artUri.substring(5)).delete();
        }
        unsaved = true;
        if (nowElapsed - savedAt >= SAVE_EVERY_MS) save();
        if (isNew) tellChanged();
    }

    /** The picture the app gives with what it plays: a large enough image of its own first, else an address. */
    private static String artOf(MediaMetadata m, String key) {
        Bitmap picture = null;
        for (String k : new String[]{MediaMetadata.METADATA_KEY_ART, MediaMetadata.METADATA_KEY_ALBUM_ART,
                MediaMetadata.METADATA_KEY_DISPLAY_ICON}) {
            Bitmap b = m.getBitmap(k);
            if (b != null && (picture == null || b.getWidth() > picture.getWidth())) picture = b;
        }
        String address = textOf(m, MediaMetadata.METADATA_KEY_ART_URI, MediaMetadata.METADATA_KEY_ALBUM_ART_URI,
                MediaMetadata.METADATA_KEY_DISPLAY_ICON_URI);
        if (picture == null || (picture.getWidth() < 240 && !address.isEmpty())) return address;
        File dir = new File(app.getFilesDir(), ART_DIR);
        if (!dir.isDirectory() && !dir.mkdirs()) return address;
        File out = new File(dir, Integer.toHexString(key.hashCode()) + ".jpg");
        int h = Math.max(1, Math.round(ART_W * picture.getHeight() / (float) picture.getWidth()));
        try (FileOutputStream stream = new FileOutputStream(out)) {
            Bitmap small = picture.getConfig() == Bitmap.Config.HARDWARE
                    ? picture.copy(Bitmap.Config.ARGB_8888, false) : picture;
            Bitmap sized = Bitmap.createScaledBitmap(small, ART_W, h, true);
            sized.compress(Bitmap.CompressFormat.JPEG, 84, stream);
        } catch (IOException | RuntimeException unwritable) {
            return address;
        }
        return "file:" + out.getPath();
    }

    /** Where the app's media id says what is playing: Prime Video's opens that title's page, its Resume button in focus. */
    private static String linkOf(String pkg, MediaMetadata m) {
        String id = textOf(m, MediaMetadata.METADATA_KEY_MEDIA_ID);
        if (pkg.equals("com.amazon.amazonvideo.livingroom") && id.startsWith("amzn1.dv.gti.")) {
            return "https://app.primevideo.com/detail?gti=" + id;
        }
        return "";
    }

    private static void load(Context context) {
        if (loaded) return;
        loaded = true;
        if (app == null) app = context;
        entries.clear();
        try {
            byte[] raw = new AtomicFile(new File(context.getFilesDir(), FILE)).readFully();
            JSONArray all = new JSONArray(new String(raw, StandardCharsets.UTF_8));
            for (int i = 0; i < all.length(); i++) {
                JSONObject o = all.getJSONObject(i);
                Entry e = new Entry();
                e.pkg = o.getString("pkg");
                e.title = o.getString("title");
                e.detail = o.optString("detail");
                e.artUri = o.optString("art");
                e.link = o.optString("link");
                e.lastMs = o.optLong("last");
                e.position = o.optLong("position");
                e.duration = o.optLong("duration");
                entries.add(e);
            }
        } catch (IOException | JSONException nothingYet) {
            // No history yet, or one that cannot be read: start again.
        }
    }

    private static synchronized void save() {
        if (!unsaved || app == null) return;
        unsaved = false;
        savedAt = SystemClock.elapsedRealtime();
        JSONArray all = new JSONArray();
        AtomicFile file = new AtomicFile(new File(app.getFilesDir(), FILE));
        FileOutputStream out = null;
        try {
            for (Entry e : entries) {
                all.put(new JSONObject().put("pkg", e.pkg).put("title", e.title).put("detail", e.detail)
                        .put("art", e.artUri).put("link", e.link).put("last", e.lastMs)
                        .put("position", e.position).put("duration", e.duration));
            }
            out = file.startWrite();
            out.write(all.toString().getBytes(StandardCharsets.UTF_8));
            file.finishWrite(out);
        } catch (IOException | JSONException unwritable) {
            if (out != null) file.failWrite(out);
        }
    }
}
