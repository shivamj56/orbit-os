// What the TV's setup scripts say (phone/SPEC.md, "The script"): lines starting "@orbit" are for the page, the rest is
// log, kept but never shown. Flutter adds "@orbit-exit <code>" when the command ends.
//
//   @orbit step <id> start|ok|skip|fail [text]
//   @orbit progress <0-100>
//   @orbit undo <line>
//   @orbit done ok|fail [text]

import { t, tm, tn } from "../i18n";

export type StepState = "start" | "ok" | "skip" | "fail";

export type OrbitLine =
  | { kind: "step"; id: string; state: StepState; text: string }
  | { kind: "progress"; value: number }
  | { kind: "undo"; line: string }
  | { kind: "done"; ok: boolean; text: string }
  | { kind: "exit"; code: number }
  | { kind: "log"; line: string };

export function parseLine(raw: string): OrbitLine {
  // The end of an undo line can matter ("a11y " is an empty list), so only the shell's \r comes off it.
  const line = raw.replace(/\r/g, "").replace(/^\s+/, "");
  let m = /^@orbit-exit\s+(-?\d+)\s*$/.exec(line);
  if (m) return { kind: "exit", code: Number(m[1]) };
  if (line.startsWith("@orbit undo ")) {
    const rest = line.slice("@orbit undo ".length);
    return rest.trim() ? { kind: "undo", line: rest } : { kind: "log", line };
  }
  m = /^@orbit\s+step\s+(\S+)\s+(start|ok|skip|fail)(?:\s+(.*))?$/.exec(line);
  if (m) return { kind: "step", id: m[1], state: m[2] as StepState, text: (m[3] ?? "").trim() };
  m = /^@orbit\s+progress\s+(\d+(?:\.\d+)?)\s*%?\s*$/.exec(line);
  if (m) return { kind: "progress", value: Math.max(0, Math.min(100, Number(m[1]))) };
  m = /^@orbit\s+done\s+(ok|fail)(?:\s+(.*))?$/.exec(line);
  if (m) return { kind: "done", ok: m[1] === "ok", text: (m[2] ?? "").trim() };
  return { kind: "log", line };
}

export interface StepNow {
  state: StepState;
  text: string;
}

/** One run of a script, as far as its lines have come. */
export interface Run {
  steps: Record<string, StepNow>;
  /** Step ids in the order they first spoke. */
  order: string[];
  progress: number;
  undo: string[];
  done: { ok: boolean; text: string } | null;
  exit: number | null;
  log: string[];
}

export const freshRun = (): Run => ({ steps: {}, order: [], progress: 0, undo: [], done: null, exit: null, log: [] });

const LOG_KEEP = 300;

export function applyLine(run: Run, line: OrbitLine): Run {
  switch (line.kind) {
    case "step":
      return {
        ...run,
        steps: { ...run.steps, [line.id]: { state: line.state, text: line.text } },
        order: run.order.includes(line.id) ? run.order : [...run.order, line.id],
      };
    case "progress":
      return { ...run, progress: line.value };
    case "undo":
      return { ...run, undo: [...run.undo, line.line] };
    case "done":
      return { ...run, done: { ok: line.ok, text: line.text } };
    case "exit":
      return { ...run, exit: line.code };
    default:
      return { ...run, log: [...run.log.slice(-(LOG_KEEP - 1)), line.line] };
  }
}

/** Several output lines at once (a chunk with newlines in it is split). */
export function applyOutput(run: Run, out: string): Run {
  return out.split("\n").filter((l) => l.replace(/\r/g, "").length > 0).reduce((r, l) => applyLine(r, parseLine(l)), run);
}

/** The first step that failed, if any. */
export function failedStep(run: Run): { id: string; text: string } | null {
  const id = run.order.find((s) => run.steps[s].state === "fail");
  return id ? { id, text: run.steps[id].text } : null;
}

// ---- the rows the Installing screen lists ----

export type RowState = "pending" | "active" | "done" | "skipped" | "fail";

