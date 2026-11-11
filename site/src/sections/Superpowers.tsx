import { AnimatePresence, motion } from "motion/react";
import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";
import homeUrl from "@/assets/img/home.webp";
import remoteUrl from "@/assets/setup/16-remote.webp";
import { AnimatedBeam } from "@/components/magicui/animated-beam";
import { OrbitingCircles } from "@/components/magicui/orbiting-circles";
import { Globe } from "@/components/magicui/globe";
import DecryptedText from "@/components/reactbits/DecryptedText";
import { SectionHead } from "@/components/kit/SectionHead";
import * as I from "@/components/kit/icons";
import { useInView, useReducedMotion } from "@/lib/hooks";
import { useThemeValue } from "@/lib/themeContext";

type Mode = "wifi" | "cloud" | "help";

const MODES: { id: Mode; title: string; tag: string; text: string; facts: string[] }[] = [
  {
    id: "wifi",
    title: "A remote you can type on",
    tag: "Same Wi-Fi",
    text: "Roll the globe to move, tap for OK. The D-pad, volume and sleep are there too, and the phone's keyboard types straight into the TV's search boxes.",
    facts: ["Paired once with the code the TV shows", "Straight to the TV over your Wi-Fi"],
  },
  {
    id: "cloud",
    title: "From anywhere",
    tag: "Through the cloud",
    text: "Link once with Google sign-in and the 8-digit code the TV shows, and the remote keeps working when you are nowhere near the home Wi-Fi.",
    facts: ["Google sign-in, one 8-digit code", "Each account reads only its own TV"],
  },
  {
    id: "help",
    title: "Help mode, for family",
    tag: "See the TV's screen",
    text: "See the TV's screen on your phone, menus and apps, and tap it to press buttons for your parents at home. The TV shows who is watching, and help ends by itself.",
    facts: ["About two pictures a second", "The TV always says who can see it"],
  },
];

