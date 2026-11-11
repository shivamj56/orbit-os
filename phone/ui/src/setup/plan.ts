// The plan: which questions a TV is asked, and which of its apps go off. Worked out from the catalog alone, on what the
// TV itself said is on it: a package the catalog does not list is never touched, nor one that is part of the system
// (coreRe, unless coreOk) or on neverOff.
import type { Answer, Catalog, CatalogQuestion } from "./catalog";

/** Orbit Home, the home screen the setup installs: never the TV's "stock" launcher (phone/SPEC.md, "The apps' ids"). */
export const ORBIT_HOME = "dev.shiv.orbit.home";

/** Orbit Home under its id and under the one it had before 11 Nov: a TV may still run the earlier one. */
export const ORBIT_HOMES: ReadonlySet<string> = new Set([ORBIT_HOME, "com.gathin.tvhome"]);

/** The packages in `pm list packages` output ("package:com.example.app" lines; anything else is ignored). */
export function parsePackages(out: string): string[] {
  const found = new Set<string>();
  for (const line of out.split(/\r?\n/)) {
    const m = /^\s*package:(?:\S*=)?([A-Za-z][\w.]*)\s*$/.exec(line);
    if (m) found.add(m[1]);
  }
  return [...found];
}

/**
 * The home screen's package from `cmd package resolve-activity --brief … HOME`: its last line is
 * "com.example.launcher/.HomeActivity". Null when Android names no launcher, or Orbit Home already is it.
 */
export function stockLauncher(out: string): string | null {
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const m = /^([A-Za-z][\w.]*)\/\S+$/.exec(lines[lines.length - 1] ?? "");
  if (!m || ORBIT_HOMES.has(m[1]) || m[1] === "android") return null;
  return m[1];
}

interface Rules {
  core: RegExp;
  ok: RegExp | null;
  never: Set<string>;
}
const compiled = new WeakMap<Catalog, Rules>();
function rules(catalog: Catalog): Rules {
  let r = compiled.get(catalog);
  if (!r) {
    r = { core: new RegExp(catalog.coreRe), ok: catalog.coreOk ? new RegExp(catalog.coreOk) : null, never: new Set(catalog.neverOff) };
    compiled.set(catalog, r);
  }
  return r;
}

/** A part of the system: never switched off, whatever a list says. */
export function isCore(catalog: Catalog, pkg: string): boolean {
  const r = rules(catalog);
  return r.core.test(pkg) && !(r.ok?.test(pkg) ?? false);
}

/** A package Orbit may offer to switch off: in the catalog, in a group it knows, not core and not on neverOff. */
export function isSwitchable(catalog: Catalog, pkg: string): boolean {
  const entry = catalog.packages[pkg];
  return !!entry && !!catalog.groups[entry.group] && !isCore(catalog, pkg) && !rules(catalog).never.has(pkg);
}

/** The questions worth asking on this TV: those whose group has an app on it, switched on, that Orbit may switch off. */
export function visibleQuestions(catalog: Catalog, enabled: Iterable<string>): CatalogQuestion[] {
  const groups = new Set<string>();
  for (const pkg of enabled) if (isSwitchable(catalog, pkg)) groups.add(catalog.packages[pkg].group);
  return catalog.questions.filter((q) => groups.has(q.group));
}

/** A question's two answers in the order shown: the recommended one first, else "keep" first. */
export function choicesOf(q: CatalogQuestion): [Answer, Answer] {
  return q.recommend === "off" ? ["off", "keep"] : ["keep", "off"];
}

/**
 * Why a group is on the plan: `default` (its group goes off unless a person keeps it), `answer` (an answer switched
 * it off), `choose` (an answer said "let me look first": nothing is chosen until a person picks), `required` (the stock
 * home screen, which Orbit Home replaces).
 */
export type GroupWhy = "default" | "answer" | "choose" | "required";

/** Locked items cannot be kept by a person: `required` goes off with Orbit Home, `together` follows its partner. */
export type ItemLock = "required" | "together" | null;

export interface PlanItem {
  pkg: string;
  label: string;
  group: string;
  off: boolean;
  lock: ItemLock;
}

export interface PlanGroup {
  id: string;
  label: string;
  about: string;
  why: GroupWhy;
  question: CatalogQuestion | null;
  items: PlanItem[];
  /** How many of its items go off. */
  off: number;
}

export interface Plan {
  groups: PlanGroup[];
  /** disable.txt, one package a line: catalog order, with each `together` pair in its own order. */
  disable: string[];
  /** Groups with apps on this TV that all stay on, for "Stays on". */
  kept: { id: string; label: string }[];
}

export interface PlanInput {
  catalog: Catalog;
  /** What `pm list packages -e` said. */
  enabled: Iterable<string>;
  /** ro.product.model, for the catalog's `together` pairs. */
  model?: string | null;
  answers?: Record<string, Answer>;
  /** What a person changed on the plan, package by package. */
  overrides?: Record<string, Answer>;
  /** Orbit Home is installed (the stock home screen then goes). */
  home?: boolean;
}

type Why = GroupWhy | "kept";

function groupWhy(catalog: Catalog, id: string, answers: Record<string, Answer>, home: boolean): Why {
  const group = catalog.groups[id];
  // Without Orbit Home the TV keeps its own home screen (the script skips it too).
  if (group.requiredWithHome) return home ? "required" : "kept";
  const q = catalog.questions.find((x) => x.group === id);
  const a = q ? answers[q.id] : undefined;
  if (a === "off") return group.default === "off" ? "default" : "answer";
  if (a === "keep") return group.default === "off" ? "choose" : "kept";
  return group.default === "off" ? "default" : "kept";
}

