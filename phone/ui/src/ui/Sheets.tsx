import { motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { bridge, cloud, haptic, tv, type Account, type AppEntry, type Status, type TvState } from "../bridge";
import { setDemoMode, useDemo } from "../demo";
import { LINKS, openLink } from "../links";
import { APP_VERSION, openSetup, type FlowMode } from "../setup/flow";
import type { HomeChoice } from "../setup/lines";
import { patchTv, setAccount, updateSettings, useWorld } from "../store";
import { ORBIT_HOMES } from "../setup/plan";
import * as I from "./icons";
import { Press, Sheet, spring } from "./kit";

// ---- app pictures, kept for the whole run ----

const icons = new Map<string, string>();
const asking = new Map<string, Promise<string | null>>();

function iconOf(pkg: string): Promise<string | null> {
  if (icons.has(pkg)) return Promise.resolve(icons.get(pkg)!);
  if (!asking.has(pkg)) {
    asking.set(
      pkg,
      tv
        .icon(pkg)
        .then(({ src }) => {
          icons.set(pkg, src);
          return src;
        })
        .catch(() => null),
    );
  }
  return asking.get(pkg)!;
}

export function useIcon(pkg: string | null): string | null {
  const [src, setSrc] = useState<string | null>(pkg ? icons.get(pkg) ?? null : null);
  useEffect(() => {
    if (!pkg) return setSrc(null);
    let live = true;
    iconOf(pkg).then((s) => live && setSrc(s));
    return () => {
      live = false;
    };
  }, [pkg]);
  return src;
}

// ---- apps ----

export function AppsSheet({
  open,
  onClose,
  onLaunched,
  onFail,
}: {
  open: boolean;
  onClose: () => void;
  onLaunched: (label: string) => void;
  onFail: (e: unknown) => void;
}) {
  const [apps, setApps] = useState<AppEntry[] | null>(null);
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!open) return;
    setQuery("");
    tv.apps().then(setApps).catch(onFail);
  }, [open, onFail]);
  const shown = useMemo(
    () => (apps ?? []).filter((a) => a.label.toLowerCase().includes(query.trim().toLowerCase())),
    [apps, query],
  );
  return (
    <Sheet open={open} onClose={onClose} title="Apps" tall>
      <label className="glass mb-4 flex h-12 items-center gap-2.5 rounded-full px-4">
        <I.Search size={18} className="text-faint" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find an app"
          aria-label="Find an app"
          className="min-w-0 flex-1 bg-transparent text-[16px] placeholder:text-faint focus:outline-none"
        />
      </label>
      {!apps && <p className="py-10 text-center text-[14px] text-faint">Asking the TV…</p>}
      <motion.ul className="grid grid-cols-2 gap-3" initial="hidden" animate="shown" variants={{ shown: { transition: { staggerChildren: 0.025 } } }}>
        {shown.map((a) => (
          <motion.li key={a.pkg} variants={{ hidden: { opacity: 0, y: 12 }, shown: { opacity: 1, y: 0 } }} transition={spring}>
            <AppTile app={a} onPress={() => {
              tv.launch(a.pkg).then(() => onLaunched(a.label)).catch(onFail);
              onClose();
            }} />
          </motion.li>
        ))}
      </motion.ul>
      {apps && shown.length === 0 && <p className="py-10 text-center text-[14px] text-faint">No app by that name.</p>}
    </Sheet>
  );
}

