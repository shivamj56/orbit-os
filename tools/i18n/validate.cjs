#!/usr/bin/env node
// Checks translations made from tools/i18n/jobs.cjs before they go into the app.
//
//   node tools/i18n/validate.cjs <work-dir> <code> [...]
//
// Reads <work-dir>/jobs/<code>.json and every <work-dir>/out/<code>.json / <code>.<n>.json part, and reports:
// missing or unknown ids, empty texts, {values} / <b> tags / %1$s marks that differ from the English, and counts
// without every plural form the language needs. Exit code 1 if anything is wrong.
const fs = require("fs");
const path = require("path");
const { marks } = require("./languages.cjs");

const [dir, ...codes] = process.argv.slice(2);
const listFile = fs.existsSync(path.join(dir, "phone.json")) ? "phone.json" : "texts.json";
const phone = new Map(JSON.parse(fs.readFileSync(path.join(dir, listFile), "utf8")).map((e) => [e.id, e]));

function load(code) {
  const out = {};
  const files = fs.readdirSync(path.join(dir, "out")).filter((f) => f === `${code}.json` || (f.startsWith(`${code}.`) && /^\d+\.json$/.test(f.slice(code.length + 1))));
  for (const f of files.sort()) Object.assign(out, JSON.parse(fs.readFileSync(path.join(dir, "out", f), "utf8")));
  return out;
}

let bad = 0;
for (const code of codes) {
  const job = JSON.parse(fs.readFileSync(path.join(dir, "jobs", `${code}.json`), "utf8"));
  let got;
  try {
    got = load(code);
  } catch (e) {
    console.log(`${code}: a file is not valid JSON: ${e.message}`);
    bad++;
    continue;
  }
  const problems = [];
  const tv = new Map(job.tv.map((e) => [e.id, e]));
  const wanted = new Set([...job.phone, ...tv.keys()]);
  for (const id of wanted) {
    const value = got[id];
    const english = tv.has(id) ? tv.get(id) : phone.get(id);
    const plural = tv.has(id) ? english.plural : english.one ? { one: english.one, other: english.text } : null;
    if (value === undefined) {
      problems.push(`${id} missing`);
      continue;
    }
    const forms = typeof value === "string" ? { other: value } : value;
    if (typeof value !== "string" && (typeof value !== "object" || value === null)) {
      problems.push(`${id} is neither a text nor plural forms`);
      continue;
    }
    if (plural && job.plural.length > 1 && typeof value === "string") problems.push(`${id} is a count: give the forms ${job.plural.join(", ")}`);
    if (plural && typeof value === "object") for (const c of job.plural) if (!forms[c]) problems.push(`${id} lacks the "${c}" form`);
    if (!plural && typeof value !== "string") problems.push(`${id} is not a count: give one text`);
    for (const [form, text] of Object.entries(forms)) {
      if (!text || !String(text).trim()) {
        problems.push(`${id} ${form} is empty`);
        continue;
      }
      // A count's forms keep {n}/%d except where the language spells the one out ("one app"); the rest must match.
      const want = marks(plural ? (form === "one" && plural.one ? plural.one : plural.other) : english.text);
      const have = marks(String(text));
      // "one" may spell the number out ("one app") only where it means 1 alone: in Russian it is also 21, 31, 101...
      const alone = (() => {
        try {
          const rules = new Intl.PluralRules(code);
          return ![...Array(200).keys()].slice(2).some((n) => rules.select(n) === form);
        } catch {
          return false;
        }
      })();
      const loose = plural && form !== "other" && alone;
      const missing = want.filter((m) => !have.includes(m) && !(loose && /^(\{n\}|%(\d+\$)?d)$/.test(m)));
      const extra = have.filter((m) => !want.includes(m) && !(plural && /^(\{n\}|%(\d+\$)?d)$/.test(m)));
      if (missing.length || extra.length) problems.push(`${id}${plural ? ` ${form}` : ""} marks differ: want ${want.join(" ") || "none"}, has ${have.join(" ") || "none"}`);
    }
  }
  const unknown = Object.keys(got).filter((id) => !wanted.has(id));
  if (unknown.length) problems.push(`unknown ids: ${unknown.slice(0, 8).join(", ")}${unknown.length > 8 ? "…" : ""}`);
  const done = [...wanted].filter((id) => got[id] !== undefined).length;
  if (problems.length) {
    bad++;
    console.log(`${code}: ${done}/${wanted.size} done, ${problems.length} problems`);
    for (const p of problems.slice(0, 40)) console.log(`  ${p}`);
    if (problems.length > 40) console.log(`  … and ${problems.length - 40} more`);
  } else console.log(`${code}: ${done}/${wanted.size} done, all good`);
}
process.exit(bad ? 1 : 0);