/** The together pairs of a model, as the catalog lists them. */
export function pairsOf(catalog: Catalog, model?: string | null): string[][] {
  return (model && catalog.models[model]?.together) || [];
}

export function buildPlan(input: PlanInput): Plan {
  const { catalog } = input;
  const enabled = new Set(input.enabled);
  const answers = input.answers ?? {};
  const overrides = input.overrides ?? {};
  const home = input.home ?? true;
  const why = new Map<string, Why>();
  const whyOf = (group: string) => {
    if (!why.has(group)) why.set(group, groupWhy(catalog, group, answers, home));
    return why.get(group)!;
  };

  // Every package on the TV that Orbit may switch off, in catalog order, with what its group and the answers say.
  const items = new Map<string, PlanItem & { listed: boolean }>();
  for (const [pkg, entry] of Object.entries(catalog.packages)) {
    if (!enabled.has(pkg) || !isSwitchable(catalog, pkg)) continue;
    const w = whyOf(entry.group);
    const item = {
      pkg,
      label: entry.label,
      group: entry.group,
      off: w === "default" || w === "answer" || w === "required",
      lock: (w === "required" ? "required" : null) as ItemLock,
      listed: w !== "kept",
    };
    if (item.listed && !item.lock && overrides[pkg]) item.off = overrides[pkg] === "off";
    items.set(pkg, item);
  }

  // Together pairs go off both or neither. The stock home screen's pair goes with it; a partner Orbit may not switch
  // off (or one in a group the answers kept) keeps the other on too; two that disagree both stay on.
  const pairs = pairsOf(catalog, input.model);
  for (const pair of pairs) {
    const on = pair.filter((p) => enabled.has(p));
    if (on.length < 2) continue;
    const members = on.map((p) => items.get(p));
    if (members.some((m) => !m)) {
      for (const m of members) if (m) Object.assign(m, { off: false, lock: "together" });
      continue;
    }
    const all = members as (PlanItem & { listed: boolean })[];
    if (all.some((m) => m.lock === "required")) {
      for (const m of all) Object.assign(m, { off: true, lock: "required", listed: true });
    } else if (all.some((m) => !m.listed)) {
      for (const m of all) Object.assign(m, { off: false, lock: m.listed ? "together" : null });
    } else if (new Set(all.map((m) => m.off)).size > 1) {
      for (const m of all) m.off = false;
    }
  }

  const disable = [...items.values()].filter((i) => i.off).map((i) => i.pkg);
  for (const pair of pairs) {
    const at = pair.map((p) => disable.indexOf(p));
    if (at.some((i) => i < 0)) continue;
    const spots = [...at].sort((a, b) => a - b);
    pair.forEach((p, k) => (disable[spots[k]] = p));
  }

  const groups: PlanGroup[] = [];
  const kept: { id: string; label: string }[] = [];
  for (const [id, group] of Object.entries(catalog.groups)) {
    const mine = [...items.values()].filter((i) => i.group === id);
    if (!mine.length) continue;
    const listed = mine.filter((i) => i.listed);
    if (!listed.length) {
      kept.push({ id, label: group.label });
      continue;
    }
    const w = whyOf(id);
    groups.push({
      id,
      label: group.label,
      about: group.about,
      // A group the answers kept shows only for a partner that its pair forced off.
      why: w === "kept" ? "required" : w,
      question: catalog.questions.find((q) => q.group === id) ?? null,
      items: listed.map(({ listed: _listed, ...item }) => item),
      off: listed.filter((i) => i.off).length,
    });
  }
  return { groups, disable, kept };
}

/**
 * A person switching one package: the new overrides, with its together partners following it (both or neither).
 * Locked packages do not move.
 */
export function overridePackage(
  plan: Plan,
  overrides: Record<string, Answer>,
  pairs: string[][],
  pkg: string,
  off: boolean,
): Record<string, Answer> {
  const item = plan.groups.flatMap((g) => g.items).find((i) => i.pkg === pkg);
  if (!item || item.lock) return overrides;
  const next = { ...overrides, [pkg]: (off ? "off" : "keep") as Answer };
  for (const pair of pairs) if (pair.includes(pkg)) for (const p of pair) next[p] = off ? "off" : "keep";
  return next;
}

/** Undo record lines as the phone keeps them: once each, first seen first, and nothing but the line itself. */
export function mergeUndo(...lists: (readonly string[] | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const raw of list ?? []) {
      const line = normalUndoLine(raw);
      if (line === null || seen.has(line)) continue;
      seen.add(line);
      out.push(line);
    }
  }
  return out;
}

/**
 * One undo line, checked. orbit-undo.sh reads "a11y <list>" with the space even when the list was empty, so a bare
 * "a11y" (a line that lost its last space on the way) gets it back. Blank lines are dropped.
 */
export function normalUndoLine(raw: string): string | null {
  const line = raw.replace(/\r/g, "").replace(/^\s+/, "");
  if (!line.trim()) return null;
  if (line === "a11y" || line === "a11y_on") return `${line} `;
  return line;
}

/** The packages setup really switched off, from its undo record ("enable <package>" lines). */
export function disabledByRecord(undo: readonly string[]): string[] {
  return undo.map((l) => /^enable ([A-Za-z][\w.]*)\s*$/.exec(l)?.[1]).filter((p): p is string => !!p);
}