function AppTile({ app, onPress }: { app: AppEntry; onPress: () => void }) {
  const src = useIcon(app.pkg);
  return (
    <Press label={`Open ${app.label}`} onPress={onPress} feel="medium" className="w-full">
      <span className="block w-full">
        <span className="relative block aspect-video w-full overflow-hidden rounded-[18px] border border-white/8 bg-white/5">
          {src ? (
            <img src={src} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : (
            <span className="absolute inset-0 animate-pulse bg-white/4" />
          )}
          <span className="pointer-events-none absolute inset-0 rounded-[18px] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]" />
        </span>
        <span className="mt-1.5 block truncate px-1 text-left text-[13px] text-muted">{app.label}</span>
      </span>
    </Press>
  );
}

// ---- typing ----

export function TypeSheet({
  open,
  onClose,
  onDone,
  onFail,
}: {
  open: boolean;
  onClose: () => void;
  onDone: (text: string) => void;
  onFail: (e: unknown) => void;
}) {
  const [text, setText] = useState("");
  const [enter, setEnter] = useState(true);
  const box = useRef<HTMLTextAreaElement>(null);
  const link = /^\s*https?:\/\/\S+\s*$/i.test(text) || /^\s*(www\.|youtu\.be\/|youtube\.com\/)\S+\s*$/i.test(text);
  useEffect(() => {
    if (open) window.setTimeout(() => box.current?.focus(), 380);
  }, [open]);
  const send = async () => {
    const value = text.trim();
    if (!value) return;
    try {
      if (link) {
        await tv.open(/^https?:/i.test(value) ? value : `https://${value}`);
        onDone("Opening the link on the TV");
      } else {
        await tv.type(value, enter);
        onDone("Sent to the TV");
      }
      haptic("success");
      setText("");
      onClose();
    } catch (e) {
      onFail(e);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={link ? "Open a link" : "Type on the TV"}>
      <p className="mb-3 text-[13.5px] text-muted">
        {link ? "The TV opens it, in the app it belongs to or in a browser." : "Into the search box that is open on the TV."}
      </p>
      <textarea
        ref={box}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="Search, a name, or a link"
        aria-label="Text for the TV"
        className="glass w-full resize-none rounded-[20px] px-4 py-3.5 text-[17px] leading-snug placeholder:text-faint focus:outline-none"
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div className="mt-4 flex items-center justify-between gap-3">
        {!link ? (
          <button
            type="button"
            role="switch"
            aria-checked={enter}
            onClick={() => setEnter(!enter)}
            className="flex h-11 items-center gap-2.5 text-[14px] text-muted"
          >
            <Toggle on={enter} />
            Search after sending
          </button>
        ) : (
          <span className="flex items-center gap-2 text-[13.5px] text-cyan">
            <I.Link size={17} /> A link
          </span>
        )}
        <Press label="Send" onPress={send} disabled={!text.trim()} feel={null} className="h-12 rounded-full bg-text px-6 text-ink">
          <span className="flex items-center gap-2 text-[15px] font-medium">
            <I.Send size={18} /> Send
          </span>
        </Press>
      </div>
    </Sheet>
  );
}

// ---- what is playing ----

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
}

export function PlayerSheet({ open, onClose, state, onFail }: { open: boolean; onClose: () => void; state: TvState | null; onFail: (e: unknown) => void }) {
  const [now, setNow] = useState(Date.now());
  const [seen, setSeen] = useState({ at: Date.now(), position: state?.position ?? 0 });
  useEffect(() => setSeen({ at: Date.now(), position: state?.position ?? 0 }), [state?.position]);
  useEffect(() => {
    if (!open || !state?.playing) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [open, state?.playing]);
  const art = useIcon(state?.pkg && !ORBIT_HOMES.has(state.pkg) ? state.pkg : null);
  const position = state ? Math.min(state.duration || Infinity, seen.position + (state.playing ? now - seen.at : 0)) : 0;
  const share = state?.duration ? position / state.duration : 0;
  const media = (a: "play_pause" | "next" | "previous" | "forward" | "rewind") => {
    tv.media(a).catch(onFail);
    if (a === "play_pause" && state) patchTv({ playing: !state.playing });
  };
  return (
    <Sheet open={open} onClose={onClose} title="Now playing">
      <div className="flex items-center gap-4">
        <span className="relative h-[68px] w-[120px] shrink-0 overflow-hidden rounded-[16px] bg-white/6">
          {art ? <img src={art} alt="" className="absolute inset-0 h-full w-full object-cover" /> : (
            <span className="absolute inset-0 grid place-items-center text-muted"><I.Tv size={26} /></span>
          )}
        </span>
        <div className="min-w-0">
          <p className="truncate font-display text-[21px] leading-tight">{state?.title || state?.app || "Nothing playing"}</p>
          <p className="mt-1 truncate text-[13.5px] text-muted">{state?.artist || state?.player || state?.app || ""}</p>
        </div>
      </div>
      {!!state?.duration && (
        <div className="mt-6">
          <div className="h-[5px] overflow-hidden rounded-full bg-white/10">
            <motion.div className="ribbon-line h-full" animate={{ width: `${share * 100}%` }} transition={{ duration: 0.5, ease: "linear" }} />
          </div>
          <div className="tabular mt-2 flex justify-between text-[12px] text-faint">
            <span>{clock(position)}</span>
            <span>-{clock(state.duration - position)}</span>
          </div>
        </div>
      )}
      <div className="mt-5 flex items-center justify-between px-1">
        <Press label="Previous" onPress={() => media("previous")} className="h-14 w-14 rounded-full text-muted"><I.Prev size={24} /></Press>
        <Press label="Back 10 seconds" onPress={() => media("rewind")} className="h-14 w-14 rounded-full text-text"><I.Rewind size={28} /></Press>
        <Press label={state?.playing ? "Pause" : "Play"} onPress={() => media("play_pause")} feel="medium" className="h-[74px] w-[74px] rounded-full bg-text text-ink">
          {state?.playing ? <I.Pause size={30} /> : <I.Play size={30} />}
        </Press>
        <Press label="Forward 10 seconds" onPress={() => media("forward")} className="h-14 w-14 rounded-full text-text"><I.Forward size={28} /></Press>
        <Press label="Next" onPress={() => media("next")} className="h-14 w-14 rounded-full text-muted"><I.Next size={24} /></Press>
      </div>
      {state && <VolumeSlider state={state} onFail={onFail} />}
    </Sheet>
  );
}

function VolumeSlider({ state, onFail }: { state: TvState; onFail: (e: unknown) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const last = useRef(0);
  const set = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    const level = Math.round(Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * state.max);
    if (level === state.volume) return;
    patchTv({ volume: level, muted: false });
    const now = performance.now();
    if (now - last.current > 60 || level === 0 || level === state.max) {
      last.current = now;
      haptic("tick");
      tv.volume(level).catch(onFail);
    }
  };
  const share = state.max ? state.volume / state.max : 0;
  return (
    <div className="mt-7 flex items-center gap-3">
      <Press label={state.muted ? "Unmute" : "Mute"} onPress={() => { tv.key("mute").catch(onFail); patchTv({ muted: !state.muted }); }}
        className={`h-11 w-11 shrink-0 rounded-full ${state.muted ? "text-rose" : "text-muted"}`}>
        <I.Speaker size={20} muted={state.muted} level={share < 0.5 ? 1 : 2} />
      </Press>
      <div
        ref={track}
        className="relative h-11 flex-1 touch-none"
        role="slider"
        aria-label="Volume"
        aria-valuemin={0}
        aria-valuemax={state.max}
        aria-valuenow={state.volume}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          set(e.clientX);
        }}
        onPointerMove={(e) => e.buttons && set(e.clientX)}
        onPointerUp={() => tv.volume(state.volume).catch(onFail)}
      >
        <div className="absolute inset-x-0 top-1/2 h-[6px] -translate-y-1/2 overflow-hidden rounded-full bg-white/10">
          <div className="ribbon-line h-full" style={{ width: `${share * 100}%` }} />
        </div>
        <motion.div
          className="absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-text shadow-[0_4px_14px_rgba(0,0,0,0.5)]"
          animate={{ left: `${share * 100}%` }}
          transition={{ type: "spring", stiffness: 900, damping: 50 }}
        />
      </div>
      <span className="tabular w-8 text-right text-[14px] text-muted">{state.volume}</span>
    </div>
  );
}

