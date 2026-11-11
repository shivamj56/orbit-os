import { motion, useScroll, useTransform } from "motion/react";
import { useRef, useState } from "react";
import homeUrl from "@/assets/img/home.webp";
import Galaxy from "@/components/reactbits/Galaxy";
import SplitText from "@/components/reactbits/SplitText";
import { OrbitStage, type StageControl } from "@/components/hero/OrbitStage";
import { DownloadButton, StarButton } from "@/components/kit/buttons";
import { QrCard } from "@/components/kit/QrCard";
import * as I from "@/components/kit/icons";
import { useReducedMotion } from "@/lib/hooks";
import { useThemeValue } from "@/lib/themeContext";
import { goTo } from "@/lib/scroll";

/*
 * The hero's intro is one sequence on one clock: the TV rises and powers on (0 to 1.4 s), the ring draws itself around
 * it (1.0 to 2.55 s), and the headline comes in as the ring starts, then the line under it and the buttons.
 */
const T = { chip: 0.9, line1: 1.05, line2: 1.32, lede: 1.85, cta: 2.05, foot: 2.6 };
const EXPO = [0.19, 1, 0.22, 1] as const;

export function Hero({ stars }: { stars: number | null }) {
  const section = useRef<HTMLElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const control = useRef<StageControl | null>(null);
  const reduce = useReducedMotion();
  const theme = useThemeValue();
  const [fallback, setFallback] = useState(false);
  const [panel, setPanel] = useState(false);
  const day = theme === "light";

  // Scrolling away: the words lift and fade faster than the TV, which dollies in (inside the scene).
  const { scrollYProgress } = useScroll({ target: section, offset: ["start start", "end start"] });
  const textY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : -150]);
  const textFade = useTransform(scrollYProgress, [0, 0.5], [1, 0]);

  const enter = (at: number, y = 18) =>
    reduce
      ? {}
      : {
          initial: { opacity: 0, y, filter: "blur(8px)" },
          animate: { opacity: 1, y: 0, filter: "blur(0px)" },
          transition: { duration: 0.9, delay: at, ease: EXPO },
        };

  return (
    <section ref={section} id="top" aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      {/* Far: the sky. At night, React Bits Galaxy in Orbit's three lights; by day, the same field as ink dust on pearl. */}
      <div className="absolute inset-0 -z-30" aria-hidden="true">
        <div className={`absolute inset-0 transition-opacity duration-700 ${day ? "opacity-100" : "opacity-0"}`} style={{ background: "radial-gradient(70% 60% at 50% 18%, #ffffff 0%, transparent 70%), radial-gradient(55% 50% at 18% 70%, rgba(116,209,255,0.22), transparent 70%), radial-gradient(50% 45% at 85% 62%, rgba(233,179,255,0.22), transparent 70%), linear-gradient(180deg, #eef1f8, #f5f6fa 55%, #f5f6fa)" }} />
        <Galaxy
          starColors={day ? ["#0a76b3", "#4a5bd6", "#9a3fd0", "#0b1020"] : ["#74D1FF", "#ADC6FF", "#E9B3FF", "#FFFFFF"]}
          lightMode={day}
          focal={[0.5, 0.38]}
          density={day ? 0.8 : 1.05}
          glowIntensity={day ? 0.22 : 0.28}
          flareIntensity={day ? 0.25 : 0.55}
          starSpeed={0.3}
          speed={0.7}
          rotationSpeed={0.012}
          twinkleIntensity={0.5}
          repulsionStrength={1.4}
          opacity={day ? 0.55 : 1}
          dpr={1}
          transparent
        />
      </div>
      {/* Near: a horizon of light under the TV, and a veil so the type always reads. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-20" style={{ background: day ? "radial-gradient(60% 40% at 50% 80%, rgba(10,118,179,0.10), transparent 70%), linear-gradient(180deg, transparent 70%, var(--page) 100%)" : "radial-gradient(60% 45% at 50% 78%, rgba(116,209,255,0.13), transparent 70%), radial-gradient(40% 35% at 62% 84%, rgba(233,179,255,0.12), transparent 70%), linear-gradient(180deg, rgba(5,7,13,0.55) 0%, rgba(5,7,13,0) 38%, rgba(5,7,13,0) 70%, var(--page) 100%)" }} />

      {!fallback && (
        <OrbitStage container={section} anchor={anchor} control={control} reduce={reduce} theme={theme} onFallback={() => setFallback(true)} onPanel={setPanel} />
      )}

      <div className="wrap relative flex min-h-[100svh] flex-col items-center pt-[clamp(5.75rem,11vh,8rem)] pb-10 text-center">
        <motion.div style={{ y: textY, opacity: textFade }} className="flex w-full flex-col items-center">
          <motion.p {...enter(T.chip, 10)} className="glass inline-flex items-center gap-2.5 rounded-full py-1.5 pr-4 pl-2 text-[0.8125rem] text-soft">
            <span className="rounded-full bg-ok/12 px-2 py-0.5 font-mono text-[0.6875rem] font-semibold tracking-[0.08em] text-ok uppercase">Free</span>
            For Google TV and Android TV
          </motion.p>

          <h1 id="hero-title" aria-label="A calmer, faster home for your TV." className="mt-5 font-display text-[clamp(2.6rem,5vw,4.75rem)] leading-[0.98] font-[440] tracking-[-0.035em] text-ink">
            <span className="block" aria-hidden="true">
              <SplitText text="A calmer, faster home" tag="span" splitType="chars" effect="blur" delay={22} duration={1.1} trigger="load" startDelay={reduce ? 0 : T.line1} accentColor={day ? "#4a5bd6" : "#ADC6FF"} />
            </span>
            <span className="block pb-[0.08em]" aria-hidden="true">
              <SplitText
                text="for your TV."
                tag="span"
                splitType="chars"
                effect="rise"
                mask
                delay={34}
                duration={1.2}
                trigger="load"
                startDelay={reduce ? 0 : T.line2}
                gradient={reduce ? undefined : "var(--iris)"}
                className={`relative font-[520] ${reduce ? "iris-text" : ""}`}
              />
            </span>
          </h1>

          <motion.p {...enter(T.lede)} className="mt-5 max-w-[46rem] text-[clamp(1.0625rem,1.25vw,1.15rem)] leading-[1.58] text-soft">
            Only your apps, 30 free Live TV channels, and a phone remote that works from anywhere.{" "}
            <span className="text-ink">Set up from your phone in five minutes. No computer, no code.</span>
          </motion.p>

          <motion.div {...enter(T.cta, 22)} className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <DownloadButton />
            <StarButton stars={stars} />
          </motion.div>
        </motion.div>

        {/* Where the TV sits: the WebGL scene draws it here. */}
        <div className="relative mt-[clamp(2.25rem,4.5vh,3.5rem)] w-[clamp(300px,min(80vw,calc((100svh-36.5rem)*1.78)),680px)] max-sm:w-[84vw]">
          <div
            ref={anchor}
            role="img"
            aria-label="A TV showing Orbit Home, a curved row of app cards under the greeting Good Afternoon, circled by a glowing orbit ring"
            className="relative aspect-video w-full cursor-pointer"
          >
            {fallback && (
              <div className="absolute inset-0 rounded-[10px] bg-[#0a0d18] p-[6px] shadow-[0_40px_120px_-30px_rgb(var(--shadow-rgb)/var(--shadow-a))] ring-1 ring-veil/10">
                <img src={homeUrl} alt="" className="h-full w-full rounded-[6px] object-cover" />
              </div>
            )}
          </div>
        </div>
        <motion.div {...enter(T.foot, 10)} className="mt-[clamp(2.25rem,5vh,3.5rem)] flex flex-col items-center gap-3">
          {!fallback && (
            <button
              type="button"
              onClick={() => control.current?.toggle()}
              className="group inline-flex items-center gap-2 rounded-full border border-line bg-surface/60 px-3.5 py-1.5 text-[0.8125rem] whitespace-nowrap text-soft backdrop-blur-md transition-[color,border-color,transform] duration-300 hover:-translate-y-0.5 hover:border-accent/40 hover:text-ink active:translate-y-0"
            >
              <I.Gear size={15} className={`transition-transform duration-700 group-hover:rotate-45 ${panel ? "rotate-180 text-accent" : ""}`} />
              {panel ? "Back to Home" : "Press Settings on this TV"}
            </button>
          )}
          <p className="max-w-[36rem] rounded-full bg-page/70 px-3 py-1 text-[0.8125rem] text-soft backdrop-blur-md">Free. Android 8 or later on the phone, on the same Wi-Fi as the TV. One tap puts it all back.</p>
        </motion.div>

        <QrCard className="absolute right-[var(--gutter-r)] bottom-8 hidden [@media(min-width:1280px)_and_(min-height:760px)]:flex" />
        <motion.a
          {...enter(T.foot + 0.3, 8)}
          href="#try"
          onClick={(e) => {
            e.preventDefault();
            goTo("try");
          }}
          className="group mt-auto inline-flex flex-col items-center gap-2 pt-[clamp(3rem,8vh,5rem)] text-[0.8125rem] text-dim transition-colors hover:text-ink"
        >
          <span className="eyebrow !text-[0.6875rem] !text-dim group-hover:!text-accent-2">Take the remote</span>
          <span className="grid size-9 place-items-center rounded-full border border-line bg-surface/50 transition-transform group-hover:translate-y-1 motion-safe:animate-[float-y_2.4s_ease-in-out_infinite]">
            <I.ArrowDown size={16} />
          </span>
        </motion.a>
      </div>
    </section>
  );
}
