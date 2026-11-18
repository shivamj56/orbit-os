#!/usr/bin/env node
// Lists Orbit's own words on the TV (launcher/app/src/main/java/com/gathin/tvhome/Words.java) into
// launcher/i18n/source.json: every Words.t("..."), Words.mark("...") and Words.n(n, "one", "other") in the launcher's
// code, and Words.PATTERNS (the texts the code puts together). Their translations go to the launcher's
// assets/words/<code>.json (tools/i18n/apply.cjs). The launcher's older texts and Orbit Live TV's are Android
// strings.xml files, translated the Android way.
//
//   node tools/i18n/extract-tv.cjs          writes launcher/i18n/source.json
//   node tools/i18n/extract-tv.cjs --check  fails if it is not up to date
const fs = require("fs");
const path = require("path");

const repo = path.resolve(__dirname, "../..");
const javaDir = path.join(repo, "launcher/app/src/main/java/com/gathin/tvhome");
const out = path.join(repo, "launcher/i18n/source.json");

const unescape = (s) => s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
const LIT = '"((?:[^"\\\\]|\\\\.)*)"';

const texts = new Map();
const add = (text, where, one) => {
  const e = texts.get(text) ?? { text, where: new Set() };
  e.where.add(where);
  if (one) e.one = one;
  texts.set(text, e);
};

for (const f of fs.readdirSync(javaDir).filter((f) => f.endsWith(".java")).sort()) {
  const code = fs.readFileSync(path.join(javaDir, f), "utf8");
  for (const m of code.matchAll(new RegExp(`Words\\.(?:t|mark)\\(\\s*${LIT}`, "g"))) add(unescape(m[1]), f);
  for (const m of code.matchAll(new RegExp(`Words\\.n\\([^,]+,\\s*${LIT}\\s*,\\s*${LIT}`, "g"))) add(unescape(m[2]), f, unescape(m[1]));
}
const words = fs.readFileSync(path.join(javaDir, "Words.java"), "utf8");
const block = words.slice(words.indexOf("static final String[] PATTERNS = {"), words.indexOf("};", words.indexOf("static final String[] PATTERNS = {")));
for (const m of block.matchAll(new RegExp(LIT, "g"))) add(unescape(m[1]), "Words.java PATTERNS");

const list = [...texts.values()]
  .map((e) => ({ text: e.text, ...(e.one ? { one: e.one } : {}), kind: "tv", where: [...e.where].sort() }))
  .sort((a, b) => a.text.localeCompare(b.text, "en"));
const doc = {
  about:
    "Orbit's own words on the TV, made by tools/i18n/extract-tv.cjs from the launcher's Words.t/mark/n and Words.PATTERNS: do not edit by hand. Translations: launcher/app/src/main/assets/words/<code>.json, keyed by these texts.",
  texts: list,
};
const json = JSON.stringify(doc, null, 2) + "\n";
if (process.argv.includes("--check")) {
  if (!fs.existsSync(out) || fs.readFileSync(out, "utf8") !== json) {
    console.error("launcher/i18n/source.json is out of date: run node tools/i18n/extract-tv.cjs");
    process.exit(1);
  }
  console.log(`launcher/i18n/source.json is up to date (${list.length} texts)`);
} else {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, json);
  console.log(`wrote ${path.relative(repo, out)}: ${list.length} texts`);
}
