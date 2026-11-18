package com.gathin.tvhome;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * What the Control Center knows about the thing playing beyond its media session: the words of a song (lrclib.net,
 * which needs no account, or the Hanuman Chalisa kept here), a link for the phone, and the cover picture when the app
 * gives only its address. All network work runs on the caller's worker thread.
 */
final class PanelMedia {

    private PanelMedia() {
    }

    /** One line of words: when it starts (ms into the song, or -1 when the source has no times) and the words. */
    static final class Line {
        final long at;
        final String text;

        Line(long at, String text) {
            this.at = at;
            this.text = text;
        }
    }

    static final class Lyrics {
        final List<Line> lines;
        final boolean synced;
        final String source;

        Lyrics(List<Line> lines, boolean synced, String source) {
            this.lines = lines;
            this.synced = synced;
            this.source = source;
        }
    }

    /** The song's own name out of a video title: "Keejo Kesari Ke Laal | Jai Shree Ram | Dj ..." gives the first part. */
    static String cleanTitle(String title) {
        if (title == null) return "";
        String t = title;
        for (String cut : new String[]{"|", "｜", "(", "[", " - Official", " Official", " Lyrical", " Full Video", " Full Song", "#"}) {
            int i = t.indexOf(cut);
            if (i > 3) t = t.substring(0, i);
        }
        return t.trim();
    }

    static boolean isChalisa(String title) {
        if (title == null) return false;
        String t = title.toLowerCase(Locale.ROOT);
        return t.contains("hanuman chalisa") || title.contains("हनुमान चालीसा");
    }

    /** The words of the Hanuman Chalisa (Tulsidas; in the public domain), with no times: they follow the playback. */
    static Lyrics chalisa() {
        List<Line> lines = new ArrayList<>();
        for (String l : CHALISA) lines.add(new Line(-1L, l));
        return new Lyrics(lines, false, "Hanuman Chalisa · Tulsidas");
    }

    /** lrclib.net's best match, timed lines when it has them; null when nothing fits or the network is out. */
    static Lyrics fetch(String title, String artist, long durationMs) {
        String song = cleanTitle(title);
        if (song.isEmpty()) return null;
        try {
            String q = Uri.encode(song + (artist != null && !artist.isEmpty() && song.length() < 40 ? " " + artist : ""));
            JSONArray found = new JSONArray(get("https://lrclib.net/api/search?q=" + q));
            if (found.length() == 0 && artist != null && !artist.isEmpty()) {
                found = new JSONArray(get("https://lrclib.net/api/search?q=" + Uri.encode(song)));
            }
            JSONObject best = null;
            long bestGap = Long.MAX_VALUE;
            for (int i = 0; i < found.length(); i++) {
                JSONObject o = found.getJSONObject(i);
                if (o.optBoolean("instrumental")) continue;
                boolean timed = !o.optString("syncedLyrics", "").isEmpty() && !o.isNull("syncedLyrics");
                boolean plain = !o.optString("plainLyrics", "").isEmpty() && !o.isNull("plainLyrics");
                if (!timed && !plain) continue;
                // Prefer timed words, then the recording whose length is nearest to what is playing.
                long gap = durationMs > 0 ? Math.abs(Math.round(o.optDouble("duration", 0) * 1000) - durationMs) : 0;
                if (!timed) gap += 10_000_000L;
                if (gap < bestGap) {
                    bestGap = gap;
                    best = o;
                }
            }
            if (best == null) return null;
            String source = Words.t("Words from lrclib.net");
            String timed = best.isNull("syncedLyrics") ? "" : best.optString("syncedLyrics", "");
            if (!timed.isEmpty()) {
                List<Line> lines = parseLrc(timed);
                if (!lines.isEmpty()) return new Lyrics(lines, true, source);
            }
            List<Line> lines = new ArrayList<>();
            for (String l : best.optString("plainLyrics", "").split("\n")) {
                if (!l.trim().isEmpty()) lines.add(new Line(-1L, l.trim()));
            }
            return lines.isEmpty() ? null : new Lyrics(lines, false, source);
        } catch (IOException | org.json.JSONException | RuntimeException unavailable) {
            return null;
        }
    }

    private static final Pattern LRC = Pattern.compile("\\[(\\d+):(\\d+)(?:[.:](\\d+))?]");

