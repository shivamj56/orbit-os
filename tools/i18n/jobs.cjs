#!/usr/bin/env node
// Prepares translation work for people or agents (tools/i18n/README.md): what each language still needs.
//
//   node tools/i18n/jobs.cjs <out-dir> [code ...]
//
// <out-dir>/phone.json   the phone app's texts (phone/ui/i18n/source.json) with short ids, the same for every language
// <out-dir>/jobs/<code>.json  per language: its plural categories, the phone ids it still needs, and the TV launcher's
//                        strings it still needs (launcher/app/src/main/res/values/strings.xml, by Android name)
// Translations come back as <out-dir>/out/<code>.json (or several <code>.<n>.json parts): { id: text | { forms } }.
const fs = require("fs");
const path = require("path");
const repo = path.resolve(__dirname, "../..");
const lang = require("./languages.cjs");

const [dir, ...only] = process.argv.slice(2);
if (!dir) {
  console.error("usage: node tools/i18n/jobs.cjs <out-dir> [code ...]");
  process.exit(2);
}
fs.mkdirSync(path.join(dir, "jobs"), { recursive: true });
fs.mkdirSync(path.join(dir, "out"), { recursive: true });

// ---- the phone: one list, short ids ----
const source = JSON.parse(fs.readFileSync(path.join(repo, "phone/ui/i18n/source.json"), "utf8")).texts;
const phone = source.map((e, i) => ({ id: `p${String(i + 1).padStart(4, "0")}`, ...e }));
// One entry per line: easy to read in parts.
fs.writeFileSync(
  path.join(dir, "phone.json"),
  "[\n" + phone.map(({ id, text, one, kind }) => JSON.stringify({ id, kind, text, ...(one ? { one } : {}) })).join(",\n") + "\n]\n",
);

// ---- the TV: the launcher's strings.xml, by name ----
const tvBase = lang.readStrings(path.join(repo, "launcher/app/src/main/res/values/strings.xml"));

for (const l of lang.LANGUAGES) {
  if (l.code === "en" || (only.length && !only.includes(l.code))) continue;
  const have = lang.readPhoneLocale(repo, l.code);
  const needPhone = phone.filter((e) => !(e.text in have)).map((e) => e.id);
  const tvHave = new Map();
  for (const q of l.android) {
    const file = path.join(repo, "launcher/app/src/main/res", `values-${q}`, "strings.xml");
    if (fs.existsSync(file)) for (const s of lang.readStrings(file)) tvHave.set(s.name, s);
  }
  const needTv = tvBase.filter((s) => s.translatable && !tvHave.has(s.name)).map((s) => ({ id: `t:${s.name}`, text: s.text, ...(s.plural ? { plural: s.plural } : {}) }));
  const job = {
    code: l.code,
    name: l.name,
    english: l.english,
    rtl: !!l.rtl,
    plural: new Intl.PluralRules(l.code).resolvedOptions().pluralCategories,
    phone: needPhone,
    tv: needTv,
  };
  fs.writeFileSync(path.join(dir, "jobs", `${l.code}.json`), JSON.stringify(job, null, 1));
  console.log(`${l.code.padEnd(7)} phone ${String(needPhone.length).padStart(4)}  tv ${String(needTv.length).padStart(3)}  plural ${job.plural.join(",")}`);
}
