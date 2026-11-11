import { useCallback, useEffect, useReducer, useRef } from "react";
import { APPS, CHANNELS, START_FOCUS } from "./apps";

export type Key = "left" | "right" | "up" | "down" | "ok" | "back" | "home" | "settings" | "volup" | "voldown" | "mute";

export type Screen = { kind: "home" } | { kind: "app"; app: number } | { kind: "live" };

export interface CcState {
  open: boolean;
  focus: string;
  on: Record<string, boolean>;
  display: number;
  sound: number;
}

export interface DemoState {
  focus: number;
  screen: Screen;
  channel: number; // index into CHANNELS
  guide: boolean;
  zapId: number;
  cc: CcState;
  volume: number;
  muted: boolean;
  volumeAt: number;
  island: { text: string; sub?: string; id: number } | null;
  quests: { moved: number; zapped: number; cc: boolean; opened: boolean };
  watched: number | null; // last channel index, for the Control Center's "now playing"
  bump: number;
}

/** The Control Center's tiles, in the order spatial navigation reads them. */
export const CC_TILES = [
  "wifi", "bluetooth", "cast", "playing", "inputs", "picture", "soundmode", "timer", "screensaver", "quiet", "clear", "recents",
  "display", "sound", "movie", "bhakti", "night",
] as const;

const initial: DemoState = {
  focus: START_FOCUS,
  screen: { kind: "home" },
  channel: 0,
  guide: false,
  zapId: 0,
  cc: {
    open: false,
    focus: "wifi",
    on: { wifi: true, bluetooth: true, cast: true, quiet: false, screensaver: false, movie: false, bhakti: false, night: false },
    display: 80,
    sound: 24,
  },
  volume: 24,
  muted: false,
  volumeAt: 0,
  island: null,
  quests: { moved: 0, zapped: 0, cc: false, opened: false },
  watched: null,
  bump: 0,
};

type Action =
  | { type: "key"; key: Key; ccMove?: string | null }
  | { type: "channel"; index: number }
  | { type: "focus"; index: number }
  | { type: "island"; text: string | null; sub?: string }
  | { type: "ccFocus"; id: string };

let islandId = 0;

function reducer(s: DemoState, a: Action): DemoState {
  switch (a.type) {
    case "island":
      return { ...s, island: a.text ? { text: a.text, sub: a.sub, id: ++islandId } : null };
    case "focus":
      return { ...s, focus: Math.max(0, Math.min(APPS.length - 1, a.index)), quests: { ...s.quests, moved: s.quests.moved + 1 } };
    case "ccFocus":
      return { ...s, cc: { ...s.cc, focus: a.id } };
    case "channel": {
      const n = CHANNELS.length;
      const index = ((a.index % n) + n) % n;
      return { ...s, channel: index, zapId: s.zapId + 1, watched: index, quests: { ...s.quests, zapped: s.quests.zapped + 1 } };
    }
    case "key":
      return onKey(s, a.key, a.ccMove ?? null);
  }
}

