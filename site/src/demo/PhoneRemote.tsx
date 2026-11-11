import { motion } from "motion/react";
import { useRef, useState, type ReactNode } from "react";
import { Globe, type Dir } from "@/components/globe/Globe";
import * as I from "@/components/kit/icons";
import { useNear } from "@/lib/hooks";
import type { Key } from "./useDemo";

/*
 * Orbit on the phone, as the remote for the pretend TV: the real globe touchpad (Orbit's own WebGL globe from
 * phone/ui), or a D-pad, and the keys under them. In a phone frame on wide screens; bare on a phone.
 */
export function PhoneRemote({ onKey, framed, volume, muted }: { onKey: (k: Key) => void; framed: boolean; volume: number; muted: boolean }) {
  const [mode, setMode] = useState<"globe" | "dpad">("globe");
  const [flash, setFlash] = useState<{ dir: Dir; n: number } | null>(null);
  const [touching, setTouching] = useState(false);
  const [tried, setTried] = useState(false);
  // The globe's WebGL starts only when the demo comes close to the screen.
  const pad = useRef<HTMLDivElement>(null);
  const near = useNear(pad, "300px");

  const body = (
    <div className={`flex h-full flex-col ${framed ? "px-4 pt-10 pb-4" : "px-0 pt-0 pb-0"}`}>
      <header className="text-left">
        <div className="truncate font-display text-[1.25rem] leading-tight text-ink">Family room</div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[0.75rem] text-soft">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full rounded-full bg-mint/60 motion-safe:animate-ping" />
            <span className="relative inline-flex size-2 rounded-full bg-mint" />
          </span>
          On your home Wi-Fi
        </div>
      </header>
      <div className="mt-3 flex justify-center">
        <div className="glass relative flex rounded-full p-1" role="radiogroup" aria-label="Remote style">
          {(["globe", "dpad"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={`relative z-10 h-8 rounded-full px-4 text-[0.8125rem] font-medium transition-colors ${mode === m ? "text-night" : "text-soft hover:text-ink"}`}
            >
              {mode === m && <motion.span layoutId={framed ? "mode-pill-f" : "mode-pill"} className="absolute inset-0 -z-10 rounded-full bg-ink" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
              {m === "globe" ? "Globe" : "D-pad"}
            </button>
          ))}
        </div>
      </div>

      <div ref={pad} className="relative mx-auto my-2 grid aspect-square w-full max-w-[15rem] flex-none place-items-center">
        {mode === "globe" ? (
          <>
            <Ticks flash={flash} />
            {!tried && (
              <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 grid place-items-center">
                <motion.span
                  className="flex items-center gap-2 rounded-full border border-white/20 bg-black/55 px-3 py-1.5 text-[0.75rem] font-medium text-ink backdrop-blur-md"
                  animate={{ x: [-18, 18, -18] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
                >
                  <I.Hand size={16} /> Drag the globe
                </motion.span>
              </span>
            )}
            {near && <Globe
              mode="focus"
              onTouch={(down) => {
                setTouching(down);
                if (down) setTried(true);
              }}
              onStep={(dir) => {
                setFlash((f) => ({ dir, n: (f?.n ?? 0) + 1 }));
                onKey(dir);
              }}
              onTap={() => onKey("ok")}
              onLong={() => onKey("home")}
            />}
          </>
        ) : (
          <DPad onKey={onKey} />
        )}
      </div>
      <p className={`-mt-1 mb-3 text-center text-[0.75rem] text-faint transition-opacity duration-300 ${touching ? "opacity-0" : ""}`}>
        {mode === "globe" ? "Roll to move · tap for OK · hold for Home" : "Arrows move · the middle is OK"}
      </p>

      <div className="grid grid-cols-3 gap-2.5">
        <Key3 label="Back" onPress={() => onKey("back")}>
          <I.Back size={20} />
        </Key3>
        <Key3 label="Home" onPress={() => onKey("home")}>
          <I.Home size={20} />
        </Key3>
        <Key3 label="Settings" onPress={() => onKey("settings")} accent>
          <I.Gear size={20} />
        </Key3>
      </div>
      <div className="glass mt-2.5 flex items-center rounded-[1.25rem] p-1">
        <button type="button" aria-label="Volume down" onClick={() => onKey("voldown")} className="grid h-11 w-12 place-items-center rounded-2xl text-ink hover:bg-white/[0.06]">
          <I.Minus size={18} />
        </button>
        <button type="button" aria-label={muted ? "Unmute" : "Mute"} onClick={() => onKey("mute")} className="flex h-11 flex-1 flex-col items-center justify-center gap-1 rounded-2xl hover:bg-white/[0.04]">
          <span className={`flex items-center gap-1.5 text-[0.8125rem] font-medium ${muted ? "text-[#ff7a93]" : "text-ink"}`}>
            {muted ? <I.SoundOff size={15} /> : <I.Speaker size={15} />}
            <span className="tabular-nums">{muted ? 0 : volume}</span>
          </span>
          <span className="h-[3px] w-12 overflow-hidden rounded-full bg-white/10">
            <motion.span className="block h-full bg-[linear-gradient(90deg,#74D1FF,#ADC6FF,#E9B3FF)]" animate={{ width: `${muted ? 0 : volume}%` }} />
          </span>
        </button>
        <button type="button" aria-label="Volume up" onClick={() => onKey("volup")} className="grid h-11 w-12 place-items-center rounded-2xl text-ink hover:bg-white/[0.06]">
          <I.Plus size={18} />
        </button>
      </div>
    </div>
  );

  if (!framed) return body;
  return (
    <div className="relative mx-auto w-[18.25rem] rounded-[3rem] bg-[linear-gradient(160deg,#2a3048,#0c1020_45%,#1b2136)] p-[0.6rem] shadow-[0_60px_120px_-40px_rgba(0,0,0,0.95),inset_0_1px_0_rgba(255,255,255,0.18),0_0_0_1px_rgba(173,198,255,0.14)]">
      <div className="relative h-[36.5rem] overflow-hidden rounded-[2.5rem] bg-[radial-gradient(120%_70%_at_50%_0%,#121a33,#090c16_60%,#05070d)]">
        <div className="absolute top-3 left-1/2 z-10 h-[1.6rem] w-[6.2rem] -translate-x-1/2 rounded-full bg-black" />
        {body}
      </div>
    </div>
  );
}

function Ticks({ flash }: { flash: { dir: Dir; n: number } | null }) {
  const spots: Record<Dir, string> = {
    up: "left-1/2 top-[3%] -translate-x-1/2",
    down: "left-1/2 bottom-[3%] -translate-x-1/2",
    left: "top-1/2 left-[3%] -translate-y-1/2",
    right: "top-1/2 right-[3%] -translate-y-1/2",
  };
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {(Object.keys(spots) as Dir[]).map((d) => (
        <motion.span
          key={d + (flash?.dir === d ? flash.n : 0)}
          className={`absolute size-1.5 rounded-full ${spots[d]}`}
          initial={flash?.dir === d ? { scale: 2.6, backgroundColor: "#ffffff", boxShadow: "0 0 18px 4px rgba(116,209,255,.9)" } : false}
          animate={{ scale: 1, backgroundColor: "rgba(255,255,255,0.22)", boxShadow: "0 0 0 0 rgba(116,209,255,0)" }}
          transition={{ duration: 0.45, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

function DPad({ onKey }: { onKey: (k: Key) => void }) {
  const arrow = "absolute grid size-[30%] place-items-center rounded-full text-ink/85 transition-[background-color,color,transform] hover:bg-white/[0.07] hover:text-white active:scale-90";
  return (
    <div className="relative size-full rounded-full bg-[radial-gradient(circle_at_50%_35%,rgba(173,198,255,0.12),rgba(11,16,32,0.9)_70%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.12),inset_0_0_0_1px_rgba(173,198,255,0.16),0_30px_60px_-30px_rgba(0,0,0,0.9)]">
      <span aria-hidden="true" className="absolute inset-[6%] rounded-full border border-white/[0.06]" />
      <button type="button" aria-label="Up" onClick={() => onKey("up")} className={`${arrow} top-[3%] left-1/2 -translate-x-1/2`}>
        <I.Chevron size={22} className="rotate-180" />
      </button>
      <button type="button" aria-label="Down" onClick={() => onKey("down")} className={`${arrow} bottom-[3%] left-1/2 -translate-x-1/2`}>
        <I.Chevron size={22} />
      </button>
      <button type="button" aria-label="Left" onClick={() => onKey("left")} className={`${arrow} top-1/2 left-[3%] -translate-y-1/2`}>
        <I.Chevron size={22} className="rotate-90" />
      </button>
      <button type="button" aria-label="Right" onClick={() => onKey("right")} className={`${arrow} top-1/2 right-[3%] -translate-y-1/2`}>
        <I.Chevron size={22} className="-rotate-90" />
      </button>
      <button
        type="button"
        aria-label="OK"
        onClick={() => onKey("ok")}
        className="absolute top-1/2 left-1/2 grid size-[36%] -translate-1/2 place-items-center rounded-full bg-[linear-gradient(160deg,#74D1FF,#ADC6FF_55%,#E9B3FF)] font-semibold text-night shadow-[0_10px_30px_-8px_rgba(116,209,255,0.7),inset_0_1px_0_rgba(255,255,255,0.6)] transition-transform active:scale-95"
      >
        OK
      </button>
    </div>
  );
}

function Key3({ label, onPress, children, accent }: { label: string; onPress: () => void; children: ReactNode; accent?: boolean }) {
  return (
    <button type="button" onClick={onPress} aria-label={label} className="glass flex h-[3.4rem] flex-col items-center justify-center gap-1 rounded-[1.2rem] text-ink transition-transform active:scale-95">
      <span className={accent ? "text-sky" : ""}>{children}</span>
      <span className="text-[0.6875rem] text-faint">{label}</span>
    </button>
  );
}
