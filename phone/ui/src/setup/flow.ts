// Orbit Setup on the page (phone/SPEC.md, "Orbit Setup"): which screen is up, what the TV said about itself, the
// answers and the plan, and the runs of the TV's own scripts. The page decides what changes; Flutter only finds TVs,
// opens the TV's debugging connection and moves files. Every bridge call is made here, from actions, so a screen that
// comes in twice never asks twice.
import { useMemo, useSyncExternalStore } from "react";
import {
  bridge,
  BridgeError,
  cloud,
  drive,
  haptic,
  setupTv,
  type DriveBackup,
  type SetupProps,
  type SetupRecord,
  type SetupTvFound,
  type SignInWay,
  type TvRef,
} from "../bridge";
import { WAY_NAMES } from "../signin";
import { setAccount } from "../store";
import { backupBytes, backupText, buildBackup, canBackUp, parseBackup, type BackupInput } from "./backup";
import { catalog, type Answer, type CatalogQuestion } from "./catalog";
import { applyLine, freshRun, installRows, parseLine, runWentWell, type HomeChoice, type Run } from "./lines";
import {
  ORBIT_HOMES,
  buildPlan,
  disabledByRecord,
  mergeUndo,
  overridePackage,
  pairsOf,
  parsePackages,
  stockLauncher,
  visibleQuestions,
  type Plan,
} from "./plan";

/** The app's own version, for the backups it makes (phone/app/pubspec.yaml). */
export const APP_VERSION = "1.4.0";

export type SetupStep =
  | "welcome"
  | "find"
  | "devmode"
  | "allow"
  | "questions"
  | "plan"
  | "installing"
  | "failed"
  | "you"
  | "ready"
  | "undo"
  | "undoing"
  | "undone"
  | "switch"
  | "switching"
  | "switched"
  | "backup"
  | "backups"
  | "account";

/**
 * What the flow is for: putting Orbit OS on a TV, undoing it, switching the TV's home screen from Settings, backing up
 * the TV's own setup to Google Drive, or the list of those backups (from which Undo can start).
 */
export type FlowMode = "install" | "undo" | "switch" | "backup" | "backups" | "account";

/** Settings › "Delete my Orbit account": what was asked for, and how it went. */
export interface AccountDeletion {
  state: "idle" | "deleting" | "deleted" | "failed";
  /** "Also delete my TV backups from Google Drive" (on unless the person turns it off). */
  backups: boolean;
  /** The account being deleted, for the screens once it has gone. */
  email: string | null;
  error: DriveTrouble | null;
  /** How many backups went, when they were asked to. */
  removed: number | null;
}

export interface SetupTv extends SetupTvFound {
  /** Typed by a person, not found on the Wi-Fi. */
  manual?: boolean;
}

/** A Drive failure in the person's words, and the word for which way out to offer. */
export interface DriveTrouble {
  reason: string;
  text: string;
}

/** The backup of the chosen TV: the file as it will go to Drive, and how saving it went. */
export interface BackupState {
  /** Building the file, or reading the TV for it. */
  state: "idle" | "needsTv" | "reading" | "ready" | "none" | "saving" | "saved" | "failed";
  text: string | null;
  bytes: number;
  /** When the file was made (it says so inside, and Drive's copy is listed by it). */
  at?: number;
  /** The TV was read over its debugging connection for this backup (it closes after). */
  readTv: boolean;
  saved: DriveBackup | null;
  error: DriveTrouble | null;
}

export interface BackupsState {
  state: "idle" | "loading" | "done" | "failed";
  items: DriveBackup[];
  /** The Google account the list came from. */
  email: string | null;
  error: DriveTrouble | null;
  /** The backup being downloaded for Undo, or being deleted. */
  opening: string | null;
  deleting: string | null;
}

/** Undo started from a backup in Drive: its record joins the TV's own and this phone's. */
export interface FromBackup {
  id: string;
  at: number;
  tv: string;
  address: string;
  model: string | null;
  undo: string[];
}

/** Where the scripts and their files go on the TV. */
export const TV_DIR = "/data/local/tmp/orbit";
const ASSETS = ["orbit-setup.sh", "orbit-undo.sh", "orbit-home.apk", "orbit-live.apk"];
const HOME_QUERY = "cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME";
const DOOR_PORT = 8090;
/** Orbit Home's greeting takes the first line of name.txt, at most this long. */
export const NAME_MAX = 40;
/** Rounds of the 4 s scan while Find is open (about half a minute), then "Look again". */
const SCAN_ROUNDS = 6;
const RECORD_LINE = /^(enable|home|a11y|a11y_on|setting|uninstall|replaced)( |$)/;


export interface Flow {
  open: boolean;
  mode: FlowMode;
  step: SetupStep;
  /** 1 forward, -1 back: which way the screens slide. */
  dir: 1 | -1;
  /** The step Undo was started from inside the flow (Ready, or a setup that stopped), for Back. */
  undoFrom: SetupStep | null;
  tv: SetupTv | null;

  scan: { busy: boolean; tvs: SetupTv[]; rounds: number; error: string | null };
  probe: { open: boolean | null; busy: boolean; note: string | null };
  conn: { state: "idle" | "connecting" | "waiting" | "connected" | "failed"; error: string | null; props: SetupProps | null };
  read: { state: "idle" | "busy" | "done" | "failed"; error: string | null; enabled: string[]; disabled: string[]; stock: string | null };
  /** Continue was pressed while the TV was still being read: it goes on when the reading is done. */
  continuing: boolean;
  /** This phone's record of the chosen TV: loaded after connecting, saved after a run. */
  record: SetupRecord | null;
  recordLoaded: boolean;

  answers: Record<string, Answer>;
  /** The question shown; the number of questions means the summary. */
  q: number;
  qDir: 1 | -1;
  /** Every question answered once: an answer from now on goes back to the summary. */
  review: boolean;
  overrides: Record<string, Answer>;

  /** 0 to 1 while the files go to the TV. */
  pushed: number;
  run: Run;
  runStarted: number;
  /** The connection or the phone failed (not the script): the person reconnects before trying again. */
  runError: string | null;
  token: string | null;
  adopted: boolean;
  disableCount: number;

