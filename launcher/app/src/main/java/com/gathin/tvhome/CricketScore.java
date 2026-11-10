package com.gathin.tvhome;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * India's match in the TV Island, an over at a time, from CricketData.org (the free plan: an account and its key, 100 reads
 * a day). Without a key nothing runs at all. With one it looks once an hour while the screen is on, and every four minutes
 * while India is playing, which keeps a whole day of cricket inside the free reads. While a match is on, the remote's TV+
 * button opens it in JioHotstar instead of starting Movie Night.
 */
final class CricketScore {

    private static final long IDLE_MS = 60L * 60L * 1000L, LIVE_MS = 4L * 60L * 1000L;
    private static final String HOTSTAR = "in.startv.hotstar";
    private static final Map<String, String> SHORT = new HashMap<>();

    static {
        String[][] teams = {{"India", "IND"}, {"Australia", "AUS"}, {"England", "ENG"}, {"Pakistan", "PAK"},
                {"South Africa", "SA"}, {"New Zealand", "NZ"}, {"Sri Lanka", "SL"}, {"Bangladesh", "BAN"},
                {"West Indies", "WI"}, {"Afghanistan", "AFG"}, {"Ireland", "IRE"}, {"Zimbabwe", "ZIM"},
                {"Netherlands", "NED"}, {"Nepal", "NEP"}, {"Scotland", "SCO"}, {"United Arab Emirates", "UAE"}};
        for (String[] t : teams) SHORT.put(t[0].toLowerCase(Locale.ROOT), t[1]);
    }

    private static CricketScore running;

    private final Context context;
    private final String key;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable look = this::look;
    private boolean screenOn = true, live, busy;
    private String lastShown = "";
    /** The line under it: the other side and where the match stands (for the Control Center). */
    private String lastDetail = "";
    private int lastWickets = -1;
    private final BroadcastReceiver screen = new BroadcastReceiver() {
        @Override
        public void onReceive(Context c, Intent intent) {
            screenOn = Intent.ACTION_SCREEN_ON.equals(intent.getAction());
            main.removeCallbacks(look);
            if (screenOn) main.postDelayed(look, 15_000L);
        }
    };

    private CricketScore(Context context, String key) {
        this.context = context;
        this.key = key;
    }

    /** Starts it if a key is set (the theme's or config.xml's cricket_api_key); otherwise nothing. */
    static void start(Context service) {
        // A theme's config.json first: the key is the owner's, and that file stays on the TV and out of git.
        String key = Config.themeString(service, "cricket_api_key", service.getString(R.string.cricket_api_key)).trim();
        if (key.isEmpty() || running != null) return;
        running = new CricketScore(service, key);
        IntentFilter f = new IntentFilter(Intent.ACTION_SCREEN_ON);
        f.addAction(Intent.ACTION_SCREEN_OFF);
        service.registerReceiver(running.screen, f, Context.RECEIVER_EXPORTED);
        running.main.postDelayed(running.look, 30_000L);
    }

    static void stop(Context service) {
        CricketScore s = running;
        if (s == null) return;
        running = null;
        s.main.removeCallbacksAndMessages(null);
        try {
            service.unregisterReceiver(s.screen);
        } catch (RuntimeException notRegistered) {
            // Nothing to undo.
        }
    }

    /** India is playing right now. */
    static boolean live() {
        CricketScore s = running;
        return s != null && s.live;
    }

    /** The match as the Island last told it, for the Control Center: {score, where it stands}; null when India is not on. */
    static String[] scoreNow() {
        CricketScore s = running;
        if (s == null || !s.live || s.lastShown == null || s.lastShown.isEmpty()) return null;
        return new String[]{s.lastShown, s.lastDetail == null ? "" : s.lastDetail};
    }

