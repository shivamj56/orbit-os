import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { LANGUAGES, READY, languageFor, list, num, rich, systemLanguage, t, tm, tn, useCatalogForTest, type Catalog } from "./index";
import { READY_CODES } from "./ready";

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

  it("the phone's first language Orbit has texts for wins; English when none", () => {
    expect(systemLanguage(["gsw-CH", "de-CH", "en"]).code).toBe("de");
    expect(systemLanguage(["tlh"]).code).toBe("en");
    const missing = LANGUAGES.find((l) => !READY.includes(l));
    if (missing) expect(systemLanguage([missing.code]).code).toBe("en");
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

  it("writes the number in every plural form that is not the number 1 alone (Russian \"one\" is also 21, 31...)", () => {
    const rules = new Intl.PluralRules(code);
    const wide = (form: string) => Array.from({ length: 198 }, (_, i) => i + 2).some((n) => rules.select(n) === form);
    const wrong = Object.entries(catalog)
      .filter(([key, value]) => english.get(key)?.one && typeof value === "object")
      .flatMap(([key, value]) => Object.entries(value as Record<string, string>).filter(([form, text]) => form !== "other" && wide(form) && !text.includes("{n}")).map(([form]) => `${key} [${form}]`));
    expect(wrong).toEqual([]);
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

it("ready.ts lists exactly the languages that have a file in public/locales", () => {
  expect([...READY_CODES].sort()).toEqual(files.map((f) => f.replace(/\.json$/, "")).sort());
});

// tools/i18n/extract.cjs folds runs of spaces into one when it writes source.json, and the translation files are keyed
// by what it writes. A text written in the code with two spaces ("Roll to move  ·  tap for OK", Orbit 1.5.1) is then
// never found, and stays English in every language. Spacing belongs in CSS, not in the text.
const code = import.meta.glob<string>(["../**/*.ts", "../**/*.tsx", "!../**/*.test.ts", "!../**/*.test.tsx"], { eager: true, query: "?raw", import: "default" });

it("writes every translated text in the code exactly as the translation files key it (single spaces, no edge spaces)", () => {
  const literal = String.raw`"((?:[^"\\\n]|\\.)*)"`;
  const calls = [new RegExp(String.raw`\b(?:t|mark)\(\s*${literal}`, "g"), new RegExp(String.raw`\btn\([^,()]+,\s*${literal}\s*,\s*${literal}`, "g")];
  const wrong: string[] = [];
  for (const [file, text] of Object.entries(code)) {
    for (const re of calls) {
      for (const m of text.matchAll(re)) {
        for (const s of m.slice(1).filter((x): x is string => x !== undefined)) {
          if (s !== s.replace(/\s+/g, " ").trim()) wrong.push(`${file}: ${JSON.stringify(s)}`);
        }
      }
    }
  }
  expect(Object.keys(code).length).toBeGreaterThan(20);
  expect(wrong).toEqual([]);
});
