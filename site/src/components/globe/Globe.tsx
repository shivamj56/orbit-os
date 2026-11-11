// Orbit's own globe touchpad, from phone/ui/src/globe (the remote in the Orbit phone app), reused for the website's
// "Try it now" demo. Changes for the web page: the pixel ratio is capped at 2, and the globe stops drawing while it is
// scrolled out of view or the tab is hidden.
import { useEffect, useRef } from "react";
import gsap from "gsap";
import { FRAG, VERT } from "./shader";
import { axisAngle, inverseMat3, multiply, normalize, type Quat } from "./quat";

export type Dir = "up" | "down" | "left" | "right";
export type Mode = "focus" | "cursor";

interface Props {
  mode: Mode;
  /** Still looking for the TV: dim, slow, and no input. */
  asleep?: boolean;
  /** Cursor speed, 0.5 .. 2. */
  speed?: number;
  onStep?: (dir: Dir) => void;
  onTap?: () => void;
  onLong?: () => void;
  onMove?: (dx: number, dy: number) => void;
  onScroll?: (dx: number, dy: number) => void;
  /** A finger went down or came up (for the hint under the globe). */
  onTouch?: (down: boolean) => void;
}

/** How far the surface must roll, as a share of the radius, for one step of the TV's focus; never under STEP_MIN px. */
const STEP_SHARE = 0.42;
const STEP_MIN = 44;
/** A fling keeps rolling the focus for at most this many steps. */
const FLING_STEPS = 7;
const TAP_SLOP = 10;
const TAP_MS = 320;
const LONG_MS = 480;
/** Radius of the sphere inside the canvas, as in the shader (R = 0.80 of half the side). */
const SPHERE = 0.8;

interface Sim {
  q: Quat;
  vx: number;
  vy: number;
  dragging: boolean;
  flingSteps: number;
  accX: number;
  accY: number;
  moveX: number;
  moveY: number;
  scrollX: number;
  scrollY: number;
  pulse: number;
  ripple: [number, number, number, number];
  uniforms: { cursor: number; dim: number; hold: number; reveal: number };
  lastInput: number;
}

/**
 * The trackball. In Focus mode it is a BlackBerry ball made large: roll it and the TV's focus steps one card at a time,
 * flick it and it carries on for a few, tap it for OK, hold it for the recent apps. In Cursor mode it is a laptop's
 * touchpad: glide to move the TV's pointer (faster strokes go further), tap to click, two fingers to scroll.
 */