function onKey(s: DemoState, key: Key, ccMove: string | null): DemoState {
  // Volume works everywhere: Orbit's own slider on the screen's edge.
  if (key === "volup" || key === "voldown" || key === "mute") {
    const volume = key === "mute" ? s.volume : Math.max(0, Math.min(100, s.volume + (key === "volup" ? 4 : -4)));
    const muted = key === "mute" ? !s.muted : false;
    return { ...s, volume, muted, volumeAt: performance.now(), cc: { ...s.cc, sound: muted ? 0 : volume } };
  }

  // The Control Center sits over everything while it is open.
  if (s.cc.open) {
    if (key === "back" || key === "settings" || key === "home") return { ...s, cc: { ...s.cc, open: false } };
    if (key === "ok") return ccPress(s);
    if ((s.cc.focus === "display" || s.cc.focus === "sound") && (key === "left" || key === "right")) {
      const d = key === "right" ? 5 : -5;
      if (s.cc.focus === "display") return { ...s, cc: { ...s.cc, display: clamp(s.cc.display + d) } };
      const sound = clamp(s.cc.sound + d);
      return { ...s, volume: sound, muted: sound === 0, cc: { ...s.cc, sound } };
    }
    if (ccMove) return { ...s, cc: { ...s.cc, focus: ccMove } };
    return { ...s, bump: s.bump + 1 };
  }
  if (key === "settings") return { ...s, cc: { ...s.cc, open: true }, quests: { ...s.quests, cc: true } };

  const screen = s.screen;
  if (screen.kind === "home") {
    if (key === "left" || key === "right") {
      const next = s.focus + (key === "right" ? 1 : -1);
      if (next < 0 || next >= APPS.length) return { ...s, bump: s.bump + 1 };
      return { ...s, focus: next, quests: { ...s.quests, moved: s.quests.moved + 1 } };
    }
    if (key === "ok") {
      const app = APPS[s.focus];
      if (app.id === "live") return { ...s, screen: { kind: "live" }, guide: false, zapId: s.zapId + 1, watched: s.channel, quests: { ...s.quests, opened: true } };
      return { ...s, screen: { kind: "app", app: s.focus }, quests: { ...s.quests, opened: true } };
    }
    if (key === "up" || key === "down" || key === "back" || key === "home") return { ...s, bump: s.bump + 1 };
    return s;
  }
  if (screen.kind === "app") {
    if (key === "back" || key === "home") return { ...s, screen: { kind: "home" } };
    return s;
  }
  // Live TV: Up and Down change the channel, OK shows the guide, Back goes Home.
  if (key === "back" || key === "home") {
    if (key === "back" && s.guide) return { ...s, guide: false };
    return { ...s, screen: { kind: "home" }, guide: false };
  }
  if (key === "up" || key === "down") {
    const n = CHANNELS.length;
    const index = (s.channel + (key === "up" ? 1 : -1) + n) % n;
    return { ...s, channel: index, zapId: s.zapId + 1, watched: index, quests: { ...s.quests, zapped: s.quests.zapped + 1 } };
  }
  if (key === "ok") return { ...s, guide: !s.guide };
  if (key === "left" || key === "right") return { ...s, guide: key === "left" ? true : false };
  return s;
}

const clamp = (v: number) => Math.max(0, Math.min(100, v));

function ccPress(s: DemoState): DemoState {
  const id = s.cc.focus;
  const on = { ...s.cc.on };
  if (id === "playing") {
    if (s.watched !== null) return { ...s, cc: { ...s.cc, open: false }, screen: { kind: "live" }, channel: s.watched, zapId: s.zapId + 1 };
    return { ...s, cc: { ...s.cc, open: false }, screen: { kind: "live" }, zapId: s.zapId + 1, watched: s.channel };
  }
  if (id === "display" || id === "sound") return s;
  if (id === "movie" || id === "bhakti" || id === "night") {
    const was = on[id];
    on.movie = on.bhakti = on.night = false;
    on[id] = !was;
  } else {
    on[id] = !on[id];
  }
  return { ...s, cc: { ...s.cc, on } };
}

export function useDemo() {
  const [state, dispatch] = useReducer(reducer, initial);
  const islandTimer = useRef(0);
  const firstTouch = useRef(false);

  const say = useCallback((text: string, sub?: string, ms = 2600) => {
    dispatch({ type: "island", text, sub });
    window.clearTimeout(islandTimer.current);
    islandTimer.current = window.setTimeout(() => dispatch({ type: "island", text: null }), ms);
  }, []);

  const press = useCallback(
    (key: Key, ccMove?: string | null) => {
      if (!firstTouch.current) {
        firstTouch.current = true;
        say("Orbit is connected", "This browser is the remote now");
      }
      dispatch({ type: "key", key, ccMove });
    },
    [say],
  );

  useEffect(() => () => window.clearTimeout(islandTimer.current), []);

  return {
    state,
    press,
    say,
    setChannel: (index: number) => dispatch({ type: "channel", index }),
    setFocus: (index: number) => dispatch({ type: "focus", index }),
    setCcFocus: (id: string) => dispatch({ type: "ccFocus", id }),
  };
}
