import { useEffect, useRef, useState, type RefObject } from "react";

/** The visitor's "reduce motion" setting, live. */
export function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduce, setReduce] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setReduce(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduce;
}

/** True while the element is at least `amount` in view. */
export function useInView<T extends Element>(ref: RefObject<T | null>, amount = 0.2, once = false): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        setSeen(e.isIntersecting);
        if (e.isIntersecting && once) io.disconnect();
      },
      { threshold: amount },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, amount, once]);
  return seen;
}

/** Becomes true (and stays true) once the element comes within `margin` of the viewport: for starting WebGL late. */
export function useNear<T extends Element>(ref: RefObject<T | null>, margin = "400px"): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setNear(true);
          io.disconnect();
        }
      },
      { rootMargin: `${margin} 0px ${margin} 0px` },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin, near]);
  return near;
}

/** A coarse pointer (a phone or tablet): no hover, bigger targets. */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const on = () => setCoarse(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return coarse;
}

/** The time of day as the TV says it, and a clock that ticks once a minute. */
export function greetingFor(d: Date): string {
  const h = d.getHours();
  return h < 12 ? "Good Morning" : h < 17 ? "Good Afternoon" : "Good Evening";
}

export function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  const timer = useRef(0);
  useEffect(() => {
    const tick = () => {
      setNow(new Date());
      timer.current = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    };
    timer.current = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
    return () => window.clearTimeout(timer.current);
  }, []);
  return now;
}

export const timeText = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true }).toLowerCase();
export const dateText = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