    static List<Line> parseLrc(String text) {
        List<Line> out = new ArrayList<>();
        for (String raw : text.split("\n")) {
            Matcher m = LRC.matcher(raw);
            List<Long> times = new ArrayList<>();
            int end = 0;
            while (m.find() && m.start() == end) {
                long ms = Long.parseLong(m.group(1)) * 60_000L + Long.parseLong(m.group(2)) * 1000L;
                if (m.group(3) != null) {
                    String f = m.group(3);
                    ms += f.length() == 1 ? Long.parseLong(f) * 100L : f.length() == 2 ? Long.parseLong(f) * 10L : Long.parseLong(f.substring(0, 3));
                }
                times.add(ms);
                end = m.end();
            }
            String words = raw.substring(end).trim();
            for (long t : times) out.add(new Line(t, words.isEmpty() ? "♪" : words));
        }
        out.sort((a, b) -> Long.compare(a.at, b.at));
        return out;
    }

    /**
     * A link the phone opens at the same thing: YouTube at this second when the app names the video, else a search for
     * the title in that app's own site (which the phone hands to its app).
     */
    static String phoneLink(String pkg, String mediaId, String title, long posMs) {
        String q = Uri.encode(cleanTitle(title).isEmpty() ? (title == null ? "" : title) : cleanTitle(title));
        if ("com.google.android.youtube.tv".equals(pkg)) {
            String id = youTubeId(mediaId);
            if (id != null) return "https://youtu.be/" + id + (posMs > 5000 ? "?t=" + (posMs / 1000L) : "");
            return "https://www.youtube.com/results?search_query=" + q;
        }
        if ("com.netflix.ninja".equals(pkg)) return "https://www.netflix.com/search?q=" + q;
        if ("com.amazon.amazonvideo.livingroom".equals(pkg)) return "https://www.primevideo.com/search?phrase=" + q;
        if ("in.startv.hotstar".equals(pkg)) return "https://www.hotstar.com/in/explore?search_query=" + q;
        return "https://www.google.com/search?q=" + q;
    }

    private static final Pattern YT_ID = Pattern.compile("(?:v=|youtu\\.be/|/watch/|^)([A-Za-z0-9_-]{11})(?:$|[?&#/])");

    /** The 11-character video id in a media id or link, or null. */
    static String youTubeId(String mediaId) {
        if (mediaId == null || mediaId.isEmpty()) return null;
        Matcher m = YT_ID.matcher(mediaId);
        return m.find() ? m.group(1) : null;
    }