  name: string;
  nameBusy: boolean;
  nameError: string | null;
  /** The way whose sign-in sheet is open (Apple's or Google's), or null. */
  signingIn: SignInWay | null;
  signInError: string | null;

  closeDev: boolean;
  closing: boolean;

  /** switch: the home screen asked for. */
  to: HomeChoice;
  backup: BackupState;
  backups: BackupsState;
  fromBackup: FromBackup | null;
  /** The TV was chosen on Find (Back from Developer mode goes there). */
  viaFind: boolean;
  account: AccountDeletion;
}

const freshBackup = (): BackupState => ({ state: "idle", text: null, bytes: 0, readTv: false, saved: null, error: null });

function initial(): Flow {
  return {
    open: false,
    mode: "install",
    step: "welcome",
    dir: 1,
    undoFrom: null,
    tv: null,
    scan: { busy: false, tvs: [], rounds: 0, error: null },
    probe: { open: null, busy: false, note: null },
    conn: { state: "idle", error: null, props: null },
    read: { state: "idle", error: null, enabled: [], disabled: [], stock: null },
    continuing: false,
    record: null,
    recordLoaded: false,
    answers: {},
    q: 0,
    qDir: 1,
    review: false,
    overrides: {},
    pushed: 0,
    run: freshRun(),
    runStarted: 0,
    runError: null,
    token: null,
    adopted: false,
    disableCount: 0,
    name: "",
    nameBusy: false,
    nameError: null,
    signingIn: null,
    signInError: null,
    closeDev: true,
    closing: false,
    to: "stock",
    backup: freshBackup(),
    backups: { state: "idle", items: [], email: null, error: null, opening: null, deleting: null },
    fromBackup: null,
    viaFind: false,
    account: { state: "idle", backups: true, email: null, error: null, removed: null },
  };
}

let flow: Flow = initial();
const subscribers = new Set<() => void>();

function set(next: Partial<Flow>) {
  flow = { ...flow, ...next };
  subscribers.forEach((f) => f());
}

export function useSetup(): Flow {
  return useSyncExternalStore(
    (f) => {
      subscribers.add(f);
      return () => subscribers.delete(f);
    },
    () => flow,
  );
}

/** For tests and the mock: the flow as it is now. */
export const flowNow = () => flow;

// ---- what the TV said, worked into questions and a plan ----

const questionsOf = (f: Flow) => visibleQuestions(catalog, f.read.enabled);
const planOf = (f: Flow) =>
  buildPlan({ catalog, enabled: f.read.enabled, model: f.conn.props?.model, answers: f.answers, overrides: f.overrides, home: true });

export function useSetupQuestions(f: Flow): CatalogQuestion[] {
  return useMemo(() => questionsOf(f), [f.read.enabled]);
}

export function useSetupPlan(f: Flow): Plan {
  return useMemo(() => planOf(f), [f.read.enabled, f.conn.props?.model, f.answers, f.overrides]);
}

/** The TV's model in plain words: the catalog's name for it, else what the TV calls itself. */
export function modelName(f: Pick<Flow, "tv" | "conn">): string | null {
  const model = f.conn.props?.model ?? f.tv?.model ?? null;
  if (model && catalog.models[model]) return catalog.models[model].name;
  const props = f.conn.props;
  if (props?.model) return props.manufacturer && !props.model.toLowerCase().includes(props.manufacturer.toLowerCase()) ? `${props.manufacturer} ${props.model}` : props.model;
  return model;
}

export const tvName = (f: Pick<Flow, "tv">) => (f.tv?.name && f.tv.name !== "TV" ? f.tv.name : "your TV");

// ---- the phone's Back ----

// Setup is one step of history while it is open: the phone's Back comes here first, goes one screen back, and puts
// the step on again while setup stays open.
let wired = false;
let waitingForSheet = false;

function pushEntry() {
  try {
    history.pushState({ orbitSetup: true }, "");
  } catch {
    /* no history here: the screens' own back buttons still work */
  }
}

const ourEntry = () => !!(history.state as { orbitSetup?: boolean } | null)?.orbitSetup;

function wire() {
  if (wired) return;
  wired = true;
  window.addEventListener("popstate", () => {
    if (waitingForSheet) {
      // The sheet setup was opened from has taken its own step off; now setup's goes on.
      waitingForSheet = false;
      if (flow.open) pushEntry();
      return;
    }
    // A sheet above setup came off, or setup is not open: nothing for setup to do.
    if (!flow.open || ourEntry()) return;
    if (back()) pushEntry();
  });
}

// ---- opening and closing ----

const FIRST: Record<FlowMode, SetupStep> = {
  install: "welcome",
  undo: "undo",
  switch: "switch",
  backup: "backup",
  backups: "backups",
  account: "account",
};

/**
 * Opens Orbit Setup: to put Orbit OS on a TV; or, for `tv` (the TV this phone is connected to), to undo it, to switch
 * its home screen to `to`, or to back its own setup up to Google Drive; or the list of those backups.
 */
export function openSetup(mode: FlowMode, tv?: TvRef | null, to: HomeChoice = "stock") {
  if (flow.open) return;
  wire();
  flow = initial();
  set({ open: true, mode, step: FIRST[mode], dir: 1, to });
  if (mode === "undo" || mode === "switch" || mode === "backup") {
    if (tv) set({ tv: { name: tv.name, address: tv.address, model: null, orbit: true } });
    loadRecord().then(() => {
      if (flow.open && flow.mode === "backup") prepareBackup();
    });
  }
  if (mode === "backups") loadBackups();
  // Opened from a sheet: the sheet's own step of history comes off first (it closes as setup comes in).
  if ((history.state as { orbitSheet?: string } | null)?.orbitSheet) {
    waitingForSheet = true;
    window.setTimeout(() => {
      if (!waitingForSheet) return;
      waitingForSheet = false;
      if (flow.open && !ourEntry()) pushEntry();
    }, 700);
  } else pushEntry();
}

export function closeSetup() {
  if (!flow.open) return;
  stopJobs();
  if (flow.conn.state !== "idle") setupTv.close().catch(() => {});
  flow = initial();
  set({});
  if (ourEntry()) history.back();
}