export interface Row {
  key: string;
  text: string;
  state: RowState;
  /** The script's own words for a step that failed (shown small, under the plain ones). */
  detail?: string;
}

interface StepWords {
  doing: string;
  done: string;
  fail: string;
  skip?: string;
}

interface RowSpec {
  key: string;
  ids: string[];
  /** The step whose words name the row while it waits and once it is done. */
  main: string;
}

function installWords(disableCount: number, run: Run): Record<string, StepWords> {
  // "2 could not be switched off" comes with a disable step that still went on.
  const missed = Number(/^(\d+) could not/.exec(run.steps.disable?.text ?? "")?.[1] ?? 0);
  return {
    check: { doing: t("Checking the TV"), done: t("Checked the TV"), fail: t("The TV did not pass the check") },
    record: { doing: t("Saving how to undo all of it"), done: t("Saved how to undo all of it"), fail: t("Could not save how to undo it") },
    disable: {
      doing: tn(disableCount, "Switching off {n} app", "Switching off {n} apps"),
      done:
        missed > 0
          ? tn(disableCount, "Switched off {done} of {n} app", "Switched off {done} of {n} apps", { done: disableCount - missed })
          : tn(disableCount, "Switched off {n} app", "Switched off {n} apps"),
      skip: t("Nothing to switch off"),
      fail: t("Could not switch the apps off"),
    },
    home: { doing: t("Installing Orbit Home"), done: t("Orbit Home is the home screen"), skip: t("Kept the TV's own home screen"), fail: t("Orbit Home did not install") },
    helper: { doing: t("Turning on the remote helper"), done: t("Turned on the remote helper"), fail: t("The remote helper did not turn on") },
    grants: { doing: t("Giving the helper what it needs"), done: t("Gave the helper what it needs"), fail: t("The helper did not get what it needs") },
    live: { doing: t("Installing Orbit Live TV"), done: t("Installed Orbit Live TV"), skip: t("Orbit Live TV is not part of the plan"), fail: t("Orbit Live TV did not install") },
    name: { doing: t("Adding your name"), done: t("Added your name"), fail: t("Your name did not reach the TV") },
    pair: { doing: t("Pairing this phone"), done: t("Paired this phone"), fail: t("This phone did not pair") },
  };
}

const INSTALL_ROWS: RowSpec[] = [
  { key: "record", ids: ["check", "record"], main: "record" },
  { key: "disable", ids: ["disable"], main: "disable" },
  { key: "home", ids: ["home"], main: "home" },
  { key: "helper", ids: ["helper", "grants"], main: "helper" },
  { key: "live", ids: ["live"], main: "live" },
  { key: "pair", ids: ["name", "pair"], main: "pair" },
];

function undoWords(run: Run): Record<string, StepWords> {
  const n = Number(/^(\d+) switched on/.exec(run.steps.enable?.text ?? "")?.[1] ?? NaN);
  // orbit-undo.sh logs "removed <package>" for each of Orbit's apps it takes off.
  const removed = run.log.some((l) => /^removed \S/.test(l.trim()));
  return {
    home: { doing: t("Bringing back the TV's own home screen"), done: t("The TV's own home screen is back"), fail: t("Orbit Home is still the home screen") },
    enable: {
      doing: t("Switching the apps back on"),
      done: Number.isFinite(n) ? tn(n, "Switched {n} app back on", "Switched {n} apps back on") : t("Switched the apps back on"),
      fail: t("Some apps did not switch back on"),
    },
    helper: { doing: t("Putting the TV's settings back"), done: t("Put the TV's settings back"), fail: t("The TV's settings did not all go back") },
    apps: {
      doing: t("Taking Orbit's own apps away"),
      done: removed ? t("Took Orbit's own apps away") : t("No Orbit apps to take away"),
      fail: t("Orbit's apps are still on the TV"),
    },
  };
}

const UNDO_ROWS: RowSpec[] = [
  { key: "home", ids: ["home"], main: "home" },
  { key: "enable", ids: ["enable"], main: "enable" },
  { key: "helper", ids: ["helper"], main: "helper" },
  { key: "apps", ids: ["apps"], main: "apps" },
];

