// The opening intro (phone/SPEC.md, "The opening intro"): about two seconds on a cold start. The Orbit mark, exactly
// where and as the system splash left it, becomes a lit glass planet; its iridescent ring sweeps round with a satellite,
// behind the planet and in front of it; a light catches the planet's edge; "Orbit" resolves; then the ring opens, the
// night thins away, and the planet lands on the first screen's globe, which draws its grid as the planet dissolves into
// it. A tap skips to the hand-over. With reduced motion the mark only fades. Once per start of the app, never on resume.
import { useEffect, useRef, useState } from "react";
import { bridge } from "../bridge";
import { INTRO_FRAG, INTRO_VERT } from "./shader";
import { globeTarget, introEnds, introHands, introStarts } from "./store";
import { t } from "../i18n";

const SEEN_KEY = "orbit-intro-seen";

/**
 * The mark as the Android 12 splash draws it (android/app/src/main/res/drawable/splash_mark.xml, 288 dp, centred) and
 * as Flutter paints it until the page is ready (lib/app/splash_mark.dart), in CSS px = dp from the screen's middle.
 */
export const MARK = { r: 29.33, a: 72, b: 28, roll: (24 * Math.PI) / 180, stroke: 4, sat: (-34.9 * Math.PI) / 180 };

/** When the hand-over starts, and how long it takes (shorter after a tap). */
const HAND_AT = 1.62;
const HAND_FOR = 0.56;
const SKIP_FOR = 0.42;
/** Frame 0 is held while Flutter's own copy of the mark fades off above it. */
const HOLD = 0.18;

interface IntroPlan {
  play: boolean;
  /** ?intro-at=1.2: one frame, held (for screenshots of the design). */
  at: number | null;
  still: boolean;
}

let plan: IntroPlan = { play: false, at: null, still: false };

/**
 * Decides, before the first render, whether this start plays the intro: once per page session (a cold start of the
 * app), so a page that reloads in the same app run does not. `?intro` plays it again, `?intro=0` never.
 */
export function prepareIntro(): IntroPlan {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(location.search);
  } catch {
    params = new URLSearchParams();
  }
  const at = params.has("intro-at") ? Number(params.get("intro-at")) : null;
  let seen = false;
  try {
    seen = sessionStorage.getItem(SEEN_KEY) === "1";
    sessionStorage.setItem(SEEN_KEY, "1");
  } catch {
    seen = false;
  }
  const still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const forced = params.has("intro") && params.get("intro") !== "0";
  plan = {
    play: params.get("intro") !== "0" && (forced || at !== null || !seen),
    at: at !== null && Number.isFinite(at) ? Math.max(0, at) : null,
    still,
  };
  if (plan.play) introStarts();
  return plan;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const span = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const inOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const out3 = (x: number) => 1 - Math.pow(1 - x, 3);
const inQuad = (x: number) => x * x;
const inOutSine = (x: number) => -(Math.cos(Math.PI * x) - 1) / 2;

/** Tells Flutter the page shows the mark now, so its own copy above the page can go. */
function shown() {
  if (bridge.native) bridge.fire("intro", { state: "shown" });
}

export function Intro() {
  const [mine] = useState(plan);
  const [gone, setGone] = useState(!mine.play);
  const [still, setStill] = useState(mine.still);
  useEffect(() => {
    // Nothing to play (a reload in the same run): Flutter's mark, if it is still up, goes at once.
    if (!mine.play) {
      const id = requestAnimationFrame(() => requestAnimationFrame(shown));
      return () => cancelAnimationFrame(id);
    }
  }, [mine.play]);
  if (gone) return null;
  const done = () => {
    introEnds();
    setGone(true);
  };
  return still ? <StillMark onDone={done} /> : <Scene frozenAt={mine.at} onDone={done} onNoGl={() => setStill(true)} />;
}

interface State {
  cx: number;
  cy: number;
  r: number;
  a: number;
  tilt: number;
  roll: number;
  stroke: number;
  sat: number;
  trail: number;
}