function stopJobs() {
  adopting = null;
  scanJob++;
  probeJob++;
  window.clearTimeout(probeTimer);
  window.clearTimeout(scanTimer);
  window.clearTimeout(moveOnTimer);
}

// ---- moving between screens ----

function go(step: SetupStep, dir: 1 | -1 = 1) {
  if (!flow.open || flow.step === step) return;
  const from = flow.step;
  if (from === "find") stopScan();
  if (from === "devmode") stopProbe();
  set({ step, dir });
  if (step === "find") startScan();
  if (step === "devmode") startProbe(dir);
  if (step === "allow") startConnect();
  if (step === "installing") runInstall();
  if (step === "undoing") runUndo();
  if (step === "switching") runSwitch();
  if (step === "ready" && flow.backup.state === "idle") prepareBackup();
  if (step === "backups" && flow.backups.state !== "done") loadBackups();
}

/** One screen back (the header's arrow and the phone's Back). False when setup closed, or Back does nothing here. */
export function back(): boolean {
  switch (flow.step) {
    case "welcome":
      closeSetup();
      return false;
    case "find":
      go(flow.mode === "install" ? "welcome" : FIRST[flow.mode], -1);
      return true;
    case "devmode":
      go(flow.mode === "install" || flow.viaFind ? "find" : FIRST[flow.mode], -1);
      return true;
    case "allow":
      go("devmode", -1);
      return true;
    case "questions":
      if (flow.q > 0) set({ q: flow.q - 1, qDir: -1 });
      else go("allow", -1);
      return true;
    case "plan": {
      const qs = questionsOf(flow);
      if (!qs.length) go("allow", -1);
      else {
        set({ q: qs.length, qDir: -1 });
        go("questions", -1);
      }
      return true;
    }
    case "failed":
      if (flow.runError) go("allow", -1);
      else go("plan", -1);
      return true;
    case "ready":
      openRemote();
      return false;
    case "undo":
      if (flow.undoFrom) {
        const to = flow.undoFrom;
        // Back to the list of backups, or to the setup screen Undo was opened from.
        set({ mode: to === "backups" ? "backups" : "install", undoFrom: null, fromBackup: null, viaFind: false });
        go(to, -1);
      } else closeSetup();
      return flow.open;
    case "undone":
      finishUndo();
      return false;
    case "switch":
    case "backups":
      closeSetup();
      return false;
    case "switched":
      finishSwitch();
      return false;
    case "backup":
      if (flow.backup.state === "saving" || flow.backup.state === "reading") return true;
      finishBackup();
      return false;
    case "account":
      // Not while it is going: Google's own sheet may be asking.
      if (flow.account.state === "deleting") return true;
      closeSetup();
      return false;
    default:
      // Installing, undoing and the name come after the TV changed: there is no way back from them.
      return true;
  }
}

// ---- 1. welcome and find ----

export function start() {
  haptic("medium");
  go("find");
}

let scanJob = 0;
let scanTimer = 0;

function startScan() {
  const job = ++scanJob;
  set({ scan: { ...flow.scan, busy: true, error: null, rounds: 0 } });
  const round = async () => {
    if (job !== scanJob) return;
    try {
      const { tvs } = await setupTv.scan(4);
      if (job !== scanJob) return;
      mergeFound(Array.isArray(tvs) ? tvs : []);
    } catch (e) {
      if (job !== scanJob) return;
      set({ scan: { ...flow.scan, error: (e as Error).message || "Orbit could not look on this Wi-Fi." } });
    }
    const rounds = flow.scan.rounds + 1;
    if (rounds >= SCAN_ROUNDS) {
      set({ scan: { ...flow.scan, busy: false, rounds } });
      return;
    }
    set({ scan: { ...flow.scan, rounds } });
    scanTimer = window.setTimeout(round, 1200);
  };
  round();
}

function stopScan() {
  scanJob++;
  window.clearTimeout(scanTimer);
  set({ scan: { ...flow.scan, busy: false } });
}

export function rescan() {
  if (!flow.scan.busy) startScan();
}

function mergeFound(found: SetupTvFound[]) {
  const tvs = [...flow.scan.tvs];
  for (const t of found) {
    if (!t || typeof t.address !== "string" || !t.address) continue;
    const tv: SetupTv = { name: t.name || "TV", address: t.address, model: t.model ?? null, orbit: !!t.orbit };
    const i = tvs.findIndex((x) => x.address === tv.address);
    if (i >= 0) tvs[i] = { ...tvs[i], ...tv, manual: false };
    else tvs.push(tv);
  }
  set({ scan: { ...flow.scan, tvs } });
}

export function chooseTv(tv: SetupTv) {
  haptic("medium");
  if (flow.tv?.address !== tv.address) {
    // Another TV: nothing said by the last one counts.
    connectJob++;
    if (flow.conn.state !== "idle") setupTv.close().catch(() => {});
    const fresh = initial();
    set({
      conn: fresh.conn,
      read: fresh.read,
      record: null,
      recordLoaded: false,
      answers: {},
      q: 0,
      review: false,
      overrides: {},
      run: freshRun(),
      runError: null,
      token: null,
      adopted: false,
      continuing: false,
    });
  }
  set({ tv, viaFind: true });
  // Undo from a backup: this phone's own record of the chosen TV joins the backup's.
  if (flow.mode !== "install" && !flow.recordLoaded) loadRecord();
  go("devmode");
}

const ADDRESS = /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;
const HOSTNAME = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/i;

/** A typed address: null when it is taken, else what to tell the person. */
export function chooseAddress(text: string): string | null {
  const address = text.trim();
  if (!ADDRESS.test(address) && !(HOSTNAME.test(address) && /[a-z]/i.test(address) && address.includes("."))) {
    return "That is not an address. It is four numbers with dots, like 192.168.1.20.";
  }
  const known = flow.scan.tvs.find((t) => t.address === address);
  chooseTv(known ?? { name: "Your TV", address, model: null, orbit: false, manual: true });
  return null;
}

// ---- 2. developer mode ----

let probeJob = 0;
let probeTimer = 0;

