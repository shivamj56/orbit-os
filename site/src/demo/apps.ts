import channelList from "@/data/channels.json";

/** The pretend TV's apps, in the order Orbit Home shows them (Live TV is the first tile after setup). Plain names in
 * each app's colour, never their logos or lettering. */
export interface AppDef {
  id: string;
  label: string;
  /** The word on the card. */
  mark: string;
  /** Card surface: "light" frosted glass, "dark" smoked glass, or a solid brand-ish fill. */
  surface: "light" | "dark" | "fill" | "orbit";
  fill?: string;
  ink: string;
  /** The light Home throws behind the focused card. */
  glow: string;
  weight?: number;
  caps?: boolean;
}

export const APPS: AppDef[] = [
  { id: "live", label: "Live TV", mark: "Live TV", surface: "orbit", ink: "#ffffff", glow: "#7ea6ff" },
  { id: "youtube", label: "YouTube", mark: "YouTube", surface: "light", ink: "#ff2a2a", glow: "#ff3d3d", weight: 700 },
  { id: "netflix", label: "Netflix", mark: "Netflix", surface: "light", ink: "#d10a14", glow: "#e5096b", weight: 700 },
  { id: "prime", label: "Prime Video", mark: "Prime Video", surface: "fill", fill: "linear-gradient(160deg,#2aa7ff,#0b63d1)", ink: "#ffffff", glow: "#1a8cff", weight: 700 },
  { id: "hotstar", label: "JioHotstar", mark: "JioHotstar", surface: "fill", fill: "linear-gradient(160deg,#3150ff,#170b52)", ink: "#ffffff", glow: "#4b5bff", weight: 700 },
  { id: "spotify", label: "Spotify", mark: "Spotify", surface: "dark", ink: "#1ed760", glow: "#1ed760", weight: 700 },
  { id: "zee5", label: "ZEE5", mark: "ZEE5", surface: "fill", fill: "linear-gradient(160deg,#9b4dff,#2a0a5c)", ink: "#ffffff", glow: "#9b4dff", weight: 800 },
  { id: "sonyliv", label: "SonyLIV", mark: "SonyLIV", surface: "dark", ink: "#f2c14e", glow: "#f2a94e", weight: 700 },
  { id: "play", label: "Play Store", mark: "Play Store", surface: "light", ink: "#3c4043", glow: "#34a853", weight: 600 },
  { id: "miracast", label: "Miracast", mark: "Miracast", surface: "dark", ink: "#c9d2e3", glow: "#74d1ff", weight: 600 },
  { id: "vlc", label: "VLC", mark: "VLC", surface: "light", ink: "#ff7a00", glow: "#ff8800", weight: 800 },
];

export const START_FOCUS = 2;

export interface Channel {
  num: number;
  name: string;
  group: "News" | "Serials" | "Bhakti" | "Kids" | "Movies" | "Pay";
  app?: string;
}

export const CHANNELS = channelList as Channel[];

/** Each group's light on the pretend picture. */
export const GROUP_TONES: Record<Channel["group"], [string, string, string]> = {
  News: ["#ff4d5e", "#3b6bff", "#0b1230"],
  Serials: ["#ff5fb0", "#ffb35c", "#2a0b1f"],
  Bhakti: ["#ffb347", "#ff6a3d", "#2a1204"],
  Kids: ["#5ee08a", "#ffd84d", "#06261a"],
  Movies: ["#9b6bff", "#45c4ff", "#120a2e"],
  Pay: ["#8a94b2", "#3d4766", "#0b1020"],
};
