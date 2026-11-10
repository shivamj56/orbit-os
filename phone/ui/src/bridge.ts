// The page's only way out: window.OrbitNative (the Flutter app) or, in a plain browser, the mock TV in mock.ts.
// The contract is phone/SPEC.md.
import { createMock } from "./mock";

export type ConnState = "searching" | "found" | "needsPairing" | "pairing" | "connected" | "offline";

export interface TvRef {
  name: string;
  address: string;
  port: number;
  udp?: number | null;
}

export interface Status {
  state: ConnState;
  tv: TvRef | null;
  found?: TvRef[];
  via?: "wifi" | "cloud";
  error?: string | null;
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
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

export interface Message {
  id?: number;
  ok?: boolean;
  data?: unknown;
  error?: string;
  status?: number;
  event?: string;
}

type Listener = (data: any) => void;

class Bridge {
  readonly native: boolean;
  private next = 1;
  private readonly pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: number }>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly post: (text: string) => void;

  constructor() {
    const w = window as any;
    w.orbitReceive = (m: Message | string) => this.receive(typeof m === "string" ? JSON.parse(m) : m);
    if (w.OrbitNative && typeof w.OrbitNative.postMessage === "function") {
      this.native = true;
      this.post = (text) => w.OrbitNative.postMessage(text);
    } else {
      this.native = false;
      this.post = createMock((m) => this.receive(m));
    }
  }

  /** A request with an answer. */
  call<T = any>(op: string, args?: Record<string, unknown>, timeoutMs = 8000): Promise<T> {
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(id);
        reject(new BridgeError("The TV did not answer."));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.post(JSON.stringify({ id, op, args: args ?? {} }));
    });
  }

  /** Fire and forget: pointer moves, haptics. */
  fire(op: string, args?: Record<string, unknown>) {
    this.post(JSON.stringify({ id: 0, op, args: args ?? {} }));
  }

  on(event: string, listener: Listener): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(listener);
    return () => set!.delete(listener);
  }

  private receive(m: Message) {
    if (m.id) {
      const waiting = this.pending.get(m.id);
      if (!waiting) return;
      this.pending.delete(m.id);
      window.clearTimeout(waiting.timer);
      if (m.ok) waiting.resolve(m.data ?? {});
      else waiting.reject(new BridgeError(m.error || "Something went wrong.", m.status));
      return;
    }
    if (m.event) this.listeners.get(m.event)?.forEach((l) => l(m.data));
  }
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
};

export const cloud = {
  account: () => bridge.call<Account>("account"),
  // Google's own sign-in sheet can take a while: the person is choosing an account.
  signIn: () => bridge.call<Account>("signIn", {}, 120_000),
  signOut: () => bridge.call<Account>("signOut"),
  linkTv: (code: string) => bridge.call<Account>("linkTv", { code }, 40_000),
  unlinkTv: () => bridge.call<Account>("unlinkTv"),
};
