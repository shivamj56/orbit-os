import { motion } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import filmUrl from "@/assets/film/boot-intro.mp4";
import posterUrl from "@/assets/film/poster.webp";
import { DownloadButton, StarButton } from "@/components/kit/buttons";
import { ShivMark } from "@/components/kit/brand";
import { QrCard } from "@/components/kit/QrCard";
import * as I from "@/components/kit/icons";
import { useInView, useReducedMotion } from "@/lib/hooks";
import { glide } from "@/lib/scroll";

/**
 * End credits. The owner's boot film (the one Orbit Home plays when the TV starts: the chrome S becomes "Developed by
 * Shiv") plays when it scrolls into view, muted until you ask for sound. When it ends, the credits roll like a film's,
 * down to the last card; any scroll, key or touch takes the page back.
 */
export function Credits({ stars }: { stars: number | null }) {
  const theatre = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const inView = useInView(theatre, 0.6);
  const [muted, setMuted] = useState(true);
  const [state, setState] = useState<"idle" | "playing" | "ended">("idle");
  const [rolling, setRolling] = useState(false);
  const stopRoll = useRef<() => void>(() => {});
  const lastInput = useRef(0);
  const rolledOnce = useRef(false);

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

  // Play when the screen is in view (muted, so the browser allows it); pause when it leaves.
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
    // Roll the credits, once, if the visitor is still watching and has not scrolled during the film.
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
    <section id="credits" aria-labelledby="credits-title" className="relative overflow-hidden bg-[#020306] pt-[clamp(5rem,10vw,8rem)]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[linear-gradient(180deg,#05070D,transparent)]" />
      <div className="wrap">
        <p className="eyebrow flex items-center justify-center gap-2.5 !text-dim">
          <span aria-hidden="true" className="h-px w-6 bg-[linear-gradient(90deg,transparent,#8A94B2)]" />
          End credits
          <span aria-hidden="true" className="h-px w-6 bg-[linear-gradient(90deg,#8A94B2,transparent)]" />
        </p>
        <h2 id="credits-title" className="sr-only">
          End credits
        </h2>

        {/* the screen */}
        <div ref={theatre} className="relative mx-auto mt-8 max-w-[60rem]">
          <div aria-hidden="true" className="pointer-events-none absolute -inset-x-[12%] -top-[20%] -bottom-[30%] -z-10 bg-[radial-gradient(50%_45%_at_50%_45%,rgba(173,198,255,0.10),transparent_70%)]" />
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
            {state !== "playing" && (
              <button
                type="button"
                onClick={() => play(!muted)}
                className="group absolute inset-0 grid place-items-center bg-black/10 transition-colors hover:bg-black/25"
                aria-label={state === "ended" ? "Play the film again" : "Play the film"}
              >
                <span className="grid size-16 place-items-center rounded-full border border-white/25 bg-black/50 text-white backdrop-blur-md transition-transform group-hover:scale-105">
                  {state === "ended" ? <I.Replay size={24} /> : <I.Play size={22} />}
                </span>
              </button>
            )}
          </div>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[0.875rem] text-dim">The film Orbit Home plays once, every time the TV starts.</p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => play(muted)}
                aria-pressed={!muted}
                className="inline-flex h-10 items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-4 text-[0.875rem] text-ink transition-colors hover:border-white/25 hover:bg-white/[0.08]"
              >
                {muted ? <I.SoundOn size={17} /> : <I.SoundOff size={17} />}
                {muted ? "Sound on" : "Sound off"}
              </button>
              <button
                type="button"
                onClick={() => (rolling ? (stopRoll.current(), setRolling(false)) : roll())}
                className="inline-flex h-10 items-center gap-2 rounded-full border border-white/12 bg-white/[0.04] px-4 text-[0.875rem] text-ink transition-colors hover:border-white/25 hover:bg-white/[0.08]"
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
                  <span aria-hidden="true" className="h-px w-8 self-center bg-white/15" />
                  <dd className="text-left text-[0.9375rem] text-dim">{d}</dd>
                </div>
              ))}
            </dl>
          </Credit>

          <Credit gap>
            <Role>With thanks to</Role>
            <ul className="mt-5 grid gap-3 text-[clamp(1.0625rem,2vw,1.25rem)] text-ink/90">
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

          <div ref={end} className="pt-[clamp(8rem,22vh,14rem)]">
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
