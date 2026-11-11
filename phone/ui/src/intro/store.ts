// Where the opening intro stands, and what it hands over to: the app's globe on the first screen registers here, so the
// intro's planet can land exactly on it and the globe draws its grid as the planet dissolves into it.

export type IntroPhase = "playing" | "handing" | "done";

export interface GlobeTarget {
  el: HTMLElement;
  /** Starts the globe's own first appearance (its grid drawn out from the equator). */
  reveal: () => void;
}

let phase: IntroPhase = "done";
const targets = new Set<GlobeTarget>();
const waiting = new Set<() => void>();

export const introPhase = () => phase;

/** The intro starts: a globe that mounts now waits for the hand-over before it appears. */
export function introStarts() {
  phase = "playing";
}

/** The intro hands over: every globe waiting appears now. */
export function introHands() {
  if (phase !== "playing") return;
  phase = "handing";
  waiting.forEach((f) => f());
  waiting.clear();
}

export function introEnds() {
  if (phase === "playing") introHands();
  phase = "done";
}

/**
 * A globe on screen. Its first appearance runs at once, or, while the intro plays, at the hand-over. Returns the way to
 * take it off the list.
 */
export function registerGlobe(target: GlobeTarget): () => void {
  targets.add(target);
  if (phase === "playing") waiting.add(target.reveal);
  else target.reveal();
  return () => {
    targets.delete(target);
    waiting.delete(target.reveal);
  };
}

/** The globe the planet should land on: the newest one that is on screen and has a size. */
export function globeTarget(): GlobeTarget | null {
  const list = [...targets].reverse();
  for (const t of list) {
    const r = t.el.getBoundingClientRect();
    if (r.width > 40 && r.height > 40 && r.bottom > 0 && r.top < window.innerHeight) return t;
  }
  return null;
}