/** Which home screen `orbit-setup.sh switch` makes Home: the TV's own ("stock"), or Orbit Home ("orbit"). */
export type HomeChoice = "stock" | "orbit";

function switchWords(to: HomeChoice): Record<string, StepWords> {
  return {
    switch:
      to === "stock"
        ? { doing: t("Bringing back the TV's own home screen"), done: t("The TV's own home screen is Home"), fail: t("The TV's own home screen did not come back") }
        : { doing: t("Making Orbit Home the home screen"), done: t("Orbit Home is Home again"), fail: t("Orbit Home did not become Home") },
  };
}

const SWITCH_ROWS: RowSpec[] = [{ key: "switch", ids: ["switch"], main: "switch" }];

/** The switch screen's list, from what `orbit-setup.sh switch stock|orbit` has said so far. */
export function switchRows(run: Run, to: HomeChoice): Row[] {
  return rowsFrom(SWITCH_ROWS, switchWords(to), run);
}

// ---- trying Orbit for 15 minutes (orbit-setup.sh trial, and orbit-undo.sh to take it off again) ----

const TRIAL_WORDS: Record<string, StepWords> = {
  check: { doing: t("Checking the TV"), done: t("Checked the TV"), fail: t("The TV did not pass the check") },
  record: { doing: t("Noting how to take Orbit off again"), done: t("Noted how to take Orbit off again"), fail: t("Could not note how to take Orbit off") },
  install: { doing: t("Installing Orbit Home, as an app"), done: t("Installed Orbit Home, as an app"), fail: t("Orbit Home did not install") },
  keep: { doing: t("Keeping the TV's own home screen"), done: t("The TV's own home screen stays Home"), fail: t("The TV would not keep its own home screen") },
  open: { doing: t("Opening Orbit Home on the TV"), done: t("Orbit Home is on the TV now"), fail: t("Orbit Home did not open") },
};

const TRIAL_ROWS: RowSpec[] = [
  { key: "check", ids: ["check", "record"], main: "check" },
  { key: "install", ids: ["install"], main: "install" },
  { key: "keep", ids: ["keep"], main: "keep" },
  { key: "open", ids: ["open"], main: "open" },
];

/** The trial's list, from what `orbit-setup.sh trial` has said so far. */
export function trialRows(run: Run): Row[] {
  return rowsFrom(TRIAL_ROWS, TRIAL_WORDS, run);
}

function untrialWords(run: Run): Record<string, StepWords> {
  const removed = run.log.some((l) => /^removed \S/.test(l.trim()));
  // orbit-undo.sh's own steps; after a trial only the home screen and Orbit Home itself are on the record.
  const home = { doing: t("Keeping the TV's own home screen"), done: t("The TV's own home screen is Home"), fail: t("Orbit Home is still the home screen") };
  return {
    home,
    enable: home,
    helper: home,
    apps: {
      doing: t("Taking Orbit Home off the TV"),
      done: removed ? t("Took Orbit Home off the TV") : t("Orbit Home was already off the TV"),
      fail: t("Orbit Home is still on the TV"),
    },
  };
}

const UNTRIAL_ROWS: RowSpec[] = [
  { key: "home", ids: ["home", "enable", "helper"], main: "home" },
  { key: "apps", ids: ["apps"], main: "apps" },
];

/** Taking Orbit off again after a trial: orbit-undo.sh's run, in the trial's words. */
export function untrialRows(run: Run): Row[] {
  return rowsFrom(UNTRIAL_ROWS, untrialWords(run), run);
}

/** "some_step" said by a script this page does not know yet: shown as the script names it. */
function wordsFor(id: string, run: Run): StepWords {
  const said = run.steps[id]?.text || id.replace(/[_-]+/g, " ");
  const text = said.charAt(0).toUpperCase() + said.slice(1);
  return { doing: text, done: text, fail: text };
}

