package com.gathin.tvhome;

import android.content.Context;
import android.icu.text.PluralRules;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.json.JSONObject;

/**
 * Orbit's own words on the TV, in the language the launcher shows itself in: the TV's, or config.json's "locale" (see
 * LauncherLocale). English is written in the code. The translations are assets/words/&lt;language&gt;.json, English to
 * translation, made the same way as the phone app's (tools/i18n). The launcher's older texts are in strings.xml.
 *
 * <pre>
 *   Words.t("Clear all")                                  a fixed text
 *   Words.t("Open {app}", "app", name)                    a text with values in it
 *   Words.n(count, "{n} app closed", "{n} apps closed")   a count, in the language's own plural forms
 *   Words.mark("Happy Holi")                              data, translated where it is shown (tm)
 *   Words.tm(text)                                        whatever reaches the screen: exact texts, then PATTERNS
 * </pre>
 *
 * The Control Center's drawText, the island's events and the toasts go through tm(), so most code passes English and
 * never calls this class itself.
 */
final class Words {
    /** Texts the code puts together with +, as they read with their values: tm() still finds their translation. */
    static final String[] PATTERNS = {
            "The TV sleeps in {n} min",
            "{n} min",
            "At {time}, after {title}",
            "The TV sleeps when this ends, at {time}",
            "Ends {time}",
            "ends {time}",
            "Open {app}",
            "Speed {speed}",
            "Speed: {app} keeps its own speed.",
            "Subtitles {size}",
            "{n} since the TV came on",
            "Sound on · {level}",
            "Opens in YouTube at {time}",
            "On · {name}",
            "{signal} ({rssi} dBm)",
            "{band} · {speed} Mbps",
            "Ready as {name}",
            "On · visible as {name}",
            "Open {address} on your phone",
            "Phone code   {code}",
            "Orbit link code   {code}",
            "{name} can see this screen",
            "●  {name} can see this screen",
            "Results for “{words}”",
            "Still playing in {app}",
            "{h} h {m} min left",
            "{m} min left",
            "Last opened {when}",
    };

    private static final Pattern VALUE = Pattern.compile("\\{(\\w+)\\}");
    /** "Connected   ·   80%", "Sunny · Family room": parts around a dot are translated one by one. */
    private static final Pattern DOT = Pattern.compile("\\s+·\\s+");

    private static Context app;
    private static String loadedFor;
    private static Locale locale = Locale.ENGLISH;
    private static Map<String, Object> table = Collections.emptyMap();
    private static List<Matcher> patterns = Collections.emptyList();
    private static List<String> patternKeys = Collections.emptyList();
    private static PluralRules plural;
    private static final Map<String, String> SEEN = new LinkedHashMap<String, String>(256, 0.75f, true) {
        @Override
        protected boolean removeEldestEntry(Map.Entry<String, String> eldest) {
            return size() > 600;
        }
    };

    private Words() {
    }

    /** Called by the launcher's activities and its service as they start: the translations come from its assets. */
    static synchronized void init(Context context) {
        if (context != null && app == null) app = context.getApplicationContext();
    }

    /** Data that is shown later through tm(): returns the English unchanged, and tools/i18n lists it. */
    static String mark(String english) {
        return english;
    }

    static synchronized String t(String english) {
        refresh();
        Object v = table.get(english);
        if (v instanceof String && !((String) v).isEmpty()) return (String) v;
        if (v instanceof Map) {
            Object other = ((Map<?, ?>) v).get("other");
            if (other instanceof String) return (String) other;
        }
        return english;
    }

    /** t() with values: Words.t("Open {app}", "app", name). */
    static String t(String english, Object... nameValues) {
        return fill(t(english), nameValues);
    }

    /** A count: the "other" English form is the key, {n} is the number. */
    static synchronized String n(long n, String one, String other, Object... nameValues) {
        refresh();
        String form = form(table.get(other), n);
        if (form == null) form = n == 1 ? one : other;
        Object[] all = new Object[nameValues.length + 2];
        all[0] = "n";
        all[1] = n;
        System.arraycopy(nameValues, 0, all, 2, nameValues.length);
        return fill(form, all);
    }

    /** A text as it reaches the screen, put together or not: its translation, or itself. */
    static synchronized String tm(String text) {
        if (text == null || text.isEmpty()) return text;
        refresh();
        if (table.isEmpty()) return text;
        String seen = SEEN.get(text);
        if (seen != null) return seen;
        String out = translate(text, 0);
        SEEN.put(text, out);
        return out;
    }

    private static String translate(String text, int depth) {
        Object exact = table.get(text);
        if (exact instanceof String && !((String) exact).isEmpty()) return (String) exact;
        for (int i = 0; i < patterns.size(); i++) {
            Matcher m = patterns.get(i).reset(text);
            if (!m.matches()) continue;
            String key = patternKeys.get(i);
            Object entry = table.get(key);
            List<String> names = names(key);
            Map<String, String> values = new HashMap<>();
            for (int g = 0; g < names.size(); g++) {
                String value = m.group(g + 1);
                values.put(names.get(g), depth < 2 ? translate(value, depth + 1) : value);
            }
            long count = parseCount(values.get("n"));
            String form = form(entry, count);
            if (form == null) continue;
            Object[] pairs = new Object[values.size() * 2];
            int k = 0;
            for (Map.Entry<String, String> e : values.entrySet()) {
                pairs[k++] = e.getKey();
                pairs[k++] = e.getValue();
            }
            return fill(form, pairs);
        }
        if (depth < 2) {
            Matcher dot = DOT.matcher(text);
            if (dot.find()) {
                StringBuilder sb = new StringBuilder();
                int at = 0;
                dot.reset();
                while (dot.find()) {
                    sb.append(translate(text.substring(at, dot.start()), depth + 1)).append(dot.group());
                    at = dot.end();
                }
                sb.append(translate(text.substring(at), depth + 1));
                return sb.toString();
            }
        }
        return text;
    }