function startProbe(dir: 1 | -1) {
  const job = ++probeJob;
  set({ probe: { open: null, busy: false, note: null } });
  const tick = async () => {
    const tv = flow.tv;
    if (job !== probeJob || !tv) return;
    let open = false;
    try {
      open = !!(await setupTv.probe(tv.address)).open;
    } catch {
      open = false;
    }
    if (job !== probeJob) return;
    set({ probe: { ...flow.probe, open } });
    // It moves on by itself when the door opens; not when a person came back here on purpose.
    if (open && dir === 1) {
      haptic("success");
      go("allow");
      return;
    }
    probeTimer = window.setTimeout(tick, 2000);
  };
  tick();
}

function stopProbe() {
  probeJob++;
  window.clearTimeout(probeTimer);
}

/** "It's on": look straight away. */
export async function itsOn() {
  const tv = flow.tv;
  if (!tv || flow.probe.busy) return;
  set({ probe: { ...flow.probe, busy: true, note: null } });
  let open = false;
  try {
    open = !!(await setupTv.probe(tv.address)).open;
  } catch {
    open = false;
  }
  if (flow.step !== "devmode") return;
  if (open) {
    haptic("success");
    set({ probe: { open: true, busy: false, note: null } });
    go("allow");
  } else {
    haptic("error");
    set({ probe: { open: false, busy: false, note: "Not yet. Check that USB debugging is on, then press It's on again." } });
  }
}

// ---- 3. allow, and reading the TV ----

let connectJob = 0;

export function connectError(e: unknown): string {
  const reason = (e as { reason?: string }).reason ?? "";
  const said = (e as Error).message || "";
  const why = reason || (/^(refused|timeout|unreachable|tls)$/.test(said) ? said : "");
  switch (why) {
    case "refused":
      return "The TV said Cancel. Try again and choose Allow.";
    case "timeout":
      return "Nobody pressed Allow in time. Try again, and press Allow when the TV asks.";
    case "unreachable":
      return "Orbit cannot reach the TV. Check that it is on, on this Wi-Fi, and that USB debugging is on.";
    case "tls":
      return "This TV only offers Wireless debugging, which Orbit Setup does not support yet.";
    default:
      return said || "The TV did not open the connection. Try again.";
  }
}

async function startConnect() {
  const state = flow.conn.state;
  if (state === "connecting" || state === "waiting" || state === "connected") return;
  const tv = flow.tv;
  if (!tv) return;
  const job = ++connectJob;
  set({ conn: { state: "connecting", error: null, props: null }, continuing: false });
  const off = bridge.on("setupAuth", (d: { state?: string } | null) => {
    if (job === connectJob && d?.state === "waiting" && flow.conn.state === "connecting") set({ conn: { ...flow.conn, state: "waiting" } });
  });
  try {
    const props = await setupTv.connect(tv.address);
    if (job !== connectJob || !flow.open) return;
    const named = tv.manual && tv.name === "Your TV" ? { ...tv, name: modelName({ tv, conn: { ...flow.conn, props } }) ?? tv.name } : tv;
    set({ conn: { state: "connected", error: null, props }, tv: { ...named, model: props?.model || named.model } });
    haptic("success");
    if (flow.mode === "install") {
      readTv();
      if (!flow.recordLoaded) loadRecord();
    }
  } catch (e) {
    if (job !== connectJob || !flow.open) return;
    haptic("error");
    set({ conn: { state: "failed", error: connectError(e), props: null } });
  } finally {
    off();
  }
}

export function retryConnect() {
  haptic("light");
  startConnect();
}

async function readTv() {
  set({ read: { ...flow.read, state: "busy", error: null } });
  try {
    const enabled = parsePackages((await setupTv.shell("pm list packages -e")).out ?? "");
    if (!enabled.length) throw new Error("no packages");
    const disabled = parsePackages((await setupTv.shell("pm list packages -d")).out ?? "");
    const stock = stockLauncher((await setupTv.shell(HOME_QUERY)).out ?? "");
    if (!flow.open) return;
    set({ read: { state: "done", error: null, enabled, disabled, stock } });
    if (flow.continuing) continueFromAllow();
  } catch {
    if (!flow.open) return;
    set({ read: { ...flow.read, state: "failed", error: "Orbit could not read the TV's list of apps. Try again." }, continuing: false });
  }
}

async function loadRecord() {
  const tv = flow.tv;
  if (!tv || tv.address === "cloud") return set({ recordLoaded: true });
  try {
    const { record } = await setupTv.loadRecord(tv.address);
    if (flow.tv?.address === tv.address) set({ record: record && Array.isArray(record.undo) ? record : null, recordLoaded: true });
  } catch {
    if (flow.tv?.address === tv.address) set({ record: null, recordLoaded: true });
  }
}

export function continueFromAllow() {
  if (flow.conn.state !== "connected") return;
  if (flow.mode === "undo") return go("undoing");
  if (flow.mode === "switch") return go("switching");
  if (flow.mode === "backup") return readForBackup();
  if (flow.read.state === "failed" || flow.read.state === "idle") {
    set({ continuing: true });
    return readTv();
  }
  if (flow.read.state !== "done") return set({ continuing: true });
  set({ continuing: false });
  const qs = questionsOf(flow);
  if (!qs.length) return go("plan");
  const first = qs.findIndex((q) => !flow.answers[q.id]);
  set({ q: first < 0 ? qs.length : first, qDir: 1, review: first < 0 });
  go("questions");
}

// ---- 4. questions ----

export function answer(id: string, value: Answer) {
  const qs = questionsOf(flow);
  const i = qs.findIndex((q) => q.id === id);
  if (i < 0) return;
  haptic("light");
  const q = flow.review ? qs.length : i + 1;
  set({ answers: { ...flow.answers, [id]: value }, q, qDir: 1, review: flow.review || q >= qs.length });
}

export function previousQuestion() {
  if (flow.q > 0) set({ q: flow.q - 1, qDir: -1 });
}

export function changeAnswer(index: number) {
  haptic("light");
  set({ q: index, qDir: -1 });
}

export function seePlan() {
  haptic("medium");
  go("plan");
}

// ---- 5. the plan ----

