import { motion } from "motion/react";
import type { ReactNode } from "react";
import * as I from "@/components/kit/icons";
import { dateText, timeText, useClock } from "@/lib/hooks";
import { CHANNELS, GROUP_TONES } from "./apps";
import type { DemoState } from "./useDemo";

/*
 * A sketch of Orbit's Control Center: the remote's Settings key pulls it down over whatever is on. The arrows move
 * between tiles by where they sit (spatial navigation, as on the TV), OK switches, Left and Right move a slider.
 */

type Box = [x0: number, x1: number, y0: number, y1: number];
const LAYOUT: Record<string, Box> = {
  wifi: [0, 3.6, 1, 1.9],
  bluetooth: [0, 3.6, 2, 2.9],
  cast: [0, 3.6, 3, 3.9],
  playing: [3.9, 7.6, 1, 3.9],
  inputs: [7.9, 8.9, 1, 2.3],
  picture: [8.95, 9.95, 1, 2.3],
  soundmode: [10, 11, 1, 2.3],
  timer: [11.05, 12.05, 1, 2.3],
  screensaver: [7.9, 8.9, 2.6, 3.9],
  quiet: [8.95, 9.95, 2.6, 3.9],
  clear: [10, 11, 2.6, 3.9],
  recents: [11.05, 12.05, 2.6, 3.9],
  display: [0, 12, 4.2, 4.8],
  sound: [0, 12, 5, 5.6],
  movie: [0, 2.5, 6, 6.8],
  bhakti: [2.6, 5.1, 6, 6.8],
  night: [5.2, 7.7, 6, 6.8],
};

export function ccNeighbor(from: string, dir: "left" | "right" | "up" | "down"): string | null {
  const a = LAYOUT[from];
  if (!a) return null;
  const ax = (a[0] + a[1]) / 2, ay = (a[2] + a[3]) / 2;
  let best: string | null = null;
  let score = Infinity;
  for (const [id, b] of Object.entries(LAYOUT)) {
    if (id === from) continue;
    const bx = (b[0] + b[1]) / 2, by = (b[2] + b[3]) / 2;
    const gapX = Math.max(0, b[0] - ax, ax - b[1]);
    const gapY = Math.max(0, b[2] - ay, ay - b[3]);
    let s = Infinity;
    if (dir === "right" && b[0] > a[1] - 0.05) s = bx - ax + gapY * 3;
    if (dir === "left" && b[1] < a[0] + 0.05) s = ax - bx + gapY * 3;
    if (dir === "down" && b[2] > a[3] - 0.05) s = by - ay + gapX * 3;
    if (dir === "up" && b[3] < a[2] + 0.05) s = ay - by + gapX * 3;
    if (s < score) {
      score = s;
      best = id;
    }
  }
  return best;
}

