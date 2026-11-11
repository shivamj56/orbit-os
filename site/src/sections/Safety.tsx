import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import homeUrl from "@/assets/img/home.webp";
import SquishSwitch from "@/components/reactbits/SquishSwitch";
import { Clutter } from "@/sections/Calm";
import SpotlightCard from "@/components/reactbits/SpotlightCard";
import { orbitSpotlight } from "@/lib/style";
import { NumberTicker } from "@/components/magicui/number-ticker";
import { SectionHead } from "@/components/kit/SectionHead";
import * as I from "@/components/kit/icons";
import { useReducedMotion } from "@/lib/hooks";
import { useThemeValue } from "@/lib/themeContext";

// The plan Orbit Setup showed for the family room TV: 32 apps in named groups, switched off, never deleted.
const GROUPS = [
  { name: "Ads and tracking", count: 12, why: "Analytics, usage statistics, ad services" },
  { name: "Apps nobody here uses", count: 5, why: "The TV's music player, scene modes" },
  { name: "Woken at every start", count: 6, why: "Partner setup, calendar sync" },
  { name: "The stock home screen", count: 4, why: "Replaced by Orbit Home" },
  { name: "Casting", count: 1, why: "You said you don't cast from a phone" },
  { name: "USB playback", count: 3, why: "You said you don't play from a USB drive" },
  { name: "The maker's channels", count: 1, why: "You said you don't watch them" },
];
const TOTAL = GROUPS.reduce((n, g) => n + g.count, 0);

export function Safety() {
  const [on, setOn] = useState(true);
  const reduce = useReducedMotion();
  const day = useThemeValue() === "light";

  return (
    <section id="safety" tabIndex={-1} aria-labelledby="safety-title" className="relative py-[clamp(5rem,11vw,9rem)] outline-none">
      <div className="wrap">
        <SectionHead
          eyebrow="Safety you can feel"
          title="It never breaks what it cannot put back."
          lede="Flip the switch. This is the plan Orbit Setup showed for a real TV: what it switches off, in plain words, and how it all comes back."
        />
        <span id="safety-title" className="sr-only">
          Safety
        </span>

        <div className="panel mt-[clamp(2.5rem,5vw,4rem)] grid grid-cols-1 overflow-hidden rounded-[2rem] lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <div className="relative flex flex-col justify-between gap-8 border-b border-line p-6 sm:p-9 lg:border-r lg:border-b-0">
            <div aria-hidden="true" className={`pointer-events-none absolute inset-0 transition-opacity duration-700 ${on ? "opacity-0" : "opacity-100"} bg-[radial-gradient(80%_60%_at_20%_10%,color-mix(in_srgb,var(--ok)_14%,transparent),transparent_70%)]`} />
            <div className="relative">
              <p className="eyebrow !text-dim">Family room · Xiaomi TV A Pro</p>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-4">
                <div>
                  <div className="font-display text-[1.75rem] leading-tight text-ink">Orbit OS</div>
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={on ? "on" : "off"}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -6 }}
                      transition={{ duration: reduce ? 0 : 0.25 }}
                      className={`mt-1 text-[0.9375rem] ${on ? "text-accent-2" : "text-ok"}`}
                    >
                      {on ? "On. Orbit Home is the home screen." : "Undone. The TV is back as it was."}
                    </motion.div>
                  </AnimatePresence>
                </div>
                <SquishSwitch
                  checked={on}
                  onChange={setOn}
                  width={92}
                  height={50}
                  trackColor={day ? "#bfe9d6" : "rgba(126,226,184,0.35)"}
                  trackOnColor={day ? "#0a6aa3" : "#74D1FF"}
                  thumbColor={day ? "#0a7350" : "#F2F5FF"}
                  thumbOnColor={day ? "#ffffff" : "#05070D"}
                  ariaLabel="Orbit OS on this TV. Switch off to undo everything."
                />
              </div>
            </div>
            {/* the TV itself: Orbit Home, or its own home screen back after Undo */}
            <div className="relative overflow-hidden rounded-[14px] bg-black p-[5px] shadow-[0_30px_70px_-30px_rgb(var(--shadow-rgb)/var(--shadow-a)),0_0_0_1px_rgba(173,198,255,0.14)]">
              <div className="relative aspect-video overflow-hidden rounded-[9px]" style={{ containerType: "inline-size" }}>
                <AnimatePresence initial={false}>
                  {on ? (
                    <motion.img
                      key="orbit"
                      src={homeUrl}
                      alt="Orbit Home on the TV"
                      className="absolute inset-0 h-full w-full object-cover"
                      initial={reduce ? { opacity: 0 } : { opacity: 0, scaleY: 0.02, filter: "brightness(3)" }}
                      animate={{ opacity: 1, scaleY: 1, filter: "brightness(1)" }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: reduce ? 0 : 0.55, ease: [0.19, 1, 0.22, 1] }}
                    />
                  ) : (
                    <motion.div
                      key="stock"
                      className="absolute inset-0"
                      role="img"
                      aria-label="A sketch of the TV's own home screen, back after Undo"
                      initial={reduce ? { opacity: 0 } : { opacity: 0, scaleY: 0.02, filter: "brightness(3)" }}
                      animate={{ opacity: 1, scaleY: 1, filter: "brightness(1)" }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: reduce ? 0 : 0.55, ease: [0.19, 1, 0.22, 1] }}
                    >
                      <Clutter />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <span className={`absolute right-3 bottom-3 rounded-full bg-black/70 px-2.5 py-1 font-mono text-[0.625rem] tracking-[0.08em] uppercase backdrop-blur ${on ? "text-[#ADC6FF]" : "text-[#7EE2B8]"}`}>
                {on ? "Orbit Home" : "The TV's own home, back"}
              </span>
            </div>
            <dl className="relative grid grid-cols-2 gap-3">
              <Stat label="Switched off" value={on ? TOTAL : 0} tone={on ? "text-ink" : "text-ok"} />
              <Stat label="Deleted" value={0} tone="text-ok" fixed />
            </dl>
            <button
              type="button"
              onClick={() => setOn((v) => !v)}
              className="relative inline-flex h-12 items-center justify-center gap-2 self-start rounded-full border border-line bg-veil/[0.04] px-5 text-[0.9375rem] font-medium text-ink transition-colors hover:border-veil/20 hover:bg-veil/[0.07]"
            >
              <I.Undo size={18} className={on ? "text-ok" : "text-accent"} />
              {on ? "Undo everything" : "Put Orbit OS back"}
            </button>
          </div>

          <ul className="divide-y divide-line p-2 sm:p-4" aria-label="What Orbit switches off on this TV">
            <Row label="Home screen" why={on ? "Orbit Home" : "The TV's own, back"} count={null} off={false} index={0} reduce={reduce} day={day} accent={on ? "text-accent-2" : "text-ok"} />
            {GROUPS.map((g, i) => (
              <Row key={g.name} label={g.name} why={g.why} count={g.count} off={on} index={i + 1} reduce={reduce} day={day} />
            ))}
          </ul>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact icon={<I.NoTrash size={20} />} title="Nothing is deleted">
            Apps are switched off, never uninstalled. The parts Android needs to run are never touched.
          </Fact>
          <Fact icon={<I.Undo size={20} />} title="One tap undoes it all">
            Orbit records every change it makes. Undo switches each app back on and returns the TV's own home screen.
          </Fact>
          <Fact icon={<I.Lock size={20} />} title="No root, no unlocking">
            Orbit uses Android's own developer switch. The bootloader stays locked and nothing is reset.
          </Fact>
          <Fact icon={<I.ListIcon size={20} />} title="You see the list first">
            Every app it would switch off is named before anything changes, and you can keep any of them.
          </Fact>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, tone, fixed }: { label: string; value: number; tone: string; fixed?: boolean }) {
  return (
    <div className="rounded-2xl border border-line bg-veil/[0.03] p-4">
      <dt className="font-mono text-[0.6875rem] tracking-[0.12em] text-dim uppercase">{label}</dt>
      <dd className={`mt-1 font-display text-[2.4rem] leading-none font-light ${tone}`}>
        {fixed ? <span>0</span> : <NumberTicker key={value} value={value} startValue={value === 0 ? TOTAL : 0} direction={value === 0 ? "down" : "up"} />}
      </dd>
    </div>
  );
}

