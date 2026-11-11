// Demo mode's routing (phone/SPEC.md, "Demo mode"): in the app, with "Try Orbit without a TV" on, every TV op goes to the
// pretend TV and only the phone's own ops reach Flutter; each side's events reach the screens only while it is the TV.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Bridge, PHONE_OPS, type BridgeHost, type Message } from "./bridge";

interface Sent {
  id: number;
  op: string;
  args: Record<string, unknown>;
}

/** A Flutter stand-in: it keeps what the page sends, and can answer and push events like Flutter. */
function phone() {
  const sent: Sent[] = [];
  const host: BridgeHost = { OrbitNative: { postMessage: (text: string) => sent.push(JSON.parse(text)) } };
  const say = (m: Message) => host.orbitReceive!(JSON.stringify(m));
  return { host, sent, say };
}

/** A pretend TV stand-in: it keeps what it is sent, and delivers like mock.ts does. */
function pretend() {
  const sent: Sent[] = [];
  let deliver: ((m: Message) => void) | null = null;
  let made = 0;
  const factory = (d: (m: Message) => void) => {
    made++;
    deliver = d;
    return (text: string) => sent.push(JSON.parse(text));
  };
  return { factory, sent, say: (m: Message) => deliver!(m), made: () => made };
}

describe("the bridge in the app", () => {
  it("sends everything to Flutter, and never makes the pretend TV, while demo mode is off", async () => {
    const p = phone();
    const m = pretend();
    const bridge = new Bridge(p.host, m.factory);
    expect(bridge.native).toBe(true);
    expect(bridge.demo).toBe(false);
    const answer = bridge.call("key", { key: "up" });
    bridge.fire("pointer", { type: "move", dx: 1, dy: 2 });
    expect(p.sent.map((s) => s.op)).toEqual(["key", "pointer"]);
    p.say({ id: p.sent[0].id, ok: true, data: { done: 1 } });
    await expect(answer).resolves.toEqual({ done: 1 });
    expect(m.made()).toBe(0);
  });

  it("sends TV ops to the pretend TV in demo mode, and the phone's own ops to Flutter", async () => {
    const p = phone();
    const m = pretend();
    const bridge = new Bridge(p.host, m.factory);
    bridge.setDemo(true);
    expect(bridge.demo).toBe(true);
    for (const op of ["hello", "key", "apps", "help", "setupScan", "setupRun", "account", "signIn", "backupSave", "backupList", "deleteAccount", "settings"]) {
      bridge.call(op).catch(() => {});
    }
    for (const op of PHONE_OPS) bridge.call(op).catch(() => {});
    bridge.fire("haptic", { kind: "tick" });
    expect(m.sent.map((s) => s.op)).toEqual(["hello", "key", "apps", "help", "setupScan", "setupRun", "account", "signIn", "backupSave", "backupList", "deleteAccount", "settings"]);
    expect(p.sent.map((s) => s.op).sort()).toEqual([...PHONE_OPS, "haptic"].sort());
    expect(m.made()).toBe(1);

    // Each answer finds its own request, whichever side gave it.
    const fromMock = bridge.call<{ status: string }>("status");
    const fromPhone = bridge.call<{ on: boolean }>("demo", { on: true });
    m.say({ id: m.sent[m.sent.length - 1].id, ok: true, data: { status: "pretend" } });
    p.say({ id: p.sent[p.sent.length - 1].id, ok: true, data: { on: true } });
    await expect(fromMock).resolves.toEqual({ status: "pretend" });
    await expect(fromPhone).resolves.toEqual({ on: true });
  });

  it("lets only the TV in use speak to the screens", () => {
    const p = phone();
    const m = pretend();
    const bridge = new Bridge(p.host, m.factory);
    const heard: string[] = [];
    for (const e of ["status", "tvstate", "lifecycle", "screen"]) bridge.on(e, (d) => heard.push(`${e}:${d.from}`));

    p.say({ event: "status", data: { from: "phone" } });
    bridge.setDemo(true);
    bridge.call("hello").catch(() => {});
    m.say({ event: "status", data: { from: "mock" } });
    p.say({ event: "status", data: { from: "phone" } });
    p.say({ event: "tvstate", data: { from: "phone" } });
    p.say({ event: "screen", data: { from: "phone" } });
    // The app going to the background is the phone's news either way.
    p.say({ event: "lifecycle", data: { from: "phone" } });
    bridge.setDemo(false);
    m.say({ event: "tvstate", data: { from: "mock" } });
    p.say({ event: "tvstate", data: { from: "phone" } });
    expect(heard).toEqual(["status:phone", "status:mock", "lifecycle:phone", "tvstate:phone"]);
  });

  it("turns an error with a reason into a BridgeError with that reason", async () => {
    const p = phone();
    const bridge = new Bridge(p.host, pretend().factory);
    const saving = bridge.call("backupSave", { text: "{}" });
    p.say({ id: p.sent[0].id, ok: false, error: "Your Google Drive is full.", reason: "full", status: 507 });
    await expect(saving).rejects.toMatchObject({ message: "Your Google Drive is full.", reason: "full", status: 507 });
  });
});

