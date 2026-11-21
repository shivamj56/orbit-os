// TVs of other makes (phone/SPEC.md, "Every TV"): what each can do from the phone, and the words for it.
import type { TvKind, TvRef } from "./bridge";

/** Everything a TV with Orbit OS can do: every control the page has. */
export const ORBIT_CAPS: readonly string[] = [
  "keys", "volume", "mute", "volumeLevel", "media", "type", "apps", "launch", "power", "pointer", "recents",
  "settings", "nowPlaying", "help", "open",
];

/** True for a TV with Orbit OS (no kind, or "orbit"). */
export function isOrbit(tv: TvRef | null | undefined): boolean {
  return !tv?.kind || tv.kind === "orbit";
}

/** What the phone can do with this TV. */
export function capsOf(tv: TvRef | null | undefined): ReadonlySet<string> {
  if (!tv || isOrbit(tv) || !tv.caps) return new Set(ORBIT_CAPS);
  return new Set(tv.caps);
}

/** The make's own name: never translated (brand names). */
export const MAKE_NAMES: Record<TvKind, string> = {
  orbit: "Orbit OS",
  samsung: "Samsung",
  lg: "LG",
  roku: "Roku",
  androidtv: "Google TV",
  firetv: "Fire TV",
};

/** A make whose TV can be woken over the Wi-Fi (Wake-on-LAN) when it is off. */
export const WAKES: ReadonlySet<TvKind> = new Set(["samsung", "lg"]);