function Row({ label, why, count, off, index, reduce, accent, day }: { label: string; why: string; count: number | null; off: boolean; index: number; reduce: boolean; accent?: string; day: boolean }) {
  const delay = reduce ? 0 : index * 0.055;
  return (
    <li className="flex items-center gap-4 px-3 py-3 sm:px-4">
      <div className="min-w-0 flex-1">
        <div className="relative inline-block max-w-full">
          <span className={`block truncate text-[0.9375rem] font-medium transition-colors duration-500 ${off ? "text-soft" : "text-ink"}`} style={{ transitionDelay: `${delay}s` }}>
            {label}
          </span>
          <motion.span
            aria-hidden="true"
            className="absolute top-1/2 left-0 h-px w-full origin-left bg-soft/70"
            initial={false}
            animate={{ scaleX: off ? 1 : 0 }}
            transition={{ duration: reduce ? 0 : 0.35, delay, ease: [0.65, 0, 0.35, 1] }}
          />
        </div>
        <div className={`truncate text-[0.8125rem] ${accent ?? "text-dim"}`}>{why}</div>
      </div>
      {count !== null && <span className="font-mono text-[0.75rem] text-dim tabular-nums">{count}</span>}
      <motion.span
        className={`relative inline-flex h-6 w-[4.25rem] shrink-0 items-center justify-center rounded-full border text-[0.6875rem] font-semibold tracking-[0.08em] uppercase`}
        initial={false}
        animate={{
          backgroundColor: off ? (day ? "rgba(11,16,32,0.03)" : "rgba(255,255,255,0.03)") : day ? "rgba(10,115,80,0.10)" : "rgba(126,226,184,0.14)",
          borderColor: off ? (day ? "rgba(11,16,32,0.14)" : "rgba(255,255,255,0.12)") : day ? "rgba(10,115,80,0.45)" : "rgba(126,226,184,0.45)",
          color: off ? (day ? "#4a5371" : "#939dbb") : day ? "#0a7350" : "#7EE2B8",
          scale: [1, 1.12, 1],
        }}
        transition={{ duration: reduce ? 0 : 0.4, delay }}
      >
        {count === null ? "Home" : off ? "Off" : "On"}
      </motion.span>
    </li>
  );
}

function Fact({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  const day = useThemeValue() === "light";
  return (
    <SpotlightCard theme={day ? "light" : "dark"} spotlightColor={day ? "rgba(10, 115, 80, 0.10)" : "rgba(126, 226, 184, 0.16)"} style={orbitSpotlight} className="h-full rounded-[1.5rem] p-6">
      <span className="grid size-11 place-items-center rounded-2xl bg-ok/10 text-ok">{icon}</span>
      <h3 className="mt-4 font-display text-[1.25rem] font-medium text-ink">{title}</h3>
      <p className="mt-2 text-[0.9375rem] leading-relaxed text-soft">{children}</p>
    </SpotlightCard>
  );
}
