// A pretend TV for a plain browser (the demo page): it answers every op in phone/SPEC.md the way the real door does,
// and tells the demo's TV picture what happened through window events ("orbit-mock").
import type { Account, AppEntry, DriveBackup, Message, Status, TvState } from "./bridge";
import { MockScreen } from "./mock-screen";
import { createSetupMock } from "./mock-setup";

export type MockEvent =
  | { type: "focus"; index: number }
  | { type: "open"; label: string }
  | { type: "home" }
  | { type: "back" }
  | { type: "recents" }
  | { type: "cursor"; x: number; y: number }
  | { type: "click"; x: number; y: number; long: boolean }
  | { type: "scroll"; dy: number }
  | { type: "code"; code: string | null }
  | { type: "linkcode"; code: string | null }
  | { type: "volume"; volume: number; muted: boolean }
  | { type: "typed"; text: string }
  | { type: "overlay"; text: string }
  | { type: "menu"; index: number }
  /** Orbit OS's Control Center, on the remote's Settings key: open with a tile chosen, or closed (index -1). */
  | { type: "control"; index: number }
  | { type: "help"; on: boolean }
  | { type: "sleep" }
  /** Orbit Setup: Android's "Allow USB debugging?" on the TV, and the greeting's new name. */
  | { type: "adb"; on: boolean }
  | { type: "greetname"; name: string };

/** The Control Center's tiles, two rows of three; the gear (the TV's full Settings) is the first, as on the TV. */
export const MOCK_CONTROL = ["Settings", "Wi-Fi", "Bluetooth", "Picture", "Sound", "Sleep timer"];
const CONTROL_SAYS: Record<string, string> = {
  "Wi-Fi": "Wi-Fi: Home network, connected",
  Bluetooth: "Bluetooth: on",
  Picture: "Picture: Vivid",
  Sound: "Sound: Standard",
  "Sleep timer": "Sleep timer: in 30 minutes",
};

/** The pretend TV's Settings list (its rows move with up and down, as on the TV). */
export const MOCK_SETTINGS = ["Network & Internet", "Accounts & Sign In", "Apps", "Display & Sound", "Remotes & Accessories", "System"];

export const MOCK_APPS: (AppEntry & { tint: [string, string] })[] = [
  // Neutral names only: the demo is what store reviewers and screenshots see, so no other company's apps are on it.
  { pkg: "demo.orbit.livetv", label: "Live TV", tint: ["#b86bff", "#2a0b52"] },
  { pkg: "demo.orbit.movies", label: "Movies", tint: ["#ff5a4e", "#5a0f12"] },
  { pkg: "demo.orbit.music", label: "Music", tint: ["#1ed7a0", "#063426"] },
  { pkg: "demo.orbit.news", label: "News", tint: ["#1aa3ff", "#062a52"] },
  { pkg: "demo.orbit.photos", label: "Photos", tint: ["#f2c14e", "#3d2a06"] },
  { pkg: "demo.orbit.kids", label: "Kids", tint: ["#ff8ad8", "#4a0b3a"] },
  { pkg: "demo.orbit.sports", label: "Sports", tint: ["#3e5bff", "#120a3d"] },
  { pkg: "demo.orbit.games", label: "Games", tint: ["#8b3dff", "#22074d"] },
  { pkg: "demo.orbit.apps", label: "Apps", tint: ["#34a853", "#0b2f19"] },
  { pkg: "demo.orbit.browser", label: "Browser", tint: ["#9aa3b5", "#1b2030"] },
  { pkg: "demo.orbit.share", label: "Screen share", tint: ["#74d1ff", "#0b2638"] },
  { pkg: "demo.orbit.podcasts", label: "Podcasts", tint: ["#ff8800", "#3d1d00"] },
];

const TOKEN_KEY = "orbit-mock-token";
/** The pretend Google Drive's hidden Orbit folder: the backups made in the demo. */
const DRIVE_KEY = "orbit-mock-drive";

type DriveFile = DriveBackup & { text: string };

