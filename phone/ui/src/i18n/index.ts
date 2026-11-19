// The phone app's languages (phone/SPEC.md, "Languages"). English is written in the code itself: t("Looking for your
// TV") shows that text, or its translation from public/locales/<code>.json when the phone, or Settings › Language,
// asks for another language. Only that one file is ever loaded.
//
//   t("Connected to {name}", { name })      a text with values in it
//   tn(n, "{n} app", "{n} apps")            a count: the language's own plural rules pick the form
//   tm(error.message)                       a message from Flutter, the TV or its scripts, translated where it shows
//   rich(t("Open <b>Settings</b>"), { b })  a text with marked-up parts
import { createElement, Fragment, useSyncExternalStore, type ReactNode } from "react";
import { ENGLISH, LANGUAGES, READY, languageFor, type Language } from "./languages";

export { LANGUAGES, READY, languageFor, type Language } from "./languages";

/** A count's forms by the language's plural category ("one", "few", "other"...). */
export type Forms = Partial<Record<Intl.LDMLPluralRule, string>>;
/** English text -> its translation; a count's English "other" form -> its forms. */
export type Catalog = Record<string, string | Forms>;
export type Loader = (code: string) => Promise<Catalog>;
/** "system" follows the phone's language; otherwise one of LANGUAGES' codes. */
export type Choice = string;

type Vars = Record<string, string | number>;

const CHOICE_KEY = "orbit-language";

let choice: Choice = readChoice();
let language: Language = ENGLISH;
let strings: Catalog = {};
let plurals = new Intl.PluralRules("en");
// Western digits everywhere, like the rest of the page (addresses, codes, the volume).
let numbers = new Intl.NumberFormat("en", { numberingSystem: "latn" } as Intl.NumberFormatOptions);
let patterns: Pattern[] | null = null;
let loader: Loader | null = null;
let loading = 0;
let snapshot = { language, choice };
const listeners = new Set<() => void>();

function readChoice(): Choice {
  try {
    return localStorage.getItem(CHOICE_KEY) || "system";
  } catch {
    return "system";
  }
}

/** The text in the language on screen. Unknown texts (and English) stay as they are. */
export function t(text: string, vars?: Vars): string {
  const entry = strings[text];
  const out = typeof entry === "string" && entry ? entry : typeof entry === "object" && entry.other ? entry.other : text;
  return vars ? fill(out, vars) : out;
}

/** A count in the language on screen: {n} is the count, formatted; `other` is the key the translations use. */
export function tn(n: number, one: string, other: string, vars?: Vars): string {
  const entry = strings[other];
  let form: string;
  if (typeof entry === "object") form = entry[plurals.select(n)] || entry.other || other;
  else if (typeof entry === "string" && entry) form = entry;
  else form = n === 1 ? one : other;
  return fill(form, { n, ...vars });
}

/**
 * A message from outside the page (Flutter, the TV, its setup scripts), translated where it is shown. Exact texts come
 * first; then texts with values in them, by the catalog's own patterns ("The TV answered {status}.").
 */
export function tm(message: string | null | undefined): string {
  if (!message) return message ?? "";
  const exact = strings[message];
  if (typeof exact === "string" && exact) return exact;
  for (const p of (patterns ??= compile(strings))) {
    const m = p.re.exec(message);
    if (!m) continue;
    const vars: Vars = {};
    p.names.forEach((name, i) => (vars[name] = m[i + 1]));
    return fill(p.text, vars);
  }
  return message;
}

/**
 * Marks a text kept as data and translated where it is shown, t(group.label), so the translation files still list it.
 * It returns the text unchanged.
 */
export const mark = <T extends string>(text: T): T => text;

/** Items as a list, the language's own way: "A, B, C", or with "and" before the last ("A, B and C"). */
export function list(items: readonly string[], kind: "plain" | "and" = "plain"): string {
  try {
    return new Intl.ListFormat(language.code, kind === "and" ? { type: "conjunction" } : { type: "unit", style: "short" }).format(items);
  } catch {
    return items.join(", ");
  }
}

/** The first sentence of a text, in any script ("。" and "।" end sentences too). */
export function firstSentence(text: string): string {
  try {
    const seg = new Intl.Segmenter(language.code, { granularity: "sentence" });
    for (const s of seg.segment(text)) return s.segment.trim();
  } catch {
    // An old WebView: the first ". " is close enough.
  }
  return text.split(". ")[0];
}

/** The language on screen now (outside React; components use useLanguage). */
export function currentLanguage(): Language {
  return language;
}

/** A number in the language on screen. */
export function num(n: number, options?: Intl.NumberFormatOptions): string {
  return options ? new Intl.NumberFormat(language.code, { numberingSystem: "latn", ...options } as Intl.NumberFormatOptions).format(n) : numbers.format(n);
}

type Part = ReactNode | ((children: ReactNode) => ReactNode);

/**
 * A translated text with marked-up parts: <b>…</b> (any tag name) is given to parts.b, {name} becomes parts.name.
 * Translations move the marks along with the words, so the order can change from language to language.
 */
