// What the screens read: the connection, the TV's state, the settings. One small external store, fed by the bridge.
import { useSyncExternalStore } from "react";
import {
  OLDER_PHONE,
  askPhone,
  bridge,
  cloud,
  readAccount,
  setHaptics,
  signedOut,
  type Account,
  type Phone,
  type Status,
  type TvState,
} from "./bridge";
import { startHelp, stopHelp } from "./help";

export interface Settings {
  haptics: boolean;
  volumeKeys: boolean;
  speed: number;
  mode: "focus" | "cursor";
}

interface World {
  status: Status;
  tv: TvState | null;
  settings: Settings;
  account: Account;
  /** What this phone offers: its volume buttons, and the ways to sign in, in their order (asked once at the start). */
  phone: Phone;
  /** Which page the connected TV shows: the remote, or Help (its screen on the phone). */
  page: "remote" | "help";
}

const SETTINGS_KEY = "orbit-settings";

function loadSettings(): Settings {
  const fallback: Settings = { haptics: true, volumeKeys: true, speed: 1, mode: "focus" };
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return fallback;
  }
}

const firstStatus = (): Status => ({ state: "searching", tv: null, found: [], via: "wifi", error: null });

let world: World = {
  status: firstStatus(),
  tv: null,
  settings: loadSettings(),
  account: signedOut(),
  phone: OLDER_PHONE,
  page: "remote",
};

export function setAccount(account: Account) {
  set({ account });
}
const subscribers = new Set<() => void>();

function set(next: Partial<World>) {
  world = { ...world, ...next };
  subscribers.forEach((f) => f());
}

export function useWorld(): World {
  return useSyncExternalStore(
    (f) => {
      subscribers.add(f);
      return () => subscribers.delete(f);
    },
    () => world,
  );
}

export function updateSettings(patch: Partial<Settings>) {
  const settings = { ...world.settings, ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* kept for this run only */
  }
  setHaptics(settings.haptics);
  // iOS lets no app use the volume buttons: an iPhone is never told about them.
  if (patch.volumeKeys !== undefined && world.phone.volumeKeys) bridge.call("settings", { volumeKeys: settings.volumeKeys }).catch(() => {});
  set({ settings });
}

/** Patch the TV's state at once for a control the person just moved (the next poll confirms it). */
export function patchTv(patch: Partial<TvState>) {
  if (world.tv) set({ tv: { ...world.tv, ...patch } });
}

const isHelpStep = () => (history.state as { orbitPage?: string } | null)?.orbitPage === "help";

/** Help: the TV's screen on the phone. It is one step of history, so the phone's Back comes back to the remote. */
export function openHelp() {
  if (world.page === "help") return;
  startHelp();
  try {
    history.pushState({ orbitPage: "help" }, "");
  } catch {
    /* no history here: the page's own back button still works */
  }
  set({ page: "help" });
}

/** Back to the remote, the way the phone's Back goes. */
export function closeHelp() {
  if (world.page !== "help") return;
  if (isHelpStep()) history.back();
  else leaveHelp();
}

function leaveHelp() {
  stopHelp();
  set({ page: "remote" });
}

let started = false;
/** The phone's own answer, once per start: what it offers does not change with the TV (demo mode or not). */
let phoneKnown: Promise<Phone> = Promise.resolve(OLDER_PHONE);

export function startWorld() {
  if (started) return;
  started = true;
  setHaptics(world.settings.haptics);
  window.addEventListener("popstate", () => {
    if (world.page === "help" && !isHelpStep()) leaveHelp();
  });
  bridge.on("status", (status: Status) => {
    set({ status, tv: status.state === "connected" ? world.tv : null });
    // The TV out of reach: help ends (the Help page asks again when the TV is back).
    if (status.state !== "connected") stopHelp();
  });
  bridge.on("tvstate", (tv: TvState) => set({ tv }));
  bridge.on("account", (account: unknown) => set({ account: readAccount(account) }));
  bridge.on("volumeKey", () => {
    /* the app already turned the TV; the next state shows it */
  });
  phoneKnown = askPhone().then((phone) => {
    set({ phone });
    return phone;
  });
  greet();
}

/** Hello to whichever side plays the TV now: the account, the connection, and the phone's own settings. */
function greet() {
  // An older app (Wi-Fi only) does not know the op: the account then stays signed out.
  cloud.account().then(setAccount).catch(() => {});
  bridge
    .call<Status>("hello")
    .then((status) => set({ status }))
    .catch(() => {});
  // Only a phone whose volume buttons Orbit may use is told about them (never an iPhone).
  phoneKnown.then((phone) => {
    if (phone.volumeKeys) bridge.call("settings", { volumeKeys: world.settings.volumeKeys }).catch(() => {});
  });
  bridge.call("keepAwake", { on: true }).catch(() => {});
}

/**
 * The TV changed sides (demo mode on or off): what the screens knew about the last one goes, and the new one is asked,
 * as at the start. Help and Orbit Setup are closed by the caller first, while their ops still reach the old side.
 */
export function restartWorld() {
  set({ status: firstStatus(), tv: null, account: signedOut(), page: "remote" });
  if (started) greet();
}
