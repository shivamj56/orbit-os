// The language list and file helpers the i18n tools share. The list itself lives once, in
// phone/ui/src/i18n/languages.ts; this reads it from there.
const fs = require("fs");
const path = require("path");

const repo = path.resolve(__dirname, "../..");

/** Android's resource names for a language (values-<q>/), first the one Orbit writes. */
const ANDROID = {
  he: ["iw"],
  id: ["in"],
  fil: ["tl", "fil"],
  "pt-BR": ["pt"],
  "pt-PT": ["pt-rPT"],
  "es-419": ["b+es+419"],
  "fr-CA": ["fr-rCA"],
  "zh-CN": ["zh-rCN"],
  "zh-HK": ["zh-rHK"],
  "zh-TW": ["zh-rTW"],
  "sr-Latn": ["b+sr+Latn"],
};

function readLanguages() {
  const ts = fs.readFileSync(path.join(repo, "phone/ui/src/i18n/languages.ts"), "utf8");
  const out = [];
  for (const m of ts.matchAll(/\{ code: "([^"]+)", name: "([^"]+)", english: "([^"]+)"(, rtl: true)? \}/g)) {
    out.push({ code: m[1], name: m[2], english: m[3], rtl: !!m[4] });
  }
  return out.map((l) => ({ ...l, android: ANDROID[l.code] ?? [l.code] }));
}

const LANGUAGES = readLanguages();

/** strings.xml's own escapes undone: the text as people read it. */
function unescapeAndroid(s) {
  return s
    .replace(/^"(.*)"$/s, "$1")
    .replace(/\\n/g, "\n")
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\@/g, "@")
    .replace(/\\\?/g, "?")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** A text made safe for strings.xml. */
function escapeAndroid(s) {
  let out = s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n");
  if (/^[@?]/.test(out)) out = "\\" + out;
  if (/^\s|\s$/.test(out)) out = `"${out.replace(/\\"/g, '\\"')}"`;
  return out;
}

/** Every <string> and <plurals> of a strings.xml: name, text (or plural forms), translatable. */
function readStrings(file) {
  const xml = fs.readFileSync(file, "utf8").replace(/<!--[\s\S]*?-->/g, "");
  const out = [];
  for (const m of xml.matchAll(/<string\s+name="([^"]+)"([^>]*)>([\s\S]*?)<\/string>/g)) {
    out.push({ name: m[1], text: unescapeAndroid(m[3]), translatable: !/translatable="false"/.test(m[2]) && !m[3].startsWith("@string/") });
  }
  for (const m of xml.matchAll(/<plurals\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/plurals>/g)) {
    const forms = {};
    for (const i of m[2].matchAll(/<item\s+quantity="(\w+)">([\s\S]*?)<\/item>/g)) forms[i[1]] = unescapeAndroid(i[2]);
    out.push({ name: m[1], text: forms.other ?? "", plural: forms, translatable: true });
  }
  return out;
}

function readPhoneLocale(repoDir, code) {
  const file = path.join(repoDir, "phone/ui/public/locales", `${code}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
}

/** The marks a translation must keep: {name} values, <b> tags, Android's %1$s and %%. */
function marks(text) {
  const found = [...text.matchAll(/\{\w+\}|<\/?\w+>|%(?:\d+\$)?[-#+ 0,(]*\d*(?:\.\d+)?[sdfx%]/g)].map((m) => m[0]);
  return found.sort();
}

module.exports = { LANGUAGES, ANDROID, readStrings, readPhoneLocale, escapeAndroid, unescapeAndroid, marks, repo };
