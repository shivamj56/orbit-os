import { useEffect, useRef, useState, type ReactNode } from "react";
import Orb from "@/components/reactbits/Orb";
import { OrbitingCircles } from "@/components/magicui/orbiting-circles";
import { NumberTicker } from "@/components/magicui/number-ticker";
import { StarButton } from "@/components/kit/buttons";
import * as I from "@/components/kit/icons";
import { STARGAZERS_URL } from "@/lib/links";
import { useInView, useReducedMotion } from "@/lib/hooks";
import { useThemeValue } from "@/lib/themeContext";

/**
 * The star moment: everything Orbit OS is, in orbit (Magic UI Orbiting Circles) around a breathing ring of light
 * (React Bits Orb), and one big Star button in the middle. The live count appears only when GitHub answers.
 */
export function StarMoment({ stars }: { stars: number | null }) {
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(560);
  const [hot, setHot] = useState(false);
  const reduce = useReducedMotion();
  const near = useInView(stage, 0.05);
  const day = useThemeValue() === "light";

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const inner = Math.round(size * 0.3);
  const outer = Math.round(size * 0.46);
  const icon = size < 420 ? 34 : 44;
  const speed = hot ? 2.6 : 1;

  return (
    <section id="star" aria-labelledby="star-title" className="relative overflow-hidden py-[clamp(5rem,10vw,8rem)]">
      <div className="wrap text-center">
        <p className="eyebrow flex items-center justify-center gap-2.5">
          <span aria-hidden="true" className="h-px w-6 bg-[linear-gradient(90deg,transparent,var(--accent-2))]" />
          Join the orbit
          <span aria-hidden="true" className="h-px w-6 bg-[linear-gradient(90deg,var(--accent-2),transparent)]" />
        </p>
        <h2 id="star-title" className="mx-auto mt-5 max-w-[48rem] font-display text-[clamp(2.2rem,5vw,4rem)] leading-[1.02] font-[460] tracking-[-0.03em] text-ink">
          If it made you smile, <span className="iris-text">give it a star.</span>
        </h2>
        <p className="mx-auto mt-5 max-w-[38rem] text-[clamp(1.0625rem,1.3vw,1.1875rem)] leading-relaxed text-soft">
          Orbit OS is free, and made by Shiv in India. GitHub Trending lists the projects that gain the most stars in a day,
          and that is where other TV owners will find it. Your star counts.
        </p>

        <div ref={stage} className="relative mx-auto mt-6 aspect-square w-full max-w-[38rem]">
          {near && (
            <div className={`absolute inset-[8%] ${day ? "mix-blend-multiply [mask-image:radial-gradient(closest-side,#000_82%,transparent_100%)]" : ""}`} aria-hidden="true">
              <Orb key={day ? "day" : "night"} colors={day ? ["#9a3fd0", "#0a76b3", "#c7d2ff"] : ["#E9B3FF", "#74D1FF", "#1b2350"]} backgroundColor={day ? "#F5F6FA" : "#05070D"} glow={day ? 0.9 : 1.1} size={0.86} trail={1.2} hoverIntensity={0.6} forceHoverState={hot} paused={reduce} />
            </div>
          )}
          <div className="absolute inset-0 grid place-items-center">
            {!reduce && (
              <>
                <OrbitingCircles radius={inner} iconSize={icon} duration={26} speed={speed}>
                  <Planet label="Orbit Home">
                    <I.Home size={18} />
                  </Planet>
                  <Planet label="Live TV">
                    <span className="flex items-center gap-1 text-[0.625rem] font-bold tracking-[0.08em]">
                      <span className="size-1.5 rounded-full bg-live" />
                      LIVE
                    </span>
                  </Planet>
                  <Planet label="Control Center">
                    <I.Gear size={18} />
                  </Planet>
                  <Planet label="Globe remote">
                    <I.GlobeIcon size={18} />
                  </Planet>
                </OrbitingCircles>
                <OrbitingCircles radius={outer} iconSize={icon} duration={40} reverse speed={speed}>
                  <Planet label="From anywhere">
                    <I.Cloud size={18} />
                  </Planet>
                  <Planet label="Help mode">
                    <I.Eye size={18} />
                  </Planet>
                  <Planet label="One-tap undo">
                    <I.Undo size={18} />
                  </Planet>
                  <Planet label="No root">
                    <I.Shield size={18} />
                  </Planet>
                  <Planet label="Setup from the phone">
                    <I.Phone size={18} />
                  </Planet>
                  <Planet label="Your TV">
                    <I.Tv size={18} />
                  </Planet>
                </OrbitingCircles>
              </>
            )}
            <div className="relative z-10 flex flex-col items-center gap-7 max-sm:gap-5" onPointerEnter={() => setHot(true)} onPointerLeave={() => setHot(false)} onFocus={() => setHot(true)} onBlur={() => setHot(false)}>
              <div className="scale-[1.38] max-sm:scale-[1.1]">
                <StarButton stars={null} label="Star Orbit OS" />
              </div>
              {stars !== null ? (
                <a href={STARGAZERS_URL} target="_blank" rel="noopener" className="inline-flex items-center gap-2 font-mono text-[0.8125rem] text-accent-3 hover:underline">
                  <I.Star size={13} filled />
                  <NumberTicker value={stars} className="text-accent-3" /> {stars === 1 ? "star" : "stars"} so far
                </a>
              ) : (
                <span className="font-mono text-[0.75rem] text-dim max-sm:hidden">github.com/shivamj56/orbit-os</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Planet({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span title={label} aria-label={label} role="img" className="grid size-full place-items-center rounded-full border border-line bg-surface text-accent-2 shadow-[0_8px_24px_-8px_color-mix(in_srgb,var(--accent)_45%,transparent)]">
      {children}
    </span>
  );
}
