import { motion, useMotionValue, useMotionValueEvent, useScroll, useTransform } from "motion/react";
import { useEffect, useRef, useState } from "react";
import homeUrl from "@/assets/img/home.webp";
import { SectionHead } from "@/components/kit/SectionHead";
import * as I from "@/components/kit/icons";
import { useReducedMotion } from "@/lib/hooks";

/** "Clutter versus calm": drag the line between a sketch of a typical ad-filled home screen and the real Orbit Home. */
export function Calm() {
  return (
    <section id="calm" aria-labelledby="calm-title" className="relative py-[clamp(5rem,11vw,9rem)]">
      <div className="wrap">
        <SectionHead
          eyebrow="Clutter versus calm"
          title="Drag the line. Feel the difference."
          lede="On the left, the kind of home screen most TVs ship with: rows you never asked for, ads, things to install. On the right, Orbit Home on a real TV: your apps, a greeting, one search."
        />
        <span id="calm-title" className="sr-only">
          Clutter versus calm
        </span>
        <Compare />
        <ul className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { icon: <I.NoTrash size={18} />, t: "Ads, promoted rows and tracking switched off", d: "Switched off, never deleted, and back with one tap." },
            { icon: <I.Tv size={18} />, t: "Only your apps, on one curved row", d: "Lit in each app's own colour, with recents below." },
            { icon: <I.Search size={18} />, t: "One search for apps, films and shows", d: "Type or speak; results open inside YouTube and Prime Video." },
          ].map((f) => (
            <li key={f.t} className="flex gap-3.5 rounded-2xl border border-line bg-veil/[0.02] p-4">
              <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">{f.icon}</span>
              <span>
                <span className="block text-[0.9375rem] font-medium text-ink">{f.t}</span>
                <span className="mt-0.5 block text-[0.875rem] text-dim">{f.d}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Compare() {
  const box = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const pos = useMotionValue(50);
  const [value, setValue] = useState(50);
  const [touched, setTouched] = useState(false);
  useMotionValueEvent(pos, "change", (v) => setValue(Math.round(v)));
  const clip = useTransform(pos, (v) => `inset(0 ${100 - v}% 0 0)`);
  const left = useTransform(pos, (v) => `${v}%`);

  // Until you take the line yourself, scrolling moves it: clutter while it comes up, calm by the time it is centred.
  const { scrollYProgress } = useScroll({ target: box, offset: ["start end", "center 40%"] });
  useMotionValueEvent(scrollYProgress, "change", (p) => {
    if (touched || reduce) return;
    pos.set(88 - Math.min(1, Math.max(0, p)) * 66);
  });
  useEffect(() => {
    if (reduce) pos.set(50);
  }, [reduce, pos]);

  const setFrom = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    pos.set(Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100)));
  };

  return (
    <div className="mt-[clamp(2.5rem,5vw,4rem)]">
      <div
        ref={box}
        className="relative aspect-video w-full cursor-ew-resize touch-pan-y overflow-hidden rounded-[clamp(12px,1.6vw,22px)] bg-black shadow-[0_50px_120px_-40px_rgb(var(--shadow-rgb)/var(--shadow-a)),0_0_0_1px_var(--device-edge)] select-none"
        style={{ containerType: "inline-size" }}
        onPointerDown={(e) => {
          setTouched(true);
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          setFrom(e.clientX);
        }}
        onPointerMove={(e) => {
          if (e.buttons === 0 && e.pointerType === "mouse") return;
          if ((e.currentTarget as HTMLDivElement).hasPointerCapture(e.pointerId)) setFrom(e.clientX);
        }}
      >
        {/* after: the real Orbit Home */}
        <img src={homeUrl} alt="Orbit Home on the TV: Good Afternoon, a curved row of app cards with Netflix in focus, and one search bar" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
        {/* before: the sketch, clipped to the left of the line */}
        <motion.div className="absolute inset-0" style={{ clipPath: clip }} aria-hidden="true">
          <Clutter />
        </motion.div>

        <span className="pointer-events-none absolute top-[3%] left-[2.5%] rounded-full bg-black/60 px-[1.4cqw] py-[0.6cqw] font-mono text-[max(10px,1.1cqw)] tracking-[0.08em] text-white/85 uppercase backdrop-blur">
          Before · a sketch
        </span>
        <span className="pointer-events-none absolute top-[3%] right-[2.5%] rounded-full bg-black/60 px-[1.4cqw] py-[0.6cqw] font-mono text-[max(10px,1.1cqw)] tracking-[0.08em] text-[#7EE2B8] uppercase backdrop-blur">
          After · Orbit Home
        </span>

        <motion.div className="pointer-events-none absolute inset-y-0" style={{ left }}>
          <div className="absolute inset-y-0 -left-px w-0.5 bg-[linear-gradient(180deg,#74D1FF,#ADC6FF,#E9B3FF)] shadow-[0_0_24px_rgba(173,198,255,0.7)]" />
          <div
            role="slider"
            tabIndex={0}
            aria-label="Before and after: move left for Orbit Home, right for the cluttered home screen"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={value}
            aria-valuetext={`${value}% cluttered home screen`}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 10 : 4;
              if (e.key === "ArrowLeft" || e.key === "ArrowDown") pos.set(Math.max(0, pos.get() - step));
              else if (e.key === "ArrowRight" || e.key === "ArrowUp") pos.set(Math.min(100, pos.get() + step));
              else if (e.key === "Home") pos.set(0);
              else if (e.key === "End") pos.set(100);
              else return;
              e.preventDefault();
              setTouched(true);
            }}
            className="pointer-events-auto absolute top-1/2 left-0 grid size-[clamp(2.6rem,4.5cqw,3.6rem)] -translate-1/2 cursor-grab place-items-center rounded-full border border-white/40 bg-[#0b1020]/75 text-white shadow-[0_10px_30px_rgba(0,0,0,0.5),0_0_0_6px_rgba(173,198,255,0.14)] backdrop-blur-md transition-transform duration-200 hover:scale-110 active:scale-95 active:cursor-grabbing"
          >
            <span className="flex items-center gap-0.5">
              <I.Chevron size={16} className="rotate-90" />
              <I.Chevron size={16} className="-rotate-90" />
            </span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

