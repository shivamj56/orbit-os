import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import ccUrl from "@/assets/img/control-center.webp";
import homeUrl from "@/assets/img/home.webp";
import LogoLoop, { type LogoItem } from "@/components/reactbits/LogoLoop";
import TiltedCard from "@/components/reactbits/TiltedCard";
import { SectionHead } from "@/components/kit/SectionHead";
import * as I from "@/components/kit/icons";
import { CHANNELS, type Channel } from "@/demo/apps";
import { FESTIVALS, nextFestival } from "@/data/festivals";
import { useReducedMotion } from "@/lib/hooks";
import { useThemeValue } from "@/lib/themeContext";

/** "Made for Indian homes": the channels people watch, the days they celebrate, and help for parents. */
export function IndianHomes() {
  const reduce = useReducedMotion();
  const day = useThemeValue() === "light";
  const free = CHANNELS.filter((c) => c.group !== "Pay");
  const rowA = free.slice(0, 15).map(chip);
  const rowB = [...free.slice(15), ...CHANNELS.filter((c) => c.group === "Pay")].map(chip);

  return (
    <section id="india" aria-labelledby="india-title" className="relative overflow-hidden py-[clamp(5rem,11vw,9rem)]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-[8%] -z-10 h-[60%] bg-[radial-gradient(50%_60%_at_30%_40%,rgba(255,153,51,0.08),transparent_70%),radial-gradient(40%_50%_at_75%_60%,rgba(31,163,74,0.06),transparent_70%)]" />
      <div className="wrap">
        <SectionHead
          eyebrow="Made for Indian homes"
          title="Bhakti in the morning. News at night. Diwali on the home screen."
          lede="Thirty free Hindi channels with numbers like a set-top box, the festivals your family keeps, and a way to help your parents with their TV from wherever you are."
        />
        <span id="india-title" className="sr-only">
          Made for Indian homes
        </span>
      </div>

      {/* The line-up, scrolling past like a channel guide (React Bits LogoLoop, names only). */}
      <div className="mt-[clamp(2.5rem,5vw,3.5rem)] space-y-3" aria-label="Orbit Live TV's channels">
        <LogoLoop logos={rowA} speed={reduce ? 0 : 38} direction="left" logoHeight={44} gap={12} pauseOnHover scrollBoost={reduce ? 0 : 1.2} fadeOut fadeOutWidth={0.06} fadeOutColor={day ? "#f5f6fa" : "#05070d"} ariaLabel="News and serials channels" />
        <LogoLoop logos={rowB} speed={reduce ? 0 : 32} direction="right" logoHeight={44} gap={12} pauseOnHover scrollBoost={reduce ? 0 : 1.2} fadeOut fadeOutWidth={0.06} fadeOutColor={day ? "#f5f6fa" : "#05070d"} ariaLabel="Bhakti, kids, movies and pay channels" />
      </div>

      <div className="wrap mt-10 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <FestivalCard reduce={reduce} />
        <BhaktiCard />
        <HelpCard reduce={reduce} />
      </div>
    </section>
  );
}

// Deep enough for white numbers (each at least 5:1).
const BADGE: Record<Channel["group"], [string, string]> = {
  News: ["#b3203a", "#7a1528"],
  Serials: ["#a3196e", "#6e0f4a"],
  Bhakti: ["#a84800", "#7a3400"],
  Kids: ["#1d7a3c", "#145a2c"],
  Movies: ["#5b34c7", "#3f2392"],
  Pay: ["#4a5371", "#323950"],
};

function chip(c: Channel): LogoItem {
  return {
    title: `${c.num} ${c.name}`,
    ariaLabel: c.group === "Pay" ? `${c.name}, a pay channel, opens in ${c.app}` : `Channel ${c.num}, ${c.name}, ${c.group}`,
    node: (
      <span className="inline-flex h-11 items-center gap-2.5 rounded-full border border-line bg-surface/80 py-1 pr-4 pl-1.5 text-[0.9375rem] whitespace-nowrap text-ink shadow-[0_10px_24px_-18px_rgb(var(--shadow-rgb)/var(--shadow-a))]">
        <span className="grid h-8 min-w-8 place-items-center rounded-full px-1.5 font-mono text-[0.75rem] font-semibold text-white" style={{ background: `linear-gradient(140deg, ${BADGE[c.group][0]}, ${BADGE[c.group][1]})` }}>
          {String(c.num).padStart(2, "0")}
        </span>
        {c.name}
        <span className="font-mono text-[0.6875rem] tracking-[0.08em] text-dim uppercase">{c.group === "Pay" ? `via ${c.app}` : c.group}</span>
      </span>
    ),
  };
}