describe("the bridge in a browser", () => {
  it("is always the demo: everything goes to the pretend TV, made on first use", () => {
    const m = pretend();
    const host: BridgeHost = {};
    const bridge = new Bridge(host, m.factory);
    expect(bridge.native).toBe(false);
    expect(bridge.demo).toBe(true);
    expect(m.made()).toBe(0);
    bridge.setDemo(false);
    bridge.call("haptic").catch(() => {});
    bridge.call("key", { key: "ok" }).catch(() => {});
    expect(m.sent.map((s) => s.op)).toEqual(["haptic", "key"]);
    expect(typeof host.orbitReceive).toBe("function");
  });
});

// ---- the pretend Google Drive of the demo (mock.ts) ----

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
}

describe("the demo's pretend Google Drive", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("window", {
      setTimeout: (f: () => void, ms: number) => setTimeout(f, ms),
      clearTimeout: (t: ReturnType<typeof setTimeout>) => clearTimeout(t),
      setInterval: (f: () => void, ms: number) => setInterval(f, ms),
      clearInterval: (t: ReturnType<typeof setInterval>) => clearInterval(t),
      dispatchEvent: () => true,
    });
    vi.stubGlobal("CustomEvent", class {
      constructor(
        readonly type: string,
        readonly init: unknown,
      ) {}
    });
    // The pretend TV draws its screen for help mode on a canvas: a canvas that draws nothing will do here.
    const nothing = new Proxy({}, { get: () => () => undefined });
    vi.stubGlobal("document", {
      createElement: () => ({ width: 0, height: 0, getContext: () => nothing, toDataURL: () => "data:image/jpeg;base64," }),
    });
    vi.stubGlobal("location", { search: "?fresh" });
    vi.stubGlobal("localStorage", new MemoryStorage());
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("asks for Google first, then saves, lists, opens and deletes a backup, and goes with the account", async () => {
    const { createMock } = await import("./mock");
    const got: Message[] = [];
    const post = createMock((m) => got.push(m));
    let id = 0;
    const ask = async (op: string, args: Record<string, unknown> = {}) => {
      const mine = ++id;
      post(JSON.stringify({ id: mine, op, args }));
      await vi.advanceTimersByTimeAsync(3000);
      return got.find((m) => m.id === mine)!;
    };

    expect(await ask("backupList")).toMatchObject({ ok: false, reason: "noAccount" });
    expect((await ask("signIn")).ok).toBe(true);
    const text = JSON.stringify({ kind: "orbit-tv-backup", version: 1, undo: ["enable com.miui.tv.analytics"], tv: { name: "Family room" } });
    const saved = await ask("backupSave", { text, tv: "Family room", address: "192.168.1.20", model: "MiTV-AXFU0", at: 1762862640000 });
    expect(saved.ok).toBe(true);
    expect(saved.data).toMatchObject({ tv: "Family room", model: "MiTV-AXFU0", at: 1762862640000, size: new TextEncoder().encode(text).length });
    const fileId = (saved.data as { id: string }).id;

    const list = await ask("backupList");
    expect(list.data).toMatchObject({ email: "you@gmail.com", backups: [{ id: fileId, tv: "Family room" }] });
    expect(await ask("backupLoad", { id: fileId })).toMatchObject({ ok: true, data: { text } });
    expect(await ask("backupLoad", { id: "nope" })).toMatchObject({ ok: false, reason: "notFound" });

    const gone = await ask("deleteAccount", { backups: true });
    expect(gone).toMatchObject({ ok: true, data: { removed: 1, account: { signedIn: false } } });
    expect(got.some((m) => m.event === "account" && (m.data as { signedIn: boolean }).signedIn === false)).toBe(true);
    expect(await ask("backupList")).toMatchObject({ ok: false, reason: "noAccount" });
  });
});
