import { useRef, useState } from "react";
import homeUrl from "@/assets/img/home.webp";
import Galaxy from "@/components/reactbits/Galaxy";
import SplitText from "@/components/reactbits/SplitText";
import { OrbitStage, type StageControl } from "@/components/hero/OrbitStage";
import { DownloadButton, StarButton } from "@/components/kit/buttons";
import { QrCard } from "@/components/kit/QrCard";
import * as I from "@/components/kit/icons";
import { useReducedMotion } from "@/lib/hooks";
import { goTo } from "@/lib/scroll";

const IRIS = "linear-gradient(92deg, #74D1FF 0%, #ADC6FF 48%, #E9B3FF 100%)";

export function Hero({ stars }: { stars: number | null }) {
  const section = useRef<HTMLElement>(null);
  const anchor = useRef<HTMLDivElement>(null);
  const control = useRef<StageControl | null>(null);
  const reduce = useReducedMotion();
  const [fallback, setFallback] = useState(false);
  const [panel, setPanel] = useState(false);

  return (
    <section ref={section} id="top" aria-labelledby="hero-title" className="relative isolate overflow-hidden">
      {/* Far: the night sky (React Bits Galaxy), in Orbit's three lights. Click anywhere for a warp. */}
      <div className="absolute inset-0 -z-30" aria-hidden="true">
        <Galaxy
          starColors={["#74D1FF", "#ADC6FF", "#E9B3FF", "#FFFFFF"]}
          focal={[0.5, 0.38]}
          density={1.05}
          glowIntensity={0.28}
          flareIntensity={0.55}
          starSpeed={0.3}
          speed={0.7}
          rotationSpeed={0.012}
          twinkleIntensity={0.5}
          repulsionStrength={1.4}
          dpr={1}
          transparent
        />
      </div>
      {/* Near: a horizon of light under the TV, and a veil so the type always reads. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-20 bg-[radial-gradient(60%_45%_at_50%_78%,rgba(116,209,255,0.13),transparent_70%),radial-gradient(40%_35%_at_62%_84%,rgba(233,179,255,0.12),transparent_70%),linear-gradient(180deg,rgba(5,7,13,0.55)_0%,rgba(5,7,13,0)_38%,rgba(5,7,13,0)_70%,#05070D_100%)]" />

      {!fallback && (
        <OrbitStage container={section} anchor={anchor} control={control} reduce={reduce} onFallback={() => setFallback(true)} onPanel={setPanel} />
      )}

      <div className="wrap relative flex min-h-[100svh] flex-col items-center pt-[clamp(5.75rem,11vh,8rem)] pb-10 text-center">
        <p className="glass inline-flex items-center gap-2.5 rounded-full py-1.5 pr-4 pl-2 text-[0.8125rem] text-soft">
          <span className="rounded-full bg-mint/12 px-2 py-0.5 font-mono text-[0.6875rem] tracking-[0.08em] text-mint uppercase">Free</span>
          For Google TV and Android TV
        </p>

        <h1 id="hero-title" aria-label="A calmer, faster home for your TV." className="mt-5 font-display text-[clamp(2.6rem,5vw,4.75rem)] leading-[0.98] font-[440] tracking-[-0.035em] text-ink">
          <span className="block" aria-hidden="true">
            <SplitText text="A calmer, faster home" tag="span" splitType="chars" effect="blur" delay={22} duration={1.1} trigger="load" accentColor="#ADC6FF" />
          </span>
          <span className="block pb-[0.08em]" aria-hidden="true">
            <SplitText text="for your TV." tag="span" splitType="chars" effect="rise" mask delay={34} duration={1.2} trigger="load" gradient={reduce ? undefined : IRIS} className={`relative font-[520] ${reduce ? "iris-text" : ""}`} />
          </span>
        </h1>

        <p className="mt-5 max-w-[46rem] text-[clamp(1.0625rem,1.25vw,1.15rem)] leading-[1.58] text-soft">
          Only your apps, 30 free Live TV channels, and a phone remote that works from anywhere.{" "}
          <span className="text-ink">Set up from your phone in five minutes. No computer, no code.</span>
        </p>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <DownloadButton />
          <StarButton stars={stars} />
        </div>

        {/* Where the TV sits: the WebGL scene draws it here. */}
        <div className="relative mt-[clamp(2.25rem,4.5vh,3.5rem)] w-[clamp(300px,min(80vw,calc((100svh-36.5rem)*1.78)),680px)] max-sm:w-[84vw]">
          <div
            ref={anchor}
            role="img"
            aria-label="A TV showing Orbit Home, a curved row of app cards under the greeting Good Afternoon, circled by a glowing orbit ring"
            className="relative aspect-video w-full cursor-pointer"
          >
            {fallback && (
              <div className="absolute inset-0 rounded-[10px] bg-[#0a0d18] p-[6px] shadow-[0_40px_120px_-30px_rgba(0,0,0,0.9)] ring-1 ring-white/10">
                <img src={homeUrl} alt="" className="h-full w-full rounded-[6px] object-cover" />
                <svg viewBox="0 0 200 60" className="pointer-events-none absolute -inset-x-[18%] top-[30%] w-[136%] overflow-visible" aria-hidden="true">
                  <defs>
                    <linearGradient id="fallback-ring" x1="0" x2="1">
                      <stop offset="0" stopColor="#74D1FF" />
                      <stop offset=".5" stopColor="#ADC6FF" />
                      <stop offset="1" stopColor="#E9B3FF" />
                    </linearGradient>
                  </defs>
                  <ellipse cx="100" cy="30" rx="98" ry="22" fill="none" stroke="url(#fallback-ring)" strokeWidth="1.2" transform="rotate(-8 100 30)" />
                </svg>
              </div>
            )}
          </div>
        </div>
        <div className="mt-[clamp(2.25rem,5vh,3.5rem)] flex flex-col items-center gap-3">
          {!fallback && (
            <button
              type="button"
              onClick={() => control.current?.toggle()}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-[0.8125rem] whitespace-nowrap text-soft backdrop-blur-md transition-colors hover:border-white/20 hover:text-ink"
            >
              <I.Gear size={15} className={`transition-transform duration-700 ${panel ? "rotate-180 text-sky" : ""}`} />
              {panel ? "Back to Home" : "Press Settings on this TV"}
            </button>
          )}
          <p className="max-w-[34rem] text-[0.8125rem] text-dim">Free. Android 8 or later on the phone, on the same Wi-Fi as the TV. One tap puts it all back.</p>
        </div>

        <QrCard className="absolute right-[var(--gutter-r)] bottom-8 hidden [@media(min-width:1280px)_and_(min-height:760px)]:flex" />
        <a
          href="#try"
          onClick={(e) => {
            e.preventDefault();
            goTo("try");
          }}
          className="group mt-auto inline-flex flex-col items-center gap-2 pt-[clamp(3rem,8vh,5rem)] text-[0.8125rem] text-dim transition-colors hover:text-ink"
        >
          <span className="eyebrow !text-[0.6875rem] text-dim group-hover:text-ice">Take the remote</span>
          <span className="grid size-9 place-items-center rounded-full border border-white/12 bg-white/[0.03] motion-safe:animate-[float-y_2.4s_ease-in-out_infinite]">
            <I.ArrowDown size={16} />
          </span>
        </a>
      </div>
    </section>
  );
}