/** Festivals: Orbit Home's real greetings, in each day's two colours, and the next one on your calendar. */
function FestivalCard({ reduce }: { reduce: boolean }) {
  const [i, setI] = useState(0);
  const coming = useMemo(() => nextFestival(new Date()), []);
  useEffect(() => {
    if (reduce) return;
    const t = window.setInterval(() => setI((v) => (v + 1) % FESTIVALS.length), 2600);
    return () => window.clearInterval(t);
  }, [reduce]);
  const f = FESTIVALS[i];
  const when = coming ? coming.start.toLocaleDateString("en-IN", { day: "numeric", month: "long" }) : null;
  return (
    <article className="card relative flex flex-col overflow-hidden rounded-[2rem] p-6 sm:p-7">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl bg-accent/10 text-accent">
          <I.Calendar size={18} />
        </span>
        <span className="font-mono text-[0.75rem] tracking-[0.12em] text-dim uppercase">Festival greetings</span>
      </div>
      {/* a small TV, greeting the way Orbit Home does on the day */}
      <div className="relative mt-5 aspect-video overflow-hidden rounded-[14px] bg-black ring-1 ring-[#ADC6FF]/15" style={{ containerType: "inline-size" }}>
        <motion.div
          className="absolute inset-0"
          animate={{ background: `radial-gradient(60% 70% at 30% 75%, ${f.glow}66, transparent 70%), radial-gradient(55% 65% at 75% 70%, ${f.glow2}55, transparent 70%), #000` }}
          transition={{ duration: reduce ? 0 : 1.1 }}
        />
        <div className="absolute inset-x-0 top-[22%] text-center">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={f.title} initial={{ opacity: 0, y: "3cqw", filter: "blur(6px)" }} animate={{ opacity: 1, y: "0cqw", filter: "blur(0px)" }} exit={{ opacity: 0, y: "-2cqw", filter: "blur(6px)" }} transition={{ duration: reduce ? 0 : 0.5 }}>
              <div className="font-display text-[8.4cqw] leading-none font-light text-white">{f.title}{f.title.startsWith("Happy") || f.title.startsWith("Merry") ? ", Asha" : ""}</div>
              <div className="mt-[3cqw] text-[3.6cqw] text-white/85">{f.line}</div>
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="absolute inset-x-[18%] bottom-[16%] flex justify-center gap-[2.4cqw]" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((k) => (
            <span key={k} className="h-[13cqw] flex-1 rounded-[1.6cqw] border border-white/20 bg-white/10" style={k === 2 ? { boxShadow: `0 0 4cqw ${f.glow}aa`, background: "rgba(255,255,255,0.22)" } : undefined} />
          ))}
        </div>
      </div>
      <p className="mt-5 text-[0.9375rem] leading-relaxed text-soft">
        Home dresses up by itself: the greeting says the day, with your name, and the room's light takes the day's two colours. Diwali, Holi, Chhath Puja, Navratri, Ganesh Chaturthi and more,
        and the fixed days: Republic Day, Independence Day, Christmas, New Year.
      </p>
      {coming && (
        <p className="mt-auto pt-5 text-[0.875rem] text-soft">
          <span className="mr-2 inline-block size-2 rounded-full align-middle" style={{ background: coming.festival.glow, boxShadow: `0 0 10px ${coming.festival.glow}` }} />
          {coming.today ? "Today on your TV: " : `Next on your TV, ${when}: `}
          <span className="font-medium text-ink">{coming.festival.title}</span>
        </p>
      )}
    </article>
  );
}

