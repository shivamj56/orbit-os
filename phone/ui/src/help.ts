// Help mode on the page (phone/SPEC.md, "Help mode"): help on at the TV while the Help page is open, and the newest
// picture of the TV's screen, decoded and ready to show. It starts the moment Help is pressed, so the first picture is
// often there by the time the page has come in.
import { useSyncExternalStore } from "react";
import { bridge, tv, type Screen } from "./bridge";
import { mark } from "./i18n";

/** A picture of the TV's screen: `at` when the TV took it, `got` when it reached the page (both this phone's clock). */
export interface Picture {
  src: string;
  w: number;
  h: number;
  at: number;
  got: number;
}

export interface HelpView {
  on: boolean;
  /** When help was last asked for (the page waits 10 s from here for a picture). */
  since: number;
  picture: Picture | null;
  error: string | null;
}

let view: HelpView = { on: false, since: 0, picture: null, error: null };
const subscribers = new Set<() => void>();
let asked = 0;
let decoding = 0;
let wired = false;

function set(next: Partial<HelpView>) {
  view = { ...view, ...next };
  subscribers.forEach((f) => f());
}

export function useHelp(): HelpView {
  return useSyncExternalStore(
    (f) => {
      subscribers.add(f);
      return () => subscribers.delete(f);
    },
    () => view,
  );
}

function wire() {
  if (wired) return;
  wired = true;
  bridge.on("screen", (frame: Screen) => {
    if (!view.on || !frame || typeof frame.jpg !== "string" || !frame.jpg) return;
    const got = Date.now();
    const src = `data:image/jpeg;base64,${frame.jpg}`;
    const mine = ++decoding;
    // Decoded before it is shown, so the picture never blinks between two frames.
    const image = new Image();
    const show = () => {
      if (!view.on || mine !== decoding) return;
      set({
        picture: {
          src,
          w: frame.w > 0 ? frame.w : 640,
          h: frame.h > 0 ? frame.h : 360,
          at: frame.at > 0 ? Math.min(frame.at, got) : got,
          got,
        },
        error: null,
      });
    };
    image.src = src;
    if (typeof image.decode === "function") image.decode().then(show, () => {});
    else image.onload = show;
  });
  // The app turns help off in the background; back in front, the page asks again.
  bridge.on("lifecycle", (data: { state?: string }) => {
    if (view.on && data?.state === "resumed") ask();
  });
}

function ask() {
  const mine = ++asked;
  set({ since: Date.now(), error: null });
  tv.help(true).catch((e: Error) => {
    if (view.on && mine === asked) set({ error: e.message || mark("Help did not start on the TV.") });
  });
}

/** Help on: when Help is pressed, or when the Help page comes in without it. */
export function startHelp() {
  wire();
  if (view.on) return;
  set({ on: true, picture: null });
  ask();
}

/** "Try again": ask the TV once more. */
export function retryHelp() {
  if (view.on) ask();
}

/** Help off: the Help page has gone (the picture stays for its way out). */
export function stopHelp() {
  if (!view.on) return;
  asked++;
  set({ on: false, error: null });
  tv.help(false).catch(() => {});
}
