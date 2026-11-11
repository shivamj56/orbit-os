import { motion } from "motion/react";
import type { ReactNode } from "react";
import { NumberTicker } from "@/components/magicui/number-ticker";
import SpotlightCard from "@/components/reactbits/SpotlightCard";
import { orbitSpotlight } from "@/lib/style";
import { SectionHead } from "@/components/kit/SectionHead";
import * as I from "@/components/kit/icons";
import { useThemeValue } from "@/lib/themeContext";

/*
 * "By the numbers": only values that were measured on the Xiaomi TV A Pro in daily use (devices/xiaomi-mitv-axfu0)
 * or counted from Orbit's own lists. Nothing estimated, nothing about users.
 */
export function Numbers() {
  return (
    <section id="numbers" aria-labelledby="numbers-title" className="relative py-[clamp(5rem,11vw,8rem)]">
      <div className="wrap">
        <SectionHead
          eyebrow="By the numbers"
          title="Measured on a real TV, not promised."
          lede="Each number was measured on the Xiaomi TV A Pro in daily use, a low-memory TV with four small cores, or counted from Orbit's own lists."
        />
        <span id="numbers-title" className="sr-only">
          By the numbers
        </span>

        <div className="mt-[clamp(2.5rem,5vw,4rem)] grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
          <Stat
            className="lg:col-span-3"
            icon={<I.Gauge size={18} />}
            label="Control Center"
            value={<Num v={60} />}
            unit="fps"
            text="Opening the Control Center and moving in it: sixty frames a second, with no missed frames."
            big
          />
          <Stat
            className="lg:col-span-3"
            icon={<I.Tv size={18} />}
            label="Gallery scrolling"
            value={
              <>
                <Num v={400} /> <span className="text-[0.45em] [-webkit-text-fill-color:var(--dim)]">frames,</span> <span className="tabular-nums">0</span> <span className="text-[0.45em] [-webkit-text-fill-color:var(--dim)]">janky</span>
              </>
            }
            text="Scrolling the curved row: not one janky frame in four hundred, about 11 ms a frame."
            big
          />
          <Stat className="lg:col-span-2" icon={<I.Power size={18} />} label="Power-on to Home" value={<><span className="text-[0.6em] [-webkit-text-fill-color:var(--dim)]">≈</span><Num v={39} /></>} unit="s" text="From pressing power to Home on screen, the boot film included." />
          <Stat className="lg:col-span-2" icon={<I.Undo size={18} />} label="The plan on that TV" value={<><Num v={32} /> <span className="text-[0.45em] [-webkit-text-fill-color:var(--dim)]">off ·</span> <span className="tabular-nums">0</span> <span className="text-[0.45em] [-webkit-text-fill-color:var(--dim)]">deleted</span></>} text="Apps switched off by Orbit Setup, and apps uninstalled: none, ever." />
          <Stat className="lg:col-span-2" icon={<I.Chip size={18} />} label="Live TV memory" value={<><Num v={54} />–<Num v={62} /></>} unit="MB" text="What Orbit Live TV uses while a channel plays." />
          <Stat
            className="sm:col-span-2 lg:col-span-6"
            icon={<I.Film size={18} />}
            label="Live TV line-up"
            value={<Num v={30} />}
            unit="free channels"
            text="News 11 · Serials 7 · Bhakti 5 · Kids 2 · Movies 5, each played from the channel's own servers. Pay channels open in their own apps."
            wide
          />
        </div>
      </div>
    </section>
  );
}

function Num({ v, from }: { v: number; from?: number }) {
  return <NumberTicker value={v} startValue={from ?? 0} direction={from !== undefined && from > v ? "down" : "up"} className="tabular-nums" />;
}

function Stat({ icon, label, value, unit, text, className = "", big, wide }: { icon: ReactNode; label: string; value: ReactNode; unit?: string; text: string; className?: string; big?: boolean; wide?: boolean }) {
  const day = useThemeValue() === "light";
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 28, scale: 0.98 }}
      whileInView={{ opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, amount: 0.4 }}
      transition={{ duration: 0.8, ease: [0.19, 1, 0.22, 1] }}
    >
      <SpotlightCard
        theme={day ? "light" : "dark"}
        spotlightColor={day ? "rgba(74, 91, 214, 0.10)" : "rgba(116, 209, 255, 0.14)"}
        style={orbitSpotlight}
        className={`flex h-full flex-col justify-between gap-6 rounded-[1.75rem] p-6 sm:p-7 ${wide ? "lg:flex-row lg:items-end" : ""}`}
      >
        <div className="flex items-center gap-2.5">
          <span className="grid size-9 place-items-center rounded-xl bg-accent/10 text-accent">{icon}</span>
          <span className="font-mono text-[0.75rem] tracking-[0.12em] text-dim uppercase">{label}</span>
        </div>
        <div className={wide ? "lg:max-w-[44rem]" : ""}>
          <div className={`flex flex-wrap items-baseline gap-x-2 font-display leading-[0.95] font-[300] tracking-[-0.04em] ${big ? "text-[clamp(3.25rem,7vw,5.5rem)]" : "text-[clamp(2.75rem,5vw,3.75rem)]"}`}>
            <span className="iris-text">{value}</span>
            {unit && <span className="text-[0.32em] font-normal tracking-normal text-soft">{unit}</span>}
          </div>
          <p className="mt-3 max-w-[34rem] text-[0.9375rem] leading-relaxed text-soft">{text}</p>
        </div>
      </SpotlightCard>
    </motion.div>
  );
}