export function setPackage(pkg: string, off: boolean) {
  haptic("tick");
  set({ overrides: overridePackage(planOf(flow), flow.overrides, pairsOf(catalog, flow.conn.props?.model), pkg, off) });
}

export function setGroup(id: string, off: boolean) {
  haptic("light");
  const plan = planOf(flow);
  const pairs = pairsOf(catalog, flow.conn.props?.model);
  let overrides = flow.overrides;
  for (const item of plan.groups.find((g) => g.id === id)?.items ?? []) {
    if (!item.lock) overrides = overridePackage(plan, overrides, pairs, item.pkg, off);
  }
  set({ overrides });
}

export function install() {
  haptic("medium");
  go("installing");
}

// ---- 6. installing ----

function makeToken(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The script's lines, into `flow.run` while it runs. */
function listenLines(into: (line: string) => void = (l) => set({ run: applyLine(flow.run, parseLine(l)) })): () => void {
  return bridge.on("setupLine", (d: { line?: unknown } | null) => {
    if (typeof d?.line !== "string") return;
    for (const l of d.line.split("\n")) if (l.replace(/\r/g, "")) into(l);
  });
}

let moveOnTimer = 0;
let running = false;
/** The phone becoming the TV's remote, under way after a run that went well. */
let adopting: Promise<boolean> | null = null;

async function runInstall() {
  const tv = flow.tv;
  if (!tv || running) return;
  running = true;
  const plan = planOf(flow);
  const token = flow.token ?? makeToken();
  const stock = flow.read.stock ?? flow.record?.stock ?? null;
  set({ token, run: freshRun(), runStarted: Date.now(), runError: null, pushed: 0, adopted: false, disableCount: plan.disable.length });
  const texts: [string, string][] = [
    ["plan.txt", `home=1\nlive=1\nstock=${stock ?? ""}\n`],
    ["disable.txt", plan.disable.map((p) => `${p}\n`).join("")],
    ["name.txt", ""],
    ["token.txt", `${token}\n`],
    ["phone.txt", "Orbit\n"],
  ];
  const stop = listenLines();
  try {
    await setupTv.shell(`mkdir -p ${TV_DIR}`);
    const jobs = [
      ...ASSETS.map((a) => () => setupTv.pushAsset(a, `${TV_DIR}/${a}`)),
      ...texts.map(([file, text]) => () => setupTv.pushText(text, `${TV_DIR}/${file}`)),
    ];
    for (let i = 0; i < jobs.length; i++) {
      await jobs[i]();
      set({ pushed: (i + 1) / jobs.length });
    }
    const { exit } = await setupTv.run(`sh ${TV_DIR}/orbit-setup.sh install`);
    if (flow.run.exit === null && typeof exit === "number") set({ run: { ...flow.run, exit } });
  } catch (e) {
    set({ runError: (e as Error).message || "The connection to the TV closed." });
  } finally {
    stop();
    running = false;
  }
  if (!flow.open) return;
  const run = flow.run;
  const ok = !flow.runError && run.done?.ok === true;

  // The script says the TV's whole record each run, the first run's lines first; the phone keeps it all, with its own
  // earlier copy for a TV that lost its own.
  const earlier = flow.record && !flow.record.undone ? flow.record.undo : [];
  const undo = mergeUndo(earlier, run.undo);
  if (undo.length) {
    const record: SetupRecord = {
      address: tv.address,
      name: tv.name,
      model: flow.conn.props?.model ?? tv.model ?? null,
      at: Date.now(),
      token,
      undo,
      disabled: disabledByRecord(undo),
      stock,
      props: flow.conn.props ?? flow.record?.props ?? null,
      apps: appsForRecord(earlier.length > 0),
      home: ok ? "orbit" : flow.record?.home,
    };
    set({ record });
    await setupTv.saveRecord(tv.address, record).catch(() => setupTv.saveRecord(tv.address, record).catch(() => {}));
  }

  if (!ok) {
    haptic("error");
    go("failed");
    return;
  }
  haptic("success");
  // On by itself when every step went well; a step with trouble waits for Continue, so it is read.
  const trouble = installRows(flow.run, flow.disableCount).some((r) => r.state === "fail");
  if (!trouble) moveOnTimer = window.setTimeout(() => flow.step === "installing" && go("you"), 1400);
  // This phone becomes the TV's remote meanwhile (Flutter tries the door for 30 s while Orbit Home starts); if it
  // does not, Open the remote asks once more.
  adopting = setupTv
    .adopt({ address: tv.address, port: DOOR_PORT, token, name: tv.name })
    .then(
      () => true,
      () => false,
    )
    .then((adopted) => {
      if (flow.token === token) set({ adopted });
      return adopted;
    });
}

/** The apps as setup read them, for the record (and so for backups made later without the TV). */
function appsForRecord(hadRecord: boolean): SetupRecord["apps"] {
  const kept = flow.record?.apps;
  // A reading from before anything changed is the best there is: a later run keeps it.
  if (kept?.when === "setup") return kept;
  if (flow.read.state !== "done") return kept ?? null;
  const untouched = !hadRecord && !flow.tv?.orbit && !!flow.read.stock;
  return { enabled: flow.read.enabled, disabled: flow.read.disabled, when: untouched ? "setup" : "now" };
}

export function continueFromInstall() {
  if (flow.run.done?.ok) go("you");
}

export function tryAgain() {
  haptic("medium");
  if (flow.runError) {
    // The connection went: open it again, then the plan as it was.
    set({ conn: { state: "idle", error: null, props: flow.conn.props }, runError: null });
    go("allow", -1);
    return;
  }
  go("installing");
}

// ---- 7. your name and account ----

export function setName(name: string) {
  set({ name: name.replace(/[\r\n]+/g, " ").slice(0, NAME_MAX), nameError: null });
}

export async function signIn(way: SignInWay = "google") {
  if (flow.signingIn) return;
  set({ signingIn: way, signInError: null });
  try {
    setAccount(await cloud.signIn(way));
    haptic("success");
  } catch (e) {
    set({ signInError: (e as Error).message || `${WAY_NAMES[way]} sign-in did not finish.` });
  } finally {
    set({ signingIn: null });
  }
}

export async function finishName() {
  if (flow.nameBusy) return;
  const name = flow.name.trim();
  if (!name) return go("ready");
  set({ nameBusy: true, nameError: null });
  let run = freshRun();
  const stop = listenLines((l) => (run = applyLine(run, parseLine(l))));
  try {
    await setupTv.pushText(`${name}\n`, `${TV_DIR}/name.txt`);
    const { exit } = await setupTv.run(`sh ${TV_DIR}/orbit-setup.sh name`);
    if (run.done ? !run.done.ok : exit !== 0) throw new Error(run.done?.text || "");
    haptic("success");
    set({ nameBusy: false });
    go("ready");
  } catch {
    haptic("error");
    set({ nameBusy: false, nameError: "The TV did not take the name. Try again, or finish without it." });
  } finally {
    stop();
  }
}

export function skipName() {
  set({ nameError: null });
  go("ready");
}

// ---- 8. ready ----

export function setCloseDev(on: boolean) {
  haptic("tick");
  set({ closeDev: on });
}

/** Closes developer mode when asked (the connection drops as it goes), then the remote. */
async function shutTheDoor() {
  if (flow.closeDev) await setupTv.shell("settings put global adb_enabled 0", 8000).catch(() => {});
  await setupTv.close().catch(() => {});
  set({ conn: { ...flow.conn, state: "idle" } });
}

export async function openRemote() {
  if (flow.closing) return;
  set({ closing: true });
  const tv = flow.tv;
  const adopted = flow.adopted || (adopting ? await adopting : false);
  if (!adopted && tv && flow.token) {
    await setupTv.adopt({ address: tv.address, port: DOOR_PORT, token: flow.token, name: tv.name }).catch(() => {});
  }
  await shutTheDoor();
  haptic("success");
  closeSetup();
}

// ---- undo ----

/** Undo from inside the flow (Ready, or a setup that stopped): the connection is still open. */
export function undoHere() {
  haptic("light");
  set({ mode: "undo", undoFrom: flow.step });
  go("undo");
}

export function confirmUndo() {
  haptic("medium");
  if (flow.conn.state === "connected") go("undoing");
  // From a backup: which TV on this Wi-Fi it is, first (its address may have changed since).
  else if (flow.fromBackup) go("find");
  else go("devmode");
}

async function runUndo() {
  if (running) return;
  running = true;
  set({ run: freshRun(), runStarted: Date.now(), runError: null, pushed: 0 });
  const stop = listenLines();
  try {
    // The TV's own record first: it knows how the TV was; this phone's copy fills in what the TV has lost.
    let onTv: string[] = [];
    try {
      onTv = ((await setupTv.shell(`cat ${TV_DIR}/undo.txt 2>/dev/null`)).out ?? "").split("\n").filter((l) => RECORD_LINE.test(l.replace(/\r/g, "")));
    } catch {
      onTv = [];
    }
    const mine = flow.record && !flow.record.undone ? flow.record.undo : [];
    // A backup from Drive fills in what both the TV and this phone have lost.
    const lines = mergeUndo(onTv, mine, flow.fromBackup?.undo);
    await setupTv.shell(`mkdir -p ${TV_DIR}`);
    await setupTv.pushAsset("orbit-undo.sh", `${TV_DIR}/orbit-undo.sh`);
    set({ pushed: 0.5 });
    if (lines.length) await setupTv.pushText(lines.map((l) => `${l}\n`).join(""), `${TV_DIR}/undo.txt`);
    set({ pushed: 1 });
    const { exit } = await setupTv.run(`sh ${TV_DIR}/orbit-undo.sh`);
    if (flow.run.exit === null && typeof exit === "number") set({ run: { ...flow.run, exit } });
  } catch (e) {
    set({ runError: (e as Error).message || "The connection to the TV closed." });
  } finally {
    stop();
    running = false;
  }
  if (!flow.open) return;
  const ok = !flow.runError && flow.run.done?.ok === true;
  if (ok && flow.record && flow.tv) {
    const record = { ...flow.record, undone: Date.now() };
    set({ record });
    setupTv.saveRecord(flow.tv.address, record).catch(() => {});
  }
  haptic(ok ? "success" : "error");
  go("undone");
}

export function undoAgain() {
  haptic("medium");
  if (flow.runError || flow.conn.state !== "connected") {
    set({ conn: { ...flow.conn, state: "idle" }, runError: null });
    go("devmode", -1);
    return;
  }
  go("undoing");
}

export async function finishUndo() {
  if (flow.closing) return;
  set({ closing: true });
  const ok = flow.run.done?.ok === true && !flow.runError;
  if (ok) await shutTheDoor();
  else await setupTv.close().catch(() => {});
  // Orbit Home came off this TV: the remote has nothing to talk to there any more.
  const removedHome = ok && mergeUndo(flow.record?.undo, flow.fromBackup?.undo).some((l) => /^uninstall /.test(l) && ORBIT_HOMES.has(l.slice(10).trim()));
  const tv = flow.tv;
  closeSetup();
  if (removedHome && tv) {
    const status = await bridge.call<{ tv?: TvRef | null }>("status").catch(() => null);
    if (status?.tv?.address === tv.address) bridge.call("forget").catch(() => {});
  }
}

/** The undo record this phone knows for the chosen TV: its own copy (unless Undo already used it), and a backup's. */
export function knownUndo(f: Pick<Flow, "record" | "fromBackup">): string[] {
  return mergeUndo(f.record && !f.record.undone ? f.record.undo : [], f.fromBackup?.undo);
}

/** The TV's own record, /data/local/tmp/orbit/undo.txt, a line each (none when it has lost it). */
async function readTvRecord(): Promise<string[]> {
  const out = (await setupTv.shell(`cat ${TV_DIR}/undo.txt 2>/dev/null`)).out ?? "";
  return mergeUndo(out.split("\n").filter((l) => RECORD_LINE.test(l.replace(/\r/g, ""))));
}

/** The step bar of Find, Developer mode and Allow: "2 of 7" in setup; "1 of 2" for the rest, "1 of 3" with Find. */
export function stepCount(f: Pick<Flow, "mode" | "viaFind" | "fromBackup">, screen: "find" | "devmode" | "allow"): { step: number; total: number } {
  if (f.mode === "install") return { step: screen === "find" ? 1 : screen === "devmode" ? 2 : 3, total: 7 };
  const order = f.viaFind || f.fromBackup || screen === "find" ? ["find", "devmode", "allow"] : ["devmode", "allow"];
  return { step: order.indexOf(screen) + 1, total: order.length };
}

// ---- switching the home screen (Settings › This TV) ----

/** "Use the TV's own home screen" / "Use Orbit Home again": over the open connection, or Developer mode and Allow first. */
export function confirmSwitch() {
  haptic("medium");
  if (flow.conn.state === "connected") go("switching");
  else go("devmode");
}

async function runSwitch() {
  if (running) return;
  running = true;
  const to = flow.to;
  set({ run: freshRun(), runStarted: Date.now(), runError: null, pushed: 0 });
  const stop = listenLines();
  try {
    // The script reads the TV's own record for its home screen: this phone's copy goes over first when the TV has lost
    // lines of it, as for Undo.
    let onTv: string[] = [];
    try {
      onTv = await readTvRecord();
    } catch {
      onTv = [];
    }
    const lines = mergeUndo(onTv, knownUndo(flow));
    await setupTv.shell(`mkdir -p ${TV_DIR}`);
    await setupTv.pushAsset("orbit-setup.sh", `${TV_DIR}/orbit-setup.sh`);
    set({ pushed: 0.5 });
    if (lines.length > onTv.length) await setupTv.pushText(lines.map((l) => `${l}\n`).join(""), `${TV_DIR}/undo.txt`);
    set({ pushed: 1 });
    const { exit } = await setupTv.run(`sh ${TV_DIR}/orbit-setup.sh switch ${to}`);
    if (flow.run.exit === null && typeof exit === "number") set({ run: { ...flow.run, exit } });
  } catch (e) {
    set({ runError: (e as Error).message || "The connection to the TV closed." });
  } finally {
    stop();
    running = false;
  }
  if (!flow.open) return;
  const ok = !flow.runError && runWentWell(flow.run);
  if (ok && flow.record && flow.tv) {
    // Switching back to Orbit Home says the record lines it keeps (the stock home screen going off again).
    const record: SetupRecord = { ...flow.record, home: to, undo: mergeUndo(flow.record.undo, flow.run.undo) };
    set({ record });
    setupTv.saveRecord(flow.tv.address, record).catch(() => {});
  }
  haptic(ok ? "success" : "error");
  go("switched");
}

export function switchAgain() {
  haptic("medium");
  if (flow.runError || flow.conn.state !== "connected") {
    set({ conn: { ...flow.conn, state: "idle" }, runError: null });
    go("devmode", -1);
    return;
  }
  go("switching");
}

export async function finishSwitch() {
  if (flow.closing) return;
  set({ closing: true });
  if (runWentWell(flow.run) && !flow.runError) await shutTheDoor();
  else await setupTv.close().catch(() => {});
  closeSetup();
}

// ---- backups of the TV's own setup, in the person's Google Drive ----

/** The TV's settings as read over the debugging connection, for a backup this phone cannot make from its own record. */
export interface TvNow {
  enabled: string[];
  disabled: string[];
  undo: string[];
  home: string | null;
  a11y: string | null;
  a11yOn: string | null;
  screensaver: string | null;
}

/** "null" (a setting that is not set) comes back as "". */
const settingOut = (out: string | undefined) => {
  const v = (out ?? "").replace(/\r/g, "").trim();
  return v === "null" ? "" : v;
};

/** The home screen's component, the last line of resolve-activity ("com.example/.Home"). */
function homeComponent(out: string): string | null {
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] ?? "";
  return /^[A-Za-z][\w.]*\/\S+$/.test(last) ? last : null;
}

