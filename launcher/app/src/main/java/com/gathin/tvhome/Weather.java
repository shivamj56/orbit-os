package com.gathin.tvhome;

import android.content.Context;
import android.content.SharedPreferences;
import android.location.Location;
import android.location.LocationManager;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * The weather outside, as a few words beside the date: "24° Haze". From Open-Meteo, which needs no account. Where the TV is
 * comes from the city in config.xml (weather_city) when one is set, looked up once, otherwise from Android's last known
 * position. Only a rounded position is ever sent. Read at most every half hour, when Home comes up; nothing runs in between.
 */
final class Weather {

    private static final String PREFS = "weather";
    private static final long FRESH_MS = 30L * 60L * 1000L, RETRY_MS = 5L * 60L * 1000L;
    private static final Handler main = new Handler(Looper.getMainLooper());

    private static String text = "";
    private static long lastTry;
    private static boolean busy;

    private Weather() {
    }

    /** "24° Haze", or "" while nothing is known. */
    static String text() {
        return text;
    }

    /** Reads it again if it is old; {@code changed} runs on the main thread once there is something new. */
    static void refresh(Context context, Runnable changed) {
        Context app = context.getApplicationContext();
        if (text.isEmpty()) {
            SharedPreferences p = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            if (System.currentTimeMillis() - p.getLong("at", 0L) < 3L * FRESH_MS) text = p.getString("text", "");
        }
        long now = SystemClock.elapsedRealtime();
        SharedPreferences p = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        boolean fresh = System.currentTimeMillis() - p.getLong("at", 0L) < FRESH_MS;
        if (busy || fresh || (lastTry != 0L && now - lastTry < RETRY_MS)) return;
        busy = true;
        lastTry = now;
        String city = app.getString(R.string.weather_city).trim();
        new Thread(() -> {
            String made = "";
            try {
                double[] at = where(app, city);
                if (at != null) made = read(at[0], at[1]);
            } catch (IOException | RuntimeException | org.json.JSONException offline) {
                // The words simply stay as they were.
            }
            final String result = made;
            main.post(() -> {
                busy = false;
                if (result.isEmpty()) return;
                app.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                        .putString("text", result).putLong("at", System.currentTimeMillis()).apply();
                if (!result.equals(text)) {
                    text = result;
                    changed.run();
                }
            });
        }, "weather").start();
    }

    private static double[] where(Context app, String city) throws IOException, org.json.JSONException {
        SharedPreferences p = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        if (!city.isEmpty()) {
            if (city.equals(p.getString("city", "")) && p.contains("lat")) {
                return new double[]{Double.longBitsToDouble(p.getLong("lat", 0L)), Double.longBitsToDouble(p.getLong("lon", 0L))};
            }
            JSONObject found = new JSONObject(get("https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&name="
                    + URLEncoder.encode(city, "UTF-8")));
            JSONArray results = found.optJSONArray("results");
            if (results == null || results.length() == 0) return null;
            JSONObject first = results.getJSONObject(0);
            double lat = first.getDouble("latitude"), lon = first.getDouble("longitude");
            p.edit().putString("city", city).putLong("lat", Double.doubleToLongBits(lat)).putLong("lon", Double.doubleToLongBits(lon)).apply();
            return new double[]{lat, lon};
        }
        try {
            LocationManager lm = app.getSystemService(LocationManager.class);
            Location best = null;
            for (String provider : lm.getProviders(true)) {
                Location l = lm.getLastKnownLocation(provider);
                if (l != null && (best == null || l.getTime() > best.getTime())) best = l;
            }
            if (best != null) return new double[]{best.getLatitude(), best.getLongitude()};
        } catch (SecurityException | IllegalArgumentException noPosition) {
            // Then there is no weather to show.
        }
        return null;
    }

    private static String read(double lat, double lon) throws IOException, org.json.JSONException {
        // Two decimals are about a kilometre: enough for the weather, and no more than that leaves the TV.
        String url = String.format(Locale.ROOT, "https://api.open-meteo.com/v1/forecast?latitude=%.2f&longitude=%.2f"
                + "&current=temperature_2m,weather_code,is_day&timezone=auto", lat, lon);
        JSONObject current = new JSONObject(get(url)).getJSONObject("current");
        long temp = Math.round(current.getDouble("temperature_2m"));
        return temp + "° " + words(current.getInt("weather_code"), current.optInt("is_day", 1) == 1);
    }

    /** WMO weather codes, as Open-Meteo gives them, in one or two words. */
    static String words(int code, boolean day) {
        if (code == 0) return day ? "Sunny" : "Clear";
        if (code <= 2) return day ? "Mostly sunny" : "Mostly clear";
        if (code == 3) return "Cloudy";
        if (code == 45 || code == 48) return "Fog";
        if (code >= 51 && code <= 57) return "Drizzle";
        if (code >= 61 && code <= 67) return "Rain";
        if (code >= 71 && code <= 77) return "Snow";
        if (code >= 80 && code <= 82) return "Showers";
        if (code >= 85 && code <= 86) return "Snow showers";
        if (code >= 95) return "Thunderstorm";
        return "";
    }

    private static String get(String address) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(address).openConnection();
        c.setConnectTimeout(6000);
        c.setReadTimeout(6000);
        c.setRequestProperty("Accept", "application/json");
        try (InputStream in = c.getInputStream()) {
            if (c.getResponseCode() != 200) throw new IOException("HTTP " + c.getResponseCode());
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            for (int n; (n = in.read(buf)) > 0 && out.size() < 65536; ) out.write(buf, 0, n);
            return out.toString(StandardCharsets.UTF_8.name());
        } finally {
            c.disconnect();
        }
    }
}
