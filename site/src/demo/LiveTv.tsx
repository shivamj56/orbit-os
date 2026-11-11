import { AnimatePresence, motion } from "motion/react";
import SplitFlapText from "@/components/reactbits/SplitFlapText";
import * as I from "@/components/kit/icons";
import { CHANNELS, GROUP_TONES, type Channel } from "./apps";
import type { DemoState } from "./useDemo";

/*
 * Orbit Live TV, as a sketch: the real app plays each channel from the channel's own servers; here the picture is the
 * channel's ident in its group's light, with the number board flipping as you zap. Pay channels say which app opens them.
 */
export function LiveTv({ state, reduce }: { state: DemoState; reduce: boolean }) {
  const ch = CHANNELS[state.channel];
  const tones = GROUP_TONES[ch.group];
  const pay = ch.group === "Pay";
  const groupList = CHANNELS.filter((c) => c.group === ch.group);

  return (
    <motion.div
      className="absolute inset-0 overflow-hidden bg-black"
      initial={{ clipPath: "inset(31% 43.8% 36% 43.8% round 1.2cqw)" }}
      animate={{ clipPath: "inset(0% 0% 0% 0% round 0cqw)" }}
      exit={{ clipPath: "inset(31% 43.8% 36% 43.8% round 1.2cqw)", opacity: 0 }}
      transition={{ duration: reduce ? 0 : 0.5, ease: [0.25, 1, 0.5, 1] }}
    >
      {/* the picture */}
      <AnimatePresence initial={false}>
        <motion.div
          key={ch.num}
          className="absolute inset-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
          style={{
            background: `radial-gradient(60% 75% at 22% 30%, ${tones[0]}66, transparent 70%), radial-gradient(55% 70% at 80% 72%, ${tones[1]}55, transparent 70%), ${tones[2]}`,
          }}
        >
          <div className="absolute inset-0 motion-safe:animate-[live-drift_14s_ease-in-out_infinite_alternate]" style={{ background: `radial-gradient(40% 50% at 60% 40%, ${tones[1]}33, transparent 70%)` }} />
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center">
              <div className="font-display text-[1.3cqw] tracking-[0.3em] text-white/60 uppercase">{pay ? "Pay channel" : ch.group}</div>
              <div className="mt-[1.2cqw] font-display text-[6.2cqw] leading-none font-light tracking-[-0.02em] text-white">{ch.name}</div>
              {pay ? (
                <div className="mt-[2cqw] inline-flex items-center gap-[0.8cqw] rounded-full border border-white/20 bg-black/35 px-[1.6cqw] py-[0.7cqw] text-[1.3cqw] text-white">
                  Opens in {ch.app}, with your plan <I.ArrowUpRight size={14} className="size-[1.3cqw]" />
                </div>
              ) : (
                <div className="mt-[2cqw] text-[1.25cqw] text-white/60">Played from the channel's own stream</div>
              )}
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
      <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(0deg,rgba(255,255,255,0.025)_0px,rgba(255,255,255,0.025)_1px,transparent_1px,transparent_3px)]" />

      {/* a burst of static on every zap */}
      {!reduce && (
        <AnimatePresence>
          <motion.div
            key={state.zapId}
            className="tv-static pointer-events-none absolute inset-0"
            initial={{ opacity: 0.85 }}
            animate={{ opacity: 0 }}
            transition={{ duration: 0.38, ease: "easeOut" }}
          />
        </AnimatePresence>
      )}

      <div className="absolute top-[5%] left-[4%] flex items-center gap-[1cqw]">
        <span className="flex items-center gap-[0.5cqw] rounded-full bg-[#ff5468] px-[1cqw] py-[0.35cqw] text-[1cqw] font-semibold tracking-[0.12em] text-white">
          <span className="size-[0.6cqw] rounded-full bg-white motion-safe:animate-[live-pulse_1.6s_ease-in-out_infinite]" />
          LIVE
        </span>
        <span className="text-[1.15cqw] text-white/70">Orbit Live TV</span>
      </div>

      {/* the guide */}
      <AnimatePresence>
        {state.guide && (
          <motion.div
            className="absolute top-[4%] bottom-[24%] left-[3%] w-[30%] overflow-hidden rounded-[1.4cqw] border border-white/12 bg-black/60 p-[1.2cqw] backdrop-blur-xl"
            initial={{ opacity: 0, x: "-3cqw" }}
            animate={{ opacity: 1, x: "0cqw" }}
            exit={{ opacity: 0, x: "-3cqw" }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
          >
            <div className="text-[1cqw] tracking-[0.18em] text-white/50 uppercase">{ch.group === "Pay" ? "Pay channels" : ch.group}</div>
            <ul className="mt-[1cqw] space-y-[0.4cqw]">
              {groupList.slice(0, 8).map((c) => (
                <li
                  key={c.num}
                  className={`flex items-center gap-[1cqw] rounded-[0.8cqw] px-[0.8cqw] py-[0.55cqw] text-[1.2cqw] ${c.num === ch.num ? "bg-white text-black" : "text-white/80"}`}
                >
                  <span className="w-[2.4cqw] font-mono text-[1cqw] opacity-70">{String(c.num).padStart(2, "0")}</span>
                  <span className="truncate">{c.name}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>

      {/* the banner */}
      <div className="absolute inset-x-[3%] bottom-[4.5%] flex items-center gap-[2cqw] rounded-[1.8cqw] border border-white/12 bg-[linear-gradient(180deg,rgba(20,24,36,0.78),rgba(8,10,16,0.86))] px-[2cqw] py-[1.4cqw] shadow-[0_2cqw_4cqw_-2cqw_rgba(0,0,0,0.8)] backdrop-blur-xl">
        <SplitFlapText
          text={String(ch.num).padStart(2, "0")}
          charset="numeric"
          padTo={2}
          loop={false}
          intro={false}
          flipsPerChar={reduce ? 0 : 4}
          flipDuration={0.06}
          stagger={0.03}
          fontSize="3.4cqw"
          gap="0.35cqw"
          tileRadius="0.6cqw"
          tileColor="#141a2b"
          textColor="#f2f5ff"
          glare={0.25}
          aria-label={`Channel ${ch.num}`}
        />
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[2.5cqw] leading-tight text-white">{ch.name}</div>
          <div className="mt-[0.3cqw] flex items-center gap-[0.8cqw] text-[1.15cqw] text-white/55">
            <ChannelTag ch={ch} />
          </div>
        </div>
        <div className="hidden flex-col items-end gap-[0.4cqw] text-[1cqw] text-white/50 sm:flex">
          <span>
            <Kbd>▲</Kbd>
            <Kbd>▼</Kbd> channel
          </span>
          <span>
            <Kbd>OK</Kbd> guide · <Kbd>Back</Kbd> Home
          </span>
        </div>
      </div>
    </motion.div>
  );
}

function ChannelTag({ ch }: { ch: Channel }) {
  if (ch.group === "Pay") return <span>Pay channel · opens {ch.app}</span>;
  return (
    <span>
      {ch.group} · Free
    </span>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return <span className="mx-[0.15cqw] inline-block rounded-[0.35cqw] border border-white/25 px-[0.45cqw] py-[0.05cqw] font-mono text-[0.85cqw] text-white/80">{children}</span>;
}
