import Lenis from "lenis";

/** Smooth wheel scrolling (Lenis), off for "reduce motion" and for touch, which keeps its own native feel. */
let lenis: Lenis | null = null;

export function startSmoothScroll(): () => void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {};
  lenis = new Lenis({ lerp: 0.11, wheelMultiplier: 1, smoothWheel: true, anchors: false });
  let raf = 0;
  const loop = (t: number) => {
    lenis?.raf(t);
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);
  return () => {
    cancelAnimationFrame(raf);
    lenis?.destroy();
    lenis = null;
  };
}

/** Scrolls to a section by id, smoothly when allowed; moves keyboard focus there too. */
export function goTo(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (lenis && !reduce) lenis.scrollTo(el, { offset: -8, duration: 1.4 });
  else el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  history.replaceState(null, "", `#${id}`);
  window.setTimeout(() => el.focus({ preventScroll: true }), reduce ? 0 : 900);
}

export function pauseScroll(paused: boolean) {
  if (!lenis) return;
  if (paused) lenis.stop();
  else lenis.start();
}

/**
 * Glides the page down to `y` at a steady pace, like film credits. Any wheel, touch or key from the visitor stops it.
 * Returns a function that stops it.
 */
export function glide(y: number, pxPerSecond = 80, onDone?: () => void): () => void {
  const from = window.scrollY;
  const distance = y - from;
  if (distance <= 4) {
    onDone?.();
    return () => {};
  }
  const roll = distance / pxPerSecond; // seconds at full pace
  const seconds = roll + 0.5; // plus half a second to ease in
  let stopped = false;
  let raf = 0;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("wheel", stop);
    window.removeEventListener("touchstart", stop);
    window.removeEventListener("keydown", stop);
    window.removeEventListener("pointerdown", stop);
    if (lenis) lenis.scrollTo(window.scrollY, { immediate: true });
  };
  window.addEventListener("wheel", stop, { passive: true });
  window.addEventListener("touchstart", stop, { passive: true });
  window.addEventListener("keydown", stop);
  window.addEventListener("pointerdown", stop);
  const t0 = performance.now();
  const step = (now: number) => {
    if (stopped) return;
    const t = Math.min(1, (now - t0) / 1000 / seconds);
    // ease in over the first second, then a constant roll
    const tau = t * seconds;
    const k = tau < 1 ? (tau * tau) / (2 * roll) : (tau - 0.5) / roll;
    const target = from + distance * Math.min(1, k);
    if (lenis) lenis.scrollTo(target, { immediate: true });
    else window.scrollTo(0, target);
    if (t < 1) raf = requestAnimationFrame(step);
    else {
      stop();
      onDone?.();
    }
  };
  raf = requestAnimationFrame(step);
  return stop;
}
