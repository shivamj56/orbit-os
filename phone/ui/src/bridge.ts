// The page's only way out: window.OrbitNative (the Flutter app) or, in a plain browser, the mock TV in mock.ts.
// The contract is phone/SPEC.md.
import { createMock } from "./mock";
import { mark } from "./i18n";

export type ConnState = "searching" | "found" | "needsPairing" | "pairing" | "connected" | "offline";

/**
 * What a TV is: "orbit" (Orbit OS on it: every control), or a make Orbit drives as a remote (phone/SPEC.md, "Every TV").
 */
export type TvKind = "orbit" | "samsung" | "lg" | "roku" | "androidtv" | "firetv";

export interface TvRef {
  name: string;
  address: string;
  port: number;
  udp?: number | null;
  /** Absent for a TV with Orbit OS. */
  kind?: TvKind;
  model?: string | null;
  /** What a TV of another make can do from the phone (makes.ts); absent for a TV with Orbit OS. */
  caps?: string[] | null;
}

/** How a TV of another make pairs, while it needs to: accept on the TV, type its code, or change one of its settings. */
export interface Pairing {
  how: "allow" | "code" | "setting";
  length?: number;
  chars?: "digits" | "hex";
}

export interface Status {
  state: ConnState;
  tv: TvRef | null;
  found?: TvRef[];
  via?: "wifi" | "cloud";
  error?: string | null;
  pairing?: Pairing | null;
}

export interface TvState {
  ok: boolean;
  tv: string | null;
  app: string | null;
  pkg: string | null;
  title: string;
  artist: string;
  playing: boolean;
  position: number;
  duration: number;
  player: string | null;
  volume: number;
  max: number;
  muted: boolean;
  udp: number | null;
  pointer: boolean;
  /** A TV of another make: which, and whether it tells its volume (Roku, Samsung without UPnP and others do not). */
  kind?: TvKind;
  volumeKnown?: boolean;
}

export interface AppEntry {
  pkg: string;
  label: string;
}

/** Orbit from anywhere (phone/SPEC.md): the Google account on the phone, and whether the TV is linked to it. */
export interface Account {
  signedIn: boolean;
  email: string | null;
  tvLinked: boolean;
  tvOnline: boolean;
  tvName: string | null;
}

/** Help mode (phone/SPEC.md): one picture of the TV's screen, `at` when the TV took it, in this phone's clock. */
export interface Screen {
  jpg: string;
  w: number;
  h: number;
  seq: number;
  at: number;
}

export type Key =
  | "back" | "home" | "up" | "down" | "left" | "right" | "ok"
  | "recents" | "settings" | "mute" | "volup" | "voldown";

export type Haptic = "tick" | "light" | "medium" | "heavy" | "success" | "error";

export class BridgeError extends Error {
  /** A word for the page to choose its own text by (setupConnect: "refused", "timeout", "unreachable", "tls"). */
  constructor(message: string, readonly status?: number, readonly reason?: string) {
    super(message);
  }
}

export interface Message {
  id?: number;
  ok?: boolean;
  data?: unknown;
  error?: string;
  status?: number;
  reason?: string;
  event?: string;
}

type Listener = (data: any) => void;

/** Where the page lives: `window` in the app and in a browser; a stand-in in tests. */
export interface BridgeHost {
  OrbitNative?: { postMessage?: (text: string) => void };
  orbitReceive?: (m: Message | string) => void;
}

/** Makes the pretend TV (mock.ts): it answers ops, and delivers its replies and events through `deliver`. */
export type MockFactory = (deliver: (m: Message) => void) => (text: string) => void;

/**
 * Ops the phone itself answers even in demo mode (phone/SPEC.md, "Demo mode"): its own buzz and screen, the demo switch,
 * the opening intro's hand-over, and opening Orbit's public pages in the browser. Every other op is about a TV, and in
 * demo mode goes to the pretend one.
 */
export const PHONE_OPS: ReadonlySet<string> = new Set(["haptic", "keepAwake", "demo", "intro", "openUrl", "language"]);

/** Events from the phone the page still takes in demo mode: the app leaving the screen and coming back. */
export const PHONE_EVENTS: ReadonlySet<string> = new Set(["lifecycle"]);

export class Bridge {
  /** Inside the Orbit app (Flutter's OrbitNative is there); false in a plain browser, which always plays the demo. */
  readonly native: boolean;
  private demoOn = false;
  private next = 1;
  private readonly pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly toPhone: ((text: string) => void) | null;
  private toMock: ((text: string) => void) | null = null;

  constructor(host: BridgeHost = defaultHost(), private readonly makeMock: MockFactory = createMock) {
    host.orbitReceive = (m: Message | string) => this.receive(typeof m === "string" ? JSON.parse(m) : m, "phone");
    const native = host.OrbitNative;
    if (native && typeof native.postMessage === "function") {
      this.native = true;
      this.toPhone = (text) => native.postMessage!(text);
    } else {
      this.native = false;
      this.toPhone = null;
    }
  }

