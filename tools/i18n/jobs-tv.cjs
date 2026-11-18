#!/usr/bin/env node
// Like jobs.cjs, for the TV: Orbit's own words on the TV (launcher/i18n/source.json, translated into
// launcher/app/src/main/assets/words/<code>.json) and Orbit Live TV's strings.xml.
//
//   node tools/i18n/jobs-tv.cjs <out-dir> [code ...]
//
// <out-dir>/texts.json lists the words with short ids (w001...); jobs/<code>.json says which ones a language still
// needs, and which Live TV strings ("l:<name>", with their English). Translations come back as out/<code>.json parts.
const fs = require("fs");
const path = require("path");
const lang = require("./languages.cjs");
const repo = lang.repo;

const [dir, ...only] = process.argv.slice(2);
if (!dir) {
  console.error("usage: node tools/i18n/jobs-tv.cjs <out-dir> [code ...]");
  process.exit(2);
}
fs.mkdirSync(path.join(dir, "jobs"), { recursive: true });
fs.mkdirSync(path.join(dir, "out"), { recursive: true });

const words = JSON.parse(fs.readFileSync(path.join(repo, "launcher/i18n/source.json"), "utf8")).texts.map((e, i) => ({
  id: `w${String(i + 1).padStart(3, "0")}`,
  ...e,
}));
fs.writeFileSync(
  path.join(dir, "texts.json"),
  "[\n" + words.map(({ id, text, one }) => JSON.stringify({ id, kind: "tv", text, ...(one ? { one } : {}) })).join(",\n") + "\n]\n",
);
const live = lang.readStrings(path.join(repo, "launcher/livetv/src/main/res/values/strings.xml"));

for (const l of lang.LANGUAGES) {
  if (l.code === "en" || (only.length && !only.includes(l.code))) continue;
  const file = path.join(repo, "launcher/app/src/main/assets/words", `${l.code}.json`);
  const have = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  const liveHave = new Set();
  for (const q of l.android) {
    const f = path.join(repo, "launcher/livetv/src/main/res", `values-${q}`, "strings.xml");
    if (fs.existsSync(f)) for (const s of lang.readStrings(f)) liveHave.add(s.name);
  }
  const job = {
    code: l.code,
    name: l.name,
    english: l.english,
    rtl: !!l.rtl,
    plural: new Intl.PluralRules(l.code).resolvedOptions().pluralCategories,
    phone: words.filter((w) => !(w.text in have)).map((w) => w.id),
    tv: live.filter((s) => s.translatable && !liveHave.has(s.name)).map((s) => ({ id: `l:${s.name}`, text: s.text, ...(s.plural ? { plural: s.plural } : {}) })),
  };
  fs.writeFileSync(path.join(dir, "jobs", `${l.code}.json`), JSON.stringify(job, null, 1));
}
console.log(`${words.length} TV words, ${live.length} Live TV strings -> ${dir}`);