export function ControlCenter({ state, reduce, onPick }: { state: DemoState; reduce: boolean; onPick: (id: string) => void }) {
  const now = useClock();
  const { cc } = state;
  const f = (id: string) => cc.focus === id;
  const watched = state.watched !== null ? CHANNELS[state.watched] : null;

  return (
    <motion.div className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : 0.3 }}>
      <div className="absolute inset-0 bg-[#05070d]/55 backdrop-blur-[1.4cqw]" />
      <motion.div
        className="absolute inset-0 px-[4.5cqw] pt-[3.2cqw] pb-[2.4cqw]"
        initial={{ y: "-104%" }}
        animate={{ y: "0%" }}
        exit={{ y: "-104%" }}
        transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 30, mass: 0.9 }}
      >
        {/* header */}
        <div className="flex items-start justify-between">
          <div className="flex items-end gap-[1.8cqw]">
            <div className="font-display text-[5.2cqw] leading-[0.85] font-light text-white tabular-nums">{timeText(now).replace(/ ?[ap]m/, "")}</div>
            <div className="pb-[0.3cqw] leading-tight">
              <div className="text-[1.45cqw] font-medium text-white">{dateText(now)}</div>
              <div className="text-[1.15cqw] text-white/55">Family room</div>
            </div>
          </div>
          <div className="flex items-center gap-[1cqw]">
            <div className="flex items-center gap-[0.7cqw] rounded-full border border-white/15 bg-white/[0.06] px-[1.4cqw] py-[0.7cqw] text-[1.15cqw] text-white">
              <I.Phone size={14} className="size-[1.2cqw]" /> <span className="font-semibold">Orbit</span>
              <span className="size-[0.6cqw] rounded-full bg-[#7EE2B8]" /> <span className="text-white/70">Linked</span>
            </div>
            <div className="grid size-[3.4cqw] place-items-center rounded-full border border-white/15 bg-white/[0.06] text-white">
              <I.Power size={14} className="size-[1.4cqw]" />
            </div>
          </div>
        </div>

        <div className="mt-[2cqw] grid grid-cols-[30%_31%_1fr] gap-[1.4cqw]">
          <div className="flex flex-col gap-[0.9cqw]">
            <Pill id="wifi" f={f("wifi")} on={cc.on.wifi} icon={<I.Wifi size={16} className="size-[1.5cqw]" />} title="Wi-Fi" sub={cc.on.wifi ? "Home Wi-Fi" : "Off"} onPick={onPick} />
            <Pill id="bluetooth" f={f("bluetooth")} on={cc.on.bluetooth} icon={<I.Bluetooth size={16} className="size-[1.5cqw]" />} title="Bluetooth" sub={cc.on.bluetooth ? "On · Remote" : "Off"} onPick={onPick} />
            <Pill id="cast" f={f("cast")} on={cc.on.cast} icon={<I.Cast size={16} className="size-[1.5cqw]" />} title="Cast" sub={cc.on.cast ? "Ready as Family room" : "Off"} onPick={onPick} />
          </div>

          <Focusable id="playing" f={f("playing")} onPick={onPick} className="rounded-[1.8cqw] border border-white/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.09),rgba(255,255,255,0.03))] p-[1.4cqw]">
            {watched ? (
              <div className="flex h-full flex-col">
                <div className="flex items-center gap-[1.1cqw]">
                  <div className="grid size-[4.6cqw] place-items-center rounded-[0.9cqw] font-mono text-[1.6cqw] text-white" style={{ background: `linear-gradient(140deg, ${GROUP_TONES[watched.group][0]}, ${GROUP_TONES[watched.group][1]})` }}>
                    {String(watched.num).padStart(2, "0")}
                  </div>
                  <div className="min-w-0 text-left">
                    <div className="text-[1.05cqw] text-white/55">Orbit Live TV</div>
                    <div className="truncate text-[1.55cqw] font-medium text-white">{watched.name}</div>
                    <div className="text-[1.05cqw] text-white/55">{watched.group === "Pay" ? "Pay channel" : `${watched.group} · Live`}</div>
                  </div>
                </div>
                <div className="mt-auto flex items-center gap-[0.8cqw]">
                  <span className="rounded-full bg-[#ff5468] px-[0.7cqw] py-[0.15cqw] text-[0.85cqw] font-semibold tracking-[0.1em] text-white">LIVE</span>
                  <span className="h-[0.35cqw] flex-1 rounded-full bg-white/15">
                    <span className="block h-full w-full rounded-full bg-white/80" />
                  </span>
                </div>
                <div className="mt-[0.8cqw] text-left text-[1cqw] text-white/45">OK returns to it</div>
              </div>
            ) : (
              <div className="flex h-full flex-col justify-center text-left">
                <div className="text-[1.05cqw] text-white/55">Now playing</div>
                <div className="mt-[0.4cqw] text-[1.55cqw] font-medium text-white">Nothing yet</div>
                <div className="mt-[0.4cqw] text-[1.05cqw] text-white/50">OK opens Live TV</div>
              </div>
            )}
          </Focusable>

          <div className="grid grid-cols-4 gap-x-[0.6cqw] gap-y-[1cqw]">
            <Circle id="inputs" f={f("inputs")} on={false} icon={<I.Input size={16} />} label="Inputs" onPick={onPick} />
            <Circle id="picture" f={f("picture")} on={false} icon={<I.Contrast size={16} />} label="Picture" onPick={onPick} />
            <Circle id="soundmode" f={f("soundmode")} on={false} icon={<I.Sliders size={16} />} label="Sound mode" onPick={onPick} />
            <Circle id="timer" f={f("timer")} on={!!cc.on.timer} icon={<I.Timer size={16} />} label="Sleep timer" onPick={onPick} />
            <Circle id="screensaver" f={f("screensaver")} on={!!cc.on.screensaver} icon={<I.Sparkle size={16} />} label="Screensaver" onPick={onPick} />
            <Circle id="quiet" f={f("quiet")} on={!!cc.on.quiet} icon={<I.Moon size={16} />} label="Quiet" onPick={onPick} />
            <Circle id="clear" f={f("clear")} on={!!cc.on.clear} icon={<I.Broom size={16} />} label="Clear all" onPick={onPick} />
            <Circle id="recents" f={f("recents")} on={false} icon={<I.Stack size={16} />} label="Recent apps" onPick={onPick} />
          </div>
        </div>

        <Slider id="display" f={f("display")} label="Display" value={cc.display} icon={<I.Sparkle size={14} className="size-[1.3cqw]" />} onPick={onPick} />
        <Slider id="sound" f={f("sound")} label="Sound" value={state.muted ? 0 : cc.sound} icon={<I.Speaker size={14} className="size-[1.3cqw]" />} onPick={onPick} muted={state.muted} />

        <div className="mt-[1.2cqw] grid grid-cols-[58%_1fr] gap-[1.4cqw]">
          <div className="flex items-center gap-[0.9cqw] rounded-[1.6cqw] border border-white/10 bg-white/[0.04] p-[0.9cqw]">
            <span className="px-[0.6cqw] text-[0.85cqw] tracking-[0.16em] text-white/45 uppercase">Scenes</span>
            <Scene id="movie" f={f("movie")} on={!!cc.on.movie} icon={<I.Film size={14} className="size-[1.3cqw] text-[#ffd479]" />} label="Movie Night" onPick={onPick} />
            <Scene id="bhakti" f={f("bhakti")} on={!!cc.on.bhakti} icon={<I.Diya size={14} className="size-[1.3cqw] text-[#ffd479]" />} label="Bhakti" onPick={onPick} />
            <Scene id="night" f={f("night")} on={!!cc.on.night} icon={<I.Moon size={14} className="size-[1.3cqw] text-[#ffd479]" />} label="Good Night" onPick={onPick} />
          </div>
          <div className="rounded-[1.6cqw] border border-white/10 bg-white/[0.04] px-[1.4cqw] py-[1cqw] text-left">
            <div className="text-[0.85cqw] tracking-[0.16em] text-white/45 uppercase">Notifications</div>
            <div className="mt-[0.5cqw] flex justify-between text-[1.1cqw] text-white/85">
              <span>Orbit is linked</span>
              <span className="text-white/40">now</span>
            </div>
          </div>
        </div>

        <div className="mt-[1.4cqw] flex justify-center gap-[2.4cqw] text-[1cqw] text-white/45">
          <span>
            <K>OK</K> Select
          </span>
          <span>
            <K>◀ ▶</K> Slider
          </span>
          <span>
            <K>Back</K> Close
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}

