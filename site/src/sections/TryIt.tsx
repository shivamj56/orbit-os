import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import ClickSpark, { type ClickSparkHandle } from "@/components/reactbits/ClickSpark";
import { BorderBeam } from "@/components/magicui/border-beam";
import { DownloadButton } from "@/components/kit/buttons";
import { SectionHead } from "@/components/kit/SectionHead";
import * as I from "@/components/kit/icons";
import { useInView, useReducedMotion } from "@/lib/hooks";
import { APPS, CHANNELS } from "@/demo/apps";
import { ccNeighbor } from "@/demo/ControlCenter";
import { PhoneRemote } from "@/demo/PhoneRemote";
import { TvScreen } from "@/demo/TvScreen";
import { useDemo, type Key } from "@/demo/useDemo";

const KEYMAP: Record<string, Key> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  Enter: "ok",
  Escape: "back",
  Backspace: "back",
  s: "settings",
  S: "settings",
  h: "home",
  H: "home",
  "+": "volup",
  "=": "volup",
  "-": "voldown",
  m: "mute",
  M: "mute",
};

/** "Try it now": the pretend TV and the phone remote, driven by the globe, the D-pad, the keyboard or a click. */
export function TryIt() {
  const section = useRef<HTMLElement>(null);
  const tv = useRef<HTMLDivElement>(null);
  const spark = useRef<ClickSparkHandle>(null);
  const reduce = useReducedMotion();
  const inView = useInView(section, 0.35);
  const { state, press, setChannel, setFocus, setCcFocus } = useDemo();
  const [engaged, setEngaged] = useState(false);
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches);
  const live = useRef(state);
  live.current = state;
  const digits = useRef({ text: "", timer: 0 });
  const [announce, setAnnounce] = useState("");

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const send = useCallback(
    (key: Key) => {
      const s = live.current;
      let move: string | null = null;
      if (s.cc.open && (key === "left" || key === "right" || key === "up" || key === "down")) move = ccNeighbor(s.cc.focus, key);
      press(key, move);
    },
    [press],
  );

  // What the TV is showing, for screen readers.
  useEffect(() => {
    if (state.cc.open) setAnnounce(`Control Center, ${state.cc.focus}`);
    else if (state.screen.kind === "live") setAnnounce(`Live TV, channel ${CHANNELS[state.channel].num}, ${CHANNELS[state.channel].name}`);
    else if (state.screen.kind === "app") setAnnounce(`${APPS[state.screen.app].label} is open. Escape returns to Home.`);
    else setAnnounce(`Home, ${APPS[state.focus].label}`);
  }, [state.cc.open, state.cc.focus, state.screen, state.channel, state.focus]);

  // The keyboard drives the TV while the demo is on screen. Left and Right always do; Up, Down and Enter only once
  // you have touched the demo, so they never steal the page's own scrolling by surprise.
  useEffect(() => {
    if (!inView) {
      setEngaged(false);
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) return;
      const onControl = !!target?.closest("button, a, [role=radio], [role=slider], [role=switch], [role=tab]") && !target?.closest("[data-tv]");
      if (/^[0-9]$/.test(e.key) && live.current.screen.kind === "live") {
        e.preventDefault();
        const d = digits.current;
        d.text = (d.text + e.key).slice(-2);
        window.clearTimeout(d.timer);
        const n = Number(d.text);
        const idx = CHANNELS.findIndex((c) => c.num === n);
        if (idx >= 0) setChannel(idx);
        d.timer = window.setTimeout(() => (d.text = ""), 1200);
        return;
      }
      const key = KEYMAP[e.key];
      if (!key) return;
      const vertical = key === "up" || key === "down" || key === "ok" || key === "back";
      if (onControl && target?.closest("[role=slider], [role=switch], [role=tab]")) return;
      if (onControl && (key === "ok" || e.key === " ")) return;
      if (vertical && !engaged && !target?.closest("[data-tv]")) return;
      if (key === "back" && e.key === "Backspace" && !engaged) return;
      e.preventDefault();
      if (key === "left" || key === "right") setEngaged(true);
      send(key);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inView, engaged, send, setChannel]);

  const q = state.quests;
  const done = [q.moved >= 3, q.zapped >= 1, q.cc];
  const all = done.every(Boolean);
  const fired = useRef(false);
  useEffect(() => {
    if (all && !fired.current) {
      fired.current = true;
      spark.current?.spark();
      window.setTimeout(() => spark.current?.spark(), 180);
    }
  }, [all]);

  return (
    <section
      ref={section}
      id="try"
      tabIndex={-1}
      aria-labelledby="try-title"
      className="relative scroll-mt-4 py-[clamp(5rem,11vw,9rem)] outline-none"
      onPointerDown={() => setEngaged(true)}
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[70%] bg-[radial-gradient(50%_60%_at_50%_0%,rgba(116,209,255,0.07),transparent_70%)]" />
      <div className="wrap">
        <SectionHead
          eyebrow="Try it now"
          title="Take the remote."
          lede={
            <>
              This is Orbit Home, running in your browser. Roll the globe on the phone, use your arrow keys, or tap the D-pad.
              Open <span className="text-ink">Live TV</span> and zap. Press <span className="text-ink">Settings</span> for the Control Center.
            </>
          }
        />
        <span id="try-title" className="sr-only">
          Try Orbit OS now
        </span>

        <div className="mt-[clamp(2.5rem,5vw,4rem)] grid grid-cols-1 items-center gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1fr)_18.25rem]">
          <div className="relative">
            {/* the TV: a thin bezel, its own light on the wall behind, a reflection below */}
            <div aria-hidden="true" className="pointer-events-none absolute -inset-x-[6%] -inset-y-[10%] -z-10 opacity-80 transition-[background] duration-700" style={{ background: `radial-gradient(55% 55% at 50% 52%, ${APPS[state.focus].glow}22, transparent 70%)` }} />
            <div className="relative rounded-[clamp(10px,1.4vw,18px)] bg-[linear-gradient(160deg,#20263a,#090c16_40%,#151a2b)] p-[clamp(4px,0.55vw,8px)] shadow-[0_50px_120px_-40px_rgba(0,0,0,0.95),inset_0_1px_0_rgba(255,255,255,0.14),0_0_0_1px_rgba(173,198,255,0.12)]">
              <TvScreen
                ref={tv}
                data-tv=""
                tabIndex={0}
                role="application"
                aria-roledescription="TV"
                aria-label="Orbit Home demo. Arrow keys move, Enter opens, Escape goes back, S opens the Control Center."
                onFocus={() => setEngaged(true)}
                state={state}
                reduce={reduce}
                onPick={(i) => {
                  setEngaged(true);
                  if (i === state.focus && state.screen.kind === "home") send("ok");
                  else setFocus(i);
                }}
                onSettings={() => send("settings")}
                onCcPick={(id) => {
                  if (state.cc.focus === id) send("ok");
                  else setCcFocus(id);
                }}
              />
              {!reduce && <BorderBeam size={140} duration={9} colorFrom="#74D1FF" colorTo="#E9B3FF" borderWidth={1.5} />}
            </div>
            <div className="mx-auto mt-0 h-3 w-[16%] rounded-b-xl bg-[linear-gradient(180deg,#1a2034,#0b0f1c)]" aria-hidden="true" />
            <div aria-hidden="true" className="mx-auto -mt-1 h-6 w-[70%] rounded-[50%] bg-[radial-gradient(closest-side,rgba(173,198,255,0.16),transparent)] blur-md" />

            <p className="mt-3 hidden flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[0.8125rem] text-dim md:flex">
              <span className="flex items-center gap-1.5">
                <span className="keycap">←</span>
                <span className="keycap">→</span>
                <span className="keycap">↑</span>
                <span className="keycap">↓</span> move
              </span>
              <span className="flex items-center gap-1.5">
                <span className="keycap">Enter</span> OK
              </span>
              <span className="flex items-center gap-1.5">
                <span className="keycap">Esc</span> Back
              </span>
              <span className="flex items-center gap-1.5">
                <span className="keycap">S</span> Settings
              </span>
              <span className="flex items-center gap-1.5">
                <span className="keycap">0–9</span> channel
              </span>
            </p>
          </div>

          <div className={wide ? "" : "glass rounded-[1.75rem] p-4"}>
            <PhoneRemote onKey={(k) => send(k)} framed={wide} volume={state.volume} muted={state.muted} />
          </div>
        </div>

        <ClickSpark ref={spark} sparkColor={["#7EE2B8", "#74D1FF", "#E9B3FF", "#FFFFFF"]} sparkCount={22} sparkRadius={120} sparkSize={16} duration={900} shape="star" glow={0.7} className="mt-10 block">
          <div className="panel relative overflow-hidden rounded-[1.75rem] p-5 sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <p className="eyebrow">Three things to try</p>
              <p className="font-mono text-[0.75rem] text-dim">
                {done.filter(Boolean).length} of 3
              </p>
            </div>
            <ol className="mt-5 grid grid-cols-1 gap-3 md:grid-cols-3">
              <Quest done={done[0]} n={1} title="Move along your apps" hint="Roll the globe, or press ← →" />
              <Quest done={done[1]} n={2} title="Open Live TV and zap" hint="OK on Live TV, then ↑ ↓ or a number" />
              <Quest done={done[2]} n={3} title="Pull down the Control Center" hint="The Settings key, or S" />
            </ol>
            <AnimatePresence>
              {all && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  transition={{ duration: 0.5, ease: [0.19, 1, 0.22, 1] }}
                  className="overflow-hidden"
                >
                  <div className="mt-6 flex flex-wrap items-center justify-between gap-5 rounded-2xl border border-mint/25 bg-mint/[0.06] p-5">
                    <div>
                      <p className="font-display text-[1.375rem] text-ink">That was Orbit OS.</p>
                      <p className="mt-1 text-[0.9375rem] text-soft">The same home, Live TV and Control Center, on your own TV in about five minutes.</p>
                    </div>
                    <DownloadButton size="md" />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </ClickSpark>
      </div>
      <div className="sr-only" aria-live="polite">
        {announce}
      </div>
    </section>
  );
}

function Quest({ done, n, title, hint }: { done: boolean; n: number; title: string; hint: string }) {
  return (
    <li className={`flex items-start gap-3.5 rounded-2xl border p-4 transition-colors duration-500 ${done ? "border-mint/30 bg-mint/[0.05]" : "border-white/[0.07] bg-white/[0.02]"}`}>
      <span className={`relative grid size-8 shrink-0 place-items-center rounded-full border font-mono text-[0.75rem] transition-colors duration-500 ${done ? "border-mint bg-mint text-night" : "border-white/20 text-soft"}`}>
        <AnimatePresence mode="wait" initial={false}>
          {done ? (
            <motion.span key="d" initial={{ scale: 0, rotate: -40 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 500, damping: 18 }}>
              <I.Check size={16} strokeWidth={2.6} />
            </motion.span>
          ) : (
            <motion.span key="n" exit={{ scale: 0 }}>
              {n}
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <span>
        <span className={`block text-[0.9375rem] font-medium ${done ? "text-ink" : "text-ink/90"}`}>{title}</span>
        <span className="mt-0.5 block text-[0.8125rem] text-dim">{hint}</span>
      </span>
    </li>
  );
}
