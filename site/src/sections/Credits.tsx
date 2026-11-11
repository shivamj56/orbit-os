import { motion, useScroll, useTransform } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import filmUrl from "@/assets/film/boot-intro.mp4";
import posterUrl from "@/assets/film/poster.webp";
import LightRays from "@/components/reactbits/LightRays";
import Noise from "@/components/reactbits/Noise";
import { DownloadButton, StarButton } from "@/components/kit/buttons";
import { ShivMark } from "@/components/kit/brand";
import { QrCard } from "@/components/kit/QrCard";
import * as I from "@/components/kit/icons";
import { useInView, useNear, useReducedMotion } from "@/lib/hooks";
import { glide } from "@/lib/scroll";

/**
 * End credits. The lights go down (by day too: a cinema is dark), the owner's boot film plays when it comes into
 * view, muted until you ask for sound, under a projector's beam (React Bits LightRays) and a little film grain (React
 * Bits Noise). When the film ends, the credits roll like a film's, down to the last card; any scroll, key or touch
 * gives the page back.
 */
export function Credits({ stars }: { stars: number | null }) {
  const section = useRef<HTMLElement>(null);
  const theatre = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const inView = useInView(theatre, 0.6);
  const near = useNear(section, "200px");
  const [muted, setMuted] = useState(true);
  const [state, setState] = useState<"idle" | "playing" | "ended">("idle");
  const [rolling, setRolling] = useState(false);
  const stopRoll = useRef<() => void>(() => {});
  const lastInput = useRef(0);
  const rolledOnce = useRef(false);

  // The screen rises out of the dark as you arrive, a little like a curtain going up.
  const { scrollYProgress } = useScroll({ target: theatre, offset: ["start end", "center center"] });
  const screenScale = useTransform(scrollYProgress, [0, 1], [reduce ? 1 : 0.9, 1]);
  const screenTilt = useTransform(scrollYProgress, [0, 1], [reduce ? 0 : 14, 0]);

  useEffect(() => {
    const mark = () => (lastInput.current = performance.now());
    window.addEventListener("wheel", mark, { passive: true });
    window.addEventListener("touchmove", mark, { passive: true });
    window.addEventListener("keydown", mark);
    return () => {
      window.removeEventListener("wheel", mark);
      window.removeEventListener("touchmove", mark);
      window.removeEventListener("keydown", mark);
      stopRoll.current();
    };
  }, []);

  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (inView && !reduce && state === "idle") {
      v.currentTime = 0;
      v.play().then(() => setState("playing")).catch(() => {});
    } else if (!inView && state === "playing") {
      v.pause();
      setState("idle");
    }
  }, [inView, reduce, state]);

  const roll = () => {
    const target = end.current;
    if (!target) return;
    const y = target.getBoundingClientRect().top + window.scrollY - (window.innerHeight - target.offsetHeight) / 2;
    setRolling(true);
    stopRoll.current = glide(y, window.innerWidth < 640 ? 70 : 95, () => setRolling(false));
  };

  const onEnded = () => {
    setState("ended");
    if (!reduce && !rolledOnce.current && performance.now() - lastInput.current > 2500) {
      rolledOnce.current = true;
      window.setTimeout(roll, 700);
    }
  };

  const play = (withSound: boolean) => {
    const v = video.current;
    if (!v) return;
    stopRoll.current();
    setRolling(false);
    v.muted = !withSound;
    setMuted(!withSound);
    v.currentTime = 0;
    v.play().then(() => setState("playing")).catch(() => {});
  };

  return (
    <>
      {/* the lights go down */}
      <div aria-hidden="true" className="h-32 bg-gradient-to-b from-page to-[#020306]" />
      <section ref={section} id="credits" aria-labelledby="credits-title" className="theme-night relative overflow-hidden bg-[#020306] pt-[clamp(3rem,7vw,5rem)] text-ink">
        {near && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[110vh] opacity-80">
            <LightRays raysOrigin="top-center" raysColor="#c9d8ff" raysSpeed={0.6} lightSpread={0.55} rayLength={1.6} fadeDistance={1.1} intensity={0.55} haze={0.35} followMouse={!reduce} mouseInfluence={0.05} cursorShadow={false} clickPulse={false} saturation={0.6} />
          </div>
        )}
        <div className="wrap relative">
          <p className="eyebrow flex items-center justify-center gap-2.5 !text-dim">
            <span aria-hidden="true" className="h-px w-6 bg-[linear-gradient(90deg,transparent,var(--dim))]" />
            End credits
            <span aria-hidden="true" className="h-px w-6 bg-[linear-gradient(90deg,var(--dim),transparent)]" />
          </p>
          <h2 id="credits-title" className="sr-only">
            End credits
          </h2>

          {/* the screen */}
          <div ref={theatre} className="relative mx-auto mt-8 max-w-[60rem] [perspective:1400px]">
            <motion.div style={{ scale: screenScale, rotateX: screenTilt }} className="origin-bottom">
              <div className="relative overflow-hidden rounded-[clamp(10px,1.4vw,18px)] bg-black shadow-[0_60px_140px_-50px_rgba(116,209,255,0.35),0_0_0_1px_rgba(173,198,255,0.12)]">
                <video
                  ref={video}
                  src={filmUrl}
                  poster={posterUrl}
                  muted={muted}
                  playsInline
                  preload="auto"
                  onEnded={onEnded}
                  className="aspect-video w-full"
                  aria-label="Orbit OS boot film: a chrome S mark forms, then the words Developed by Shiv"
                />
                {near && <Noise opacity={0.07} fps={18} contrast={0.7} dust={0.15} scratches={0.08} className="absolute inset-0" />}
                {state !== "playing" && (
                  <button
                    type="button"
                    onClick={() => play(!muted)}
                    className="group absolute inset-0 grid place-items-center bg-black/10 transition-colors hover:bg-black/25"
                    aria-label={state === "ended" ? "Play the film again" : "Play the film"}
                  >
                    <span className="grid size-16 place-items-center rounded-full border border-white/25 bg-black/50 text-white backdrop-blur-md transition-transform duration-300 group-hover:scale-110 group-active:scale-95">
                      {state === "ended" ? <I.Replay size={24} /> : <I.Play size={22} />}
                    </span>
                  </button>
                )}
              </div>
            </motion.div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-[0.875rem] text-dim">The film Orbit Home plays once, every time the TV starts.</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => play(muted)}
                  aria-pressed={!muted}
                  className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-veil/[0.04] px-4 text-[0.875rem] text-ink transition-[border-color,background-color,transform] hover:border-veil/25 hover:bg-veil/[0.08] active:scale-95"
                >
                  {muted ? <I.SoundOn size={17} /> : <I.SoundOff size={17} />}
                  {muted ? "Sound on" : "Sound off"}
                </button>
                <button
                  type="button"
                  onClick={() => (rolling ? (stopRoll.current(), setRolling(false)) : roll())}
                  className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-veil/[0.04] px-4 text-[0.875rem] text-ink transition-[border-color,background-color,transform] hover:border-veil/25 hover:bg-veil/[0.08] active:scale-95"
                >
                  {rolling ? <I.Pause size={15} /> : <I.ArrowDown size={16} />}
                  {rolling ? "Stop the roll" : "Roll credits"}
                </button>
              </div>
            </div>
          </div>

          {/* the roll */}
          <div className="relative mx-auto mt-[clamp(6rem,16vh,10rem)] max-w-[44rem] pb-[clamp(4rem,10vh,8rem)] text-center">
            <Credit>
              <ShivMark className="mx-auto h-auto w-[clamp(7rem,18vw,10rem)] drop-shadow-[0_0_40px_rgba(173,198,255,0.35)]" label="Shiv's S mark" />
              <p className="mt-8 font-display text-[clamp(2.6rem,7vw,4.5rem)] leading-none font-light tracking-[0.02em] text-ink">Orbit OS</p>
            </Credit>

            <Credit gap>
              <Role>Developed by</Role>
              <Name big>Shiv</Name>
              <p className="mt-1 text-[1rem] text-soft">Shivam Jha</p>
            </Credit>

            <Credit gap>
              <Role>What was built</Role>
              <dl className="mt-5 grid gap-y-4">
                {[
                  ["Orbit Home", "the TV's new home screen"],
                  ["Orbit Live TV", "30 free channels, with a guide"],
                  ["Orbit for phone", "the remote, from anywhere"],
                  ["Orbit Setup", "no computer, no code"],
                ].map(([n, d]) => (
                  <div key={n} className="grid grid-cols-[1fr_auto_1fr] items-baseline gap-4">
                    <dt className="text-right font-display text-[clamp(1.25rem,2.6vw,1.6rem)] text-ink">{n}</dt>
                    <span aria-hidden="true" className="h-px w-8 self-center bg-veil/15" />
                    <dd className="text-left text-[0.9375rem] text-dim">{d}</dd>
                  </div>
                ))}
              </dl>
            </Credit>

            <Credit gap>
              <Role>With thanks to</Role>
              <ul className="mt-5 grid gap-3 text-[clamp(1.0625rem,2vw,1.25rem)] text-ink">
                <li>
                  CleanYourTV by Gathin <span className="text-dim">(MIT)</span>
                </li>
                <li>React Bits</li>
                <li>Magic UI / 21st.dev</li>
                <li>
                  Outfit, Inter and JetBrains Mono <span className="text-dim">(SIL Open Font License)</span>
                </li>
              </ul>
            </Credit>

            <div ref={end} id="credits-end" className="pt-[clamp(8rem,22vh,14rem)]">
              <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.5 }} transition={{ duration: 1.1, ease: [0.19, 1, 0.22, 1] }}>
                <p className="font-display text-[clamp(1.75rem,4vw,2.5rem)] font-light tracking-[0.18em] text-ink uppercase">Made in India</p>
                <div aria-hidden="true" className="mx-auto mt-4 flex h-[2px] w-28 overflow-hidden rounded-full">
                  <span className="flex-1 bg-[#FF9933]" />
                  <span className="flex-1 bg-white" />
                  <span className="flex-1 bg-[#138808]" />
                </div>
                <p className="mx-auto mt-8 max-w-[30rem] text-[1.0625rem] leading-relaxed text-soft">Your TV, five minutes from now. Download Orbit, open it on the same Wi-Fi as your TV, and follow the screens.</p>
                <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                  <DownloadButton />
                  <StarButton stars={stars} />
                </div>
                <QrCard className="mx-auto mt-10 hidden w-fit lg:flex" />
              </motion.div>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}

function Credit({ children, gap }: { children: ReactNode; gap?: boolean }) {
  return (
    <motion.div
      className={gap ? "pt-[clamp(6rem,16vh,10rem)]" : ""}
      initial={{ opacity: 0, y: 40, filter: "blur(8px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: false, amount: 0.4, margin: "-8% 0px -8% 0px" }}
      transition={{ duration: 1, ease: [0.19, 1, 0.22, 1] }}
    >
      {children}
    </motion.div>
  );
}

function Role({ children }: { children: ReactNode }) {
  return <p className="font-mono text-[0.75rem] tracking-[0.28em] text-dim uppercase">{children}</p>;
}

function Name({ children, big }: { children: ReactNode; big?: boolean }) {
  return <p className={`mt-4 font-display ${big ? "text-[clamp(2.4rem,6vw,3.75rem)]" : "text-[1.5rem]"} leading-none tracking-[0.06em] text-ink`}>{children}</p>;
}