const ring = "shadow-[0_0_0_0.22cqw_#fff,0_0_2.4cqw_0.2cqw_rgba(173,198,255,0.55)]";

function Focusable({ id, f, onPick, className, children }: { id: string; f: boolean; onPick: (id: string) => void; className: string; children: ReactNode }) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      onClick={() => onPick(id)}
      className={`relative transition-[transform,box-shadow] duration-200 ${f ? `scale-[1.03] ${ring}` : ""} ${className}`}
    >
      {children}
    </button>
  );
}

function Pill({ id, f, on, icon, title, sub, onPick }: { id: string; f: boolean; on: boolean; icon: ReactNode; title: string; sub: string; onPick: (id: string) => void }) {
  return (
    <Focusable id={id} f={f} onPick={onPick} className="flex items-center gap-[1cqw] rounded-full border border-white/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.09),rgba(255,255,255,0.03))] p-[0.6cqw] pr-[1.4cqw] text-left">
      <span className={`grid size-[3.4cqw] shrink-0 place-items-center rounded-full transition-colors ${on ? "bg-white text-[#1a9e5c]" : "bg-white/10 text-white/60"}`}>{icon}</span>
      <span className="min-w-0">
        <span className="block text-[1.3cqw] font-medium text-white">{title}</span>
        <span className="block truncate text-[1cqw] text-white/55">{sub}</span>
      </span>
    </Focusable>
  );
}

