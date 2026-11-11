import { AnimatePresence, motion } from "motion/react";
import { forwardRef, useEffect, useRef, useState, type ReactNode } from "react";
import homeUrl from "@/assets/img/home.webp";
import remoteUrl from "@/assets/setup/16-remote.webp";
import { AnimatedBeam } from "@/components/magicui/animated-beam";
import { OrbitingCircles } from "@/components/magicui/orbiting-circles";
import { SectionHead } from "@/components/kit/SectionHead";
import * as I from "@/components/kit/icons";
import { useInView, useReducedMotion } from "@/lib/hooks";

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
    text: "Link once with Google sign-in and the 8-digit code on the TV, and the remote keeps working when you are nowhere near the home Wi-Fi.",
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

/** "Phone superpowers": phone, cloud and TV joined by Magic UI's animated beams; the mode decides which ones light. */
export function Superpowers() {
  const [mode, setMode] = useState<Mode>("wifi");
  const [pinned, setPinned] = useState(false);
  const section = useRef<HTMLElement>(null);
  const inView = useInView(section, 0.35);
  const reduce = useReducedMotion();

  // Walk through the three until the visitor picks one.
  useEffect(() => {
    if (!inView || pinned || reduce) return;
    const t = window.setInterval(() => setMode((m) => (m === "wifi" ? "cloud" : m === "cloud" ? "help" : "wifi")), 6000);
    return () => window.clearInterval(t);
  }, [inView, pinned, reduce]);

  const active = MODES.find((m) => m.id === mode)!;

  return (
    <section ref={section} id="phone" tabIndex={-1} aria-labelledby="phone-title" className="relative overflow-hidden py-[clamp(5rem,11vw,9rem)] outline-none">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(45%_50%_at_50%_55%,rgba(173,198,255,0.08),transparent_70%)]" />
      <div className="wrap">
        <SectionHead
          eyebrow="Phone superpowers"
          title="Your phone becomes the remote."
          lede="Orbit is the remote in your pocket: on the sofa, in another room, or in another city."
        />
        <span id="phone-title" className="sr-only">
          Phone superpowers
        </span>

        <div className="mt-[clamp(2.5rem,5vw,4rem)] grid grid-cols-1 items-center gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <BeamStage mode={mode} reduce={reduce} />

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
                  className={`relative isolate rounded-full px-4 py-2 text-[0.875rem] font-medium transition-colors ${mode === m.id ? "text-night" : "text-soft hover:bg-white/[0.05] hover:text-ink"}`}
                >
                  {mode === m.id && <motion.span layoutId="phone-tab" className="absolute inset-0 -z-10 rounded-full bg-[linear-gradient(100deg,#74D1FF,#ADC6FF,#E9B3FF)]" transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
                  {m.tag}
                </button>
              ))}
            </div>
            <div id="phone-panel" role="tabpanel" className="relative mt-6 min-h-[15.5rem]">
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
                      <li key={f} className="flex items-center gap-2.5 text-[0.9375rem] text-ink/90">
                        <span className="grid size-5 place-items-center rounded-full bg-mint/15 text-mint">
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
              <div className="mt-2 h-0.5 w-40 overflow-hidden rounded-full bg-white/10" aria-hidden="true">
                <motion.div key={mode} className="h-full bg-[linear-gradient(90deg,#74D1FF,#E9B3FF)]" initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ duration: 6, ease: "linear" }} />
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function BeamStage({ mode, reduce }: { mode: Mode; reduce: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const phone = useRef<HTMLDivElement>(null);
  const cloud = useRef<HTMLDivElement>(null);
  const tv = useRef<HTMLDivElement>(null);
  const beam = { pathColor: "#ADC6FF", pathOpacity: 0.12, pathWidth: 2, gradientStartColor: "#74D1FF", gradientStopColor: "#E9B3FF", duration: 2.6 } as const;

  return (
    <div ref={box} className="relative mx-auto aspect-[16/11] w-full max-w-[40rem] rounded-[2rem] border border-white/[0.07] bg-[radial-gradient(70%_70%_at_50%_40%,rgba(17,24,48,0.8),rgba(5,7,13,0.4))] p-4 sm:p-8">
      <div aria-hidden="true" className="absolute inset-0 rounded-[inherit] bg-[linear-gradient(rgba(173,198,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(173,198,255,0.05)_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:radial-gradient(70%_70%_at_50%_50%,#000,transparent)]" />

      {/* the cloud, high in the middle */}
      <div className="absolute top-[9%] left-1/2 -translate-x-1/2">
        <Node ref={cloud} label="Cloud link" active={mode !== "wifi"} className="size-[clamp(3.5rem,9vw,4.75rem)] rounded-full">
          <I.Cloud size={30} className={mode !== "wifi" ? "text-ice" : "text-faint"} />
        </Node>
      </div>

      {/* the phone, with the remote's tools in orbit around it */}
      <div className="absolute bottom-[12%] left-[7%] grid place-items-center sm:left-[9%]">
        <div className="relative grid size-[clamp(7rem,19vw,10rem)] place-items-center">
          {!reduce && (
            <OrbitingCircles radius={64} iconSize={28} duration={22} path speed={mode === "wifi" ? 1.6 : 0.8} className="max-sm:hidden">
              <Mini icon={<I.GlobeIcon size={14} />} />
              <Mini icon={<I.Keyboard size={14} />} />
              <Mini icon={<I.Speaker size={14} />} />
              <Mini icon={<I.Power size={14} />} />
            </OrbitingCircles>
          )}
          <Node ref={phone} label="Orbit on your phone" active className="h-[clamp(5.4rem,14vw,7.5rem)] w-[clamp(2.7rem,7vw,3.75rem)] overflow-hidden rounded-[0.9rem] p-0">
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
      <div className="absolute right-[6%] bottom-[18%] sm:right-[8%]">
        <Node ref={tv} label="The TV" active className="w-[clamp(9rem,26vw,14rem)] overflow-hidden rounded-[0.7rem] p-[3px]">
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
            </AnimatePresence>
          </div>
        </Node>
      </div>

      {mode === "wifi" && <AnimatedBeam key="w1" containerRef={box} fromRef={phone} toRef={tv} curvature={-40} {...beam} />}
      {mode === "cloud" && (
        <>
          <AnimatedBeam key="c1" containerRef={box} fromRef={phone} toRef={cloud} curvature={30} {...beam} />
          <AnimatedBeam key="c2" containerRef={box} fromRef={cloud} toRef={tv} curvature={30} delay={0.6} {...beam} />
        </>
      )}
      {mode === "help" && (
        <>
          <AnimatedBeam key="h1" containerRef={box} fromRef={tv} toRef={cloud} curvature={30} reverse {...beam} gradientStartColor="#ff8aa0" gradientStopColor="#E9B3FF" />
          <AnimatedBeam key="h2" containerRef={box} fromRef={cloud} toRef={phone} curvature={30} reverse delay={0.6} {...beam} gradientStartColor="#ff8aa0" gradientStopColor="#E9B3FF" />
          <AnimatedBeam key="h3" containerRef={box} fromRef={phone} toRef={tv} curvature={-40} {...beam} duration={3.4} />
        </>
      )}

      <div className="absolute bottom-[4%] left-1/2 -translate-x-1/2 font-mono text-[0.6875rem] tracking-[0.08em] whitespace-nowrap text-dim uppercase">
        {mode === "wifi" ? "phone → TV · home Wi-Fi" : mode === "cloud" ? "phone → cloud → TV · anywhere" : "TV's screen → phone · taps → TV"}
      </div>
    </div>
  );
}

const Node = forwardRef<HTMLDivElement, { children: ReactNode; label: string; active: boolean; className?: string }>(function Node({ children, label, active, className = "" }, ref) {
  return (
    <div
      ref={ref}
      aria-label={label}
      role="img"
      className={`relative z-10 grid place-items-center border bg-[linear-gradient(180deg,#151c33,#0b1020)] transition-[border-color,box-shadow] duration-500 ${active ? "border-[#ADC6FF]/35 shadow-[0_0_40px_-6px_rgba(116,209,255,0.45)]" : "border-white/10"} ${className}`}
    >
      {children}
    </div>
  );
});

function Mini({ icon }: { icon: ReactNode }) {
  return <span className="grid size-7 place-items-center rounded-full border border-white/12 bg-[#0b1020] text-ice">{icon}</span>;
}