/**
 * The file for the chosen TV, from this phone's record (what setup read and changed), or from `now` (the TV read just
 * now) worked back with the record. Without enough on the phone the TV is read first; without any record of what Orbit
 * changed there is nothing to back up.
 */
export function prepareBackup(now?: TvNow) {
  const tv = flow.tv;
  if (!tv) return;
  const record = flow.record && !flow.record.undone ? flow.record : null;
  const props = flow.conn.props ?? record?.props ?? null;
  const apps: BackupInput["packages"] = now ? { enabled: now.enabled, disabled: now.disabled, when: "now" } : record?.apps ?? null;
  const readTv = !!now || flow.backup.readTv;
  if (!now && (!record?.undo.length || !apps || !props)) {
    set({ backup: { ...freshBackup(), state: "needsTv" } });
    return;
  }
  const undo = mergeUndo(now?.undo, record?.undo);
  if (!canBackUp(undo)) {
    set({ backup: { ...freshBackup(), state: "none", readTv } });
    return;
  }
  const made = new Date();
  const text = backupText(
    buildBackup({
      tv: { name: tv.name, address: tv.address },
      props,
      model: record?.model ?? tv.model,
      undo,
      setUpAt: record?.at ?? null,
      packages: apps,
      now: now ? { home: now.home, a11y: now.a11y, a11yOn: now.a11yOn, screensaver: now.screensaver } : null,
      made,
      app: `Orbit ${APP_VERSION}`,
    }),
  );
  set({ backup: { state: "ready", text, bytes: backupBytes(text), readTv, saved: null, error: null, at: made.getTime() } });
}

