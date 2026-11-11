// The demo's pretend TV for Orbit Setup (phone/SPEC.md, "Orbit Setup"): a MiTV-AXFU0 that is found on the Wi-Fi, turns
// developer mode on after a few looks, asks "Allow USB debugging?" for two seconds, lists its apps from the family room
// TV's own list, and runs a pretend orbit-setup.sh and orbit-undo.sh that say what the real ones say, step by step.
//
// In the address bar: ?fresh starts with a TV that has never seen Orbit; ?mock-fail=home (or check, disable, live)
// makes that step fail; ?mock-connect=refused (or timeout, tls, unreachable) makes the first Allow go that way.
import debloat from "../../../devices/xiaomi-mitv-axfu0/debloat.txt?raw";
import type { Message, SetupProps, SetupRecord, Status } from "./bridge";
import type { MockEvent } from "./mock";

const ORBIT_HOME = "com.gathin.tvhome";
const ORBIT_LIVE = "com.gathin.livetv";
const STOCK_HOME = "com.google.android.apps.tv.launcherx/.MainActivity";
const HELPER = `${ORBIT_HOME}/.HomeKeyService`;
const DIR = "/data/local/tmp/orbit";
const LATE = /^(com\.google\.android\.apps\.tv\.launcherx(\.overlay)?|com\.google\.android\.tungsten\.setupwraith|com\.google\.android\.apps\.tv\.dreamx)$/;
const CORE = /^(android|com\.android\.systemui|com\.android\.settings|com\.android\.tv\.settings|com\.android\.providers\.(?!calendar$).*)$/;
const STATE_KEY = "orbit-mock-setup";
const RECORDS_KEY = "orbit-mock-setup-records";

