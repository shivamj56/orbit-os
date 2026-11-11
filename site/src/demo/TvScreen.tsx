import { AnimatePresence, motion } from "motion/react";
import { forwardRef, useEffect, useState, type ReactNode } from "react";
import * as I from "@/components/kit/icons";
import { dateText, greetingFor, timeText, useClock } from "@/lib/hooks";
import { APPS, CHANNELS } from "./apps";
import { HomeRow } from "./HomeRow";
import { LiveTv } from "./LiveTv";
import { ControlCenter } from "./ControlCenter";
import type { DemoState } from "./useDemo";

interface Props {
  state: DemoState;
  reduce: boolean;
  onPick: (i: number) => void;
  onSettings: () => void;
  onCcPick: (id: string) => void;
  children?: ReactNode;
}

const spring = { type: "spring", stiffness: 380, damping: 32 } as const;

/** The pretend TV: Orbit Home and everything that rises over it, in one 16:9 glass screen. */
export const TvScreen = forwardRef<HTMLDivElement, Props & React.HTMLAttributes<HTMLDivElement>>(function TvScreen(
  { state, reduce, onPick, onSettings, onCcPick, children, ...rest },
  ref,
) {
  const now = useClock();
  const app = APPS[state.focus];
  const openApp = state.screen.kind === "app" ? APPS[state.screen.app] : null;
  const showVolume = useRecent(state.volumeAt, 1700);

  return (
    <div
      ref={ref}
      {...rest}
      className="relative aspect-video w-full overflow-hidden rounded-[0.9cqw] bg-black outline-none select-none [transition:--glow_0.8s_ease] focus-visible:ring-1 focus-visible:ring-sky/70 focus-visible:ring-offset-2 focus-visible:ring-offset-night"
      style={{ containerType: "inline-size", ["--glow" as string]: app.glow }}
    >
      {/* Home */}
      <div className="absolute inset-0" style={{ background: "radial-gradient(48% 46% at 50% 54%, color-mix(in srgb, var(--glow) 42%, transparent) 0%, color-mix(in srgb, var(--glow) 12%, transparent) 42%, transparent 72%), #000" }} />
      <div className="pointer-events-none absolute inset-0 opacity-60" style={{ background: "radial-gradient(1.2px 1.2px at 22% 30%, rgba(255,90,120,.7), transparent), radial-gradient(1px 1px at 71% 24%, rgba(255,90,120,.6), transparent), radial-gradient(1px 1px at 40% 72%, rgba(255,120,150,.5), transparent), radial-gradient(1.2px 1.2px at 83% 66%, rgba(255,90,120,.5), transparent)" }} />

      <motion.div
        className="absolute inset-x-0 top-[5.2%] text-center"
        animate={{ opacity: state.island ? 0 : 1, y: state.island ? "1.2cqw" : "0cqw" }}
        transition={{ duration: 0.4 }}
      >
        <div className="font-display text-[4.4cqw] leading-none font-light tracking-[-0.01em] text-white">{greetingFor(now)}</div>
        <div className="mt-[1.1cqw] text-[1.45cqw] text-white/85">Hello, I wish you a wonderful day</div>
        <div className="mt-[1.3cqw] text-[1.1cqw] text-white/45">
          {dateText(now)}
          <span className="mx-[0.8cqw]">·</span>
          {timeText(now)}
        </div>
      </motion.div>

      <div className="absolute top-[5.5%] right-[5.5%] flex gap-[1.2cqw]">
        {[I.Input, I.Wifi, I.Gear].map((Icon, i) => (
          <button
            key={i}
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={i === 2 ? onSettings : undefined}
            className="grid size-[3.6cqw] place-items-center rounded-full bg-[linear-gradient(180deg,#3a3f4c,#1d212b)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),0_0.4cqw_1cqw_rgba(0,0,0,0.6)]"
          >
            <Icon size={18} className="size-[1.7cqw]" strokeWidth={2} />
          </button>
        ))}
      </div>

      <HomeRow apps={APPS} focus={state.focus} onPick={onPick} reduce={reduce} />

      <div className="absolute inset-x-0 top-[68.5%] h-[5cqw] text-center">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={app.id}
            className="font-display text-[2.3cqw] font-normal text-white"
            initial={{ opacity: 0, y: "0.8cqw", filter: "blur(4px)" }}
            animate={{ opacity: 1, y: "0cqw", filter: "blur(0px)" }}
            exit={{ opacity: 0, y: "-0.6cqw", filter: "blur(4px)" }}
            transition={{ duration: 0.28 }}
          >
            {app.label}
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="absolute top-[78.5%] left-1/2 flex h-[4.6cqw] w-[48%] -translate-x-1/2 items-center gap-[1cqw] rounded-full border border-white/20 bg-[linear-gradient(180deg,rgba(60,64,74,0.55),rgba(20,22,28,0.7))] px-[1.6cqw] text-[1.25cqw] text-white/55 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
        <I.Search size={16} className="size-[1.5cqw]" />
        <span className="flex-1 text-left">Search apps, movies and shows</span>
        <I.Mic size={16} className="size-[1.5cqw]" />
      </div>
      <motion.div
        className="absolute bottom-[3.5%] left-1/2 -translate-x-1/2 text-[color:var(--glow)]"
        animate={reduce ? undefined : { y: ["0cqw", "0.5cqw", "0cqw"] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
      >
        <I.Chevron size={20} className="size-[2.4cqw]" strokeWidth={2.2} />
      </motion.div>

      {/* An app in front: the card flies forward into it. */}
      <AnimatePresence>
        {openApp && (
          <motion.div
            key={openApp.id}
            className="absolute inset-0 grid place-items-center"
            style={{ background: openApp.surface === "fill" ? openApp.fill : `radial-gradient(70% 70% at 50% 45%, color-mix(in srgb, ${openApp.glow} 55%, #000), #000)` }}
            initial={{ clipPath: "inset(31% 43.8% 36% 43.8% round 1.2cqw)", opacity: 0.6 }}
            animate={{ clipPath: "inset(0% 0% 0% 0% round 0cqw)", opacity: 1 }}
            exit={{ clipPath: "inset(31% 43.8% 36% 43.8% round 1.2cqw)", opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.5, ease: [0.25, 1, 0.5, 1] }}
          >
            <div className="text-center">
              <div className="text-[6cqw] leading-none font-bold tracking-[-0.02em] text-white" style={{ fontFamily: "var(--font-sans)" }}>
                {openApp.label}
              </div>
              <div className="mt-[2cqw] text-[1.4cqw] text-white/70">The app opens here, signed in as always.</div>
              <div className="mt-[3cqw] inline-flex items-center gap-[0.8cqw] rounded-full bg-black/35 px-[1.6cqw] py-[0.7cqw] text-[1.2cqw] text-white/80">
                <I.Back size={14} className="size-[1.3cqw]" /> Back returns to Home
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>{state.screen.kind === "live" && <LiveTv key="live" state={state} reduce={reduce} />}</AnimatePresence>

      <AnimatePresence>{state.cc.open && <ControlCenter key="cc" state={state} reduce={reduce} onPick={onCcPick} />}</AnimatePresence>

      {/* Orbit's volume slider on the screen's right edge. */}
      <AnimatePresence>
        {showVolume && (
          <motion.div
            className="absolute top-1/2 right-[2.2%] flex h-[42%] w-[3.2cqw] -translate-y-1/2 flex-col items-center gap-[0.8cqw] rounded-full border border-white/15 bg-black/55 py-[1cqw] backdrop-blur-md"
            initial={{ opacity: 0, x: "2cqw" }}
            animate={{ opacity: 1, x: "0cqw" }}
            exit={{ opacity: 0, x: "2cqw" }}
            transition={spring}
          >
            <span className="font-mono text-[1cqw] text-white">{state.muted ? 0 : state.volume}</span>
            <span className="relative w-[0.5cqw] flex-1 overflow-hidden rounded-full bg-white/15">
              <motion.span
                className="absolute inset-x-0 bottom-0 rounded-full bg-[linear-gradient(0deg,#74D1FF,#ADC6FF,#E9B3FF)]"
                animate={{ height: `${state.muted ? 0 : state.volume}%` }}
                transition={spring}
              />
            </span>
            {state.muted ? <I.SoundOff size={14} className="size-[1.4cqw] text-white" /> : <I.Speaker size={14} className="size-[1.4cqw] text-white" />}
          </motion.div>
        )}
      </AnimatePresence>

      {/* The Island: short notices that glow along the top edge. */}
      <AnimatePresence>
        {state.island && (
          <motion.div
            key={state.island.id}
            className="absolute inset-x-0 top-0 flex flex-col items-center"
            initial={{ opacity: 0, y: "-2cqw" }}
            animate={{ opacity: 1, y: "0cqw" }}
            exit={{ opacity: 0, y: "-2cqw" }}
            transition={spring}
          >
            <div className="h-[0.32cqw] w-[46%] rounded-b-full bg-[linear-gradient(90deg,transparent,#74D1FF_20%,#ADC6FF_50%,#E9B3FF_80%,transparent)] shadow-[0_0_2cqw_0.4cqw_rgba(173,198,255,0.55)]" />
            <div className="mt-[1.2cqw] text-center">
              <div className="text-[1.6cqw] font-medium text-white">{state.island.text}</div>
              {state.island.sub && <div className="mt-[0.3cqw] text-[1.1cqw] text-white/55">{state.island.sub}</div>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* A small shake when the remote has nowhere to go. */}
      <BumpFlash bump={state.bump} />
      {children}
    </div>
  );
});

function BumpFlash({ bump }: { bump: number }) {
  return (
    <AnimatePresence>
      {bump > 0 && (
        <motion.div
          key={bump}
          className="pointer-events-none absolute inset-0 rounded-[inherit] shadow-[inset_0_0_0_0.3cqw_rgba(173,198,255,0.35)]"
          initial={{ opacity: 1 }}
          animate={{ opacity: 0 }}
          transition={{ duration: 0.45 }}
        />
      )}
    </AnimatePresence>
  );
}

function useRecent(at: number, ms: number) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!at) return;
    setOn(true);
    const t = window.setTimeout(() => setOn(false), ms);
    return () => window.clearTimeout(t);
  }, [at, ms]);
  return on;
}

export const channelAt = (i: number) => CHANNELS[i];