/** "Phone superpowers": phone, the world and the TV joined by Magic UI's animated beams; the mode lights the path. */
export function Superpowers() {
  const [mode, setMode] = useState<Mode>("wifi");
  const [pinned, setPinned] = useState(false);
  const section = useRef<HTMLElement>(null);
  const inView = useInView(section, 0.35);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (!inView || pinned || reduce) return;
    const t = window.setInterval(() => setMode((m) => (m === "wifi" ? "cloud" : m === "cloud" ? "help" : "wifi")), 6500);
    return () => window.clearInterval(t);
  }, [inView, pinned, reduce]);

  const active = MODES.find((m) => m.id === mode)!;

  return (
    <section ref={section} id="phone" tabIndex={-1} aria-labelledby="phone-title" className="relative overflow-hidden py-[clamp(5rem,11vw,9rem)] outline-none">
      <div aria-hidden="true" className="halo pointer-events-none absolute inset-0 -z-10 opacity-80" />
      <div className="wrap">
        <SectionHead eyebrow="Phone superpowers" title="Your phone becomes the remote." lede="Orbit is the remote in your pocket: on the sofa, in another room, or in another city." />
        <span id="phone-title" className="sr-only">
          Phone superpowers
        </span>

        <div className="mt-[clamp(2.5rem,5vw,4rem)] grid grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <BeamStage mode={mode} reduce={reduce} near={inView} />

          <div>
            <div role="tablist" aria-label="What the phone can do" className="flex flex-wrap gap-2">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  role="tab"
                  type="button"
                  aria-selected={mode === m.id}
                  aria-controls="phone-panel"
                  onClick={() => {
                    setMode(m.id);
                    setPinned(true);
                  }}
                  className={`relative isolate rounded-full px-4 py-2 text-[0.875rem] font-medium transition-[color,transform] active:scale-95 ${mode === m.id ? "text-cta-ink" : "text-soft hover:bg-veil/[0.05] hover:text-ink"}`}
                >
                  {mode === m.id && <motion.span layoutId="phone-tab" className="absolute inset-0 -z-10 rounded-full" style={{ background: "var(--cta)" }} transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                  {m.tag}
                </button>
              ))}
            </div>
            <div id="phone-panel" role="tabpanel" className="relative mt-6 min-h-[16rem]">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={active.id}
                  initial={{ opacity: 0, y: 12, filter: "blur(6px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  exit={{ opacity: 0, y: -8, filter: "blur(6px)" }}
                  transition={{ duration: reduce ? 0 : 0.35 }}
                >
                  <h3 className="font-display text-[clamp(1.6rem,2.6vw,2.1rem)] leading-tight font-medium text-ink">{active.title}</h3>
                  <p className="mt-3 text-[1.0625rem] leading-relaxed text-soft">{active.text}</p>
                  <ul className="mt-5 space-y-2">
                    {active.facts.map((f) => (
                      <li key={f} className="flex items-center gap-2.5 text-[0.9375rem] text-ink">
                        <span className="grid size-5 place-items-center rounded-full bg-ok/15 text-ok">
                          <I.Check size={12} strokeWidth={2.6} />
                        </span>
                        {f}
                      </li>
                    ))}
                  </ul>
                </motion.div>
              </AnimatePresence>
            </div>
            {!pinned && !reduce && (
              <div className="mt-2 h-0.5 w-40 overflow-hidden rounded-full bg-veil/10" aria-hidden="true">
                <motion.div key={mode} className="h-full" style={{ background: "var(--iris)" }} initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ duration: 6.5, ease: "linear" }} />
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function BeamStage({ mode, reduce, near }: { mode: Mode; reduce: boolean; near: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const phone = useRef<HTMLDivElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const tv = useRef<HTMLDivElement>(null);
  const day = useThemeValue() === "light";
  const beam = {
    pathColor: day ? "#4a5bd6" : "#ADC6FF",
    pathOpacity: day ? 0.18 : 0.12,
    pathWidth: 2,
    gradientStartColor: day ? "#0a76b3" : "#74D1FF",
    gradientStopColor: day ? "#9a3fd0" : "#E9B3FF",
    duration: 2.6,
  } as const;
  const warm = { gradientStartColor: day ? "#c8233e" : "#ff8aa0", gradientStopColor: day ? "#9a3fd0" : "#E9B3FF" };

  return (
    <div ref={box} className="card relative mx-auto aspect-[16/11] w-full max-w-[40rem] overflow-hidden rounded-[2rem] p-4 sm:p-8">
      <div aria-hidden="true" className="absolute inset-0 rounded-[inherit] bg-[linear-gradient(color-mix(in_srgb,var(--accent-2)_8%,transparent)_1px,transparent_1px),linear-gradient(90deg,color-mix(in_srgb,var(--accent-2)_8%,transparent)_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:radial-gradient(70%_70%_at_50%_50%,#000,transparent)]" />

      {/* the world in the middle: Magic UI's globe (cobe), turned to India, lit only when the path runs through it */}
      <div className="absolute top-[4%] left-1/2 -translate-x-1/2">
        <div ref={world} aria-label="The cloud link" role="img" className="relative z-10 grid size-[clamp(6rem,17vw,9rem)] place-items-center rounded-full bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--accent-2)_16%,transparent),transparent)]">
          {near && <Globe look={day ? "day" : "night"} phi0={4.55} theta={0.28} spin={mode === "cloud" ? 0.004 : 0.0015} markers={[{ location: [25.6, 85.1], size: 0.07 }, { location: [12.97, 77.59], size: 0.07 }]} className={`absolute inset-0 transition-opacity duration-700 ${mode === "wifi" ? "opacity-40" : "opacity-100"}`} />}
        </div>
      </div>

      {/* the phone, with the remote's tools in orbit around it */}
      <div className="absolute bottom-[10%] left-[6%] grid place-items-center sm:left-[9%]">
        <div className="relative grid size-[clamp(7rem,19vw,10rem)] place-items-center">
          {!reduce && (
            <OrbitingCircles radius={64} iconSize={28} duration={22} path speed={mode === "wifi" ? 1.6 : 0.8} className="max-sm:hidden">
              <Mini icon={<I.GlobeIcon size={14} />} />
              <Mini icon={<I.Keyboard size={14} />} />
              <Mini icon={<I.Speaker size={14} />} />
              <Mini icon={<I.Power size={14} />} />
            </OrbitingCircles>
          )}
          <Node ref={phone} label="Orbit on your phone" className="h-[clamp(5.4rem,14vw,7.5rem)] w-[clamp(2.7rem,7vw,3.75rem)] overflow-hidden rounded-[0.9rem] p-0">
            <AnimatePresence mode="wait" initial={false}>
              {mode === "help" ? (
                <motion.div key="h" className="relative h-full w-full bg-night" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <img src={homeUrl} alt="" className="absolute inset-x-0 top-[30%] w-full" />
                  <span className="absolute top-[12%] left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-[#ff5468] motion-safe:animate-[live-pulse_1.4s_ease-in-out_infinite]" />
                </motion.div>
              ) : (
                <motion.img key="r" src={remoteUrl} alt="" className="h-full w-full object-cover object-top" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
              )}
            </AnimatePresence>
          </Node>
        </div>
      </div>

      {/* the TV */}
      <div className="absolute right-[5%] bottom-[16%] sm:right-[8%]">
        <Node ref={tv} label="The TV" className="w-[clamp(9rem,26vw,14rem)] overflow-hidden rounded-[0.7rem] p-[3px]">
          <div className="relative">
            <img src={homeUrl} alt="" className="w-full rounded-[0.5rem]" />
            <AnimatePresence>
              {mode === "help" && (
                <motion.span
                  className="absolute top-[5%] left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-black/75 px-2 py-0.5 text-[clamp(7px,1vw,10px)] whitespace-nowrap text-white"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                >
                  <span className="size-1.5 rounded-full bg-[#ff5468]" /> Shiv can see this screen
                </motion.span>
              )}
              {mode === "cloud" && (
                <motion.span
                  className="absolute inset-x-0 top-0 flex flex-col items-center"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                >
                  <span className="h-[2px] w-1/2 rounded-b-full bg-[linear-gradient(90deg,transparent,#74D1FF,#E9B3FF,transparent)]" />
                  <span className="mt-[3%] rounded-full bg-black/75 px-2 py-0.5 font-mono text-[clamp(7px,1vw,10px)] tracking-[0.12em] text-white">
                    <DecryptedText text="4821 0937" animateOn="view" sequential speed={45} revealDirection="start" characters="0123456789" className="text-white" encryptedClassName="text-[#74D1FF]" />
                  </span>
                </motion.span>
              )}
            </AnimatePresence>
          </div>
        </Node>
      </div>

      {mode === "wifi" && <AnimatedBeam key="w1" containerRef={box} fromRef={phone} toRef={tv} curvature={-40} {...beam} />}
      {mode === "cloud" && (
        <>
          <AnimatedBeam key="c1" containerRef={box} fromRef={phone} toRef={world} curvature={30} {...beam} />
          <AnimatedBeam key="c2" containerRef={box} fromRef={world} toRef={tv} curvature={30} delay={0.6} {...beam} />
        </>
      )}
      {mode === "help" && (
        <>
          <AnimatedBeam key="h1" containerRef={box} fromRef={tv} toRef={world} curvature={30} reverse {...beam} {...warm} />
          <AnimatedBeam key="h2" containerRef={box} fromRef={world} toRef={phone} curvature={30} reverse delay={0.6} {...beam} {...warm} />
          <AnimatedBeam key="h3" containerRef={box} fromRef={phone} toRef={tv} curvature={-40} {...beam} duration={3.4} />
        </>
      )}

      <div className="absolute bottom-[3.5%] left-1/2 -translate-x-1/2 font-mono text-[0.6875rem] tracking-[0.08em] whitespace-nowrap text-dim uppercase">
        {mode === "wifi" ? "phone → TV · home Wi-Fi" : mode === "cloud" ? "phone → cloud → TV · anywhere" : "TV's screen → phone · taps → TV"}
      </div>
    </div>
  );
}

const Node = forwardRef<HTMLDivElement, { children: ReactNode; label: string; className?: string }>(function Node({ children, label, className = "" }, ref) {
  return (
    <div ref={ref} aria-label={label} role="img" className={`relative z-10 grid place-items-center border border-[#ADC6FF]/30 bg-[linear-gradient(180deg,#151c33,#0b1020)] shadow-[0_0_40px_-6px_color-mix(in_srgb,var(--accent)_45%,transparent)] ${className}`}>
      {children}
    </div>
  );
});

function Mini({ icon }: { icon: ReactNode }) {
  return <span className="grid size-7 place-items-center rounded-full border border-line bg-surface text-accent-2 shadow-[0_6px_16px_-8px_rgb(var(--shadow-rgb)/var(--shadow-a))]">{icon}</span>;
}