// ---- settings ----

function Toggle({ on }: { on: boolean }) {
  return (
    <span className={`relative inline-flex h-[26px] w-[44px] shrink-0 rounded-full transition-colors ${on ? "bg-mint" : "bg-white/14"}`}>
      <motion.span className="absolute top-[3px] h-5 w-5 rounded-full bg-white shadow" animate={{ left: on ? 21 : 3 }} transition={spring} />
    </span>
  );
}

function Row({ title, note, children, onPress, icon }: { title: string; note?: string; children?: React.ReactNode; onPress?: () => void; icon?: React.ReactNode }) {
  const Body = (
    <span className="flex w-full items-center justify-between gap-4 py-3.5 text-left">
      {icon && <span className="grid h-9 w-9 shrink-0 place-items-center self-start rounded-[12px] bg-white/5 text-cyan">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-[15.5px]">{title}</span>
        {note && <span className="mt-0.5 block text-[12.5px] leading-snug text-faint">{note}</span>}
      </span>
      {children}
    </span>
  );
  return onPress ? (
    <button type="button" className="block w-full" onClick={onPress}>
      {Body}
    </button>
  ) : (
    <div>{Body}</div>
  );
}

export function SettingsSheet({ open, onClose, status }: { open: boolean; onClose: () => void; status: Status }) {
  const { settings } = useWorld();
  const demo = useDemo();
  const tv = status.tv;
  // A screen of Orbit Setup's over everything: the sheet goes first (setup takes the phone's Back from it).
  const go = (mode: FlowMode, to?: HomeChoice) => () => {
    haptic("light");
    onClose();
    openSetup(mode, tv, to);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Settings">
      <div className="glass flex items-center gap-3.5 rounded-[22px] p-4">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/6 text-cyan">
          <I.Tv size={24} />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[16px] font-medium">{tv?.name || (demo ? "The pretend TV" : "No TV yet")}</p>
          <p className="tabular truncate text-[12.5px] text-faint">
            {!tv
              ? "Orbit is looking on this Wi-Fi"
              : status.via === "cloud"
                ? "Through Google, from anywhere"
                : `${tv.address}  ·  ${status.state === "connected" ? "home Wi-Fi" : "not answering now"}`}
          </p>
        </div>
      </div>

      <div className="mt-3 divide-y divide-white/6">
        <Row title="Feel the steps" note="The phone ticks with every move of the TV's focus." onPress={() => updateSettings({ haptics: !settings.haptics })}>
          <Toggle on={settings.haptics} />
        </Row>
        <Row title="Phone's volume buttons" note="Turn the TV up and down while Orbit is open." onPress={() => updateSettings({ volumeKeys: !settings.volumeKeys })}>
          <Toggle on={settings.volumeKeys} />
        </Row>
        <div className="py-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[15.5px]">Pointer speed</span>
            <span className="tabular text-[13px] text-faint">{settings.speed.toFixed(1)}×</span>
          </div>
          <input
            type="range"
            min={0.6}
            max={1.8}
            step={0.1}
            value={settings.speed}
            onChange={(e) => updateSettings({ speed: Number(e.target.value) })}
            aria-label="Pointer speed"
            className="mt-3 w-full accent-[#74d1ff]"
          />
        </div>
      </div>

      {tv && (
        <section className="mt-4" aria-label="This TV">
          <p className="px-1 text-[12px] font-medium tracking-[0.08em] text-faint uppercase">This TV</p>
          <div className="divide-y divide-white/6">
            <Row icon={<I.CloudUp size={20} />} title="Back up this TV's own setup" note="How the TV was before Orbit OS, as a small file in your own Google Drive." onPress={go("backup")}>
              <Chevron />
            </Row>
            <Row icon={<I.Home size={20} />} title="Use the TV's own home screen" note="Only Home changes. Orbit Home stays on the TV for when you want it back." onPress={go("switch", "stock")}>
              <Chevron />
            </Row>
            <Row icon={<I.Planet size={20} />} title="Use Orbit Home again" note="Orbit Home becomes the home screen once more." onPress={go("switch", "orbit")}>
              <Chevron />
            </Row>
            <Row
              icon={<I.Undo size={20} />}
              title="Undo Orbit OS on this TV"
              note="Removes Orbit entirely: what it switched off comes back on, the TV's own home screen and settings come back, and Orbit's apps come off."
              onPress={go("undo")}
            >
              <Chevron />
            </Row>
          </div>
        </section>
      )}

      <section className="mt-4" aria-label="Orbit OS">
        <p className="px-1 text-[12px] font-medium tracking-[0.08em] text-faint uppercase">{tv ? "More" : "Orbit OS"}</p>
        <div className="divide-y divide-white/6">
          <Row icon={<I.CloudDown size={20} />} title="Backups in Google Drive" note="Each TV's backups, and putting a TV back from one." onPress={go("backups")}>
            <Chevron />
          </Row>
          <Row icon={<I.Tv size={20} />} title="Set up Orbit OS on a TV" note="Put Orbit OS on a TV from this phone." onPress={go("install")}>
            <Chevron />
          </Row>
          {bridge.native && (
            <Row
              icon={<I.Try size={20} />}
              title={demo ? "Leave the demo" : "Try Orbit without a TV"}
              note={demo ? "Back to your own TV." : "Everything Orbit does, with a pretend TV inside the app. Your own TV is left alone."}
              onPress={() => {
                haptic("medium");
                onClose();
                setDemoMode(!demo);
              }}
            >
              <Chevron />
            </Row>
          )}
        </div>
      </section>

      <AnywhereCard onDone={onClose} onDelete={go("account")} />

      <section className="mt-4" aria-label="About">
        <p className="px-1 text-[12px] font-medium tracking-[0.08em] text-faint uppercase">About</p>
        <div className="divide-y divide-white/6">
          <Row title="Privacy policy" note="What Orbit keeps, where, and how to delete it." onPress={() => openLink(LINKS.privacy)}>
            <I.External size={18} className="shrink-0 text-faint" />
          </Row>
          <Row title="Report a problem" note="On the Orbit OS site's issue page." onPress={() => openLink(LINKS.issues)}>
            <I.External size={18} className="shrink-0 text-faint" />
          </Row>
          <div className="py-3.5 text-[12.5px] text-faint">
            Orbit {APP_VERSION} · made by Shivam Anil Jha
          </div>
        </div>
      </section>

      {tv && (
        <button
          type="button"
          className="mt-5 h-12 w-full rounded-full border border-rose/30 text-[15px] text-rose"
          onClick={() => {
            haptic("heavy");
            bridge.call("forget").catch(() => {});
            onClose();
          }}
        >
          Forget this TV
        </button>
      )}
    </Sheet>
  );
}

const Chevron = () => <I.Chevron dir="right" size={18} className="shrink-0 text-faint" />;

/** The Google account Orbit uses away from the Wi-Fi, and the TV linked to it. */
function AnywhereCard({ onDone, onDelete }: { onDone: () => void; onDelete: () => void }) {
  const { account } = useWorld();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (what: string, job: () => Promise<Account>) => {
    setBusy(what);
    setError(null);
    try {
      setAccount(await job());
      haptic("light");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="glass mt-4 rounded-[22px] p-4">
      <div className="flex items-center gap-2.5">
        <I.Globe size={20} className="text-gold" />
        <p className="text-[15.5px]">From anywhere</p>
        <span className={`ml-auto rounded-full px-2.5 py-1 text-[11px] ${account.tvLinked ? "bg-mint/15 text-mint" : "bg-white/8 text-muted"}`}>
          {account.tvLinked ? (account.tvOnline ? "TV online" : "TV asleep") : account.signedIn ? "TV not linked" : "Off"}
        </span>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-faint">
        {account.signedIn
          ? <>Signed in as <span className="text-muted">{account.email}</span>.{" "}
              {account.tvLinked ? `${account.tvName || "The TV"} answers this phone from anywhere.` : "Link the TV once with the code it shows at the top of Home."}</>
          : "Sign in with the Google account that is on the TV, and Orbit reaches it away from home too."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {!account.signedIn && (
          <Press label="Continue with Google" onPress={() => run("in", cloud.signIn)} disabled={!!busy} className="h-10 rounded-full bg-text px-4 text-[14px] font-medium text-ink">
            {busy === "in" ? "Opening Google…" : "Continue with Google"}
          </Press>
        )}
        {account.signedIn && account.tvLinked && (
          <Press label="Unlink the TV" onPress={() => run("unlink", cloud.unlinkTv)} disabled={!!busy} className="glass h-10 rounded-full px-4 text-[14px]">
            {busy === "unlink" ? "Unlinking…" : "Unlink TV"}
          </Press>
        )}
        {account.signedIn && (
          <Press label="Sign out" onPress={() => run("out", cloud.signOut).then(onDone)} disabled={!!busy} className="glass h-10 rounded-full px-4 text-[14px] text-muted">
            Sign out
          </Press>
        )}
      </div>
      {error && <p className="mt-2 text-[13px] text-rose" role="alert">{error}</p>}
      {account.signedIn && (
        <button type="button" onClick={onDelete} disabled={!!busy} className="mt-3 -mb-1 min-h-11 text-[13.5px] font-medium text-rose/90 disabled:opacity-45">
          Delete my Orbit account
        </button>
      )}
    </div>
  );
}

export function SleepSheet({ open, onClose, onSleep }: { open: boolean; onClose: () => void; onSleep: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Sleep">
      <p className="text-[14px] text-muted">The TV goes to standby. Its remote turns it back on.</p>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <Press label="Cancel" onPress={onClose} feel={null} className="glass h-12 rounded-full text-[15px]">
          Cancel
        </Press>
        <Press label="Sleep now" onPress={onSleep} feel="heavy" className="h-12 rounded-full bg-rose text-[15px] font-medium text-ink">
          Sleep now
        </Press>
      </div>
    </Sheet>
  );
}
