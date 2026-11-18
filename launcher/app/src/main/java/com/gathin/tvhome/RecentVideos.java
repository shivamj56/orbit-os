package com.gathin.tvhome;

import android.app.ActivityOptions;
import android.app.PendingIntent;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.BitmapShader;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.LinearGradient;
import android.graphics.Paint;
import android.graphics.RectF;
import android.graphics.Shader;
import android.graphics.drawable.Drawable;
import android.media.tv.TvContract;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.Process;
import android.text.TextUtils;

import androidx.annotation.RequiresApi;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The videos Home shows below the search bar: the rows apps publish to the system's Continue watching
 * (docs/watch-next.md) together with what {@link WatchHistory} saw playing, one card per title, newest first, each with
 * its picture ready in graphics memory. Everything slow happens on a worker thread.
 */
@RequiresApi(Build.VERSION_CODES.TIRAMISU)
final class RecentVideos {

    static final int ART_W = 384, ART_H = 216, ART_RADIUS = 16;
    private static final int SHOW = 14;
    /** How long a Continue watching row counts: rows linger for months after anyone last looked at them. */
    private static final long OLDEST_MS = 90L * 24L * 60L * 60L * 1000L;
    private static final int TYPE_CONTINUE = 0, TYPE_NEXT = 1;
    private static final long MOST_DOWNLOAD = 3L * 1024L * 1024L;
    private static final long SAME_SITTING_MS = 2L * 60L * 60L * 1000L;
    private static final String YOUTUBE = "com.google.android.youtube.tv";
    private static final long YOUTUBE_STILL_OPEN_MS = 30L * 60L * 1000L;

    static final class Item {
        String pkg = "", title = "", detail = "", artUri = "", link = "", appName = "";
        long lastMs, position, duration;
        /** Nothing is known but the app, which was playing: its name is the title, its banner the picture. */
        boolean appOnly;
        /** Never null once the list is out: a picture of the title, or a card with its name while there is none. */
        Bitmap art;
        boolean artReal;
        int accent = 0xFF00C8FF, accent2 = 0xFF7A5CFF;

        String key() {
            return WatchHistory.keyOf(pkg, title);
        }

        /** Between 0 and 1, or a negative number when the app does not say. */
        float progress() {
            return duration > 0L && position > 0L ? Math.min(1f, position / (float) duration) : -1f;
        }
    }

    interface Listener {
        void onRecents(List<Item> items);
        void onRecentArt(Item item);
    }

    private static final Map<String, Bitmap> artCache = new HashMap<>();
    private static int generation;

    private RecentVideos() {
    }