    private static long parseCount(String s) {
        if (s == null) return -1;
        try {
            return Long.parseLong(s.trim());
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    /** A translation's form for a count (or its only form). Null when there is no translation. */
    private static String form(Object entry, long n) {
        if (entry instanceof String) return ((String) entry).isEmpty() ? null : (String) entry;
        if (!(entry instanceof Map)) return null;
        Map<?, ?> forms = (Map<?, ?>) entry;
        Object chosen = null;
        if (n >= 0 && plural != null) chosen = forms.get(plural.select(n));
        if (chosen == null) chosen = forms.get("other");
        return chosen instanceof String ? (String) chosen : null;
    }

    private static String fill(String text, Object... nameValues) {
        if (nameValues.length == 0 || text.indexOf('{') < 0) return text;
        Map<String, String> values = new HashMap<>();
        for (int i = 0; i + 1 < nameValues.length; i += 2) values.put(String.valueOf(nameValues[i]), String.valueOf(nameValues[i + 1]));
        Matcher m = VALUE.matcher(text);
        StringBuffer sb = new StringBuffer();
        while (m.find()) {
            String v = values.get(m.group(1));
            m.appendReplacement(sb, Matcher.quoteReplacement(v != null ? v : m.group()));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    private static List<String> names(String key) {
        List<String> out = new ArrayList<>();
        Matcher m = VALUE.matcher(key);
        while (m.find()) out.add(m.group(1));
        return out;
    }

    /** Orbit's file name for the language now in use ("pt-BR", "zh-TW", "sr-Latn", "he"...). */
    static String codeFor(Locale l) {
        String lang = l.getLanguage();
        String script = l.getScript();
        String country = l.getCountry();
        switch (lang) {
            case "iw": return "he";
            case "in": return "id";
            case "tl": return "fil";
            case "no": case "nn": return "nb";
            case "zh":
                if ("HK".equals(country) || "MO".equals(country)) return "zh-HK";
                return "Hant".equals(script) || "TW".equals(country) ? "zh-TW" : "zh-CN";
            case "pt": return country.isEmpty() || "BR".equals(country) ? "pt-BR" : "pt-PT";
            case "es": return country.isEmpty() || "ES".equals(country) ? "es" : "es-419";
            case "fr": return "CA".equals(country) ? "fr-CA" : "fr";
            case "sr": return "Latn".equals(script) ? "sr-Latn" : "sr";
            default: return lang;
        }
    }

    /** Loads the translations once per language; English (or a language without a file) needs none. */
    private static void refresh() {
        Locale now = Locale.getDefault();
        String code = codeFor(now);
        if (code.equals(loadedFor)) return;
        loadedFor = code;
        locale = now;
        SEEN.clear();
        table = Collections.emptyMap();
        patterns = Collections.emptyList();
        patternKeys = Collections.emptyList();
        plural = null;
        if ("en".equals(code) || app == null) {
            if (app == null) loadedFor = null; // try again once a context is there
            return;
        }
        try (InputStream in = app.getAssets().open("words/" + code + ".json")) {
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            for (int r; (r = in.read(buf)) > 0; ) bytes.write(buf, 0, r);
            JSONObject json = new JSONObject(new String(bytes.toByteArray(), StandardCharsets.UTF_8));
            Map<String, Object> read = new HashMap<>();
            for (Iterator<String> it = json.keys(); it.hasNext(); ) {
                String key = it.next();
                Object v = json.get(key);
                if (v instanceof JSONObject) {
                    Map<String, String> forms = new HashMap<>();
                    JSONObject f = (JSONObject) v;
                    for (Iterator<String> fi = f.keys(); fi.hasNext(); ) {
                        String c = fi.next();
                        forms.put(c, f.optString(c));
                    }
                    read.put(key, forms);
                } else read.put(key, String.valueOf(v));
            }
            table = read;
            plural = PluralRules.forLocale(locale);
            List<Matcher> compiled = new ArrayList<>();
            List<String> keys = new ArrayList<>();
            List<String> ordered = new ArrayList<>();
            Collections.addAll(ordered, PATTERNS);
            // Most fixed words first, so a short pattern never takes a longer, closer one's text.
            Collections.sort(ordered, (a, b) -> VALUE.matcher(b).replaceAll("").length() - VALUE.matcher(a).replaceAll("").length());
            for (String key : ordered) {
                if (!read.containsKey(key)) continue;
                StringBuilder re = new StringBuilder("^");
                int at = 0;
                Matcher m = VALUE.matcher(key);
                while (m.find()) {
                    re.append(Pattern.quote(key.substring(at, m.start()))).append("(.+?)");
                    at = m.end();
                }
                re.append(Pattern.quote(key.substring(at))).append("$");
                compiled.add(Pattern.compile(re.toString(), Pattern.DOTALL).matcher(""));
                keys.add(key);
            }
            patterns = compiled;
            patternKeys = keys;
        } catch (Exception e) {
            // No file for this language (or a broken one): Orbit's words stay English.
            table = Collections.emptyMap();
        }
    }
}