export function rich(text: string, parts: Record<string, Part>): ReactNode {
  const root: ReactNode[] = [];
  const stack: { tag: string; kids: ReactNode[] }[] = [];
  const top = () => (stack.length ? stack[stack.length - 1].kids : root);
  const re = /<(\w+)>|<\/(\w+)>|\{(\w+)\}/g;
  let last = 0;
  let key = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) top().push(text.slice(last, m.index));
    last = re.lastIndex;
    if (m[1]) stack.push({ tag: m[1], kids: [] });
    else if (m[2]) {
      const open = stack.pop();
      if (!open) continue;
      const make = parts[open.tag];
      const kids = createElement(Fragment, null, ...open.kids);
      top().push(createElement(Fragment, { key: key++ }, typeof make === "function" ? make(kids) : kids));
    } else {
      const value = parts[m[3]];
      top().push(createElement(Fragment, { key: key++ }, typeof value === "function" ? value(null) : typeof value === "number" ? num(value) : (value ?? m[0])));
    }
  }
  if (last < text.length) top().push(text.slice(last));
  // A tag a translation forgot to close keeps its words.
  while (stack.length) top().push(...stack.pop()!.kids);
  return createElement(Fragment, null, ...root);
}

function fill(text: string, vars: Vars): string {
  return text.replace(/\{(\w+)\}/g, (all, name: string) => {
    const v = vars[name];
    return v === undefined ? all : typeof v === "number" ? numbers.format(v) : v;
  });
}

interface Pattern {
  re: RegExp;
  names: string[];
  text: string;
}

function compile(catalog: Catalog): Pattern[] {
  const out: (Pattern & { weight: number })[] = [];
  for (const [key, value] of Object.entries(catalog)) {
    const text = typeof value === "string" ? value : value.other;
    if (!text || !key.includes("{")) continue;
    const names: string[] = [];
    const source = key
      .split(/(\{\w+\})/)
      .map((piece) => {
        const m = /^\{(\w+)\}$/.exec(piece);
        if (!m) return piece.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        names.push(m[1]);
        return "(.+?)";
      })
      .join("");
    // Most fixed words first, so "The TV said: {why}" does not swallow a longer, closer pattern.
    out.push({ re: new RegExp(`^${source}$`, "s"), names, text, weight: key.replace(/\{\w+\}/g, "").length });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

/** The language the phone itself is in, if Orbit speaks it (else English). */
export function systemLanguage(tags: readonly string[] = typeof navigator !== "undefined" ? navigator.languages ?? [navigator.language] : []): Language {
  for (const tag of tags) {
    const found = tag && languageFor(tag);
    if (found && READY.includes(found)) return found;
  }
  return ENGLISH;
}

function resolve(c: Choice): Language {
  return c === "system" ? systemLanguage() : (READY.find((l) => l.code === c) ?? systemLanguage());
}

/** Puts a language on screen: its texts (fetched by the loader), its plural rules, its direction. */
async function show(next: Language): Promise<void> {
  const ticket = ++loading;
  let catalog: Catalog = {};
  if (next.code !== "en" && loader) {
    try {
      catalog = await loader(next.code);
    } catch (e) {
      console.warn(`orbit: no ${next.code} texts, English instead`, e);
      next = ENGLISH;
    }
  }
  if (ticket !== loading) return;
  use(next, catalog);
}

function use(next: Language, catalog: Catalog) {
  language = next;
  strings = catalog && typeof catalog === "object" ? catalog : {};
  patterns = null;
  plurals = new Intl.PluralRules(next.code);
  numbers = new Intl.NumberFormat(next.code, { numberingSystem: "latn" } as Intl.NumberFormatOptions);
  if (typeof document !== "undefined") {
    document.documentElement.lang = next.code;
    document.documentElement.dir = next.rtl ? "rtl" : "ltr";
  }
  snapshot = { language, choice };
  listeners.forEach((l) => l());
}

/** Before the first render: the chosen language's texts, so nothing shows in English first. */
export function startLanguage(load: Loader): Promise<void> {
  loader = load;
  return show(resolve(choice));
}

/** Settings › Language: "system", or a language's code. Kept on the phone. */
export function chooseLanguage(next: Choice): Promise<void> {
  choice = next;
  try {
    if (next === "system") localStorage.removeItem(CHOICE_KEY);
    else localStorage.setItem(CHOICE_KEY, next);
  } catch {
    // A page without storage still changes language now.
  }
  snapshot = { language, choice };
  listeners.forEach((l) => l());
  return show(resolve(next));
}

/** For tests: a catalog without a loader. */
export function useCatalogForTest(code: string, catalog: Catalog) {
  use(LANGUAGES.find((l) => l.code === code) ?? ENGLISH, catalog);
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** The language on screen and the choice behind it; a component that calls this shows the new texts when it changes. */
export function useLanguage(): { language: Language; choice: Choice } {
  return useSyncExternalStore(subscribe, () => snapshot);
}