    /** Reads the list. The listener hears on the main thread, and again for each picture that had to be fetched. */
    static void load(Context context, Listener listener) {
        Context app = context.getApplicationContext();
        Handler main = new Handler(Looper.getMainLooper());
        int mine = ++generation;
        new Thread(() -> {
            Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND);
            List<Item> items = read(app);
            List<Item> fetch = new ArrayList<>();
            Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
            for (Item item : items) {
                Bitmap ready;
                synchronized (artCache) {
                    ready = artCache.get(item.artUri);
                }
                if (ready == null && !item.artUri.isEmpty() && !isWeb(item.artUri)) ready = picture(app, item.artUri);
                if (ready == null && isWeb(item.artUri)) ready = picture(app, cached(app, item.artUri).getPath());
                if (ready != null) {
                    remember(item.artUri, ready);
                    setArt(item, ready, GalleryArt.accentsOf(ready));
                } else {
                    item.art = nameCard(app, item, text);
                    if (isWeb(item.artUri)) fetch.add(item);
                }
            }
            main.post(() -> {
                if (mine == generation) listener.onRecents(items);
            });
            for (Item item : fetch) {
                if (mine != generation) return;
                if (!download(app, item.artUri)) continue;
                Bitmap made = picture(app, cached(app, item.artUri).getPath());
                if (made == null) continue;
                remember(item.artUri, made);
                int[] colours = GalleryArt.accentsOf(made);
                main.post(() -> {
                    if (mine != generation) return;
                    setArt(item, made, colours);
                    listener.onRecentArt(item);
                });
            }
            pruneDownloads(app, items);
        }, "recents").start();
    }

    /** Another app needs the memory. */
    static void forget() {
        generation++;
        synchronized (artCache) {
            artCache.clear();
        }
    }

    private static void remember(String uri, Bitmap art) {
        synchronized (artCache) {
            if (artCache.size() > SHOW * 2) artCache.clear();
            artCache.put(uri, art);
        }
    }

    private static void setArt(Item item, Bitmap art, int[] colours) {
        item.art = art;
        item.artReal = true;
        item.accent = colours[0];
        item.accent2 = colours[1];
    }

    // ---- the list --------------------------------------------------------------------------------

    /** The list as it stands, newest first, read on the caller's thread (not the main one): for Movie Night. */
    static List<Item> readNow(Context app) {
        return read(app);
    }

    private static List<Item> read(Context app) {
        Map<String, Item> byKey = new HashMap<>();
        for (WatchHistory.Entry e : WatchHistory.snapshot(app)) {
            Item item = new Item();
            item.pkg = e.pkg;
            item.title = e.title;
            item.detail = e.detail;
            item.artUri = e.artUri;
            item.link = e.link;
            item.lastMs = e.lastMs;
            item.position = e.position;
            item.duration = e.duration;
            byKey.put(item.key(), item);
        }
        readContinueWatching(app, byKey);
        List<Item> all = new ArrayList<>(byKey.values());
        Collections.sort(all, (a, b) -> Long.compare(b.lastMs, a.lastMs));
        PackageManager pm = app.getPackageManager();
        List<Item> shown = new ArrayList<>();
        boolean youtubeSeen = false;
        for (Item item : all) {
            if (shown.size() >= SHOW) break;
            try {
                ApplicationInfo info = pm.getApplicationInfo(item.pkg, 0);
                if (!info.enabled) continue;
                item.appName = pm.getApplicationLabel(info).toString();
            } catch (PackageManager.NameNotFoundException uninstalled) {
                continue;
            }
            if (item.pkg.equals(YOUTUBE)) {
                // YouTube says nothing that leads back to the video. The one it was last on, while that is recent,
                // is still open inside the app, so opening the app is the way back; for any other, its title finds it.
                boolean stillThere = !youtubeSeen && System.currentTimeMillis() - item.lastMs < YOUTUBE_STILL_OPEN_MS;
                youtubeSeen = true;
                if (!stillThere && item.link.isEmpty()) {
                    item.link = "https://www.youtube.com/results?search_query=" + Uri.encode(item.title);
                }
            }
            if (item.title.isEmpty()) {
                // An app with a real title close by says it better than this.
                boolean told = false;
                for (Item other : all) {
                    if (other != item && other.pkg.equals(item.pkg) && !other.title.isEmpty()
                            && Math.abs(other.lastMs - item.lastMs) < SAME_SITTING_MS) told = true;
                }
                if (told) continue;
                item.appOnly = true;
                item.title = item.appName;
                item.detail = Words.t("Continue where you left off");
            }
            shown.add(item);
        }
        return shown;
    }

    private static void readContinueWatching(Context app, Map<String, Item> byKey) {
        if (app.checkSelfPermission("android.permission.READ_TV_LISTINGS") != PackageManager.PERMISSION_GRANTED) return;
        String[] columns = {"package_name", "title", "season_display_number", "episode_display_number", "episode_title",
                "poster_art_uri", "thumbnail_uri", "intent_uri", "watch_next_type", "last_engagement_time_utc_millis",
                "last_playback_position_millis", "duration_millis"};
        long oldest = System.currentTimeMillis() - OLDEST_MS;
        ContentResolver resolver = app.getContentResolver();
        try (Cursor c = resolver.query(TvContract.WatchNextPrograms.CONTENT_URI, columns, null, null, null)) {
            if (c == null) return;
            while (c.moveToNext()) {
                String pkg = text(c, 0), title = text(c, 1);
                int type = c.getInt(8);
                long last = c.getLong(9), position = c.getLong(10), duration = c.getLong(11);
                if (pkg.isEmpty() || title.isEmpty() || last < oldest) continue;
                if (type != TYPE_CONTINUE && type != TYPE_NEXT) continue;
                if (type == TYPE_CONTINUE && duration > 0L && position > duration * 0.97f) continue;
                String key = WatchHistory.keyOf(pkg, title);
                Item item = byKey.get(key);
                if (item == null) {
                    item = new Item();
                    item.pkg = pkg;
                    item.title = title;
                    byKey.put(key, item);
                }
                item.lastMs = Math.max(item.lastMs, last);
                if (position > 0L) item.position = position;
                if (duration > 0L) item.duration = duration;
                String season = text(c, 2), episode = text(c, 3), episodeTitle = text(c, 4);
                if (!episode.isEmpty()) {
                    item.detail = (season.isEmpty() ? "" : "S" + season + " ") + "E" + episode
                            + (episodeTitle.isEmpty() ? "" : "  " + episodeTitle);
                }
                String art = text(c, 6).isEmpty() ? text(c, 5) : text(c, 6);
                if (!art.isEmpty()) item.artUri = art;
                if (!text(c, 7).isEmpty()) item.link = text(c, 7);
            }
        } catch (RuntimeException unreadable) {
            // Some sets refuse or lack the table; what was watched here still shows.
        }
    }

    private static String text(Cursor c, int column) {
        String s = c.getString(column);
        return s == null ? "" : s.trim();
    }

    // ---- going back to it --------------------------------------------------------------------------

    /** Straight to what was playing if that can be done, otherwise to the app. */
    static void open(Context context, Item item, ActivityOptions options) {
        options.setPendingIntentBackgroundActivityStartMode(ActivityOptions.MODE_BACKGROUND_ACTIVITY_START_ALLOWED);
        PendingIntent player = WatchHistory.player(item.key());
        if (player != null) {
            try {
                player.send(context, 0, null, null, null, null, options.toBundle());
                return;
            } catch (PendingIntent.CanceledException appWasClosed) {
                // Then one of the ways below.
            }
        }
        if (!item.link.isEmpty()) {
            try {
                Intent link = Intent.parseUri(item.link, item.link.startsWith("intent:") ? Intent.URI_INTENT_SCHEME : 0);
                // The address came from another app: it may only open that app, and may hand over nothing of ours.
                link.setSelector(null);
                link.setComponent(null);
                link.setPackage(item.pkg);
                if (link.getAction() == null) link.setAction(Intent.ACTION_VIEW);
                link.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                context.startActivity(link, options.toBundle());
                return;
            } catch (java.net.URISyntaxException | RuntimeException refused) {
                // Then the app itself.
            }
        }
        PackageManager pm = context.getPackageManager();
        Intent app = pm.getLeanbackLaunchIntentForPackage(item.pkg);
        if (app == null) app = pm.getLaunchIntentForPackage(item.pkg);
        if (app == null) return;
        app.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
        try {
            context.startActivity(app, options.toBundle());
        } catch (RuntimeException refused) {
            // Nothing more to try; Home stays.
        }
    }

    // ---- pictures ----------------------------------------------------------------------------------

    private static boolean isWeb(String uri) {
        return uri.startsWith("http://") || uri.startsWith("https://");
    }

    private static File downloads(Context app) {
        return new File(app.getCacheDir(), "recents");
    }

    private static File cached(Context app, String uri) {
        return new File(downloads(app), Integer.toHexString(uri.hashCode()) + "_" + uri.length());
    }

    private static boolean download(Context app, String uri) {
        File target = cached(app, uri);
        if (target.isFile() && target.length() > 0L) return true;
        File dir = downloads(app);
        if (!dir.isDirectory() && !dir.mkdirs()) return false;
        File part = new File(dir, target.getName() + ".part");
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(uri).openConnection();
            connection.setConnectTimeout(4000);
            connection.setReadTimeout(6000);
            connection.setInstanceFollowRedirects(true);
            if (connection.getResponseCode() != HttpURLConnection.HTTP_OK) return false;
            long total = 0L;
            try (InputStream in = connection.getInputStream(); FileOutputStream out = new FileOutputStream(part)) {
                byte[] buffer = new byte[16 * 1024];
                int read;
                while ((read = in.read(buffer)) > 0) {
                    total += read;
                    if (total > MOST_DOWNLOAD) return false;
                    out.write(buffer, 0, read);
                }
            }
            return part.renameTo(target);
        } catch (IOException | RuntimeException noNetwork) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
            part.delete();
        }
    }

    private static void pruneDownloads(Context app, List<Item> items) {
        File[] files = downloads(app).listFiles();
        if (files == null || files.length <= SHOW * 3) return;
        List<String> keep = new ArrayList<>();
        for (Item item : items) keep.add(cached(app, item.artUri).getName());
        for (File f : files) {
            if (!keep.contains(f.getName())) f.delete();
        }
    }

    /** A decoded picture, cropped to the card and rounded, in graphics memory. Null when it cannot be read. */
    private static Bitmap picture(Context app, String uriOrPath) {
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            decode(app, uriOrPath, bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null;
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = 1;
            while (bounds.outWidth / (opts.inSampleSize * 2) >= ART_W && bounds.outHeight / (opts.inSampleSize * 2) >= ART_H) {
                opts.inSampleSize *= 2;
            }
            Bitmap source = decode(app, uriOrPath, opts);
            if (source == null) return null;
            Bitmap art = rounded(source);
            source.recycle();
            return GalleryArt.gpu(art);
        } catch (IOException | RuntimeException unreadable) {
            return null;
        }
    }

    private static Bitmap decode(Context app, String uriOrPath, BitmapFactory.Options opts) throws IOException {
        if (uriOrPath.startsWith("/")) return BitmapFactory.decodeFile(uriOrPath, opts);
        if (uriOrPath.startsWith("file:")) return BitmapFactory.decodeFile(uriOrPath.substring(5), opts);
        try (InputStream in = app.getContentResolver().openInputStream(Uri.parse(uriOrPath))) {
            return BitmapFactory.decodeStream(in, null, opts);
        }
    }

    /**
     * A wide picture fills the card. A poster or a logo would lose too much that way, so it stands whole on a large,
     * soft copy of itself.
     */
    private static Bitmap rounded(Bitmap source) {
        Bitmap inner = Bitmap.createBitmap(ART_W, ART_H, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(inner);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG | Paint.DITHER_FLAG);
        float aspect = source.getWidth() / (float) source.getHeight();
        float fill = Math.max(ART_W / (float) source.getWidth(), ART_H / (float) source.getHeight());
        RectF filled = new RectF((ART_W - source.getWidth() * fill) / 2f, (ART_H - source.getHeight() * fill) / 2f,
                (ART_W + source.getWidth() * fill) / 2f, (ART_H + source.getHeight() * fill) / 2f);
        if (aspect >= 1.45f) {
            c.drawBitmap(source, null, filled, p);
        } else {
            Bitmap tiny = Bitmap.createScaledBitmap(source, 12, Math.max(1, Math.round(12f / aspect)), true);
            c.drawBitmap(tiny, null, filled, p);
            if (tiny != source) tiny.recycle();
            c.drawColor(0x8C000000);
            float fit = Math.min((ART_W - 24f) / source.getWidth(), (ART_H - 18f) / source.getHeight());
            float w = source.getWidth() * fit, h = source.getHeight() * fit;
            c.drawBitmap(source, null, new RectF((ART_W - w) / 2f, (ART_H - h) / 2f, (ART_W + w) / 2f, (ART_H + h) / 2f), p);
        }
        return roundOff(inner);
    }

    /** A clear pixel all round too: the card is drawn in perspective, and this is what keeps its edges smooth. */
    private static Bitmap roundOff(Bitmap square) {
        Bitmap out = Bitmap.createBitmap(ART_W, ART_H, Bitmap.Config.ARGB_8888);
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG);
        p.setShader(new BitmapShader(square, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP));
        new Canvas(out).drawRoundRect(new RectF(1f, 1f, ART_W - 1f, ART_H - 1f), ART_RADIUS, ART_RADIUS, p);
        square.recycle();
        return out;
    }

    /** No picture to be had (yet): the app's own banner, and the title on it unless the title is only the app's name. */
    private static Bitmap nameCard(Context app, Item item, Paint text) {
        Bitmap inner = Bitmap.createBitmap(ART_W, ART_H, Bitmap.Config.ARGB_8888);
        Canvas c = new Canvas(inner);
        Drawable banner = null;
        try {
            banner = app.getPackageManager().getApplicationBanner(item.pkg);
            if (banner == null) banner = app.getPackageManager().getApplicationLogo(item.pkg);
        } catch (PackageManager.NameNotFoundException | RuntimeException noBanner) {
            // Then the colours alone.
        }
        Paint p = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.DITHER_FLAG);
        int seed = item.pkg.hashCode();
        float[] hsv = {Math.floorMod(seed, 360), 0.70f, 0.42f};
        int from = Color.HSVToColor(hsv);
        hsv[0] = (hsv[0] + 42f) % 360f;
        hsv[2] = 0.18f;
        p.setShader(new LinearGradient(0, 0, ART_W, ART_H, from, Color.HSVToColor(hsv), Shader.TileMode.CLAMP));
        c.drawRect(0, 0, ART_W, ART_H, p);
        if (banner != null) {
            banner.setBounds(0, 0, ART_W, ART_H);
            banner.draw(c);
        }
        if (!item.appOnly) {
            p.setShader(new LinearGradient(0, ART_H * 0.42f, 0, ART_H, 0x00000000, 0xD0000000, Shader.TileMode.CLAMP));
            c.drawRect(0, 0, ART_W, ART_H, p);
            text.setColor(Color.WHITE);
            text.setTextAlign(Paint.Align.CENTER);
            text.setTextSize(24f);
            CharSequence title = TextUtils.ellipsize(item.title, new android.text.TextPaint(text), ART_W - 40f, TextUtils.TruncateAt.END);
            c.drawText(title, 0, title.length(), ART_W / 2f, ART_H - 26f, text);
        }
        return GalleryArt.gpu(roundOff(inner));
    }
}