const SWITCHED_OFF = debloat
  .split("\n")
  .map((l) => l.replace(/#.*/, "").trim())
  .filter(Boolean);

/** What the family room TV keeps on: its streaming apps, the system, and the two Xiaomi services it needs. */
const KEPT = [
  "com.netflix.ninja",
  "com.google.android.youtube.tv",
  "com.amazon.amazonvideo.livingroom",
  "in.startv.hotstar",
  "com.android.vending",
  "com.android.tv.settings",
  "com.mitv.livetv",
  "com.mitv.overseaservice",
  "com.google.android.katniss",
  "com.google.android.tv.remote.service",
  "com.google.android.gms",
  "com.google.android.gsf",
  "android",
  "com.android.systemui",
  "com.android.providers.settings",
  "com.android.providers.media",
];

const PROPS: SetupProps = { model: "MiTV-AXFU0", manufacturer: "Xiaomi", brand: "Xiaomi", device: "arctictale", sdk: 34, release: "14" };

const SIZES: Record<string, number> = { "orbit-home.apk": 3_506_975, "orbit-live.apk": 1_284_310, "orbit-setup.sh": 12_533, "orbit-undo.sh": 3_066 };

interface PretendTv {
  installed: string[];
  disabled: string[];
  home: string;
  /** /data/local/tmp/orbit/undo.txt */
  undo: string[];
  a11y: string;
  /** "Always allow from this computer" was ticked once. */
  allowed: boolean;
  /** USB debugging (adb_enabled). */
  adb: boolean;
  name: string;
  token: string | null;
}

function fresh(): PretendTv {
  return { installed: [...KEPT, ...SWITCHED_OFF], disabled: [], home: STOCK_HOME, undo: [], a11y: "", allowed: false, adb: false, name: "", token: null };
}

/** The TV as the demo has always shown it: Orbit OS on it, set up on 8 November. */
function setUp(): PretendTv {
  return {
    ...fresh(),
    installed: [...KEPT, ...SWITCHED_OFF, ORBIT_HOME, ORBIT_LIVE],
    disabled: [...SWITCHED_OFF],
    home: `${ORBIT_HOME}/.MainActivity`,
    undo: [`home ${STOCK_HOME}`, ...SWITCHED_OFF.map((p) => `enable ${p}`), `uninstall ${ORBIT_HOME}`, "a11y ", "a11y_on 0", "setting secure screensaver_components ", `uninstall ${ORBIT_LIVE}`],
    a11y: HELPER,
    allowed: true,
  };
}

function load(): PretendTv {
  const params = new URLSearchParams(location.search);
  if (params.has("fresh")) return fresh();
  try {
    const kept = JSON.parse(localStorage.getItem(STATE_KEY) || "null");
    if (kept && Array.isArray(kept.installed)) return { ...fresh(), ...kept };
  } catch {
    /* a private window: the TV as the demo shows it */
  }
  return setUp();
}

interface Hooks {
  tv: { name: string; address: string };
  deliver: (m: Message) => void;
  show: (e: MockEvent) => void;
  /** The door takes this token as a paired phone: the mock remote connects. */
  adopt: (token: string) => Status;
  /** Orbit Home came off the TV: its door no longer answers. */
  gone: () => void;
}

type Line = { wait: number; line?: string; act?: () => void };

export interface SetupMock {
  handle: (id: number, op: string, args: Record<string, any>) => boolean;
  /** Orbit Home is on the TV and answers as Orbit OS. */
  orbitOn: () => boolean;
}

export function createSetupMock(hooks: Hooks): SetupMock {
  const params = new URLSearchParams(location.search);
  const failAt = params.get("mock-fail");
  let connectTrouble = params.get("mock-connect");
  let tv = load();
  let connected = false;
  let looks = 0;
  const files = new Map<string, string>();
  const assets = new Set<string>();

  const save = () => {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(tv));
    } catch {
      /* kept for this run only */
    }
  };
  save();
  const later = (ms: number, f: () => void) => window.setTimeout(f, ms);
  const reply = (id: number, data: unknown, ms = 60) => id && later(ms, () => hooks.deliver({ id, ok: true, data }));
  const fail = (id: number, error: string, extra: { status?: number; reason?: string } = {}, ms = 60) =>
    id && later(ms, () => hooks.deliver({ id, ok: false, error, ...extra }));
  const orbitOn = () => tv.installed.includes(ORBIT_HOME) && !tv.disabled.includes(ORBIT_HOME);
  const enabled = () => tv.installed.filter((p) => !tv.disabled.includes(p));
  const text = (path: string) => files.get(`${DIR}/${path}`) ?? "";
  const names = (path: string) =>
    text(path)
      .split("\n")
      .map((l) => l.replace(/#.*/, "").replace(/\s+/g, ""))
      .filter(Boolean);

  const records = (): Record<string, SetupRecord> => {
    try {
      return JSON.parse(localStorage.getItem(RECORDS_KEY) || "{}");
    } catch {
      return {};
    }
  };

  /** Plays a script's lines one after another, then answers like Flutter: "@orbit-exit <code>", then {exit}. */
  const play = (id: number, lines: Line[], code: () => number) => {
    let i = 0;
    const next = () => {
      if (i >= lines.length) {
        const exit = code();
        save();
        hooks.deliver({ event: "setupLine", data: { line: `@orbit-exit ${exit}` } });
        return reply(id, { exit }, 20);
      }
      const l = lines[i++];
      later(l.wait, () => {
        l.act?.();
        if (l.line !== undefined) hooks.deliver({ event: "setupLine", data: { line: l.line } });
        next();
      });
    };
    next();
  };

  // ---- the pretend orbit-setup.sh install ----

  const install = (): { lines: Line[]; code: () => number } => {
    const lines: Line[] = [];
    let code = 0;
    const say = (line: string, wait = 40) => lines.push({ wait, line });
    const act = (f: () => void, wait = 0) => lines.push({ wait, act: f });
    // One line of the undo record: written once on the TV, said every time.
    const remember = (line: string) =>
      lines.push({
        wait: 30,
        act: () => {
          if (!tv.undo.includes(line)) tv.undo.push(line);
        },
        line: `@orbit undo ${line}`,
      });
    const stop = (text: string) => {
      say(`@orbit done fail ${text}`, 200);
      code = 1;
    };
    const plan = Object.fromEntries(
      text("plan.txt")
        .split("\n")
        .map((l) => l.split("="))
        .filter((kv) => kv.length === 2),
    );
    const home = plan.home === "1";
    const live = plan.live === "1";
    for (const l of tv.undo) say(`@orbit undo ${l}`, 10);

    say("@orbit step check start", 300);
    if (failAt === "check") {
      say("@orbit step check fail Android 8 or later is needed", 600);
      stop("This TV's Android is too old for Orbit OS");
      return { lines, code: () => code };
    }
    if (home && !assets.has("orbit-home.apk")) {
      say("@orbit step check fail Orbit Home is missing", 300);
      stop("Orbit Home was not sent to the TV");
      return { lines, code: () => code };
    }
    say("@orbit step check ok", 600);
    say("@orbit progress 5");

    say("@orbit step record start", 300);
    if (!tv.home.startsWith(`${ORBIT_HOME}/`) && !tv.undo.some((l) => l.startsWith("home "))) remember(`home ${tv.home}`);
    say("@orbit step record ok", 400);
    say("@orbit progress 8");

    say("@orbit step disable start", 200);
    const list = names("disable.txt");
    let failed = 0;
    const switchOff = (p: string, wait: number) => {
      if (CORE.test(p)) return say(`skip ${p}: a core package`, wait);
      if (!tv.installed.includes(p)) return say(`skip ${p}: not on this TV`, wait);
      if (tv.disabled.includes(p)) return say(`skip ${p}: already off`, wait);
      if (failAt === "disable" && p === list[list.length - 1]) {
        failed++;
        return say(`could not switch off ${p}: Error: refused`, wait);
      }
      act(() => tv.disabled.push(p), wait);
      remember(`enable ${p}`);
      say(`off ${p}`, 10);
    };
    list.forEach((p, n) => {
      say(`@orbit progress ${8 + Math.floor((30 * (n + 1)) / Math.max(1, list.length))}`, 0);
      if (LATE.test(p)) return say(home ? `later ${p}` : `skip ${p}: the TV keeps its own home screen without Orbit Home`, 150);
      switchOff(p, 160);
    });
    say(failed ? `@orbit step disable ok ${failed} could not be switched off` : "@orbit step disable ok", 200);
    say("@orbit progress 40");

    if (home) {
      say("@orbit step home start", 300);
      if (failAt === "home") {
        say("pm install com.gathin.tvhome: Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]", 1800);
        say("@orbit step home fail Orbit Home did not install");
        stop("Orbit Home did not install; the TV keeps its own home screen");
        return { lines, code: () => code };
      }
      const had = tv.installed.includes(ORBIT_HOME);
      act(() => {
        if (!tv.installed.includes(ORBIT_HOME)) tv.installed.push(ORBIT_HOME);
      }, 1800);
      if (!had) remember(`uninstall ${ORBIT_HOME}`);
      say("@orbit progress 50");
      say("Status: ok", 900);
      list.filter((p) => LATE.test(p)).forEach((p) => switchOff(p, 140));
      act(() => (tv.home = `${ORBIT_HOME}/.MainActivity`), 300);
      say("@orbit step home ok", 200);
      say("@orbit progress 60");

      say("@orbit step helper start", 200);
      if (!tv.undo.some((l) => l.startsWith("a11y "))) remember(`a11y ${tv.a11y}`);
      if (!tv.undo.some((l) => l.startsWith("a11y_on "))) remember(`a11y_on ${tv.a11y ? 1 : 0}`);
      act(() => (tv.a11y = [...tv.a11y.split(":").filter((s) => s && !s.startsWith(`${ORBIT_HOME}/`)), HELPER].join(":")), 1200);
      say("@orbit step helper ok", 100);
      say("@orbit progress 66");

      say("@orbit step grants start", 200);
      for (const perm of ["WRITE_SECURE_SETTINGS", "BLUETOOTH_CONNECT", "READ_TV_LISTINGS", "ACCESS_FINE_LOCATION"]) say(`granted android.permission.${perm}`, 120);
      say("notification listener on", 100);
      if (!tv.undo.some((l) => l.startsWith("setting secure screensaver_components "))) remember("setting secure screensaver_components ");
      say("@orbit step grants ok", 1600);
      say("@orbit progress 78");
    } else {
      say("@orbit step home skip");
      say("@orbit step helper skip");
      say("@orbit step grants skip");
    }

    if (live) {
      say("@orbit step live start", 300);
      if (failAt === "live") say("@orbit step live fail Orbit Live TV did not install", 1200);
      else {
        const had = tv.installed.includes(ORBIT_LIVE);
        act(() => {
          if (!tv.installed.includes(ORBIT_LIVE)) tv.installed.push(ORBIT_LIVE);
        }, 1200);
        if (!had) remember(`uninstall ${ORBIT_LIVE}`);
        say("@orbit step live ok", 50);
      }
    } else say("@orbit step live skip");
    say("@orbit progress 88");

    if (home) {
      say("@orbit step name start", 200);
      const name = text("name.txt").split("\n")[0].trim();
      if (name) {
        act(() => (tv.name = name));
        say("@orbit step name ok", 200);
      } else say("@orbit step name skip", 150);
      say("@orbit step pair start", 200);
      const token = text("token.txt").split("\n")[0].trim().toLowerCase();
      if (/^[0-9a-f]{32}$/.test(token)) {
        act(() => (tv.token = token));
        say("handed over token.txt", 300);
        say("@orbit step pair ok", 50);
      } else say("@orbit step pair fail The phone could not be paired", 300);
      act(() => hooks.show({ type: "greetname", name: tv.name }), 1200);
    } else {
      say("@orbit step name skip");
      say("@orbit step pair skip");
    }
    act(() => {
      files.delete(`${DIR}/token.txt`);
      assets.delete("orbit-home.apk");
      assets.delete("orbit-live.apk");
    });
    say("@orbit progress 100", 100);
    say("@orbit done ok", 100);
    return { lines, code: () => code };
  };

  // ---- the pretend orbit-setup.sh name ----

  const name = (): { lines: Line[]; code: () => number } => {
    if (!tv.installed.includes(ORBIT_HOME)) return { lines: [{ wait: 200, line: "@orbit done fail Orbit Home is not on this TV" }], code: () => 1 };
    const given = text("name.txt").split("\n")[0].trim().slice(0, 40);
    return {
      lines: [
        { wait: 300, line: "handed over name.txt", act: () => (tv.name = given) },
        { wait: 1200, act: () => hooks.show({ type: "greetname", name: given }) },
        { wait: 100, line: "@orbit done ok" },
      ],
      code: () => 0,
    };
  };

  // ---- the pretend orbit-undo.sh ----

  const undo = (): { lines: Line[]; code: () => number } => {
    if (!tv.undo.length) return { lines: [{ wait: 300, line: "@orbit done fail There is no record of what Orbit Setup changed on this TV" }], code: () => 1 };
    const record = [...tv.undo];
    const field = (key: string) => record.filter((l) => l.startsWith(`${key} `)).map((l) => l.slice(key.length + 1));
    const lines: Line[] = [];
    const say = (line: string, wait = 60) => lines.push({ wait, line });
    const act = (f: () => void, wait = 0) => lines.push({ wait, act: f });
    const on = (p: string) => (tv.disabled = tv.disabled.filter((x) => x !== p));

    say("@orbit step home start", 300);
    for (const p of field("enable").filter((p) => LATE.test(p))) {
      act(() => on(p), 150);
      say(`on ${p}`, 10);
    }
    const home = field("home")[0];
    if (home) act(() => (tv.home = home), 600);
    say("@orbit step home ok", 300);
    say("@orbit progress 30");

    say("@orbit step enable start", 200);
    const enable = field("enable");
    for (const p of enable) {
      act(() => on(p), 120);
      say(`on ${p}`, 10);
    }
    say(`@orbit step enable ok ${enable.length} switched on`, 200);
    say("@orbit progress 60");

    say("@orbit step helper start", 200);
    const a11y = field("a11y")[0];
    if (a11y !== undefined) act(() => (tv.a11y = a11y), 500);
    say("@orbit step helper ok", 200);
    say("@orbit progress 75");

    say("@orbit step apps start", 200);
    for (const p of field("uninstall")) {
      if (p !== ORBIT_HOME && p !== ORBIT_LIVE) {
        say(`kept ${p}: only Orbit's own apps are removed`);
        continue;
      }
      act(() => (tv.installed = tv.installed.filter((x) => x !== p)), 700);
      say(`removed ${p}`, 10);
    }
    say("@orbit step apps ok", 200);
    act(() => {
      tv.undo = [];
      tv.name = "";
      tv.token = null;
      hooks.show({ type: "greetname", name: "" });
      if (!orbitOn()) hooks.gone();
    });
    say("@orbit progress 100", 100);
    say("@orbit done ok", 100);
    return { lines, code: () => 0 };
  };

  const needsConnection = (id: number) => {
    if (connected) return false;
    fail(id, "The connection to the TV is closed.");
    return true;
  };

  const handle = (id: number, op: string, args: Record<string, any>): boolean => {
    switch (op) {
      case "setupScan":
        reply(id, { tvs: [{ name: hooks.tv.name, address: hooks.tv.address, model: PROPS.model, orbit: orbitOn() }] }, Math.min(2200, (Number(args.seconds) || 4) * 1000));
        return true;
      case "setupProbe":
        if (args.address !== hooks.tv.address) {
          reply(id, { open: false }, 1500);
          return true;
        }
        // The person at the TV turns USB debugging on while the phone looks: on the third look it is on.
        if (!tv.adb && ++looks >= 3) {
          tv.adb = true;
          save();
        }
        reply(id, { open: tv.adb }, 120);
        return true;
      case "setupConnect": {
        if (args.address !== hooks.tv.address || !tv.adb) {
          fail(id, "Nothing answered on the TV's port 5555.", { reason: "unreachable" }, 1200);
          return true;
        }
        const trouble = connectTrouble;
        connectTrouble = null;
        const asks = !tv.allowed || trouble === "refused" || trouble === "timeout";
        if (asks) {
          later(500, () => {
            hooks.deliver({ event: "setupAuth", data: { state: "waiting" } });
            hooks.show({ type: "adb", on: true });
          });
        }
        later(asks ? 2700 : 600, () => {
          hooks.show({ type: "adb", on: false });
          if (trouble) {
            const words: Record<string, string> = { refused: "The TV refused.", timeout: "Nobody answered on the TV.", tls: "The TV wants TLS.", unreachable: "The TV did not answer." };
            hooks.deliver({ id, ok: false, error: words[trouble] ?? "The TV did not answer.", reason: trouble });
            return;
          }
          tv.allowed = true;
          connected = true;
          save();
          hooks.deliver({ id, ok: true, data: PROPS });
        });
        return true;
      }
      case "setupShell": {
        if (needsConnection(id)) return true;
        const cmd = String(args.cmd ?? "").trim();
        if (cmd === "pm list packages -e") reply(id, { out: enabled().map((p) => `package:${p}\n`).join("") }, 500);
        else if (cmd === "pm list packages -d") reply(id, { out: tv.disabled.map((p) => `package:${p}\n`).join("") }, 300);
        else if (cmd.startsWith("cmd package resolve-activity"))
          reply(id, { out: `priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true\n${tv.home}\n` }, 200);
        else if (cmd.startsWith(`cat ${DIR}/undo.txt`)) reply(id, { out: tv.undo.map((l) => `${l}\n`).join("") });
        else if (cmd === "settings put global adb_enabled 0") {
          // Developer mode goes, and the connection with it: the phone hears an error, as it would from the TV.
          tv.adb = false;
          connected = false;
          looks = 0;
          save();
          fail(id, "The connection to the TV closed.", {}, 150);
        } else reply(id, { out: "" });
        return true;
      }
      case "setupPush": {
        if (needsConnection(id)) return true;
        const to = String(args.to ?? "");
        if (typeof args.asset === "string") {
          if (!(args.asset in SIZES)) {
            fail(id, `There is no ${args.asset} in the app.`);
            return true;
          }
          assets.add(args.asset);
          reply(id, { bytes: SIZES[args.asset] }, args.asset.endsWith(".apk") ? 700 : 80);
        } else {
          const body = String(args.text ?? "");
          files.set(to, body);
          // The TV's own undo record lives at this path: a pushed copy takes its place.
          if (to === `${DIR}/undo.txt`) {
            tv.undo = body.split("\n").filter((l) => l.length > 0);
            save();
          }
          reply(id, { bytes: new TextEncoder().encode(body).length }, 60);
        }
        return true;
      }
      case "setupRun": {
        if (needsConnection(id)) return true;
        const cmd = String(args.cmd ?? "");
        const job = cmd.endsWith("orbit-setup.sh install") ? install() : cmd.endsWith("orbit-setup.sh name") ? name() : cmd.endsWith("orbit-undo.sh") ? undo() : null;
        if (!job) play(id, [{ wait: 50, line: `sh: ${cmd}: not found` }], () => 127);
        else play(id, job.lines, job.code);
        return true;
      }
      case "setupClose":
        connected = false;
        hooks.show({ type: "adb", on: false });
        reply(id, {});
        return true;
      case "setupRecord": {
        const all = records();
        const key = String(args.key ?? "");
        if ("record" in args) {
          if (args.record) all[key] = args.record;
          else delete all[key];
          try {
            localStorage.setItem(RECORDS_KEY, JSON.stringify(all));
          } catch {
            /* kept for this run only */
          }
        }
        reply(id, { record: all[key] ?? null });
        return true;
      }
      case "setupAdopt":
        later(1000, () => {
          if (args.address !== hooks.tv.address || !orbitOn()) return fail(id, "The TV did not answer.");
          if (!tv.token || String(args.token).toLowerCase() !== tv.token) return fail(id, "That TV does not know this phone.", { status: 403 });
          hooks.deliver({ id, ok: true, data: hooks.adopt(tv.token) });
        });
        return true;
      default:
        return false;
    }
  };

  return { handle, orbitOn };
}
