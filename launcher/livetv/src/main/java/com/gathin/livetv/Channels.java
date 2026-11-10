package com.gathin.livetv;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * The channels. The list ships in assets/channels.json (built by work/livetv/make_list.py from iptv-org's public Hindi
 * list, checked from this home's own line): free channels only, each with the servers it may play from. Once a day the
 * TV reads iptv-org's list again and takes any new address a channel has ON THOSE SERVERS, so a moved stream follows
 * without an update, but a copy on somebody else's server never gets in. Every few hours it also asks each channel's
 * stream whether it answers, so the guide can say "Off air" and Up/Down can skip it.
 */
final class Channels {

    static final String[] GROUPS = {"All", "News", "Serials", "Bhakti", "Kids", "Movies", "Paid"};
    static final String UA = "Mozilla/5.0 (Linux; Android 14; MiTV) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

    private static final String LIST = "https://iptv-org.github.io/iptv/languages/hin.m3u";
    private static final long REFRESH_MS = 24L * 60L * 60L * 1000L, CHECK_MS = 30L * 60L * 1000L;
    private static final String STREAMS_FILE = "streams.json", HEALTH_FILE = "health-v4.json";

    static final class Stream {
        final String url, referrer, userAgent;

        Stream(String url, String referrer, String userAgent) {
            this.url = url;
            this.referrer = referrer;
            this.userAgent = userAgent;
        }

        static Stream of(JSONObject o) {
            return new Stream(o.optString("u"), o.optString("ref", null), o.optString("ua", null));
        }

        JSONObject json() throws JSONException {
            JSONObject o = new JSONObject().put("u", url);
            if (referrer != null) o.put("ref", referrer);
            if (userAgent != null) o.put("ua", userAgent);
            return o;
        }

        String host() {
            try {
                String h = java.net.URI.create(url).getHost();
                return h == null ? "" : h;
            } catch (IllegalArgumentException notAnAddress) {
                return "";
            }
        }
    }

    static final class Channel {
        final String id, name, group, tvg, app, appName;
        final int num;
        final List<Stream> streams = new ArrayList<>();
        final Set<String> hosts = new HashSet<>();
        Bitmap logo;
        /** Tried here and nothing played: Up/Down skips it until it plays again. */
        boolean offAir;
        /** Only the background check found no answer: the guide says so, but Up/Down still tries it. */
        boolean checkFailed;

        /** For the JVM tests: a free channel with these allowed servers. */
        Channel(String id, String tvg, String... allowedHosts) {
            this.id = id;
            num = 0;
            name = id;
            group = "News";
            this.tvg = tvg;
            app = null;
            appName = null;
            for (String h : allowedHosts) hosts.add(h);
        }

        Channel(JSONObject o) {
            id = o.optString("id");
            num = o.optInt("num");
            name = o.optString("name");
            group = o.optString("group");
            tvg = o.optString("tvg", null);
            app = o.optString("app", null);
            appName = o.optString("appName", null);
            JSONArray s = o.optJSONArray("streams");
            for (int i = 0; s != null && i < s.length(); i++) {
                JSONObject one = s.optJSONObject(i);
                if (one != null && !one.optString("u").isEmpty()) streams.add(Stream.of(one));
            }
            JSONArray h = o.optJSONArray("hosts");
            for (int i = 0; h != null && i < h.length(); i++) hosts.add(h.optString(i));
        }

        /** A pay channel: no free stream exists, so it opens in its own app. */
        boolean paid() {
            return app != null;
        }

        boolean in(String g) {
            return "All".equals(g) || group.equals(g);
        }
    }

    private Channels() {
    }

    /** The bundled list, with the streams the last refresh found and the last check's off-air marks applied. */
    static List<Channel> load(Context c) {
        List<Channel> out = new ArrayList<>();
        try {
            JSONArray list = new JSONObject(asset(c, "channels.json")).getJSONArray("channels");
            for (int i = 0; i < list.length(); i++) out.add(new Channel(list.getJSONObject(i)));
        } catch (IOException | JSONException broken) {
            return out;
        }
        try {
            JSONObject found = new JSONObject(read(new File(c.getFilesDir(), STREAMS_FILE))).optJSONObject("channels");
            for (Channel ch : out) {
                JSONArray s = found == null ? null : found.optJSONArray(ch.id);
                if (s != null) mergeFirst(ch, s);
            }
        } catch (IOException | JSONException none) {
            // Never refreshed yet: the bundled streams as they are.
        }
        try {
            JSONObject health = new JSONObject(read(new File(c.getFilesDir(), HEALTH_FILE)));
            if (System.currentTimeMillis() - health.optLong("at") < CHECK_MS) {
                JSONArray off = health.optJSONArray("off");
                Set<String> ids = new HashSet<>();
                for (int i = 0; off != null && i < off.length(); i++) ids.add(off.optString(i));
                for (Channel ch : out) ch.checkFailed = ids.contains(ch.id);
            }
        } catch (IOException | JSONException none) {
            // Not checked yet: every channel is worth a try.
        }
        return out;
    }

    /** The logos, small and drawn often: decoded once into the GPU's own memory. */
    static void loadLogos(Context c, List<Channel> list) {
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inPreferredConfig = Bitmap.Config.HARDWARE;
        for (Channel ch : list) {
            if (ch.logo != null) continue;
            try (InputStream in = c.getAssets().open("logos/" + ch.id + ".png")) {
                ch.logo = BitmapFactory.decodeStream(in, null, o);
            } catch (IOException noLogo) {
                // The guide writes the name in its place.
            }
        }
    }

    /** What the refresh and the check found, to be applied on the main thread (the lists are the UI's). */
    static final class Update {
        final Map<String, List<Stream>> streams = new HashMap<>();
        final Set<String> off = new HashSet<>();
        boolean checked;

        void apply(List<Channel> list) {
            for (Channel ch : list) {
                List<Stream> s = streams.get(ch.id);
                if (s != null) {
                    List<Stream> old = new ArrayList<>(ch.streams);
                    ch.streams.clear();
                    ch.streams.addAll(s);
                    for (Stream o : old) if (!hasUrl(ch.streams, o.url)) ch.streams.add(o);
                }
                if (checked) ch.checkFailed = off.contains(ch.id);
            }
        }
    }

    /**
     * Off the main thread: reads iptv-org's list once a day and asks every free channel once every few hours. Returns
     * null when nothing was due. {@code snapshot} is a copy of the list taken on the main thread.
     */
    static Update refresh(Context c, List<Channel> snapshot) {
        Update u = new Update();
        boolean any = false;
        File streamsFile = new File(c.getFilesDir(), STREAMS_FILE);
        if (System.currentTimeMillis() - streamsFile.lastModified() > REFRESH_MS) {
            try {
                Map<String, List<Stream>> found = fromList(get(LIST, null, UA, 2 * 1024 * 1024, 10000), snapshot);
                JSONObject channels = new JSONObject();
                for (Map.Entry<String, List<Stream>> e : found.entrySet()) {
                    JSONArray a = new JSONArray();
                    for (Stream s : e.getValue()) a.put(s.json());
                    channels.put(e.getKey(), a);
                }
                write(streamsFile, new JSONObject().put("at", System.currentTimeMillis()).put("channels", channels).toString());
                u.streams.putAll(found);
                any = true;
            } catch (IOException | JSONException | RuntimeException offline) {
                // Tomorrow, or the next time Live TV opens.
            }
        }
        File healthFile = new File(c.getFilesDir(), HEALTH_FILE);
        long checkedAt = 0L;
        try {
            checkedAt = new JSONObject(read(healthFile)).optLong("at");
        } catch (IOException | JSONException never) {
            // Due now.
        }
        if (System.currentTimeMillis() - checkedAt > CHECK_MS || any) {
            List<Channel> free = new ArrayList<>();
            for (Channel ch : snapshot) if (!ch.paid()) free.add(ch);
            Set<String> off = java.util.Collections.synchronizedSet(new HashSet<>());
            // Two at a time: the TV's name lookups fail under a crowd (Zee News "Unable to resolve host" after 10 s,
            // 10 Nov), and Android then keeps that failure for a few seconds, which failed the second try at once.
            ExecutorService pool = Executors.newFixedThreadPool(2);
            for (Channel ch : free) {
                List<Stream> streams = new ArrayList<>();
                if (u.streams.containsKey(ch.id)) streams.addAll(u.streams.get(ch.id));
                for (Stream s : ch.streams) if (!hasUrl(streams, s.url)) streams.add(s);
                pool.execute(() -> {
                    if (answers(streams, 8000)) return;
                    // A second, patient try a few seconds later, past the remembered failed lookup.
                    try {
                        Thread.sleep(4000L);
                    } catch (InterruptedException stop) {
                        return;
                    }
                    if (!answers(streams, 12000)) off.add(ch.id);
                });
            }
            pool.shutdown();
            try {
                pool.awaitTermination(150, TimeUnit.SECONDS);
            } catch (InterruptedException stop) {
                Thread.currentThread().interrupt();
            }
            // Every channel off at once is the internet, not the channels: say nothing then.
            if (off.size() < free.size()) {
                u.off.addAll(off);
                u.checked = true;
                try {
                    write(healthFile, new JSONObject().put("at", System.currentTimeMillis()).put("off", new JSONArray(off)).toString());
                } catch (IOException | JSONException ignored) {
                    // Checked again next time.
                }
                any = true;
            }
        }
        return any ? u : null;
    }

    /** One of the first two streams gives a playlist within this many milliseconds. */
    private static boolean answers(List<Stream> streams, int timeoutMs) {
        for (int i = 0; i < Math.min(2, streams.size()); i++) {
            Stream s = streams.get(i);
            long t = android.os.SystemClock.elapsedRealtime();
            try {
                String body = get(s.url, s.referrer, s.userAgent != null ? s.userAgent : UA, 64 * 1024, timeoutMs);
                boolean ok = body.contains("#EXTM3U");
                if (!ok) android.util.Log.i("LiveTV", "check " + s.host() + ": no playlist, " + body.length() + " chars");
                if (ok) return true;
            } catch (IOException | RuntimeException no) {
                android.util.Log.i("LiveTV", "check " + s.host() + ": " + no + " after " + (android.os.SystemClock.elapsedRealtime() - t) + " ms");
            }
        }
        return false;
    }

    /** The streams iptv-org lists for each channel today, kept only where the channel already plays from. */
    static Map<String, List<Stream>> fromList(String m3u, List<Channel> channels) {
        Map<String, Channel> byTvg = new HashMap<>();
        for (Channel ch : channels) if (ch.tvg != null && !ch.paid()) byTvg.put(ch.tvg, ch);
        Map<String, List<Stream>> out = new HashMap<>();
        String tvg = null, ref = null, ua = null;
        for (String raw : m3u.split("\n")) {
            String line = raw.trim();
            if (line.startsWith("#EXTINF")) {
                tvg = attr(line, "tvg-id");
                ref = null;
                ua = null;
            } else if (line.startsWith("#EXTVLCOPT:http-referrer=")) {
                ref = line.substring("#EXTVLCOPT:http-referrer=".length());
            } else if (line.startsWith("#EXTVLCOPT:http-user-agent=")) {
                ua = line.substring("#EXTVLCOPT:http-user-agent=".length());
            } else if (!line.isEmpty() && !line.startsWith("#")) {
                Channel ch = tvg == null ? null : byTvg.get(tvg);
                if (ch != null && line.startsWith("https://")) {
                    Stream s = new Stream(line, ref, ua);
                    if (ch.hosts.contains(s.host())) {
                        List<Stream> list = out.computeIfAbsent(ch.id, k -> new ArrayList<>());
                        if (!hasUrl(list, s.url)) list.add(s);
                    }
                }
                tvg = null;
            }
        }
        return out;
    }

    private static String attr(String line, String name) {
        int at = line.indexOf(name + "=\"");
        if (at < 0) return null;
        int from = at + name.length() + 2, to = line.indexOf('"', from);
        return to < 0 ? null : line.substring(from, to);
    }

    private static void mergeFirst(Channel ch, JSONArray found) {
        List<Stream> fresh = new ArrayList<>();
        for (int i = 0; i < found.length(); i++) {
            JSONObject o = found.optJSONObject(i);
            if (o == null) continue;
            Stream s = Stream.of(o);
            if (ch.hosts.contains(s.host()) && !hasUrl(fresh, s.url)) fresh.add(s);
        }
        for (Stream s : ch.streams) if (!hasUrl(fresh, s.url)) fresh.add(s);
        ch.streams.clear();
        ch.streams.addAll(fresh);
    }

    private static boolean hasUrl(List<Stream> list, String url) {
        for (Stream s : list) if (s.url.equals(url)) return true;
        return false;
    }

    static String get(String address, String referrer, String userAgent, int limit, int timeoutMs) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(address).openConnection();
        c.setConnectTimeout(timeoutMs);
        c.setReadTimeout(timeoutMs);
        c.setRequestProperty("User-Agent", userAgent);
        if (referrer != null) c.setRequestProperty("Referer", referrer);
        try {
            if (c.getResponseCode() != 200) throw new IOException("HTTP " + c.getResponseCode());
            try (InputStream in = c.getInputStream()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[16 * 1024];
                for (int n; out.size() < limit && (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                return out.toString(StandardCharsets.UTF_8.name());
            }
        } finally {
            c.disconnect();
        }
    }

    private static String asset(Context c, String name) throws IOException {
        try (InputStream in = c.getAssets().open(name)) {
            return readAll(in);
        }
    }

    private static String read(File f) throws IOException {
        try (InputStream in = new java.io.FileInputStream(f)) {
            return readAll(in);
        }
    }

    private static String readAll(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[16 * 1024];
        for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
        return out.toString(StandardCharsets.UTF_8.name());
    }

    /** Through a temporary file, so a power cut mid-write never leaves half a list. */
    private static void write(File f, String text) throws IOException {
        File tmp = new File(f.getPath() + ".tmp");
        try (FileOutputStream out = new FileOutputStream(tmp)) {
            out.write(text.getBytes(StandardCharsets.UTF_8));
            out.getFD().sync();
        }
        if (!tmp.renameTo(f)) throw new IOException("rename " + f);
    }
}
