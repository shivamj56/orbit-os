#!/usr/bin/env node
// Puts checked translations (tools/i18n/validate.cjs) where the apps read them:
//
//   node tools/i18n/apply.cjs --phone <work-dir> [code ...]   phone app texts  -> phone/ui/public/locales/<code>.json
//                                                             launcher strings -> launcher/.../values-<q>/strings.xml
//   node tools/i18n/apply.cjs --tv <work-dir> [code ...]      Orbit's TV words -> launcher/app/src/main/assets/words/<code>.json
//                                                             Live TV strings  -> launcher/livetv/.../values-<q>/strings.xml
//   node tools/i18n/apply.cjs --locales                       launcher's locales_config.xml from the language list
//
// Existing translations are kept: new ones only fill what is missing (a person's fix is never overwritten).
const fs = require("fs");
const path = require("path");
const lang = require("./languages.cjs");
const repo = lang.repo;

const args = process.argv.slice(2);
const mode = args[0];

function readParts(dir, code) {
  const out = {};
  const outDir = path.join(dir, "out");
  if (!fs.existsSync(outDir)) return out;
  for (const f of fs.readdirSync(outDir).sort()) {
    if (f === `${code}.json` || new RegExp(`^${code.replace(/[-+]/g, "\\$&")}\\.\\d+\\.json$`).test(f)) {
      Object.assign(out, JSON.parse(fs.readFileSync(path.join(outDir, f), "utf8")));
    }
  }
  return out;
}

function sortedJson(obj) {
  const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b, "en"));
  const o = {};
  for (const k of keys) o[k] = obj[k];
  return JSON.stringify(o, null, 2) + "\n";
}

/** Adds strings (and plurals) to a strings.xml, keeping what is there; creates the file if needed. */
function mergeStrings(file, entries, plurals) {
  const have = fs.existsSync(file) ? new Set(lang.readStrings(file).map((s) => s.name)) : new Set();
  const lines = [];
  for (const [name, value] of entries) {
    if (have.has(name)) continue;
    if (typeof value === "string") lines.push(`    <string name="${name}">${lang.escapeAndroid(value)}</string>`);
    else {
      lines.push(`    <plurals name="${name}">`);
      for (const c of plurals) if (value[c]) lines.push(`        <item quantity="${c}">${lang.escapeAndroid(value[c])}</item>`);
      lines.push(`    </plurals>`);
    }
  }
  if (!lines.length) return 0;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let xml = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n</resources>\n';
  const end = xml.lastIndexOf("</resources>");
  xml = xml.slice(0, end) + lines.join("\n") + "\n" + xml.slice(end);
  fs.writeFileSync(file, xml);
  return lines.length;
}

const pickCodes = (rest, dir) => {
  const listed = rest.filter((a) => !a.startsWith("--"));
  if (listed.length) return listed;
  const outDir = path.join(dir, "out");
  const found = new Set(fs.readdirSync(outDir).map((f) => f.replace(/(\.\d+)?\.json$/, "")));
  return lang.LANGUAGES.map((l) => l.code).filter((c) => found.has(c));
};