  /** Demo mode: the TV is the pretend one. Always so in a browser; in the app while "Try Orbit without a TV" is on. */
  get demo(): boolean {
    return !this.native || this.demoOn;
  }

  /**
   * In the app: from now on every TV op goes to the pretend TV (on) or to Flutter (off), and only that side's events
   * reach the screens. Flutter is told separately (the `demo` op), so it leaves the real TV alone meanwhile.
   */
  setDemo(on: boolean) {
    if (!this.native) return;
    this.demoOn = on;
  }

  /** A request with an answer. */
  call<T = any>(op: string, args?: Record<string, unknown>, timeoutMs = 8000): Promise<T> {
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeError(mark("The TV did not answer.")));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.route(op)(JSON.stringify({ id, op, args: args ?? {} }));
    });
  }

  /** Fire and forget: pointer moves, haptics. */
  fire(op: string, args?: Record<string, unknown>) {
    this.route(op)(JSON.stringify({ id: 0, op, args: args ?? {} }));
  }

  on(event: string, listener: Listener): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(listener);
    return () => set!.delete(listener);
  }

  /** Which side answers `op`: Flutter, or the pretend TV (made the first time it is needed). */
  private route(op: string): (text: string) => void {
    if (this.toPhone && (!this.demoOn || PHONE_OPS.has(op))) return this.toPhone;
    if (!this.toMock) this.toMock = this.makeMock((m) => this.receive(m, "mock"));
    return this.toMock;
  }

  private receive(m: Message, from: "phone" | "mock") {
    if (m.id) {
      const waiting = this.pending.get(m.id);
      if (!waiting) return;
      this.pending.delete(m.id);
      clearTimeout(waiting.timer);
      if (m.ok) waiting.resolve(m.data ?? {});
      else {
        const reason = m.reason ?? (m.data as { reason?: string } | undefined)?.reason;
        waiting.reject(new BridgeError(m.error || mark("Something went wrong."), m.status, typeof reason === "string" ? reason : undefined));
      }
      return;
    }
    if (!m.event) return;
    // One TV at a time: in demo mode the real TV's news is let go, out of it the pretend TV's.
    if (this.native && (from === "mock" ? !this.demoOn : this.demoOn && !PHONE_EVENTS.has(m.event))) return;
    this.listeners.get(m.event)?.forEach((l) => l(m.data));
  }
}

function defaultHost(): BridgeHost {
  return typeof window !== "undefined" ? (window as unknown as BridgeHost) : {};
}

export const bridge = new Bridge();

// ---- the small vocabulary the screens use ----

let hapticsOn = true;
export function setHaptics(on: boolean) {
  hapticsOn = on;
}

export function haptic(kind: Haptic) {
  if (hapticsOn) bridge.fire("haptic", { kind });
}

export const tv = {
  key: (key: Key) => bridge.call("key", { key }),
  media: (action: "play_pause" | "next" | "previous" | "forward" | "rewind") => bridge.call("media", { action }),
  volume: (level: number) => bridge.call<{ volume: number; max: number }>("volume", { level }),
  type: (text: string, submit: boolean) => bridge.call("type", { text, submit }),
  open: (url: string) => bridge.call("open", { url }),
  launch: (pkg: string) => bridge.call("launch", { pkg }),
  sleep: () => bridge.call("sleep"),
  apps: () => bridge.call<AppEntry[]>("apps"),
  icon: (pkg: string) => bridge.call<{ src: string }>("icon", { pkg }),
  move: (dx: number, dy: number) => bridge.fire("pointer", { type: "move", dx, dy }),
  scroll: (dx: number, dy: number) => bridge.fire("pointer", { type: "scroll", dx, dy }),
  click: (long = false) => bridge.call("pointer", { type: long ? "longpress" : "click" }),
  hidePointer: () => bridge.call("pointer", { type: "hide" }),
  /** Help mode on or off: while on, the TV's screen comes as `screen` events. */
  help: (on: boolean) => bridge.call<{ ok: boolean; on: boolean }>("help", { on }),
  /** A click at a spot of the TV's screen, in its pixels (1280 x 720). */
  tapAt: (x: number, y: number) => bridge.call("tapAt", { x, y }),
  /** A TV of another make: try it again now (after its prompt was refused, timed out, or a setting changed). */
  again: () => bridge.call<Status>("again"),
  /** A TV of another make: Wake-on-LAN, when its MAC address is known. */
  wake: () => bridge.call<{ sent: boolean }>("wake"),
};

/** Choose a TV the search found (an Orbit TV, or a TV of another make, driven as a remote). */
export const chooseTv = (tv: TvRef) =>
  bridge.call<Status>("connect", {
    address: tv.address,
    port: tv.port,
    ...(tv.kind && tv.kind !== "orbit" ? { kind: tv.kind, name: tv.name, model: tv.model ?? null } : {}),
  });

/** A TV found by Orbit Setup's scan (phone/SPEC.md, "Orbit Setup"): `orbit` when it already answers as Orbit OS. */
export interface SetupTvFound {
  name: string;
  address: string;
  model: string | null;
  orbit: boolean;
}

