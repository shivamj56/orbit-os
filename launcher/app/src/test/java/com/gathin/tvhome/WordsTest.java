package com.gathin.tvhome;

import static org.junit.Assert.assertEquals;

import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

import org.junit.After;
import org.junit.Test;

public class WordsTest {
    private final Locale before = Locale.getDefault();

    @After
    public void restore() {
        Words.useForTest(Locale.ENGLISH, new HashMap<>());
        Locale.setDefault(before);
    }

    private static Map<String, Object> brazil() {
        Map<String, Object> t = new HashMap<>();
        t.put("Clear all", "Limpar tudo");
        t.put("Connected", "Conectado");
        t.put("Strong", "Forte");
        t.put("Family room", "Sala de estar");
        t.put("Sunny", "Ensolarado");
        t.put("The TV sleeps in {n} min", "A TV desliga em {n} min");
        t.put("Ends {time}", "Termina às {time}");
        t.put("ends {time}", "termina às {time}");
        t.put("Phone code   {code}", "Código do celular   {code}");
        t.put("{name} can see this screen", "{name} pode ver esta tela");
        t.put("Open {app}", "Abrir {app}");
        Map<String, String> minutes = new HashMap<>();
        minutes.put("one", "{n} minuto");
        minutes.put("other", "{n} minutos");
        t.put("{n} minutes", minutes);
        return t;
    }

    @Test
    public void exactTextsAndUnknownOnes() {
        Words.useForTest(Locale.forLanguageTag("pt-BR"), brazil());
        assertEquals("Limpar tudo", Words.t("Clear all"));
        assertEquals("Limpar tudo", Words.tm("Clear all"));
        assertEquals("Netflix", Words.tm("Netflix"));
        assertEquals("Something new", Words.t("Something new"));
    }

    @Test
    public void textsPutTogetherInTheCodeAreFoundByTheirPattern() {
        Words.useForTest(Locale.forLanguageTag("pt-BR"), brazil());
        assertEquals("A TV desliga em 15 min", Words.tm("The TV sleeps in 15 min"));
        assertEquals("Código do celular   123 456", Words.tm("Phone code   123 456"));
        assertEquals("Shiv pode ver esta tela", Words.tm("Shiv can see this screen"));
        // A value that is itself a text is translated too.
        assertEquals("Abrir Sala de estar", Words.tm("Open Family room"));
    }

    @Test
    public void partsAroundADotAreTranslatedOneByOne() {
        Words.useForTest(Locale.forLanguageTag("pt-BR"), brazil());
        assertEquals("Ensolarado · Sala de estar", Words.tm("Sunny · Family room"));
        assertEquals("Conectado   ·   80%", Words.tm("Connected   ·   80%"));
        assertEquals("Conectado · Forte", Words.tm("Connected · Strong"));
    }

    @Test
    public void valuesAndCounts() {
        Words.useForTest(Locale.forLanguageTag("pt-BR"), brazil());
        assertEquals("Abrir YouTube", Words.t("Open {app}", "app", "YouTube"));
        // Without Android's plural rules (a JVM test) the "other" form is used; on the TV, PluralRules picks.
        assertEquals("5 minutos", Words.n(5, "{n} minute", "{n} minutes"));
        assertEquals("1 app closed", Words.n(1, "{n} app closed", "{n} apps closed"));
        assertEquals("3 apps closed", Words.n(3, "{n} app closed", "{n} apps closed"));
    }

    @Test
    public void languageFileNames() {
        assertEquals("pt-BR", Words.codeFor(Locale.forLanguageTag("pt")));
        assertEquals("pt-PT", Words.codeFor(Locale.forLanguageTag("pt-PT")));
        assertEquals("es-419", Words.codeFor(Locale.forLanguageTag("es-MX")));
        assertEquals("es", Words.codeFor(Locale.forLanguageTag("es-ES")));
        assertEquals("zh-TW", Words.codeFor(Locale.forLanguageTag("zh-Hant-TW")));
        assertEquals("zh-HK", Words.codeFor(Locale.forLanguageTag("zh-HK")));
        assertEquals("zh-CN", Words.codeFor(Locale.forLanguageTag("zh-CN")));
        assertEquals("sr-Latn", Words.codeFor(Locale.forLanguageTag("sr-Latn-RS")));
        assertEquals("he", Words.codeFor(Locale.forLanguageTag("he-IL")));
        assertEquals("id", Words.codeFor(Locale.forLanguageTag("id-ID")));
        assertEquals("fil", Words.codeFor(Locale.forLanguageTag("fil-PH")));
        assertEquals("nb", Words.codeFor(Locale.forLanguageTag("nn-NO")));
        assertEquals("hi", Words.codeFor(Locale.forLanguageTag("hi-IN")));
    }
}
