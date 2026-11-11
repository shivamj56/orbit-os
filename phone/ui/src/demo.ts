// Demo mode in the app (phone/SPEC.md, "Demo mode"): "Try Orbit without a TV" plays everything against the pretend TV
// the desktop browser already uses (mock.ts), and Flutter is told to leave the real TV alone meanwhile. It stays on
// across starts of the app until the person leaves it; a plain browser is always the demo.
import { useSyncExternalStore } from "react";
import { bridge, phoneDemo } from "./bridge";
import { stopHelp } from "./help";
import { closeSetup } from "./setup/flow";
import { restartWorld } from "./store";

const KEY = "orbit-demo";
let on = false;
const subscribers = new Set<() => void>();

function saved(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/** Before the first render, and before the page says hello: demo mode as the person left it. */
export function startDemo() {
  if (!bridge.native) return;
  on = saved();
  bridge.setDemo(on);
  // Always said, so Flutter follows the page even if the two ever disagree.
  phoneDemo(on).catch(() => {});
}

export const demoOn = () => on;

export function useDemo(): boolean {
  return useSyncExternalStore(
    (f) => {
      subscribers.add(f);
      return () => subscribers.delete(f);
    },
    () => on,
  );
}

/** "Try Orbit without a TV" (on) and the Demo badge's one tap (off). */
export function setDemoMode(next: boolean) {
  if (!bridge.native || next === on) return;
  // Help and Orbit Setup end on the side they were talking to.
  stopHelp();
  closeSetup();
  on = next;
  try {
    localStorage.setItem(KEY, next ? "1" : "0");
  } catch {
    /* on for this run only */
  }
  bridge.setDemo(next);
  phoneDemo(next).catch(() => {});
  restartWorld();
  subscribers.forEach((f) => f());
}
