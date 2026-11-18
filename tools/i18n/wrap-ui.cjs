#!/usr/bin/env node
// One-off helper for phone/ui: wraps the English the screens show in t() (src/i18n), so it can be translated.
// It changes only what is plainly on-screen text and lists everything it leaves for a person to do by hand:
// sentences with values or marked-up words inside them, and strings that are also used as values.
//
//   node tools/i18n/wrap-ui.cjs phone/ui/src [--write] [file ...]
//
// Rules (see phone/SPEC.md, "Languages"):
//   - JSX text (unless its element mixes words with values or with marked-up words: listed for hand work)
//   - string attributes that people read or hear: label, aria-label, title, note, placeholder, alt, aside, word
//   - string literals inside JSX expressions that pick a text: {busy ? "Saving" : "Save"}, {error || "Try again"}
//   - inside functions: label/title/... properties, new Error("..."), returned sentences
// Never: strings compared against (=== "your TV"), switch cases, keys, class names, protocol lines.
const ts = require(require.resolve("typescript", { paths: [process.cwd(), __dirname] }));
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const write = args.includes("--write");
const [srcArg, ...only] = args.filter((a) => !a.startsWith("--"));
const src = path.resolve(srcArg);

const SKIP_FILES = /(^|\/)(mock-setup\.ts|mock\.ts|demo\.test\.ts|.*\.test\.ts|.*shader\.ts|quat\.ts|i18n\/.*|bridge\.ts|lines\.ts)$/;
const TEXT_ATTRS = new Set(["label", "aria-label", "title", "note", "placeholder", "alt", "aside", "word", "aria-valuetext"]);
const TEXT_PROPS = new Set(["label", "title", "note", "lead", "button", "after", "about", "hint", "body", "text", "doing", "done", "fail", "skip", "question", "heading"]);
const TEXT_CALLS = new Set(["Error", "BridgeError", "setOverlay", "onDone", "setError"]);

const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(f)) files.push(p);
  }
})(src);

const isClassy = (s) => /(^|\s)(-?[a-z]+-\[|[a-z0-9]+:[a-z-]|px-|py-|mt-|mb-|ml-|mr-|mx-|my-|text-|bg-|rounded|flex|grid|h-|w-|gap-|items-|justify-|border|shadow|font-|leading-|tracking-|opacity-|absolute|relative|inset-|z-|overflow|transition|duration-|ease-|scale-|shrink|grow|hidden|block|inline)/.test(s);
const BRANDS = new Set(["Orbit", "Orbit OS", "Orbit Home", "Orbit Live TV", "Orbit Setup", "Google", "Google Drive", "Google TV", "Android TV", "Wi-Fi", "OK"]);
const hasWords = (s) => /\p{L}{2,}/u.test(s);
const sentence = (s) => hasWords(s) && !isClassy(s) && (/\s/.test(s.trim()) || /^\p{Lu}/u.test(s) || /[.!?…]$/.test(s));

// Pass 1: every string that is used as a value somewhere (compared, switched on, a key): never wrapped.
const values = new Set();
const sources = new Map();
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  sources.set(file, sf);
  if (/(^|\/)(mock[^/]*\.ts|demo\/[^/]*|.*\.test\.ts)$/.test(path.relative(src, file))) continue; // the pretend TV's own words
  (function visit(n) {
    if (ts.isBinaryExpression(n) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken].includes(n.operatorToken.kind)) {
      for (const side of [n.left, n.right]) if (ts.isStringLiteral(side)) values.add(side.text);
    }
    if (ts.isCaseClause(n) && ts.isStringLiteral(n.expression)) values.add(n.expression.text);
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && ["includes", "has", "startsWith", "endsWith", "indexOf"].includes(n.expression.name.text)) {
      for (const a of n.arguments) if (ts.isStringLiteral(a)) values.add(a.text);
    }
    ts.forEachChild(n, visit);
  })(sf);
}

const report = { manual: [], values: [], templates: [] };
let changed = 0;
let wraps = 0;