/** The TV's own description, read once the debugging connection is open. */
export interface SetupProps {
  model: string;
  manufacturer: string;
  brand: string;
  device: string;
  sdk: number;
  release: string;
}

/** What this phone keeps about a TV it set up: enough to undo it all. */
export interface SetupRecord {
  address: string;
  name: string;
  model: string | null;
  at: number;
  token: string;
  /** The script's undo record, line by line, as it said it. */
  undo: string[];
  /** The packages it switched off. */
  disabled: string[];
  /** The TV's own launcher before setup. */
  stock?: string | null;
  /** When Undo put the TV back with this record. */
  undone?: number;
  /**
   * What the TV said about itself and its apps when setup read it (app 1.4.0 on), for backups made later without the
   * TV. `when` is "setup" when nothing had changed the TV yet, "now" when an earlier setup had (the record works it back).
   */
  props?: SetupProps | null;
  apps?: { enabled: string[]; disabled: string[]; when: "setup" | "now" } | null;
  /** The home screen after the last switch from Settings: Orbit Home, or the TV's own. */
  home?: "orbit" | "stock";
}

/** Orbit Setup: the TV's debugging connection (ADB over the Wi-Fi), opened and used by Flutter. */
export const setupTv = {
  scan: (seconds = 4) => bridge.call<{ tvs: SetupTvFound[] }>("setupScan", { seconds }, seconds * 1000 + 8000),
  probe: (address: string) => bridge.call<{ open: boolean }>("setupProbe", { address, port: 5555 }, 6000),
  // The TV may wait up to 90 s for a person to press Allow.
  connect: (address: string) => bridge.call<SetupProps>("setupConnect", { address, port: 5555 }, 100_000),
  shell: (cmd: string, timeoutMs = 20_000) => bridge.call<{ out: string }>("setupShell", { cmd, timeoutMs }, timeoutMs + 6000),
  pushAsset: (asset: string, to: string) => bridge.call<{ bytes: number }>("setupPush", { asset, to }, 180_000),
  pushText: (text: string, to: string) => bridge.call<{ bytes: number }>("setupPush", { text, to }, 30_000),
  // Installing two apps and switching thirty off takes a minute or two; the lines come as setupLine events meanwhile.
  run: (cmd: string) => bridge.call<{ exit: number }>("setupRun", { cmd }, 15 * 60_000),
  close: () => bridge.call("setupClose"),
  saveRecord: (key: string, record: SetupRecord) => bridge.call<{ record: SetupRecord | null }>("setupRecord", { key, record }),
  loadRecord: (key: string) => bridge.call<{ record: SetupRecord | null }>("setupRecord", { key }),
  // Orbit Home may still be starting: Flutter tries its door for 30 s.
  adopt: (args: { address: string; port: number; token: string; name: string }) => bridge.call<Status>("setupAdopt", args, 45_000),
};

/** One backup in the person's Google Drive (phone/SPEC.md, "Backups in Google Drive"), as `backupList` lists it. */
export interface DriveBackup {
  /** Drive's file id. */
  id: string;
  /** The TV's name, address and model when the backup was made (the file's appProperties). */
  tv: string;
  address: string;
  model: string | null;
  /** When the backup was made (ms since 1970). */
  at: number;
  /** Bytes in Drive. */
  size: number;
}

/**
 * Backups of a TV's own setup, in the hidden app folder of the Google Drive this phone signs in with. Each call may show
 * Google's own sheet the first time ("Orbit wants to see, create and delete its own configuration data"); a refusal is a
 * BridgeError with `reason` "refused", and the others are "noAccount", "full", "offline", "auth" and "server".
 */
export const drive = {
  save: (args: { text: string; tv: string; address: string; model: string | null; at: number }) =>
    bridge.call<DriveBackup>("backupSave", args, 120_000),
  list: () => bridge.call<{ backups: DriveBackup[]; email: string | null }>("backupList", {}, 120_000),
  load: (id: string) => bridge.call<{ text: string }>("backupLoad", { id }, 60_000),
  remove: (id: string) => bridge.call("backupDelete", { id }, 60_000),
};

/** Tells Flutter which TV the page plays with: the pretend one (on), so it leaves the real TV alone, or the real one. */
export const phoneDemo = (on: boolean) => bridge.call<{ on: boolean }>("demo", { on });

export const cloud = {
  account: () => bridge.call<Account>("account"),
  // Google's own sign-in sheet can take a while: the person is choosing an account.
  signIn: () => bridge.call<Account>("signIn", {}, 120_000),
  signOut: () => bridge.call<Account>("signOut"),
  linkTv: (code: string) => bridge.call<Account>("linkTv", { code }, 40_000),
  unlinkTv: () => bridge.call<Account>("unlinkTv"),
  /**
   * Deletes the Orbit account: the TV backups in Google Drive too when `backups`, everything the cloud keeps under the
   * account, then the account, and signs out (phone/SPEC.md, "Deleting the account"). Google may show its sheet.
   */
  deleteAccount: (backups: boolean) =>
    bridge.call<{ removed: number | null; account: Account }>("deleteAccount", { backups }, 240_000),
};