    /** The match, in JioHotstar's sport page if it opens, else the app. */
    static void openMatch(Context c) {
        Intent sport = new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.hotstar.com/in/sports/cricket"))
                .setPackage(HOTSTAR).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            c.startActivity(sport);
            return;
        } catch (RuntimeException noSportPage) {
            // Then the app as it opens.
        }
        Intent app = AppSwitcher.launchIntent(c, HOTSTAR);
        if (app != null) {
            try {
                c.startActivity(app);
            } catch (RuntimeException gone) {
                // Nothing more to try.
            }
        }
    }

    private void look() {
        if (!screenOn || busy) return;
        busy = true;
        new Thread(() -> {
            JSONObject match = null;
            try {
                match = indiaLive(get("https://api.cricapi.com/v1/currentMatches?offset=0&apikey=" + URLEncoder.encode(key, "UTF-8")));
            } catch (IOException | JSONException | RuntimeException offline) {
                // Try again at the usual time.
            }
            final JSONObject m = match;
            main.post(() -> {
                busy = false;
                boolean was = live;
                live = m != null && !m.optBoolean("matchEnded");
                if (m != null) say(m, was);
                main.removeCallbacks(look);
                main.postDelayed(look, live ? LIVE_MS : IDLE_MS);
            });
        }, "cricket").start();
    }

    private static JSONObject indiaLive(String body) throws JSONException {
        JSONArray data = new JSONObject(body).optJSONArray("data");
        if (data == null) return null;
        JSONObject ended = null;
        for (int i = 0; i < data.length(); i++) {
            JSONObject m = data.getJSONObject(i);
            JSONArray teams = m.optJSONArray("teams");
            boolean india = false;
            for (int k = 0; teams != null && k < teams.length(); k++) india |= teams.optString(k).startsWith("India");
            if (!india || !m.optBoolean("matchStarted")) continue;
            if (!m.optBoolean("matchEnded")) return m;
            if (ended == null) ended = m;
        }
        return ended;
    }

    /** One line for the over, one for the other side and where the match stands; shown only when it has changed. */
    private void say(JSONObject m, boolean wasLive) {
        JSONArray score = m.optJSONArray("score");
        String status = m.optString("status", "");
        boolean ended = m.optBoolean("matchEnded");
        if (ended && !wasLive) return;   // an old result is not news
        String now = "", other = "";
        int wickets = -1;
        if (score != null && score.length() > 0) {
            JSONObject last = score.optJSONObject(score.length() - 1);
            now = line(last);
            wickets = last == null ? -1 : last.optInt("w", -1);
            if (score.length() > 1) other = line(score.optJSONObject(score.length() - 2));
        }
        String title = ended ? status : now;
        if (title.isEmpty() || title.equals(lastShown)) return;
        // A wicket: more of them than last time in the same innings (a new innings starts again from none).
        boolean wicket = !ended && lastWickets >= 0 && wickets > lastWickets;
        lastWickets = wickets;
        lastShown = title;
        lastDetail = ended ? m.optString("name", "") : status;
        String detail = ended ? m.optString("name", "") : (other.isEmpty() ? "" : other + "   ·   ") + status
                + (live ? "   ·   TV+ to watch" : "");
        int accent = ended ? 0xFF4BE3A0 : wicket ? 0xFFFF5A6A : 0xFF4F8BFF;
        TvIsland island = HomeKeyService.island();
        if (island != null) {
            island.show(new TvIsland.Event("cricket", wicket ? "WICKET · " + title : title, detail, accent, TvIsland.ICON_BAT,
                    null, null, 5000L));
        }
    }

    /** "India Inning 1", r 154, w 3, o 17.2 → "IND 154/3 (17.2)". */
    private static String line(JSONObject s) {
        if (s == null) return "";
        String inning = s.optString("inning", "");
        String team = inning.replaceAll("(?i)\\s+inning.*$", "").trim();
        String code = SHORT.get(team.toLowerCase(Locale.ROOT).replace(" women", ""));
        if (code == null) code = team.length() > 12 ? team.substring(0, 12) : team;
        if (team.toLowerCase(Locale.ROOT).endsWith(" women")) code += "-W";
        return code + " " + s.optInt("r") + "/" + s.optInt("w") + " (" + s.optString("o") + ")";
    }

    private static String get(String address) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(address).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(8000);
        try (InputStream in = c.getInputStream()) {
            if (c.getResponseCode() != 200) throw new IOException("HTTP " + c.getResponseCode());
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            for (int n; (n = in.read(buf)) > 0 && out.size() < 512 * 1024; ) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        } finally {
            c.disconnect();
        }
    }
}