function rowsFrom(specs: RowSpec[], words: Record<string, StepWords>, run: Run): Row[] {
  const known = new Set(specs.flatMap((s) => s.ids));
  const extra = run.order.filter((id) => !known.has(id)).map((id) => ({ key: id, ids: [id], main: id }));
  // A script always ends with "done"; one that exits without it stopped.
  const ended = run.done ? (run.done.ok ? "ok" : "fail") : run.exit !== null ? "fail" : null;
  return [...specs, ...extra].map((spec) => {
    const w = (id: string) => words[id] ?? wordsFor(id, run);
    const states = spec.ids.map((id) => run.steps[id]?.state);
    const failed = spec.ids.find((id) => run.steps[id]?.state === "fail");
    if (failed) {
      const text = run.steps[failed].text;
      // The script's own words show under ours, unless they say the same (in English, or once translated).
      const same = !text || text === w(failed).fail || tm(text) === w(failed).fail;
      return { key: spec.key, text: w(failed).fail, state: "fail", detail: same ? undefined : text };
    }
    const settled = states.every((s) => s === "ok" || s === "skip");
    if (settled) {
      const allSkipped = states.every((s) => s === "skip");
      return { key: spec.key, text: allSkipped ? w(spec.main).skip ?? w(spec.main).done : w(spec.main).done, state: allSkipped ? "skipped" : "done" };
    }
    const started = spec.ids.filter((id) => run.steps[id]);
    if (!started.length || ended === "fail") {
      // A run that went well without a word about this row passed it by; one that stopped never reached it.
      if (ended === "ok") return { key: spec.key, text: w(spec.main).skip ?? w(spec.main).done, state: "skipped" };
      return { key: spec.key, text: w(spec.main).doing, state: "pending" };
    }
    const now = spec.ids.find((id) => run.steps[id]?.state === "start") ?? spec.ids.find((id) => !run.steps[id]) ?? spec.main;
    return { key: spec.key, text: w(now).doing, state: ended === "ok" ? "skipped" : "active" };
  });
}

/** The Installing screen's list, from what orbit-setup.sh has said so far. */
export function installRows(run: Run, disableCount: number): Row[] {
  return rowsFrom(INSTALL_ROWS, installWords(disableCount, run), run);
}

/** The Undo screen's list, from what orbit-undo.sh has said so far. */
export function undoRows(run: Run): Row[] {
  return rowsFrom(UNDO_ROWS, undoWords(run), run);
}

/** The plain words for the step that stopped a run (or the run's own last word). */
export function whatStopped(
  run: Run,
  kind: "install" | "undo" | "switch" | "trial" | "untrial",
  disableCount = 0,
  to: HomeChoice = "stock",
): { text: string; detail?: string } {
  const rows =
    kind === "install"
      ? installRows(run, disableCount)
      : kind === "undo"
        ? undoRows(run)
        : kind === "trial"
          ? trialRows(run)
          : kind === "untrial"
            ? untrialRows(run)
            : switchRows(run, to);
  const row = rows.find((r) => r.state === "fail");
  if (row) return { text: row.text, detail: row.detail ?? (run.done?.text && run.done.text !== row.text ? run.done.text : undefined) };
  if (run.done?.text) return { text: run.done.text };
  // A script from before `switch` answers with its usage line and stops.
  if (kind === "switch" && run.log.some((l) => /\busage:/.test(l))) return { text: t("This copy of Orbit Setup cannot switch the home screen") };
  if (kind === "trial" && run.log.some((l) => /\busage:/.test(l))) return { text: t("This copy of Orbit Setup cannot run a trial") };
  const stopped: Record<typeof kind, string> = {
    install: t("The setup stopped before it finished"),
    undo: t("Undo stopped before it finished"),
    switch: t("The switch stopped before it finished"),
    trial: t("The trial stopped before it started"),
    untrial: t("Taking Orbit off stopped before it finished"),
  };
  return { text: stopped[kind] };
}

/** A run that went well: its "done ok", and no step that failed. */
export const runWentWell = (run: Run): boolean => run.done?.ok === true && !run.order.some((id) => run.steps[id].state === "fail");