/** Backup mode, once Allow is pressed: read the TV's apps, its record and its settings, then back to the backup. */
async function readForBackup() {
  if (flow.continuing) return;
  set({ continuing: true, read: { ...flow.read, state: "busy", error: null } });
  try {
    const enabled = parsePackages((await setupTv.shell("pm list packages -e")).out ?? "");
    if (!enabled.length) throw new Error("no packages");
    const disabled = parsePackages((await setupTv.shell("pm list packages -d")).out ?? "");
    const undo = await readTvRecord().catch(() => []);
    const home = homeComponent((await setupTv.shell(HOME_QUERY)).out ?? "");
    const a11y = settingOut((await setupTv.shell("settings get secure enabled_accessibility_services")).out);
    const a11yOn = settingOut((await setupTv.shell("settings get secure accessibility_enabled")).out);
    const screensaver = settingOut((await setupTv.shell("settings get secure screensaver_components")).out);
    if (!flow.open || flow.mode !== "backup") return;
    set({ continuing: false, read: { state: "done", error: null, enabled, disabled, stock: stockLauncher(home ?? "") } });
    prepareBackup({ enabled, disabled, undo, home, a11y, a11yOn: a11yOn || null, screensaver });
    go("backup");
  } catch {
    if (!flow.open) return;
    set({ continuing: false, read: { ...flow.read, state: "failed", error: "Orbit could not read the TV's list of apps. Try again." } });
  }
}