/** phone/ui/src/i18n/ready.ts: the languages the phone app has texts for (Settings › Language offers only these). */
function writeReady() {
  const codes = fs
    .readdirSync(path.join(repo, "phone/ui/public/locales"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
  const ts =
    "// Written by tools/i18n/apply.cjs: the languages whose texts are in public/locales. Settings › Language offers\n" +
    "// only these (and English); i18n.test.ts checks the list against the files.\n" +
    `export const READY_CODES: readonly string[] = ${JSON.stringify(codes)};\n`;
  fs.writeFileSync(path.join(repo, "phone/ui/src/i18n/ready.ts"), ts);
}

if (mode === "--ready") {
  writeReady();
  console.log("ready.ts written");
} else if (mode === "--phone") {
  const dir = args[1];
  const list = new Map(JSON.parse(fs.readFileSync(path.join(dir, "phone.json"), "utf8")).map((e) => [e.id, e]));
  for (const code of pickCodes(args.slice(2), dir)) {
    const l = lang.LANGUAGES.find((x) => x.code === code);
    const got = readParts(dir, code);
    const job = JSON.parse(fs.readFileSync(path.join(dir, "jobs", `${code}.json`), "utf8"));
    // phone
    const file = path.join(repo, "phone/ui/public/locales", `${code}.json`);
    const texts = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    let added = 0;
    for (const [id, value] of Object.entries(got)) {
      const e = list.get(id);
      if (!e || e.text in texts) continue;
      texts[e.text] = value;
      added++;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, sortedJson(texts));
    // launcher strings.xml
    // A language with only "other" answers a count with a plain text; Android still needs it as <plurals>.
    const tvEntries = job.tv
      .filter((e) => got[e.id] !== undefined)
      .map((e) => [e.id.slice(2), e.plural && typeof got[e.id] === "string" ? { other: got[e.id] } : got[e.id]]);
    const xml = path.join(repo, "launcher/app/src/main/res", `values-${l.android[0]}`, "strings.xml");
    const n = mergeStrings(xml, tvEntries, job.plural);
    console.log(`${code.padEnd(7)} phone +${added} (${Object.keys(texts).length})  launcher strings +${n}`);
  }
  writeReady();
} else if (mode === "--tv") {
  const dir = args[1];
  const list = new Map(JSON.parse(fs.readFileSync(path.join(dir, "texts.json"), "utf8")).map((e) => [e.id, e]));
  for (const code of pickCodes(args.slice(2), dir)) {
    const l = lang.LANGUAGES.find((x) => x.code === code);
    const got = readParts(dir, code);
    const job = JSON.parse(fs.readFileSync(path.join(dir, "jobs", `${code}.json`), "utf8"));
    const file = path.join(repo, "launcher/app/src/main/assets/words", `${code}.json`);
    const words = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    let added = 0;
    for (const [id, value] of Object.entries(got)) {
      const e = list.get(id);
      if (!e || e.text in words) continue;
      words[e.text] = value;
      added++;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, sortedJson(words));
    const live = job.tv.filter((e) => got[e.id] !== undefined).map((e) => [e.id.slice(2), got[e.id]]);
    const xml = path.join(repo, "launcher/livetv/src/main/res", `values-${l.android[0]}`, "strings.xml");
    const n = mergeStrings(xml, live, job.plural);
    console.log(`${code.padEnd(7)} TV words +${added} (${Object.keys(words).length})  Live TV strings +${n}`);
  }
} else if (mode === "--locales") {
  // Android 13+ lists these as the launcher's own languages; Hebrew and Indonesian keep Android's old names, which
  // its resource folders use (values-iw, values-in).
  const legacy = { he: "iw", id: "in" };
  // Only the languages Orbit Home has its own words for (assets/words/<code>.json), and English.
  const words = path.join(repo, "launcher/app/src/main/assets/words");
  const tags = lang.LANGUAGES.filter((l) => l.code === "en" || fs.existsSync(path.join(words, `${l.code}.json`))).map((l) => legacy[l.code] ?? l.code);
  const xml =
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    "<!-- Languages the launcher is translated into (those with assets/words/<code>.json, from phone/ui/src/i18n/languages.ts),\n" +
    "     written by tools/i18n/apply.cjs (locales). Android 13+ lets the launcher have its own language (set it with\n" +
    '     "cmd locale set-app-locales", see the README), since TVs rarely offer every language system-wide. -->\n' +
    '<locale-config xmlns:android="http://schemas.android.com/apk/res/android">\n' +
    tags.map((t) => `    <locale android:name="${t}" />`).join("\n") +
    "\n</locale-config>\n";
  fs.writeFileSync(path.join(repo, "launcher/app/src/main/res/xml/locales_config.xml"), xml);
  console.log(`locales_config.xml: ${tags.length} languages`);
} else {
  console.error("usage: node tools/i18n/apply.cjs --phone <work-dir> [code ...] | --tv <work-dir> [code ...] | --locales");
  process.exit(2);
}