for (const file of files) {
  const rel = path.relative(src, file);
  if (SKIP_FILES.test(rel) || (only.length && !only.some((o) => rel.includes(o)))) continue;
  const sf = sources.get(file);
  const text = sf.getFullText();
  const edits = [];
  const where = (n) => `${rel}:${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`;
  const covered = (n) => edits.some((e) => n.getStart() >= e.start && n.end <= e.end);
  const literal = (s) => JSON.stringify(s);

  /** t("...") for a string literal, or t("... {x} ...", { x }) for a template whose values are plain names. */
  function wrapExpr(node, shown = false) {
    if (covered(node)) return true;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const s = node.text;
      if (!hasWords(s) || isClassy(s) || BRANDS.has(s.trim())) return false;
      if (values.has(s) && !shown) {
        report.values.push(`${where(node)}  ${literal(s)}`);
        return false;
      }
      edits.push({ start: node.getStart(), end: node.end, text: `t(${literal(s)})` });
      wraps++;
      return true;
    }
    if (ts.isTemplateExpression(node)) {
      let key = node.head.text;
      const vars = [];
      for (const span of node.templateSpans) {
        const e = span.expression;
        const name = ts.isIdentifier(e) ? e.text : ts.isPropertyAccessExpression(e) && !e.questionDotToken ? e.name.text : null;
        if (!name) {
          report.templates.push(`${where(node)}  ${node.getText().slice(0, 140)}`);
          return false;
        }
        if (!vars.some((v) => v.name === name)) vars.push({ name, expr: e.getText() });
        key += `{${name}}` + span.literal.text;
      }
      if (!hasWords(key.replace(/\{\w+\}/g, "")) || isClassy(key)) return false;
      const obj = vars.map((v) => (v.expr === v.name ? v.name : `${v.name}: ${v.expr}`)).join(", ");
      edits.push({ start: node.getStart(), end: node.end, text: `t(${literal(key)}, { ${obj} })` });
      wraps++;
      return true;
    }
    return false;
  }

  /** The string choices inside an expression that picks a text: a ? "x" : "y", e || "z", (…). */
  function wrapChoices(node, shown = false) {
    if (ts.isParenthesizedExpression(node)) return wrapChoices(node.expression, shown);
    if (ts.isConditionalExpression(node)) {
      wrapChoices(node.whenTrue, shown);
      wrapChoices(node.whenFalse, shown);
      return;
    }
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.AmpersandAmpersandToken].includes(node.operatorToken.kind)) {
      if (node.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) wrapChoices(node.left, shown);
      wrapChoices(node.right, shown);
      return;
    }
    wrapExpr(node, shown);
  }

  /** JSX's own whitespace rule: what a JSX text renders as. */
  function jsxValue(raw) {
    const lines = raw.split(/\r\n|\n|\r/);
    let last = -1;
    lines.forEach((l, i) => /[^ \t]/.test(l) && (last = i));
    let out = "";
    lines.forEach((line, i) => {
      let l = line.replace(/\t/g, " ");
      if (i !== 0) l = l.replace(/^[ ]+/, "");
      if (i !== lines.length - 1) l = l.replace(/[ ]+$/, "");
      if (l) out += i !== last ? l + " " : l;
    });
    return out;
  }

  const valueLike = (k) => ts.isJsxExpression(k) && k.expression && !ts.isStringLiteral(k.expression) && !containsJsx(k.expression);
  function containsJsx(n) {
    let found = false;
    (function v(x) {
      if (found) return;
      if (ts.isJsxElement(x) || ts.isJsxSelfClosingElement(x) || ts.isJsxFragment(x)) found = true;
      else ts.forEachChild(x, v);
    })(n);
    return found;
  }
  const wordy = (k) => {
    if (ts.isJsxText(k)) return hasWords(k.getText());
    let w = false;
    (function v(x) {
      if (w) return;
      if (ts.isJsxText(x) && hasWords(x.getText())) w = true;
      else if (ts.isJsxExpression(x) && x.expression && !containsJsx(x.expression)) w = true;
      else ts.forEachChild(x, v);
    })(k);
    return w;
  };

  function visit(n) {
    if (covered(n)) return; // already wrapped, or left for hand work
    // Elements: plain words get t(); words mixed with values or marked-up words are listed for hand work.
    if (ts.isJsxElement(n) || ts.isJsxFragment(n)) {
      const kids = n.children;
      const texts = kids.filter((k) => ts.isJsxText(k) && hasWords(k.getText()));
      if (texts.length) {
        const mixed = kids.some(valueLike) || kids.some((k) => (ts.isJsxElement(k) || ts.isJsxFragment(k)) && wordy(k));
        if (mixed) {
          report.manual.push(`${where(n)}  ${kids.map((k) => k.getText()).join("").replace(/\s+/g, " ").trim().slice(0, 160)}`);
          edits.push({ start: n.getStart(), end: n.end, text: null }); // hands off this element
        } else {
          for (const k of texts) {
            const value = jsxValue(k.getText());
            const core = value.trim().replace(/\s+/g, " ");
            if (!core || BRANDS.has(core)) continue;
            const lead = /^\s/.test(value) ? `{" "}` : "";
            const trail = /\s$/.test(value) ? `{" "}` : "";
            // Keep the text's own line breaks around it, so the file reads the same.
            const raw = k.getText();
            const before = raw.match(/^\s*/)[0];
            const after = raw.match(/\s*$/)[0];
            const keepBefore = before.includes("\n") ? before : "";
            const keepAfter = after.includes("\n") ? after : "";
            edits.push({ start: k.getStart(), end: k.end, text: `${keepBefore}${keepBefore ? "" : lead}{t(${literal(core)})}${keepAfter ? "" : trail}${keepAfter}` });
            wraps++;
          }
        }
      }
    }
    if (ts.isJsxAttribute(n) && n.initializer) {
      const name = n.name.getText();
      if (TEXT_ATTRS.has(name) && !covered(n)) {
        if (ts.isStringLiteral(n.initializer)) {
          const s = n.initializer.text;
          if (hasWords(s) && !BRANDS.has(s.trim())) {
            edits.push({ start: n.initializer.getStart(), end: n.initializer.end, text: `{t(${literal(s)})}` });
            wraps++;
          }
        } else if (ts.isJsxExpression(n.initializer) && n.initializer.expression) wrapChoices(n.initializer.expression, true);
      }
    }
    if (ts.isJsxExpression(n) && n.expression && !ts.isJsxAttribute(n.parent) && !covered(n)) {
      wrapChoices(n.expression, true);
    }
    const inFunction = (() => {
      for (let p = n.parent; p; p = p.parent) if (ts.isFunctionLike(p)) return true;
      return false;
    })();
    if (inFunction && !covered(n)) {
      if (ts.isPropertyAssignment(n) && TEXT_PROPS.has(n.name.getText().replace(/["']/g, ""))) {
        const v = n.initializer;
        if ((ts.isStringLiteral(v) && sentence(v.text)) || ts.isTemplateExpression(v) || ts.isConditionalExpression(v) || ts.isBinaryExpression(v)) wrapChoices(v);
      }
      if ((ts.isNewExpression(n) || ts.isCallExpression(n)) && n.arguments?.length) {
        const callee = n.expression.getText().split(".").pop();
        if (TEXT_CALLS.has(callee)) wrapChoices(n.arguments[0]);
      }
      if (ts.isReturnStatement(n) && n.expression) {
        const e = n.expression;
        const pick = (x) => {
          if (ts.isParenthesizedExpression(x)) return pick(x.expression);
          if (ts.isConditionalExpression(x)) return pick(x.whenTrue), pick(x.whenFalse);
          if ((ts.isStringLiteral(x) && sentence(x.text)) || (ts.isTemplateExpression(x) && sentence(x.head.text + x.templateSpans.map((s) => s.literal.text).join("")))) wrapExpr(x);
        };
        pick(e);
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(sf);

  const real = edits.filter((e) => e.text !== null).sort((a, b) => b.start - a.start);
  if (!real.length) continue;
  let out = text;
  for (const e of real) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  // import { t } from ".../i18n";
  if (!/from "(\.\.?\/)+i18n"|from "\.\/i18n"/.test(out)) {
    const depth = rel.split("/").length - 1;
    const spec = depth ? "../".repeat(depth) + "i18n" : "./i18n";
    const imports = [...out.matchAll(/^import .*?;$/gms)];
    const at = imports.length ? imports[imports.length - 1].index + imports[imports.length - 1][0].length : 0;
    out = out.slice(0, at) + `${at ? "\n" : ""}import { t } from "${spec}";${at ? "" : "\n"}` + out.slice(at);
  }
  changed++;
  if (write) fs.writeFileSync(file, out);
}

console.log(`${write ? "wrote" : "would change"} ${changed} files, ${wraps} texts wrapped`);
console.log(`\n== by hand: elements that mix words with values or marked-up words (${report.manual.length})`);
report.manual.forEach((l) => console.log(l));
console.log(`\n== by hand: templates with more than names in them (${report.templates.length})`);
report.templates.forEach((l) => console.log(l));
console.log(`\n== left alone: also used as values (${report.values.length})`);
report.values.forEach((l) => console.log(l));