function driveFiles(): DriveFile[] {
  try {
    const list = JSON.parse(localStorage.getItem(DRIVE_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function keepDrive(files: DriveFile[]) {
  try {
    localStorage.setItem(DRIVE_KEY, JSON.stringify(files));
  } catch {
    /* kept for this run only */
  }
}

const listed = ({ text: _text, ...b }: DriveFile): DriveBackup => b;
const TV = { name: "Family room", address: "192.168.1.20", port: 8090, udp: 8091 };

export function emitMock(e: MockEvent) {
  window.dispatchEvent(new CustomEvent<MockEvent>("orbit-mock", { detail: e }));
}

function banner(label: string, tint: [string, string]): string {
  const c = document.createElement("canvas");
  c.width = 320;
  c.height = 180;
  const g = c.getContext("2d")!;
  const grad = g.createLinearGradient(0, 0, 320, 180);
  grad.addColorStop(0, tint[0]);
  grad.addColorStop(1, tint[1]);
  g.fillStyle = grad;
  g.fillRect(0, 0, 320, 180);
  const shine = g.createRadialGradient(80, 20, 0, 80, 20, 260);
  shine.addColorStop(0, "rgba(255,255,255,0.28)");
  shine.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = shine;
  g.fillRect(0, 0, 320, 180);
  g.fillStyle = "#fff";
  g.font = "600 34px Outfit, Inter, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(label, 160, 92);
  return c.toDataURL("image/png");
}

export function createMock(deliver: (m: Message) => void): (text: string) => void {
  let token: string | null = null;
  try {
    // ?fresh is a TV that has never seen Orbit (mock-setup.ts): no phone is paired with it yet.
    if (new URLSearchParams(location.search).has("fresh")) localStorage.removeItem(TOKEN_KEY);
    token = localStorage.getItem(TOKEN_KEY);
  } catch {
    token = null;
  }
  let status: Status = { state: "searching", tv: null, found: [], via: "wifi", error: null };
  let code: string | null = null;
  let tries = 5;
  let focus = 1;
  let cursor = { x: 640, y: 360 };
  const icons = new Map<string, string>();
  const state: TvState = {
    ok: true,
    tv: TV.name,
    app: "Home",
    pkg: "com.gathin.tvhome",
    title: "Evening Raga",
    artist: "Orbit Live TV",
    playing: false,
    position: 1_260_000,
    duration: 3_600_000,
    player: "Orbit Live TV",
    volume: 24,
    max: 100,
    muted: false,
    udp: 8091,
    pointer: true,
  };
  let ticking = 0;
  let account: Account = { signedIn: false, email: null, tvLinked: false, tvOnline: false, tvName: null };
  let linkCode: string | null = null;
  // Help mode: the TV's screen as pictures, about twice a second, and only when it changed (at least every 5 s).
  const screen = new MockScreen(MOCK_APPS, MOCK_SETTINGS);
  let helpTimer = 0;
  let screenSeq = 0;
  let lastPicture = "";
  let lastSent = 0;
  // What happened goes to the demo's TV picture and to the screen help mode photographs.
  const show = (e: MockEvent) => {
    screen.apply(e);
    emitMock(e);
  };
  const inSettings = () => screen.app === "Settings";
  const snap = () => {
    if (!helpTimer) return;
    const jpg = screen.picture(focus, state.playing && !!state.title && screen.app === state.app);
    const now = Date.now();
    if (jpg === lastPicture && now - lastSent < 5000) return;
    lastPicture = jpg;
    lastSent = now;
    deliver({ event: "screen", data: { jpg, w: 640, h: 360, seq: ++screenSeq, at: now } });
  };
  const helpOn = (on: boolean) => {
    if (on === !!helpTimer) return;
    if (on) {
      helpTimer = window.setInterval(snap, 500);
      show({ type: "help", on: true });
      lastPicture = "";
      later(350, snap);
    } else {
      window.clearInterval(helpTimer);
      helpTimer = 0;
      show({ type: "help", on: false });
    }
  };

  const later = (ms: number, f: () => void) => window.setTimeout(f, ms);
  const event = (name: string, data: unknown) => later(0, () => deliver({ event: name, data }));
  const reply = (id: number, data: unknown) => id && later(40 + Math.random() * 50, () => deliver({ id, ok: true, data }));
  const fail = (id: number, error: string, status?: number) => id && later(60, () => deliver({ id, ok: false, error, status }));
  const refuse = (id: number, error: string, reason: string) => id && later(80, () => deliver({ id, ok: false, error, reason }));
  const noAccount = (id: number) => refuse(id, "Sign in with Google first. Orbit keeps the backups in that account's own Google Drive.", "noAccount");
  const setStatus = (s: Partial<Status>) => {
    status = { ...status, ...s };
    event("status", status);
  };
  const pushState = () => event("tvstate", { ...state });

  const connected = () => {
    setStatus({ state: "connected", tv: TV, error: null });
    pushState();
    window.clearInterval(ticking);
    ticking = window.setInterval(() => {
      if (state.playing) state.position = Math.min(state.duration, state.position + 2000);
      pushState();
    }, 2000);
  };

  // Through the pretend cloud: the same state, without the Wi-Fi.
  const connectedCloud = () => {
    pushState();
    window.clearInterval(ticking);
    ticking = window.setInterval(() => {
      if (state.playing) state.position = Math.min(state.duration, state.position + 2000);
      pushState();
    }, 2000);
  };

  const find = () => {
    setStatus({ state: "searching", found: [], tv: null, error: null });
    later(1400, () => {
      // A TV without Orbit OS has no door to find: the phone keeps looking (and offers Orbit Setup).
      if (!setup.orbitOn()) return;
      if (token) connected();
      else setStatus({ state: "found", found: [TV] });
    });
  };

  // Orbit Setup's ops: the TV's debugging connection, its apps and its scripts.
  // `orbit-setup.sh switch stock|orbit`, for a pretend TV that does not know it yet (an older mock-setup.ts answers
  // "not found"): the switch is played here instead, with the lines the real script says.
  let switching: { id: number; to: string; swallow: boolean } | null = null;
  const playSwitch = (id: number, to: string) => {
    const lines =
      to === "stock"
        ? ["@orbit step switch start", "on com.google.android.apps.tv.launcherx", "@orbit step switch ok", "@orbit done ok"]
        : ["@orbit step switch start", "off com.google.android.apps.tv.launcherx", "@orbit step switch ok", "@orbit done ok"];
    lines.forEach((line, i) => later(380 + i * 420, () => deliver({ event: "setupLine", data: { line } })));
    later(380 + lines.length * 420, () => {
      deliver({ event: "setupLine", data: { line: "@orbit-exit 0" } });
      deliver({ id, ok: true, data: { exit: 0 } });
    });
  };
  const fromSetup = (m: Message) => {
    const job = switching;
    if (job) {
      const line = m.event === "setupLine" ? String((m.data as { line?: unknown } | undefined)?.line ?? "") : "";
      if (!job.swallow && /orbit-setup\.sh switch \w+: not found$/.test(line)) {
        job.swallow = true;
        playSwitch(job.id, job.to);
        return;
      }
      if (job.swallow && (line.startsWith("@orbit-exit") || m.id === job.id)) {
        if (m.id === job.id) switching = null;
        return;
      }
      if (m.id === job.id) switching = null;
    }
    deliver(m);
  };

  const setup = createSetupMock({
    tv: TV,
    deliver: fromSetup,
    show: (e) => show(e),
    adopt: (given) => {
      token = given;
      try {
        localStorage.setItem(TOKEN_KEY, given);
      } catch {
        /* paired until reload */
      }
      connected();
      return status;
    },
    gone: () => {
      window.clearInterval(ticking);
      if (status.state === "connected" && status.via !== "cloud") setStatus({ state: "offline", error: "The TV does not answer." });
    },
  });

  // An app comes to the front: only Live TV has something on, paused, as a person's TV would.
  const open = (i: number) => {
    const app = MOCK_APPS[i];
    const live = app.label === "Live TV";
    state.app = app.label;
    state.pkg = app.pkg;
    state.player = live ? "Orbit Live TV" : app.label;
    state.title = live ? "Evening Raga" : "";
    state.artist = live ? "Orbit Live TV" : "";
    state.playing = false;
    show({ type: "open", label: app.label });
    pushState();
  };

  // The Control Center over whatever is on: the arrows move between its tiles, OK uses one, Back closes it.
  let control = -1;
  const controlTo = (i: number) => show({ type: "control", index: (control = i) });
  const controlKeys: Record<string, () => void> = {
    left: () => controlTo(control % 3 === 0 ? control : control - 1),
    right: () => controlTo(control % 3 === 2 ? control : control + 1),
    up: () => controlTo(control >= 3 ? control - 3 : control),
    down: () => controlTo(control < 3 ? control + 3 : control),
    ok: () => {
      const tile = MOCK_CONTROL[control];
      if (tile === "Settings") {
        controlTo(-1);
        openSettings();
      } else show({ type: "overlay", text: CONTROL_SAYS[tile] ?? tile });
    },
    back: () => controlTo(-1),
    home: () => {
      controlTo(-1);
      keys.home();
    },
    settings: () => controlTo(-1),
  };

  // Settings in front: up and down move its rows, OK opens one.
  const menuTo = (row: number) => show({ type: "menu", index: Math.max(0, Math.min(MOCK_SETTINGS.length - 1, row)) });
  const openRow = () => show({ type: "overlay", text: MOCK_SETTINGS[screen.menu] });

  // A click on the TV's screen, as the real TV does it: on Home the row turns to the card under the ring and the middle
  // card opens; in Settings a row is chosen, and a chosen one opens.
  const clickAt = (x: number, y: number) => {
    const hit = screen.hit(x, y, focus);
    if (!hit) return;
    if ("card" in hit) {
      if (hit.card === focus) open(focus);
      else show({ type: "focus", index: (focus = hit.card) });
    } else if (hit.row === screen.menu) openRow();
    else menuTo(hit.row);
  };

  const openSettings = () => {
    state.app = "Settings";
    state.pkg = "com.android.tv.settings";
    state.title = "";
    state.playing = false;
    show({ type: "open", label: "Settings" });
    pushState();
  };

  const keys: Record<string, () => void> = {
    left: () => !inSettings() && show({ type: "focus", index: (focus = Math.max(0, focus - 1)) }),
    right: () => !inSettings() && show({ type: "focus", index: (focus = Math.min(MOCK_APPS.length - 1, focus + 1)) }),
    up: () => (inSettings() ? menuTo(screen.menu - 1) : show({ type: "focus", index: focus })),
    down: () => (inSettings() ? menuTo(screen.menu + 1) : show({ type: "focus", index: focus })),
    ok: () => (inSettings() ? openRow() : open(focus)),
    back: () => show({ type: "back" }),
    home: () => {
      state.app = "Home";
      state.pkg = "com.gathin.tvhome";
      show({ type: "home" });
    },
    recents: () => show({ type: "recents" }),
    // Orbit OS: the remote's Settings key opens the Control Center; its gear opens the TV's full Settings.
    settings: () => controlTo(0),
    mute: () => {
      state.muted = !state.muted;
      show({ type: "volume", volume: state.volume, muted: state.muted });
    },
    volup: () => {
      state.muted = false;
      state.volume = Math.min(state.max, state.volume + 3);
      show({ type: "volume", volume: state.volume, muted: state.muted });
    },
    voldown: () => {
      state.volume = Math.max(0, state.volume - 3);
      show({ type: "volume", volume: state.volume, muted: state.muted });
    },
  };

  return (text: string) => {
    const { id, op, args = {} } = JSON.parse(text) as { id: number; op: string; args: any };
    switch (op) {
      case "hello":
        reply(id, status);
        find();
        return;
      case "status":
        return reply(id, status);
      case "discover":
        find();
        return reply(id, { found: [] });
      case "connect":
      case "manualAddress":
        if (token) connected();
        else setStatus({ state: "needsPairing", tv: TV, error: null });
        return reply(id, status);
      case "askCode":
        code = String(Math.floor(100000 + Math.random() * 900000));
        tries = 5;
        show({ type: "code", code });
        setStatus({ state: "needsPairing", tv: TV, error: null });
        return reply(id, {});
      case "pair":
        if (!code) return fail(id, "There is no pairing code on the TV now. Ask the TV for one.", 409);
        if (String(args.code) !== code) {
          tries--;
          if (tries <= 0) {
            code = null;
            show({ type: "code", code: null });
            return fail(id, "Too many wrong codes. Ask the TV for a new one.", 429);
          }
          return fail(id, `That is not the code on the TV. ${tries === 1 ? "One try left." : `${tries} tries left.`}`, 403);
        }
        code = null;
        show({ type: "code", code: null });
        token = "mock";
        try {
          localStorage.setItem(TOKEN_KEY, token);
        } catch {
          /* private window: paired until reload */
        }
        connected();
        return reply(id, status);
      case "forget":
        token = null;
        try {
          localStorage.removeItem(TOKEN_KEY);
        } catch {
          /* nothing kept */
        }
        window.clearInterval(ticking);
        find();
        return reply(id, status);
      case "state":
        return reply(id, { ...state });
      case "apps":
        return reply(id, MOCK_APPS.map(({ pkg, label }) => ({ pkg, label })));
      case "icon": {
        const app = MOCK_APPS.find((a) => a.pkg === args.pkg);
        if (!app) return fail(id, "That app has no picture.", 404);
        if (!icons.has(app.pkg)) icons.set(app.pkg, banner(app.label, app.tint));
        return reply(id, { src: icons.get(app.pkg) });
      }
      case "key":
        if (control >= 0 && controlKeys[args.key]) controlKeys[args.key]();
        else keys[args.key]?.();
        return reply(id, {});
      case "volumeStep":
        keys[args.dir === "up" ? "volup" : "voldown"]();
        return reply(id, {});
      case "media":
        if (args.action === "play_pause") state.playing = !state.playing;
        if (args.action === "forward") state.position = Math.min(state.duration, state.position + 10_000);
        if (args.action === "rewind") state.position = Math.max(0, state.position - 10_000);
        pushState();
        return reply(id, {});
      case "volume":
        state.volume = Math.max(0, Math.min(state.max, Math.round(args.level)));
        state.muted = false;
        show({ type: "volume", volume: state.volume, muted: false });
        return reply(id, { volume: state.volume, max: state.max });
      case "type":
        show({ type: "typed", text: String(args.text ?? "") });
        return reply(id, { ok: true, entered: !!args.submit });
      case "open":
        show({ type: "open", label: "Browser" });
        return reply(id, { ok: true, opened: "Browser" });
      case "launch": {
        const i = MOCK_APPS.findIndex((a) => a.pkg === args.pkg);
        if (i >= 0) {
          focus = i;
          show({ type: "focus", index: i });
          open(i);
        }
        return reply(id, {});
      }
      case "sleep":
        show({ type: "sleep" });
        return reply(id, {});
      case "pointer":
        if (args.type === "move") {
          cursor = { x: Math.max(0, Math.min(1279, cursor.x + args.dx)), y: Math.max(0, Math.min(719, cursor.y + args.dy)) };
          show({ type: "cursor", ...cursor });
        } else if (args.type === "scroll") {
          show({ type: "scroll", dy: args.dy });
        } else if (args.type === "click" || args.type === "longpress") {
          show({ type: "click", ...cursor, long: args.type === "longpress" });
          if (args.type === "click") clickAt(cursor.x, cursor.y);
          reply(id, {});
        } else reply(id, {});
        return;
      case "help":
        helpOn(!!args.on);
        return reply(id, { ok: true, on: !!args.on });
      case "tapAt": {
        // The ring jumps to the spot and clicks there.
        const x = Math.max(0, Math.min(1279, Math.round(Number(args.x) || 0)));
        const y = Math.max(0, Math.min(719, Math.round(Number(args.y) || 0)));
        cursor = { x, y };
        show({ type: "cursor", x, y });
        show({ type: "click", x, y, long: false });
        clickAt(x, y);
        return reply(id, { ok: true });
      }
      case "account":
        return reply(id, account);
      case "signIn":
        later(900, () => {
          account = { ...account, signedIn: true, email: "you@gmail.com" };
          event("account", account);
          deliver({ id, ok: true, data: account });
          // The pretend TV, not linked yet, shows its code at the top of Home.
          if (!account.tvLinked) show({ type: "linkcode", code: (linkCode = String(Math.floor(10_000_000 + Math.random() * 89_999_999))) });
        });
        return;
      case "signOut":
        account = { signedIn: false, email: null, tvLinked: false, tvOnline: false, tvName: null };
        event("account", account);
        return reply(id, account);
      case "linkTv":
        if (!linkCode || String(args.code) !== linkCode) return fail(id, "That code is not on the TV.", 403);
        later(1100, () => {
          linkCode = null;
          show({ type: "linkcode", code: null });
          account = { ...account, tvLinked: true, tvOnline: true, tvName: TV.name };
          event("account", account);
          deliver({ id, ok: true, data: account });
          setStatus({ state: "connected", via: "cloud", tv: { name: TV.name, address: "cloud", port: 0, udp: null } });
          connectedCloud();
        });
        return;
      case "unlinkTv":
        account = { ...account, tvLinked: false, tvOnline: false, tvName: null };
        event("account", account);
        find();
        return reply(id, account);
      case "haptic": {
        const pattern = { tick: 6, light: 10, medium: 18, heavy: 28, success: [12, 40, 12], error: [30, 50, 30] }[
          args.kind as string
        ];
        if (pattern && "vibrate" in navigator) navigator.vibrate(pattern as number | number[]);
        return id ? reply(id, {}) : undefined;
      }
      case "keepAwake":
      case "settings":
        return reply(id, {});
      // ---- the pretend Google Drive (phone/SPEC.md, "Backups in Google Drive") ----
      case "backupSave": {
        if (!account.signedIn) return noAccount(id);
        const text = String(args.text ?? "");
        later(700, () => {
          const file: DriveFile = {
            id: `demo-${Date.now().toString(36)}`,
            tv: String(args.tv ?? "TV"),
            address: String(args.address ?? ""),
            model: typeof args.model === "string" ? args.model : null,
            at: Number(args.at) || Date.now(),
            size: new TextEncoder().encode(text).length,
            text,
          };
          keepDrive([file, ...driveFiles()]);
          deliver({ id, ok: true, data: listed(file) });
        });
        return;
      }
      case "backupList":
        if (!account.signedIn) return noAccount(id);
        later(500, () => deliver({ id, ok: true, data: { backups: driveFiles().map(listed), email: account.email } }));
        return;
      case "backupLoad": {
        if (!account.signedIn) return noAccount(id);
        const file = driveFiles().find((f) => f.id === args.id);
        if (!file) return refuse(id, "That backup is no longer in your Google Drive.", "notFound");
        return reply(id, { text: file.text });
      }
      case "backupDelete":
        if (!account.signedIn) return noAccount(id);
        keepDrive(driveFiles().filter((f) => f.id !== args.id));
        return reply(id, {});
      case "deleteAccount": {
        if (!account.signedIn) return fail(id, "Sign in with Google first.", 401);
        later(1400, () => {
          const removed = args.backups ? driveFiles().length : null;
          if (args.backups) keepDrive([]);
          account = { signedIn: false, email: null, tvLinked: false, tvOnline: false, tvName: null };
          event("account", account);
          deliver({ id, ok: true, data: { removed, account } });
        });
        return;
      }
      default:
        if (op === "setupRun") {
          const m = /orbit-setup\.sh switch (stock|orbit)\s*$/.exec(String(args.cmd ?? ""));
          if (m) switching = { id, to: m[1], swallow: false };
        }
        if (setup.handle(id, op, args)) return;
        return fail(id, `Unknown op ${op}`, 400);
    }
  };
}
