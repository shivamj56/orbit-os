#!/usr/bin/env node
// Lists every English text the phone app can show (phone/SPEC.md, "Languages") into phone/ui/i18n/source.json, the
// list translations are made from and checked against:
//
//   - the page's own words: t("..."), tn(n, "one", "other"), mark("...") in phone/ui/src
//   - messages that come from outside the page and are translated where they show (tm): Flutter's errors
//     (phone/app/lib), the TV's answers (launcher's PhonePortal and OrbitCloud), the setup scripts' failures
//     (setup/tv/*.sh), and the demo's pretend TV (mock*.ts)
//   - the setup catalog's names and questions (phone/ui/src/setup/catalog.json)
//
//   node tools/i18n/extract.cjs          writes phone/ui/i18n/source.json
//   node tools/i18n/extract.cjs --check  fails if the file is not up to date (for CI and tests)
const fs = require("fs");
const path = require("path");

const repo = path.resolve(__dirname, "../..");
const ui = path.join(repo, "phone/ui");
const ts = require(require.resolve("typescript", { paths: [ui] }));
const out = path.join(ui, "i18n/source.json");

/** text -> { text, one?, where: Set, kind } */
const texts = new Map();
function add(text, where, kind, one) {
  text = text.replace(/\s+/g, " ").trim();
  if (!/\p{L}{2,}/u.test(text)) return;
  const e = texts.get(text) ?? { text, where: new Set(), kinds: new Set() };
  e.where.add(where);
  e.kinds.add(kind);
  if (one) e.one = one;
  texts.set(text, e);
}

function walk(dir, test) {
  const found = [];
  (function go(d) {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) go(p);
      else if (test(p)) found.push(p);
    }
  })(dir);
  return found.sort();
}

// ---- the page ----
const BUTTONS = new Set(["Press", "Primary", "Quiet", "TextButton", "button", "Choice"]);
for (const file of walk(path.join(ui, "src"), (p) => /\.tsx?$/.test(p) && !/\.test\.tsx?$/.test(p) && !/\/i18n\//.test(p))) {
  const rel = path.relative(path.join(ui, "src"), file);
  const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const str = (n) => (n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null);
  const kindOf = (n) => {
    for (let p = n.parent; p; p = p.parent) {
      if (ts.isJsxAttribute(p)) {
        const name = p.name.getText();
        return name === "label" || name.startsWith("aria-") ? "spoken" : name === "placeholder" ? "field" : "text";
      }
      if (ts.isJsxElement(p)) {
        const tag = p.openingElement.tagName.getText();
        if (BUTTONS.has(tag)) return "button";
        if (/^(Title|h1|h2)$/.test(tag)) return "heading";
        return "text";
      }
    }
    return "text";
  };
  (function visit(n) {
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText();
      const [a, b, c] = n.arguments;
      if (callee === "t" || callee === "mark") {
        const s = str(a);
        if (s !== null) add(s, rel, kindOf(n));
      } else if (callee === "tn") {
        const one = str(b);
        const other = str(c);
        if (one !== null && other !== null) add(other, rel, kindOf(n), one);
      }
    }
    ts.forEachChild(n, visit);
  })(sf);
}

// ---- the setup catalog ----
const catalog = JSON.parse(fs.readFileSync(path.join(ui, "src/setup/catalog.json"), "utf8"));
for (const g of Object.values(catalog.groups)) {
  add(g.label, "setup/catalog.json", "heading");
  add(g.about, "setup/catalog.json", "text");
}
for (const q of catalog.questions) {
  add(q.title, "setup/catalog.json", "heading");
  add(q.help, "setup/catalog.json", "text");
  for (const k of ["keep", "off"]) if (q[k]) add(q[k], "setup/catalog.json", "button");
}
for (const p of Object.values(catalog.packages)) add(p.label, "setup/catalog.json", "text");

