import { motion, useSpring, useTransform, type MotionValue } from "motion/react";
import { useEffect } from "react";
import type { AppDef } from "./apps";

/*
 * Orbit Home's gallery: the apps on the inside of a cylinder, so the cards at the sides come closer and turn toward
 * you, and the row rolls on a critically damped spring like the TV's. Everything is in container units (cqw), so it
 * scales with the pretend TV.
 */
const STEP = 0.255; // radians between cards
const R = 58; // cylinder radius, cqw

export function HomeRow({ apps, focus, onPick, reduce }: { apps: AppDef[]; focus: number; onPick: (i: number) => void; reduce: boolean }) {
  const pos = useSpring(focus, reduce ? { stiffness: 2000, damping: 100 } : { stiffness: 210, damping: 27, mass: 0.9 });
  useEffect(() => {
    pos.set(focus);
  }, [focus, pos]);
  return (
    <div className="absolute inset-x-0 top-[31%] h-[33%]" style={{ perspective: "70cqw", perspectiveOrigin: "50% 42%" }}>
      <div className="relative h-full w-full" style={{ transformStyle: "preserve-3d" }}>
        {apps.map((a, i) => (
          <Card key={a.id} app={a} index={i} pos={pos} focused={i === focus} onPick={() => onPick(i)} />
        ))}
      </div>
    </div>
  );
}

function Card({ app, index, pos, focused, onPick }: { app: AppDef; index: number; pos: MotionValue<number>; focused: boolean; onPick: () => void }) {
  const transform = useTransform(pos, (p) => {
    const d = index - p;
    const t = d * STEP;
    const x = R * Math.sin(t);
    const z = R * (1 - Math.cos(t));
    const lift = Math.max(0, 1 - Math.abs(d)) * 0.9;
    return `translate3d(calc(-50% + ${x.toFixed(3)}cqw), -50%, ${(z + lift).toFixed(3)}cqw) rotateY(${(-t).toFixed(4)}rad)`;
  });
  const opacity = useTransform(pos, (p) => {
    const d = Math.abs(index - p);
    return d > 5.4 ? 0 : Math.min(1, 5.4 - d);
  });
  const dim = useTransform(pos, (p) => {
    const d = Math.abs(index - p);
    return `brightness(${(1 - Math.min(0.42, d * 0.11)).toFixed(3)})`;
  });

  const surface: React.CSSProperties =
    app.surface === "light"
      ? { background: "linear-gradient(165deg, rgba(242,244,250,0.95), rgba(188,195,212,0.86))", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.55)" }
      : app.surface === "dark"
        ? { background: "linear-gradient(165deg, rgba(84,92,112,0.92), rgba(32,36,50,0.94))", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.16)" }
        : app.surface === "orbit"
          ? { background: "linear-gradient(150deg, #74D1FF 0%, #8c9dff 46%, #c58bff 100%)", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.4)" }
          : { background: app.fill, boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.22)" };

  return (
    <motion.button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      onClick={onPick}
      className="absolute top-1/2 left-1/2 h-[16.6cqw] w-[12.4cqw] cursor-pointer rounded-[1.2cqw] outline-none"
      style={{ transform, opacity, filter: dim, transformStyle: "preserve-3d", willChange: "transform" }}
    >
      <span
        className="absolute inset-0 overflow-hidden rounded-[inherit] transition-shadow duration-500"
        style={{
          ...surface,
          boxShadow: `${surface.boxShadow}${focused ? `, 0 1.6cqw 5cqw -0.6cqw ${app.glow}, 0 0 0 0.16cqw rgba(255,255,255,0.85)` : ""}`,
        }}
      >
        {/* glass: a sheen from the top-left */}
        <span className="absolute inset-0 bg-[linear-gradient(155deg,rgba(255,255,255,0.38)_0%,rgba(255,255,255,0.06)_38%,rgba(255,255,255,0)_60%)]" />
        <span
          className="absolute inset-0 grid place-items-center px-[0.8cqw] text-center leading-none"
          style={{
            color: app.ink,
            fontWeight: app.weight ?? 600,
            fontSize: app.mark.length > 9 ? "1.35cqw" : "1.7cqw",
            letterSpacing: app.caps ? "0.06em" : "-0.01em",
            fontFamily: "var(--font-sans)",
          }}
        >
          {app.surface === "orbit" ? (
            <span className="flex flex-col items-center gap-[0.6cqw]">
              <span className="flex items-center gap-[0.5cqw] rounded-full bg-black/25 px-[0.7cqw] py-[0.25cqw] text-[0.85cqw] font-semibold tracking-[0.12em]">
                <span className="size-[0.6cqw] rounded-full bg-[#ff5468]" />
                LIVE
              </span>
              <span className="font-display text-[2cqw] font-medium">Live TV</span>
              <span className="text-[0.85cqw] font-medium opacity-80">30 free channels</span>
            </span>
          ) : (
            app.mark
          )}
        </span>
        {/* the focused card's streak of light, as on the TV */}
        {focused && (
          <motion.span
            key={`streak-${index}`}
            className="absolute top-0 bottom-0 w-[0.22cqw]"
            style={{ background: "linear-gradient(180deg, transparent, #fff 20%, #fff 80%, transparent)", boxShadow: `0 0 1.4cqw 0.3cqw ${app.glow}` }}
            initial={{ left: "-4%", opacity: 0 }}
            animate={{ left: "50%", opacity: 0.95 }}
            transition={{ duration: 0.55, ease: [0.19, 1, 0.22, 1] }}
          />
        )}
      </span>
    </motion.button>
  );
}
