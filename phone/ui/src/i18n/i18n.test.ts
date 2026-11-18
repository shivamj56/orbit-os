import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { LANGUAGES, languageFor, list, num, rich, systemLanguage, t, tm, tn, useCatalogForTest, type Catalog } from "./index";

afterEach(() => useCatalogForTest("en", {}));

describe("languageFor: the tag a phone gives, to the language Orbit has", () => {
  it.each([
    ["pt-BR", "pt-BR"],
    ["pt", "pt-BR"],
    ["pt-PT", "pt-PT"],
    ["pt-AO", "pt-PT"],
    ["es-ES", "es"],
    ["es", "es"],
    ["es-MX", "es-419"],
    ["es-US", "es-419"],
    ["fr-CA", "fr-CA"],
    ["fr-BE", "fr"],
    ["zh-CN", "zh-CN"],
    ["zh-Hans-SG", "zh-CN"],
    ["zh-Hant-TW", "zh-TW"],
    ["zh-TW", "zh-TW"],
    ["zh-HK", "zh-HK"],
    ["zh-Hant-HK", "zh-HK"],
    ["sr-Latn-RS", "sr-Latn"],
    ["sr-RS", "sr"],
    ["iw-IL", "he"],
    ["in-ID", "id"],
    ["tl-PH", "fil"],
    ["fil-PH", "fil"],
    ["nn-NO", "nb"],
    ["hi-IN", "hi"],
    ["en-GB", "en"],
    ["ar_EG", "ar"],
  ])("%s is %s", (tag, code) => {
    expect(languageFor(tag)?.code).toBe(code);
  });

  it("knows nothing of a language Orbit does not speak, or of junk", () => {
    expect(languageFor("tlh")).toBeNull();
    expect(languageFor("")).toBeNull();
    expect(languageFor("../hi")).toBeNull();
  });

  it("the phone's first language Orbit speaks wins; English when none", () => {
    expect(systemLanguage(["gsw-CH", "de-CH", "en"]).code).toBe("de");
    expect(systemLanguage(["tlh"]).code).toBe("en");
  });

  it("every language has a file name, its own name, and right-to-left only where it should", () => {
    const codes = LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(LANGUAGES.filter((l) => l.rtl).map((l) => l.code).sort()).toEqual(["ar", "fa", "he", "ur"]);
    for (const l of LANGUAGES) expect(languageFor(l.code)?.code).toBe(l.code);
  });
});

describe("t, tn, tm, rich", () => {
  it("English, with values, when there is no translation", () => {
    expect(t("Connect to {name}", { name: "Bedroom" })).toBe("Connect to Bedroom");
    expect(tn(1, "{n} app", "{n} apps")).toBe("1 app");
    expect(tn(1200, "{n} app", "{n} apps")).toBe("1,200 apps");
  });

  it("a language's own words, values in its own places", () => {
    useCatalogForTest("ja", { "Connect to {name}": "{name}に接続" });
    expect(t("Connect to {name}", { name: "寝室" })).toBe("寝室に接続");
    expect(t("Not translated yet")).toBe("Not translated yet");
  });

  it("counts take the language's plural form", () => {
    useCatalogForTest("ru", { "{n} apps": { one: "{n} приложение", few: "{n} приложения", many: "{n} приложений", other: "{n} приложения" } });
    expect(tn(1, "{n} app", "{n} apps")).toBe("1 приложение");
    expect(tn(3, "{n} app", "{n} apps")).toBe("3 приложения");
    expect(tn(5, "{n} app", "{n} apps")).toBe("5 приложений");
    expect(tn(21, "{n} app", "{n} apps")).toBe("21 приложение");
  });

  it("messages from Flutter or the TV: exact, then by pattern, the most specific first", () => {
    useCatalogForTest("pt-BR", {
      "The TV said no.": "A TV disse não.",
      "The TV answered {status}.": "A TV respondeu {status}.",
      "The TV said: {why}": "A TV disse: {why}",
    });
    expect(tm("The TV said no.")).toBe("A TV disse não.");
    expect(tm("The TV answered 418.")).toBe("A TV respondeu 418.");
    expect(tm("Something new from the TV")).toBe("Something new from the TV");
    expect(tm(null)).toBe("");
  });

  it("rich: marked-up words and values, in the translation's order", () => {
    useCatalogForTest("de", { "Signed in as {email}. Deleting cannot be undone.": "Angemeldet als {email}. <b>Löschen</b> lässt sich nicht rückgängig machen." });
    const node = rich(t("Signed in as {email}. Deleting cannot be undone."), {
      email: createElement("i", null, "a@b.c"),
      b: (words) => createElement("b", null, words),
    });
    expect(renderToStaticMarkup(createElement("p", null, node))).toBe("<p>Angemeldet als <i>a@b.c</i>. <b>Löschen</b> lässt sich nicht rückgängig machen.</p>");
  });

  it("numbers and lists the language's way, digits always Western", () => {
    useCatalogForTest("de", {});
    expect(num(1234.5, { maximumFractionDigits: 1 })).toBe("1.234,5");
    expect(list(["A", "B", "C"], "and")).toBe("A, B und C");
    useCatalogForTest("ar", {});
    expect(num(42)).toBe("42");
  });
});

// ---- the translation files themselves ----

// Read through Vite (as the app's own build would), so this file needs no Node types.
const locales = import.meta.glob<Catalog>("../../public/locales/*.json", { eager: true, import: "default" });
const sourceFile = import.meta.glob<{ texts: { text: string; one?: string }[] }>("../../i18n/source.json", { eager: true, import: "default" });
const source = Object.values(sourceFile)[0];
const english = new Map(source.texts.map((e) => [e.text, e]));
const marks = (s: string) => [...s.matchAll(/\{\w+\}|<\/?\w+>/g)].map((m) => m[0]).sort();
const files = Object.keys(locales).map((p) => p.split("/").pop()!);

describe.each(files)("public/locales/%s", (file) => {
  const code = file.replace(/\.json$/, "");
  const catalog = locales[`../../public/locales/${file}`];
  const categories = new Intl.PluralRules(code).resolvedOptions().pluralCategories;

  it("is a language Orbit lists", () => {
    expect(LANGUAGES.some((l) => l.code === code)).toBe(true);
  });

  it("keeps every {value} and <tag> of the English, and every plural form", () => {
    const wrong: string[] = [];
    for (const [key, value] of Object.entries(catalog)) {
      const e = english.get(key);
      if (!e) continue; // a text the app no longer shows: harmless, removed by the next tidy-up
      const forms = typeof value === "string" ? { other: value } : value;
      if (e.one && categories.length > 1 && typeof value === "string") wrong.push(`${key}: needs ${categories.join(", ")}`);
      for (const [form, text] of Object.entries(forms)) {
        if (!text) {
          wrong.push(`${key} [${form}]: empty`);
          continue;
        }
        const want = marks(e.one && form === "one" ? e.one : e.text).filter((m) => !(e.one && form !== "other" && m === "{n}"));
        const have = marks(text).filter((m) => !(e.one && m === "{n}"));
        const missing = want.filter((m) => m !== "{n}" && !have.includes(m));
        const extra = have.filter((m) => !want.includes(m) && m !== "{n}");
        if (missing.length || extra.length) wrong.push(`${key} [${form}]: ${text}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});