export function Globe({ mode, asleep = false, speed = 1, onStep, onTap, onLong, onMove, onScroll, onTouch }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const sim = useRef<Sim>({
    q: normalize(multiply(axisAngle(1, 0, 0, 0.42), axisAngle(0, 1, 0, -0.5))),
    vx: 0,
    vy: 0,
    dragging: false,
    flingSteps: 0,
    accX: 0,
    accY: 0,
    moveX: 0,
    moveY: 0,
    scrollX: 0,
    scrollY: 0,
    pulse: 0,
    ripple: [0, 0, 1, -1],
    uniforms: { cursor: mode === "cursor" ? 1 : 0, dim: asleep ? 1 : 0, hold: 0, reveal: 0 },
    lastInput: 0,
  });
  // The newest props, for the long-lived handlers below.
  const props = useRef({ mode, asleep, speed, onStep, onTap, onLong, onMove, onScroll, onTouch });
  props.current = { mode, asleep, speed, onStep, onTap, onLong, onMove, onScroll, onTouch };

  // Mode and sleep are animated in the shader, not switched: GSAP carries the numbers across.
  useEffect(() => {
    const u = sim.current.uniforms;
    gsap.to(u, { cursor: mode === "cursor" ? 1 : 0, duration: 0.7, ease: "power3.inOut" });
    // A small spin on the way, so the change is felt as well as seen.
    sim.current.vx += mode === "cursor" ? 0.9 : -0.9;
  }, [mode]);
  useEffect(() => {
    gsap.to(sim.current.uniforms, { dim: asleep ? 1 : 0, duration: 1.1, ease: "power2.out" });
  }, [asleep]);

  useEffect(() => {
    const cv = canvas.current!;
    const box = wrap.current!;
    const gl = cv.getContext("webgl2", { antialias: false, premultipliedAlpha: true, alpha: true });
    const s = sim.current;
    gsap.to(s.uniforms, { reveal: 1, duration: 1.8, ease: "expo.out", delay: 0.15 });
    if (!gl) return;

    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(sh));
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const U = (name: string) => gl.getUniformLocation(prog, name);
    const uRes = U("uRes"), uTime = U("uTime"), uInv = U("uInv"), uRipple = U("uRipple"), uPulse = U("uPulse");
    const uCursor = U("uCursor"), uDim = U("uDim"), uHold = U("uHold"), uReveal = U("uReveal");
    gl.clearColor(0, 0, 0, 0);
    const inv = new Float32Array(9);

    let side = 0;
    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      side = box.clientWidth;
      const px = Math.round(side * dpr);
      if (cv.width !== px) {
        cv.width = px;
        cv.height = px;
      }
      gl.viewport(0, 0, cv.width, cv.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(box);

    // ---- rolling ----
    const radius = () => (side / 2) * SPHERE;
    const roll = (dx: number, dy: number) => {
      const len = Math.hypot(dx, dy);
      if (len < 1e-4) return;
      s.q = normalize(multiply(axisAngle(dy, dx, 0, len / radius()), s.q));
    };
    const steps = (dx: number, dy: number, fling: boolean) => {
      const step = Math.max(STEP_MIN, radius() * STEP_SHARE);
      s.accX += dx;
      s.accY += dy;
      const emit = (dir: Dir) => {
        if (fling && s.flingSteps-- <= 0) return false;
        s.pulse = 1;
        props.current.onStep?.(dir);
        return true;
      };
      while (Math.abs(s.accX) >= step && Math.abs(s.accX) >= Math.abs(s.accY)) {
        if (!emit(s.accX > 0 ? "right" : "left")) break;
        s.accX -= Math.sign(s.accX) * step;
        s.accY *= 0.4;
      }
      while (Math.abs(s.accY) >= step && Math.abs(s.accY) > Math.abs(s.accX)) {
        if (!emit(s.accY > 0 ? "down" : "up")) break;
        s.accY -= Math.sign(s.accY) * step;
        s.accX *= 0.4;
      }
    };
    const gain = (v: number) => props.current.speed * (1.5 + 2.3 * Math.min(1, v / 1.8));

    // ---- touch ----
    const pointers = new Map<number, { x: number; y: number }>();
    let start = { x: 0, y: 0, t: 0 };
    let last = { x: 0, y: 0, t: 0 };
    let travelled = 0;
    let longTimer = 0;
    let longFired = false;
    let twoFinger = false;
    let mid = { x: 0, y: 0 };

    const toSphere = (cx: number, cy: number): [number, number, number] => {
      const rect = box.getBoundingClientRect();
      let x = ((cx - rect.left) / rect.width) * 2 - 1;
      let y = -(((cy - rect.top) / rect.height) * 2 - 1);
      x /= SPHERE;
      y /= SPHERE;
      const r = Math.hypot(x, y);
      if (r > 1) {
        x /= r;
        y /= r;
      }
      return [x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y))];
    };
    const ripple = (cx: number, cy: number) => {
      const n = toSphere(cx, cy);
      s.ripple = [n[0], n[1], n[2], 0];
    };
    const midpoint = () => {
      const ps = [...pointers.values()];
      return { x: (ps[0].x + ps[1].x) / 2, y: (ps[0].y + ps[1].y) / 2 };
    };

    const down = (e: PointerEvent) => {
      if (props.current.asleep) return;
      box.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      s.lastInput = performance.now();
      if (pointers.size === 1) {
        start = last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
        travelled = 0;
        longFired = false;
        twoFinger = false;
        s.dragging = true;
        s.vx = s.vy = 0;
        s.accX = s.accY = 0;
        gsap.to(s.uniforms, { hold: 1, duration: 0.25, ease: "power2.out" });
        props.current.onTouch?.(true);
        window.clearTimeout(longTimer);
        longTimer = window.setTimeout(() => {
          if (travelled < TAP_SLOP && !twoFinger) {
            longFired = true;
            ripple(start.x, start.y);
            props.current.onLong?.();
          }
        }, LONG_MS);
      } else if (pointers.size === 2) {
        twoFinger = true;
        window.clearTimeout(longTimer);
        mid = midpoint();
      }
    };

    const move = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      s.lastInput = performance.now();
      if (twoFinger) {
        if (pointers.size < 2) return;
        const m = midpoint();
        const dx = m.x - mid.x, dy = m.y - mid.y;
        mid = m;
        roll(dx * 0.6, dy * 0.6);
        // Natural scrolling: fingers up shows what is further down.
        s.scrollX -= dx * 1.6;
        s.scrollY -= dy * 1.6;
        return;
      }
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      const dt = Math.max(1, e.timeStamp - last.t);
      last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
      travelled += Math.hypot(dx, dy);
      if (travelled > TAP_SLOP) window.clearTimeout(longTimer);
      roll(dx, dy);
      // Velocity, smoothed, in px per ms: what a fling carries on with.
      s.vx = s.vx * 0.6 + (dx / dt) * 0.4;
      s.vy = s.vy * 0.6 + (dy / dt) * 0.4;
      if (props.current.mode === "focus") steps(dx, dy, false);
      else {
        const g = gain(Math.hypot(dx, dy) / dt);
        s.moveX += dx * g;
        s.moveY += dy * g;
      }
    };

    const up = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pointers.size > 0) return;
      window.clearTimeout(longTimer);
      s.dragging = false;
      gsap.to(s.uniforms, { hold: 0, duration: 0.5, ease: "power2.out" });
      props.current.onTouch?.(false);
      const quick = e.timeStamp - start.t < TAP_MS;
      if (!twoFinger && !longFired && travelled < TAP_SLOP && quick && e.type === "pointerup") {
        ripple(e.clientX, e.clientY);
        s.vx = s.vy = 0;
        props.current.onTap?.();
        return;
      }
      // A flick: the ball carries on; in Focus mode it keeps stepping, a few at most.
      if (performance.now() - last.t > 70) s.vx = s.vy = 0;
      s.flingSteps = FLING_STEPS;
    };

    box.addEventListener("pointerdown", down);
    box.addEventListener("pointermove", move);
    box.addEventListener("pointerup", up);
    box.addEventListener("pointercancel", up);

    // ---- frames ----
    let raf = 0;
    let prev = performance.now();
    let skip = false;
    let visible = true;
    const frame = (now: number) => {
      if (!visible || document.hidden) {
        raf = 0;
        return;
      }
      raf = requestAnimationFrame(frame);
      const dt = Math.min(48, now - prev);
      prev = now;
      const p = props.current;
      const busy = s.dragging || Math.hypot(s.vx, s.vy) > 0.004 || s.pulse > 0.01 || s.ripple[3] >= 0
        || gsap.isTweening(s.uniforms);
      // At rest the globe only drifts: half the frames are enough for that, and the battery notices.
      skip = !busy && !skip;
      if (skip) return;

      if (!s.dragging) {
        const fx = s.vx * dt, fy = s.vy * dt;
        if (Math.abs(fx) + Math.abs(fy) > 0.01) {
          roll(fx, fy);
          if (p.mode === "focus" && s.flingSteps > 0) steps(fx, fy, true);
        }
        const keep = Math.exp(-dt / (p.mode === "focus" ? 230 : 330));
        s.vx *= keep;
        s.vy *= keep;
        // The slow drift of a globe nobody is touching, as if it were in the room's air.
        roll(0.012 * dt * (p.asleep ? 2.2 : 1), 0);
      }
      if (s.moveX || s.moveY) {
        p.onMove?.(s.moveX, s.moveY);
        s.moveX = s.moveY = 0;
      }
      if (s.scrollX || s.scrollY) {
        p.onScroll?.(s.scrollX, s.scrollY);
        s.scrollX = s.scrollY = 0;
      }
      s.pulse = Math.max(0, s.pulse - dt / 320);
      if (s.ripple[3] >= 0) {
        s.ripple[3] += dt / 1000;
        if (s.ripple[3] > 1.4) s.ripple[3] = -1;
      }

      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(uRes, cv.width, cv.height);
      gl.uniform1f(uTime, now / 1000);
      gl.uniformMatrix3fv(uInv, false, inverseMat3(s.q, inv));
      gl.uniform4f(uRipple, s.ripple[0], s.ripple[1], s.ripple[2], s.ripple[3]);
      gl.uniform1f(uPulse, s.pulse);
      gl.uniform1f(uCursor, s.uniforms.cursor);
      gl.uniform1f(uDim, s.uniforms.dim);
      gl.uniform1f(uHold, s.uniforms.hold);
      gl.uniform1f(uReveal, s.uniforms.reveal);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    raf = requestAnimationFrame(frame);
    const wake = () => {
      if (!raf && visible && !document.hidden) {
        prev = performance.now();
        raf = requestAnimationFrame(frame);
      }
    };
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      wake();
    });
    io.observe(box);
    document.addEventListener("visibilitychange", wake);

    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", wake);
      ro.disconnect();
      window.clearTimeout(longTimer);
      box.removeEventListener("pointerdown", down);
      box.removeEventListener("pointermove", move);
      box.removeEventListener("pointerup", up);
      box.removeEventListener("pointercancel", up);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, []);

  return (
    <div
      ref={wrap}
      className="relative aspect-square w-full touch-none select-none"
      aria-label={mode === "focus" ? "Trackball: roll to move, tap for OK" : "Touchpad: glide to point, tap to click"}
      role="application"
    >
      <canvas ref={canvas} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