/** A made-up stock home screen: drawn shapes and generic words only, no real product or brand. */
export function Clutter() {
  const tile = (bg: string, i: number, badge?: string) => (
    <div key={i} className="relative h-full flex-1 overflow-hidden rounded-[0.5cqw]" style={{ background: bg }}>
      <div className="absolute inset-x-[10%] bottom-[12%] h-[10%] rounded-full bg-white/35" />
      <div className="absolute inset-x-[10%] bottom-[28%] h-[8%] w-[60%] rounded-full bg-white/25" />
      {badge && <span className="absolute top-[6%] left-[6%] rounded-[0.25cqw] bg-[#ffd400] px-[0.4cqw] py-[0.1cqw] text-[0.75cqw] font-bold text-black">{badge}</span>}
    </div>
  );
  return (
    <div className="absolute inset-0 bg-[#121212] font-sans text-white">
      <div className="flex items-center gap-[1.6cqw] px-[3cqw] pt-[2.4cqw] text-[1.2cqw]">
        <span className="rounded-[0.4cqw] bg-white/90 px-[0.8cqw] py-[0.2cqw] font-bold text-black">HOME</span>
        {["For you", "Live", "Movies", "Shows", "Apps", "Library", "Shop"].map((t, i) => (
          <span key={t} className={i === 0 ? "border-b-[0.25cqw] border-white pb-[0.3cqw] font-semibold" : "text-white/60"}>
            {t}
          </span>
        ))}
        <span className="ml-auto flex items-center gap-[1cqw] text-white/70">
          <span className="rounded-full bg-[#ff3b30] px-[0.7cqw] py-[0.1cqw] text-[0.9cqw] font-bold text-white">3</span>
          <span className="size-[2.2cqw] rounded-full bg-white/20" />
          <span className="size-[2.2cqw] rounded-full bg-white/20" />
        </span>
      </div>
      <div className="relative mx-[3cqw] mt-[1.6cqw] h-[36%] overflow-hidden rounded-[0.8cqw] bg-[linear-gradient(115deg,#c2350b,#a00e57_45%,#3a0ca3)]">
        <div className="absolute -top-[30%] right-[8%] size-[24cqw] rounded-full bg-[#ffd400]/40 blur-[1cqw]" />
        <div className="absolute right-[14%] bottom-[-20%] size-[16cqw] rotate-12 rounded-[2cqw] bg-white/20" />
        <span className="absolute top-[8%] left-[3%] rounded-[0.3cqw] bg-black/50 px-[0.6cqw] py-[0.15cqw] text-[0.9cqw] font-semibold">SPONSORED</span>
        <div className="absolute bottom-[14%] left-[3%]">
          <div className="text-[3.4cqw] leading-none font-black tracking-[-0.02em] uppercase">Big New Show</div>
          <div className="mt-[0.6cqw] text-[1.2cqw] text-white/85">Streaming now. Subscribe to watch.</div>
          <div className="mt-[1cqw] flex gap-[0.8cqw]">
            <span className="rounded-[0.4cqw] bg-white px-[1.4cqw] py-[0.5cqw] text-[1.1cqw] font-bold text-black">Install app</span>
            <span className="rounded-[0.4cqw] bg-black/35 px-[1.4cqw] py-[0.5cqw] text-[1.1cqw] font-semibold">Learn more</span>
          </div>
        </div>
        <span className="absolute right-[2%] bottom-[6%] rounded-[0.3cqw] bg-[#ffd400] px-[0.5cqw] text-[0.85cqw] font-bold text-black">AD</span>
        <div className="absolute bottom-[6%] left-1/2 flex -translate-x-1/2 gap-[0.4cqw]">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className={`h-[0.5cqw] rounded-full ${i === 1 ? "w-[2cqw] bg-white" : "w-[0.5cqw] bg-white/45"}`} />
          ))}
        </div>
      </div>
      <div className="mx-[3cqw] mt-[1.6cqw] text-[1.15cqw] font-semibold">
        Top picks for you <span className="font-normal text-white/50">· Promoted</span>
      </div>
      <div className="mx-[3cqw] mt-[0.8cqw] flex h-[15%] gap-[0.8cqw]">
        {["#2b6cff", "#ff8a00", "#00b37e", "#d6246e", "#7a3cff", "#00a3c4", "#ffbf00"].map((c, i) => tile(`linear-gradient(160deg, ${c}, #111)`, i, i % 3 === 0 ? "NEW" : i === 4 ? "AD" : undefined))}
      </div>
      <div className="mx-[3cqw] mt-[1.4cqw] text-[1.15cqw] font-semibold">
        Apps you might like <span className="font-normal text-white/50">· Sponsored</span>
      </div>
      <div className="mx-[3cqw] mt-[0.8cqw] flex h-[11%] gap-[0.8cqw]">
        {["#e53935", "#43a047", "#1e88e5", "#fdd835", "#8e24aa", "#fb8c00", "#00897b", "#3949ab"].map((c, i) => (
          <div key={i} className="relative flex-1 rounded-[0.5cqw]" style={{ background: c }}>
            <span className="absolute right-[6%] bottom-[8%] rounded-[0.25cqw] bg-black/55 px-[0.4cqw] text-[0.7cqw] font-semibold">Install</span>
          </div>
        ))}
      </div>
      <div className="absolute right-[3cqw] bottom-[3cqw] w-[24cqw] rounded-[0.8cqw] border border-line bg-[#262626] p-[1.2cqw] shadow-[0_1cqw_3cqw_rgb(var(--shadow-rgb)/calc(var(--shadow-a)*0.7))]">
        <div className="flex items-center justify-between text-[1.1cqw] font-semibold">
          Try Premium free <span className="text-white/50">✕</span>
        </div>
        <div className="mt-[0.4cqw] text-[0.9cqw] text-white/60">Then a monthly plan. Cancel anytime.</div>
      </div>
    </div>
  );
}