function Scene({ frozenAt, onDone, onNoGl }: { frozenAt: number | null; onDone: () => void; onNoGl: () => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const word = useRef<HTMLDivElement>(null);
  const skip = useRef<() => void>(() => {});

  useEffect(() => {
    const box = wrap.current!;
    const cv = canvas.current!;
    const gl = cv.getContext("webgl2", { antialias: false, premultipliedAlpha: true, alpha: true });
    if (!gl) {
      onNoGl();
      return;
    }
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? "shader");
      return sh;
    };
    const prog = gl.createProgram()!;
    try {
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, INTRO_VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, INTRO_FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
    } catch (e) {
      console.error("intro:", e);
      onNoGl();
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const U = (n: string) => gl.getUniformLocation(prog, n);
    const u = {
      res: U("uRes"), px: U("uPx"), center: U("uCenter"), r: U("uR"), ring: U("uRing"), ringA: U("uRingAlpha"), sat: U("uSat"),
      trail: U("uTrail"), form: U("uForm"), glint: U("uGlint"), bg: U("uBg"), fade: U("uFade"), time: U("uTime"),
    };
    gl.clearColor(0, 0, 0, 0);

    // Canvas pixels: the screen's own, up to 1.5 per CSS px (dropped to 1 if the first frames come slowly).
    let dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let W = 0;
    let H = 0;
    const size = () => {
      W = box.clientWidth;
      H = box.clientHeight;
      const w = Math.max(1, Math.round(W * dpr));
      const h = Math.max(1, Math.round(H * dpr));
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
      }
      gl.viewport(0, 0, cv.width, cv.height);
      // "Orbit" sits under the planet's place before the hand-over.
      if (word.current) word.current.style.top = `${(H * 0.43 + r1() + 34).toFixed(1)}px`;
    };
    const ro = new ResizeObserver(size);
    ro.observe(box);

    // The layout: the mark where the splash had it (the middle of the screen), then the planet a little higher.
    const at0 = (): State => ({ cx: W / 2, cy: H / 2, r: MARK.r, a: MARK.a / MARK.r, tilt: MARK.b / MARK.a, roll: MARK.roll, stroke: MARK.stroke, sat: MARK.sat, trail: 0 });
    const r1 = () => Math.min(128, Math.max(80, Math.min(W * 0.26, H * 0.15)));
    size();

    /** The scene before the hand-over, at time t. */
    const before = (t: number): State & { form: number; glint: number } => {
      const s0 = at0();
      const g = inOut(span(t, 0.05, 1.05));
      const R = lerp(s0.r, r1(), g);
      const sweep = inOutSine(span(t, 0.12, HAND_AT + 0.05));
      return {
        cx: lerp(s0.cx, W / 2, g),
        cy: lerp(s0.cy, H * 0.43, g),
        r: R,
        // The ring closes in a little as the camera comes in, so it stays clear of the screen's edges.
        a: lerp(s0.a, 1.62, g),
        tilt: lerp(s0.tilt, 0.36, g) - 0.1 * Math.sin(Math.PI * span(t, 0.1, 1.45)),
        roll: lerp(MARK.roll, (15 * Math.PI) / 180, inOut(span(t, 0.1, 1.5))),
        stroke: lerp(MARK.stroke, 3.0, g),
        sat: MARK.sat + Math.PI * 2 * 1.22 * sweep,
        trail: span(t, 0.12, 0.45),
        form: inOut(span(t, 0.1, 0.95)),
        glint: t >= 0.62 && t <= 1.4 ? (t - 0.62) / 0.78 : -1,
      };
    };

    let handStart = HAND_AT;
    let handFor = HAND_FOR;
    let from: State | null = null;
    let fromForm = 1;
    let fromWord = 1;
    let target: { cx: number; cy: number; r: number } | null = null;
    let handed = false;
    let clock0 = 0;
    let raf = 0;
    let frames = 0;
    let slow = 0;
    let lastNow = 0;
    let first = true;

    const wordStyle = (opacity: number, spacing: number, blur: number, y: number, sweep: number) => {
      const el = word.current;
      if (!el) return;
      el.style.opacity = opacity.toFixed(3);
      el.style.letterSpacing = `${spacing.toFixed(3)}em`;
      // The space after the last letter, given back before the first, so the word stays centred as it closes up.
      el.style.paddingLeft = `${spacing.toFixed(3)}em`;
      el.style.filter = blur > 0.05 ? `blur(${blur.toFixed(2)}px)` : "none";
      el.style.transform = `translate3d(-50%, ${y.toFixed(2)}px, 0)`;
      el.style.backgroundPosition = `${sweep.toFixed(1)}% 50%, 0 0`;
    };

    const findTarget = () => {
      const g = globeTarget();
      if (!g) return null;
      const outer = box.getBoundingClientRect();
      const k = outer.width / Math.max(1, box.clientWidth);
      const r = g.el.getBoundingClientRect();
      return { cx: (r.left + r.width / 2 - outer.left) / k, cy: (r.top + r.height / 2 - outer.top) / k, r: ((r.width / k) / 2) * 0.8 };
    };

    const draw = (t: number, now: number) => {
      let s: State;
      let form = 1;
      let glint = -1;
      let ringA = 1;
      let bg = 1;
      let fade = 1;
      if (t < handStart) {
        const b = before(t);
        s = b;
        form = b.form;
        glint = b.glint;
        // Word: resolves from wide, soft letters.
        const w = out3(span(t, 0.95, 1.55));
        wordStyle(w, lerp(0.42, 0.06, w), lerp(10, 0, w), lerp(10, 0, w), lerp(130, -30, span(t, 1.15, 1.8)));
      } else {
        if (!from) {
          const b = before(handStart);
          from = b;
          fromForm = b.form;
          fromWord = out3(span(handStart, 0.95, 1.55));
          target = findTarget();
          // The app is under the finger again from here.
          box.style.pointerEvents = "none";
        }
        const h = span(t, handStart, handStart + handFor);
        const mv = out3(span(h, 0, 0.66));
        const f0 = from;
        const to = target ?? { cx: f0.cx, cy: f0.cy, r: f0.r * 0.92 };
        s = {
          cx: lerp(f0.cx, to.cx, mv),
          cy: lerp(f0.cy, to.cy, mv),
          r: lerp(f0.r, to.r, mv),
          a: f0.a * (1 + 2.4 * inQuad(h)),
          tilt: lerp(f0.tilt, 0.92, inOut(h)),
          roll: f0.roll,
          stroke: f0.stroke * (1 - 0.4 * h),
          sat: f0.sat + 1.7 * h,
          trail: f0.trail * (1 - h),
        };
        form = lerp(fromForm, 1, out3(span(h, 0, 0.5)));
        ringA = 1 - inQuad(span(h, 0, 0.85));
        bg = 1 - inOut(span(h, 0, 0.7));
        fade = target ? 1 - inOut(span(h, 0.5, 1)) : 1 - inOut(span(h, 0.3, 1));
        const w = fromWord * (1 - out3(span(h, 0, 0.45)));
        wordStyle(w, lerp(0.42, 0.06, fromWord), (1 - w) * 6, -10 * (1 - w), -30);
        // The globe begins to draw its grid as the planet arrives on it.
        if (!handed && h >= 0.42) {
          handed = true;
          introHands();
        }
        if (h >= 1 && frozenAt === null) {
          finish();
          return;
        }
      }
      const px = cv.width / Math.max(1, W);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(u.res, cv.width, cv.height);
      gl.uniform1f(u.px, px);
      gl.uniform2f(u.center, s.cx * px, (H - s.cy) * px);
      gl.uniform1f(u.r, s.r * px);
      gl.uniform4f(u.ring, s.a, s.tilt, s.roll, s.stroke);
      gl.uniform1f(u.ringA, ringA);
      gl.uniform1f(u.sat, s.sat);
      gl.uniform1f(u.trail, s.trail);
      gl.uniform1f(u.form, form);
      gl.uniform1f(u.glint, glint);
      gl.uniform1f(u.bg, bg);
      gl.uniform1f(u.fade, fade);
      gl.uniform1f(u.time, now / 1000);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const finish = () => {
      cancelAnimationFrame(raf);
      onDone();
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (first) {
        first = false;
        clock0 = now + HOLD * 1000;
        draw(0, now);
        // Two frames on, the WebView has shown it: Flutter's mark above the page can go.
        requestAnimationFrame(() => requestAnimationFrame(shown));
        lastNow = now;
        return;
      }
      // A phone that cannot keep up gets fewer pixels, not fewer frames.
      if (frames < 14 && now - lastNow > 24) slow++;
      frames++;
      lastNow = now;
      if (frames === 14 && slow >= 6 && dpr > 1) {
        dpr = 1;
        size();
      }
      const t = frozenAt ?? Math.max(0, (now - clock0) / 1000);
      draw(t, now);
    };
    raf = requestAnimationFrame(frame);

    skip.current = () => {
      if (frozenAt !== null) return;
      const t = Math.max(0, (performance.now() - clock0) / 1000);
      if (t >= handStart) return;
      handStart = t;
      handFor = SKIP_FOR;
    };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return (
    <div
      ref={wrap}
      className="absolute inset-0 z-[90] overflow-hidden"
      onPointerDown={() => skip.current()}
      role="img"
      aria-label="Orbit"
    >
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" aria-hidden="true" />
      <div
        ref={word}
        aria-hidden="true"
        className="intro-word pointer-events-none absolute left-1/2 font-display font-light whitespace-nowrap"
        style={{ opacity: 0 }}
      >
        Orbit
      </div>
      <button type="button" className="sr-only" onClick={() => skip.current()}>
        {t("Skip the intro")}
      </button>
    </div>
  );
}

/** Reduced motion, or no WebGL: the mark as the splash showed it, for a moment, then a short fade. */
function StillMark({ onDone }: { onDone: () => void }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(shown));
    introHands();
    const t1 = window.setTimeout(() => setLeaving(true), 220);
    const t2 = window.setTimeout(onDone, 220 + 320);
    return () => {
      cancelAnimationFrame(id);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[90] grid place-items-center bg-[#05070d] transition-opacity duration-300"
      style={{ opacity: leaving ? 0 : 1 }}
      role="img"
      aria-label="Orbit"
    >
      <MarkSvg />
    </div>
  );
}

/** The mark itself, as splash_mark.xml draws it: 288 by 288 around the screen's middle. */
export function MarkSvg() {
  const { r, a, b } = MARK;
  const c = 144;
  return (
    <svg width="288" height="288" viewBox="0 0 288 288" aria-hidden="true">
      <defs>
        <linearGradient id="mark-ring" x1={c - a} y1="0" x2={c + a} y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#74D1FF" />
          <stop offset="0.5" stopColor="#ADC6FF" />
          <stop offset="1" stopColor="#E9B3FF" />
        </linearGradient>
        <radialGradient id="mark-planet" cx={c - 0.24 * r} cy={c - 0.36 * r} r={1.6 * r} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1D2A56" />
          <stop offset="1" stopColor="#0A0F22" />
        </radialGradient>
        <radialGradient id="mark-sat" cx="0" cy="0" r="9" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.4" stopColor="#74D1FF" stopOpacity="0.8" />
          <stop offset="1" stopColor="#74D1FF" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g transform={`rotate(-24 ${c} ${c})`}>
        <path d={`M ${c - a} ${c} A ${a} ${b} 0 0 1 ${c + a} ${c}`} fill="none" stroke="url(#mark-ring)" strokeWidth={MARK.stroke * 0.8} strokeLinecap="round" opacity="0.45" />
      </g>
      <circle cx={c} cy={c} r={r} fill="url(#mark-planet)" />
      <circle cx={c} cy={c} r={r - 0.75} fill="none" stroke="#ADC6FF" strokeOpacity="0.55" strokeWidth="1.5" />
      <g transform={`rotate(-24 ${c} ${c})`}>
        <path d={`M ${c + a} ${c} A ${a} ${b} 0 0 1 ${c - a} ${c}`} fill="none" stroke="url(#mark-ring)" strokeWidth={MARK.stroke * 1.22} strokeLinecap="round" />
        <g transform={`translate(${c + a * Math.cos(MARK.sat)} ${c - b * Math.sin(MARK.sat)})`}>
          <circle r="9" fill="url(#mark-sat)" />
          <circle r="3" fill="#FFFFFF" />
        </g>
      </g>
    </svg>
  );
}