// ---- messages from outside the page ----
const sentence = (s) => /^[A-Z]/.test(s) && /\s/.test(s) && /\p{L}{3,}/u.test(s);
// Words for developers, never shown to anyone using the app.
const NOT_SHOWN = /(^\w+\(|^Bearer |^Content-Type|^Orbit\/\d|^Orbit needs "|^A tap needs|^Not with this method|^Unknown key|^Orbit has no "|^The message has no op|^No haptic called|^No pointer action called|^The direction is "|^That is not a 32-character key|^Nothing to push|^The record must be an object|tool\/sync_|^Unknown op|^Unknown action|^Not a move|^The request was not a JSON object|^The page is missing from this build|^The level must be a number|plan\.txt|Orbit cannot write to)/;

// Flutter: '...' strings in lib/ (adjacent ones joined, as Dart joins them), with $name as {name}. A string with a
// ${...} in it is left out: its words cannot be matched back when it arrives.
for (const file of walk(path.join(repo, "phone/app/lib"), (p) => p.endsWith(".dart"))) {
  const rel = "app/" + path.relative(path.join(repo, "phone/app"), file);
  const code = fs
    .readFileSync(file, "utf8")
    .split("\n")
    .map((l) => (/^\s*\/\/|debugPrint/.test(l) ? "" : l))
    .join("\n");
  const re = /(?<![r\w])'((?:[^'\\\n]|\\.)*)'((?:\s*(?<![r\w])'(?:[^'\\\n]|\\.)*')*)/g;
  for (const m of code.matchAll(re)) {
    let s = m[1] + [...m[2].matchAll(/'((?:[^'\\\n]|\\.)*)'/g)].map((x) => x[1]).join("");
    s = s.replace(/\\'/g, "'").replace(/\\\$/g, "$").replace(/\\n/g, " ");
    if (s.includes("${") || !sentence(s) || NOT_SHOWN.test(s)) continue;
    // The TVs of other makes (tv/brands): only whole sentences are words for the person; the rest are brand and app
    // names, the TVs' own protocol and what their shells print.
    if (rel.includes("/tv/brands/") && !/[.!?]$/.test(s.trim())) continue;
    add(s.replace(/\$(\w+)/g, "{$1}"), rel, "message");
  }
}

// The TV's door: "..." strings in PhonePortal and OrbitCloud that are its answers to the phone.
for (const name of ["PhonePortal.java", "OrbitCloud.java"]) {
  const file = path.join(repo, "launcher/app/src/main/java/com/gathin/tvhome", name);
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (/^\s*(\/\/|\*)|Log\.\w\(/.test(line)) continue;
    for (const m of line.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
      const s = m[1];
      if (sentence(s) && !NOT_SHOWN.test(s) && /[.!?]$/.test(s.trim())) add(s, `tv/${name}`, "message");
    }
  }
}
// Its one sentence put together from two: a wrong pairing code and the tries left.
add("That is not the code on the TV. One try left.", "tv/PhonePortal.java", "message");
add("That is not the code on the TV. {tries} tries left.", "tv/PhonePortal.java", "message");

// The setup scripts' failures, as the Installing, Undo and Switch screens show them.
for (const name of ["orbit-setup.sh", "orbit-undo.sh"]) {
  const file = path.join(repo, "setup/tv", name);
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    for (const m of line.matchAll(/(?:step \w+ fail|stop_fail|say done fail) "([^"]+)"/g)) {
      const s = m[1].replace(/\$\{?(\w+)\}?/g, "{$1}");
      if (!NOT_SHOWN.test(s)) add(s, `setup/${name}`, "message");
    }
  }
}

// The demo's pretend TV and its pretend setup say the same kind of things.
for (const name of ["mock.ts", "mock-setup.ts"]) {
  const text = fs.readFileSync(path.join(ui, "src", name), "utf8");
  for (const m of text.matchAll(/(?:fail|refuse|stop)\((?:id, )?"([^"]+)"/g)) if (sentence(m[1]) && !NOT_SHOWN.test(m[1])) add(m[1], name, "message");
  for (const m of text.matchAll(/"@orbit (?:step \w+ fail|done fail) ([^"$]+)"/g)) add(m[1], name, "message");
  for (const m of text.matchAll(/: "([A-Z][^"]{6,}[.?!])"/g)) if (!NOT_SHOWN.test(m[1])) add(m[1], name, "message");
}

const list = [...texts.values()]
  .map((e) => {
    const kind = e.kinds.has("button") ? "button" : e.kinds.has("heading") ? "heading" : e.kinds.has("spoken") ? "spoken" : e.kinds.has("field") ? "field" : e.kinds.has("message") ? "message" : "text";
    return { text: e.text, ...(e.one ? { one: e.one } : {}), kind, where: [...e.where].sort() };
  })
  .sort((a, b) => a.text.localeCompare(b.text, "en"));

const doc = {
  about:
    "Every English text the Orbit phone app can show, made by tools/i18n/extract.cjs: do not edit by hand. Each language's translations are in phone/ui/public/locales/<code>.json, keyed by these texts. kind: button (keep it short), heading, spoken (read out by screen readers), field (a hint in a text box), message (from Flutter, the TV or its scripts), text. A text with \"one\" is a count: the key is its \"other\" form.",
  texts: list,
};
const json = JSON.stringify(doc, null, 2) + "\n";
if (process.argv.includes("--check")) {
  const now = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
  if (now !== json) {
    console.error("phone/ui/i18n/source.json is out of date: run node tools/i18n/extract.cjs");
    process.exit(1);
  }
  console.log(`source.json is up to date (${list.length} texts)`);
} else {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, json);
  const by = {};
  for (const e of list) by[e.kind] = (by[e.kind] ?? 0) + 1;
  console.log(`wrote ${path.relative(repo, out)}: ${list.length} texts`, by);
}