function Circle({ id, f, on, icon, label, onPick }: { id: string; f: boolean; on: boolean; icon: ReactNode; label: string; onPick: (id: string) => void }) {
  return (
    <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => onPick(id)} className="flex flex-col items-center gap-[0.5cqw]">
      <span
        className={`grid size-[4.3cqw] place-items-center rounded-full border border-white/14 transition-[transform,box-shadow,background-color] duration-200 [&>svg]:size-[1.6cqw] ${on ? "bg-white text-[#0b1020]" : "bg-[linear-gradient(180deg,rgba(255,255,255,0.1),rgba(255,255,255,0.03))] text-white"} ${f ? `scale-110 ${ring}` : ""}`}
      >
        {icon}
      </span>
      <span className="text-[0.9cqw] whitespace-nowrap text-white/65">{label}</span>
    </button>
  );
}

function Slider({ id, f, label, value, icon, onPick, muted }: { id: string; f: boolean; label: string; value: number; icon: ReactNode; onPick: (id: string) => void; muted?: boolean }) {
  return (
    <Focusable id={id} f={f} onPick={onPick} className="mt-[1.2cqw] flex w-full items-center gap-[1.4cqw] rounded-full border border-white/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.025))] px-[1.8cqw] py-[1cqw]">
      <span className="w-[6cqw] text-left text-[1.25cqw] font-medium text-white">{label}</span>
      <span className="text-white/60">{icon}</span>
      <span className="relative h-[0.6cqw] flex-1 rounded-full bg-white/12">
        <motion.span className="absolute inset-y-0 left-0 rounded-full bg-white" animate={{ width: `${value}%` }} transition={{ type: "spring", stiffness: 300, damping: 30 }} />
      </span>
      <span className="w-[5cqw] text-right font-mono text-[1.1cqw] text-white/70">{muted ? "Muted" : value}</span>
    </Focusable>
  );
}

function Scene({ id, f, on, icon, label, onPick }: { id: string; f: boolean; on: boolean; icon: ReactNode; label: string; onPick: (id: string) => void }) {
  return (
    <Focusable
      id={id}
      f={f}
      onPick={onPick}
      className={`flex flex-1 items-center justify-center gap-[0.6cqw] rounded-full px-[1cqw] py-[0.8cqw] text-[1.1cqw] whitespace-nowrap ${on ? "bg-white text-[#0b1020]" : "bg-white/[0.06] text-white"}`}
    >
      {icon}
      {label}
    </Focusable>
  );
}

function K({ children }: { children: ReactNode }) {
  return <span className="mr-[0.4cqw] inline-block rounded-[0.35cqw] border border-white/25 px-[0.45cqw] font-mono text-[0.85cqw] text-white/75">{children}</span>;
}