/** "Read the TV": Developer mode and Allow, then the reading (or straight to it while the connection is open). */
export function readTvForBackup() {
  haptic("medium");
  if (flow.conn.state === "connected") readForBackup();
  else go("devmode");
}

function driveTrouble(e: unknown): DriveTrouble {
  const reason = e instanceof BridgeError ? e.reason ?? "other" : "other";
  const said = (e as Error)?.message;
  return { reason, text: said || "Google Drive did not answer. Try again." };
}

/** Saves the file to Drive; Google's own sheet asks for Drive the first time. */
export async function saveBackup() {
  const b = flow.backup;
  const tv = flow.tv;
  if (!tv || !b.text || b.state === "saving") return;
  haptic("medium");
  set({ backup: { ...b, state: "saving", error: null } });
  try {
    const saved = await drive.save({
      text: b.text,
      tv: tv.name,
      address: tv.address,
      model: flow.conn.props?.model ?? flow.record?.model ?? tv.model ?? null,
      at: b.at ?? Date.now(),
    });
    if (!flow.open) return;
    haptic("success");
    set({ backup: { ...flow.backup, state: "saved", saved, error: null } });
  } catch (e) {
    if (!flow.open) return;
    haptic("error");
    set({ backup: { ...flow.backup, state: "failed", error: driveTrouble(e) } });
  }
}

/** No account yet: Apple's or Google's sign-in first, then the backup (Google's sheet then asks for a Drive). */
export async function signInAndSave(way: SignInWay = "google") {
  await signIn(way);
  if (!flow.signInError) await saveBackup();
}

/** Done: closes developer mode when the TV was opened for the backup (and the person left the switch on). */
export async function finishBackup() {
  if (flow.closing) return;
  set({ closing: true });
  if (flow.conn.state === "connected") await shutTheDoor();
  closeSetup();
}

/** Settings › Backups: every TV backup in this Google account's Drive. */
export async function loadBackups() {
  if (flow.backups.state === "loading") return;
  set({ backups: { ...flow.backups, state: "loading", error: null } });
  try {
    const { backups, email } = await drive.list();
    if (!flow.open) return;
    set({ backups: { ...flow.backups, state: "done", items: Array.isArray(backups) ? backups : [], email: email ?? null, error: null } });
  } catch (e) {
    if (!flow.open) return;
    set({ backups: { ...flow.backups, state: "failed", error: driveTrouble(e) } });
  }
}

/** Settings › Backups before signing in: Apple's or Google's sign-in, then the list. */
export async function signInAndList(way: SignInWay = "google") {
  await signIn(way);
  if (!flow.signInError) await loadBackups();
}

/**
 * "Put this TV back": the backup's record comes down from Drive, and Undo starts with it (Find first, to be sure which
 * TV; this phone's own record of it, if any, joins in).
 */
export async function restoreFrom(item: DriveBackup) {
  if (flow.backups.opening) return;
  haptic("medium");
  set({ backups: { ...flow.backups, opening: item.id, error: null } });
  try {
    const backup = parseBackup((await drive.load(item.id)).text);
    if (!flow.open || flow.mode !== "backups") return;
    const fromBackup: FromBackup = { id: item.id, at: item.at, tv: backup.tv.name, address: backup.tv.address, model: backup.tv.model, undo: backup.undo };
    connectJob++;
    if (flow.conn.state !== "idle") setupTv.close().catch(() => {});
    set({
      backups: { ...flow.backups, opening: null },
      mode: "undo",
      undoFrom: "backups",
      fromBackup,
      tv: { name: backup.tv.name, address: backup.tv.address, model: backup.tv.model, orbit: false },
      record: null,
      recordLoaded: false,
      conn: initial().conn,
      viaFind: false,
      run: freshRun(),
      runError: null,
    });
    loadRecord();
    go("undo");
  } catch (e) {
    if (!flow.open) return;
    haptic("error");
    set({
      backups: {
        ...flow.backups,
        opening: null,
        error: e instanceof BridgeError ? driveTrouble(e) : { reason: "file", text: (e as Error).message || "That backup could not be read." },
      },
    });
  }
}

export async function deleteBackup(id: string) {
  if (flow.backups.deleting) return;
  set({ backups: { ...flow.backups, deleting: id, error: null } });
  try {
    await drive.remove(id);
    haptic("success");
    set({ backups: { ...flow.backups, deleting: null, items: flow.backups.items.filter((b) => b.id !== id) } });
  } catch (e) {
    haptic("error");
    set({ backups: { ...flow.backups, deleting: null, error: driveTrouble(e) } });
  }
}

// ---- Settings › "Delete my Orbit account" ----

export function setDeleteBackups(on: boolean) {
  haptic("tick");
  set({ account: { ...flow.account, backups: on } });
}

/**
 * Deletes the Orbit account (phone/SPEC.md, "Deleting the account"): the TV backups in Drive when asked, everything
 * Orbit's cloud keeps under this account, then the account itself (Google may ask once more that it is the person), and
 * signs out. Nothing on the TV changes.
 */
export async function deleteAccount(email: string | null) {
  if (flow.account.state === "deleting") return;
  haptic("heavy");
  set({ account: { ...flow.account, state: "deleting", error: null, email } });
  try {
    const { removed, account } = await cloud.deleteAccount(flow.account.backups);
    setAccount(account);
    if (!flow.open) return;
    haptic("success");
    set({ account: { ...flow.account, state: "deleted", removed: typeof removed === "number" ? removed : null } });
  } catch (e) {
    if (!flow.open) return;
    haptic("error");
    set({ account: { ...flow.account, state: "failed", error: driveTrouble(e) } });
  }
}