/** Bhakti: the real Control Center photo, with a bhajan playing and the Bhakti scene (React Bits TiltedCard). */
function BhaktiCard() {
  return (
    <article className="card relative flex flex-col overflow-hidden rounded-[2rem] p-6 sm:p-7">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl bg-accent/10 text-accent">
          <I.Diya size={18} />
        </span>
        <span className="font-mono text-[0.75rem] tracking-[0.12em] text-dim uppercase">Bhakti, built in</span>
      </div>
      <div className="mt-5 aspect-[1178/664] w-full">
        <TiltedCard
          imageSrc={ccUrl}
          altText="Orbit's Control Center on the TV: a bhajan playing, the Bhakti scene among Movie Night and Good Night"
          containerHeight="100%"
          containerWidth="100%"
          imageHeight="100%"
          imageWidth="100%"
          rotateAmplitude={9}
          scaleOnHover={1.04}
          showTooltip={false}
          radius={14}
          glare={0.35}
          shadow={0.5}
        />
      </div>
      <p className="mt-5 text-[0.9375rem] leading-relaxed text-soft">
        Five bhakti channels in Live TV, a Bhakti scene in the Control Center, and the lyrics of songs and bhajans while they play. This photo is the real Control Center, on the TV.
      </p>
    </article>
  );
}

/** Help mode: you see their TV's screen on your phone and press the buttons for them. */
function HelpCard({ reduce }: { reduce: boolean }) {
  return (
    <article className="card relative flex flex-col overflow-hidden rounded-[2rem] p-6 sm:p-7">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-xl bg-accent/10 text-accent">
          <I.Heart size={18} />
        </span>
        <span className="font-mono text-[0.75rem] tracking-[0.12em] text-dim uppercase">Help mode, for parents</span>
      </div>
      <div className="relative mt-5 grid aspect-video place-items-center overflow-hidden rounded-[14px] bg-[radial-gradient(80%_80%_at_50%_30%,var(--halo-1),transparent_70%)] ring-1 ring-line">
        {/* their TV, far away */}
        <div className="absolute top-[12%] right-[7%] w-[56%] rounded-[8px] bg-black p-[3px] shadow-[0_20px_40px_-20px_rgb(var(--shadow-rgb)/var(--shadow-a))]">
          <img src={homeUrl} alt="" className="w-full rounded-[5px]" />
          <span className="absolute top-[8%] left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/75 px-1.5 py-0.5 text-[clamp(6px,0.75vw,9px)] whitespace-nowrap text-white">
            <span className="size-1 rounded-full bg-[#ff5468]" /> Shiv can see this screen
          </span>
        </div>
        {/* your phone, showing their screen; a tap presses OK on it */}
        <div className="absolute bottom-[-30%] left-[10%] w-[30%] rounded-[16px] bg-[#0b0e16] p-[3px] shadow-[0_20px_40px_-14px_rgb(var(--shadow-rgb)/var(--shadow-a))] ring-1 ring-[#ADC6FF]/15">
          <div className="relative overflow-hidden rounded-[13px] bg-[#05070d] pt-[14%] pb-[60%]">
            <img src={homeUrl} alt="" className="w-full" />
            <span className="absolute top-[5%] left-[8%] flex items-center gap-1 text-[clamp(6px,0.7vw,8px)] text-white/80">
              <span className="size-1 rounded-full bg-[#ff5468] motion-safe:animate-[live-pulse_1.4s_ease-in-out_infinite]" /> Family room
            </span>
            {!reduce && (
              <motion.span
                className="absolute top-[30%] left-[48%] size-4 rounded-full border-2 border-white"
                animate={{ scale: [0.4, 1.6], opacity: [0.9, 0] }}
                transition={{ duration: 1.4, repeat: Infinity, ease: "easeOut" }}
              />
            )}
          </div>
        </div>
      </div>
      <p className="mt-5 text-[0.9375rem] leading-relaxed text-soft">
        The TV is stuck on a menu, and you are in another city. Open Orbit, see their TV's screen on your phone, and tap to press its buttons. The TV always says who is watching, and help ends by itself.
      </p>
    </article>
  );
}