    /** A cover picture from an http(s) address, scaled down to at most {@code max} pixels a side. */
    static Bitmap download(String address, int max) {
        try {
            byte[] bytes = bytes(address, 4_000_000);
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);
            int sample = 1;
            while (bounds.outWidth / (sample * 2) >= max || bounds.outHeight / (sample * 2) >= max) sample *= 2;
            BitmapFactory.Options opts = new BitmapFactory.Options();
            opts.inSampleSize = sample;
            return BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
        } catch (IOException | RuntimeException unavailable) {
            return null;
        }
    }

    private static String get(String address) throws IOException {
        return new String(bytes(address, 2_000_000), StandardCharsets.UTF_8);
    }

    private static byte[] bytes(String address, int most) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL(address).openConnection();
        c.setConnectTimeout(4000);
        c.setReadTimeout(6000);
        // lrclib asks callers to say who they are.
        c.setRequestProperty("User-Agent", "FamilyRoomTV (dev.shiv.orbit.home)");
        try {
            if (c.getResponseCode() != 200) throw new IOException("HTTP " + c.getResponseCode());
            try (InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) {
                    out.write(buf, 0, n);
                    if (out.size() > most) throw new IOException("too large");
                }
                return out.toByteArray();
            }
        } finally {
            c.disconnect();
        }
    }

    /** Shri Hanuman Chalisa, Goswami Tulsidas: opening dohas, forty chaupais, closing doha. */
    private static final String[] CHALISA = {
            "श्रीगुरु चरन सरोज रज, निज मनु मुकुरु सुधारि।",
            "बरनउँ रघुबर बिमल जसु, जो दायकु फल चारि॥",
            "बुद्धिहीन तनु जानिके, सुमिरौं पवन-कुमार।",
            "बल बुद्धि बिद्या देहु मोहिं, हरहु कलेस बिकार॥",
            "जय हनुमान ज्ञान गुन सागर। जय कपीस तिहुँ लोक उजागर॥",
            "राम दूत अतुलित बल धामा। अंजनि-पुत्र पवनसुत नामा॥",
            "महाबीर बिक्रम बजरंगी। कुमति निवार सुमति के संगी॥",
            "कंचन बरन बिराज सुबेसा। कानन कुंडल कुंचित केसा॥",
            "हाथ बज्र औ ध्वजा बिराजै। काँधे मूँज जनेऊ साजै॥",
            "संकर सुवन केसरीनंदन। तेज प्रताप महा जग बंदन॥",
            "बिद्यावान गुनी अति चातुर। राम काज करिबे को आतुर॥",
            "प्रभु चरित्र सुनिबे को रसिया। राम लखन सीता मन बसिया॥",
            "सूक्ष्म रूप धरि सियहिं दिखावा। बिकट रूप धरि लंक जरावा॥",
            "भीम रूप धरि असुर सँहारे। रामचंद्र के काज सँवारे॥",
            "लाय सजीवन लखन जियाये। श्रीरघुबीर हरषि उर लाये॥",
            "रघुपति कीन्ही बहुत बड़ाई। तुम मम प्रिय भरतहि सम भाई॥",
            "सहस बदन तुम्हरो जस गावैं। अस कहि श्रीपति कंठ लगावैं॥",
            "सनकादिक ब्रह्मादि मुनीसा। नारद सारद सहित अहीसा॥",
            "जम कुबेर दिगपाल जहाँ ते। कबि कोबिद कहि सके कहाँ ते॥",
            "तुम उपकार सुग्रीवहिं कीन्हा। राम मिलाय राज पद दीन्हा॥",
            "तुम्हरो मंत्र बिभीषन माना। लंकेस्वर भए सब जग जाना॥",
            "जुग सहस्र जोजन पर भानू। लील्यो ताहि मधुर फल जानू॥",
            "प्रभु मुद्रिका मेलि मुख माहीं। जलधि लाँघि गये अचरज नाहीं॥",
            "दुर्गम काज जगत के जेते। सुगम अनुग्रह तुम्हरे तेते॥",
            "राम दुआरे तुम रखवारे। होत न आज्ञा बिनु पैसारे॥",
            "सब सुख लहै तुम्हारी सरना। तुम रच्छक काहू को डर ना॥",
            "आपन तेज सम्हारो आपै। तीनों लोक हाँक तें काँपै॥",
            "भूत पिसाच निकट नहिं आवै। महाबीर जब नाम सुनावै॥",
            "नासै रोग हरै सब पीरा। जपत निरंतर हनुमत बीरा॥",
            "संकट तें हनुमान छुड़ावै। मन क्रम बचन ध्यान जो लावै॥",
            "सब पर राम तपस्वी राजा। तिन के काज सकल तुम साजा॥",
            "और मनोरथ जो कोई लावै। सोइ अमित जीवन फल पावै॥",
            "चारों जुग परताप तुम्हारा। है परसिद्ध जगत उजियारा॥",
            "साधु संत के तुम रखवारे। असुर निकंदन राम दुलारे॥",
            "अष्ट सिद्धि नौ निधि के दाता। अस बर दीन जानकी माता॥",
            "राम रसायन तुम्हरे पासा। सदा रहो रघुपति के दासा॥",
            "तुम्हरे भजन राम को पावै। जनम जनम के दुख बिसरावै॥",
            "अंत काल रघुबर पुर जाई। जहाँ जन्म हरि-भक्त कहाई॥",
            "और देवता चित्त न धरई। हनुमत सेइ सर्ब सुख करई॥",
            "संकट कटै मिटै सब पीरा। जो सुमिरै हनुमत बलबीरा॥",
            "जै जै जै हनुमान गोसाईं। कृपा करहु गुरुदेव की नाईं॥",
            "जो सत बार पाठ कर कोई। छूटहि बंदि महा सुख होई॥",
            "जो यह पढ़ै हनुमान चालीसा। होय सिद्धि साखी गौरीसा॥",
            "तुलसीदास सदा हरि चेरा। कीजै नाथ हृदय महँ डेरा॥",
            "पवन तनय संकट हरन, मंगल मूरति रूप।",
            "राम लखन सीता सहित, हृदय बसहु सुर भूप॥",
    };
}
