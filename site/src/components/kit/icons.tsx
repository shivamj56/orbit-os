import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

/** One stroke family for the whole page: 24-unit grid, round joins, currentColor. */
function S({ size = 20, children, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const GitHub = ({ size = 20, ...rest }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...rest}>
    <path d="M12 .8a11.2 11.2 0 0 0-3.54 21.83c.56.1.77-.24.77-.54v-1.9c-3.12.68-3.78-1.5-3.78-1.5-.51-1.3-1.25-1.64-1.25-1.64-1.02-.7.08-.68.08-.68 1.13.08 1.72 1.16 1.72 1.16 1 1.72 2.63 1.22 3.27.93.1-.73.4-1.22.71-1.5-2.49-.28-5.11-1.25-5.11-5.55 0-1.22.44-2.22 1.15-3-.11-.29-.5-1.43.11-2.98 0 0 .94-.3 3.08 1.15a10.7 10.7 0 0 1 5.6 0c2.14-1.45 3.08-1.15 3.08-1.15.61 1.55.23 2.69.11 2.98.72.78 1.15 1.78 1.15 3 0 4.31-2.62 5.26-5.12 5.54.4.35.76 1.03.76 2.08v3.08c0 .3.2.65.78.54A11.2 11.2 0 0 0 12 .8Z" />
  </svg>
);

export const Star = ({ filled, ...p }: P & { filled?: boolean }) => (
  <S {...p} fill={filled ? "currentColor" : "none"}>
    <path d="m12 3.2 2.72 5.52 6.08.88-4.4 4.29 1.04 6.06L12 17.1l-5.44 2.85 1.04-6.06-4.4-4.29 6.08-.88Z" />
  </S>
);
export const Download = (p: P) => (
  <S {...p}>
    <path d="M12 3.5v11.5" />
    <path d="m7 10.5 5 5 5-5" />
    <path d="M4.5 19.5h15" />
  </S>
);
export const ArrowRight = (p: P) => (
  <S {...p}>
    <path d="M5 12h14" />
    <path d="m13 6 6 6-6 6" />
  </S>
);
export const ArrowDown = (p: P) => (
  <S {...p}>
    <path d="M12 5v14" />
    <path d="m6 13 6 6 6-6" />
  </S>
);
export const ArrowUpRight = (p: P) => (
  <S {...p}>
    <path d="M7 17 17 7" />
    <path d="M8 7h9v9" />
  </S>
);
export const Chevron = (p: P) => (
  <S {...p}>
    <path d="m6 9 6 6 6-6" />
  </S>
);
export const Check = (p: P) => (
  <S {...p}>
    <path d="m4.5 12.5 5 5 10-11" />
  </S>
);
export const Gear = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </S>
);
export const Home = (p: P) => (
  <S {...p}>
    <path d="M4 11.2 12 4.5l8 6.7" />
    <path d="M6.2 9.6V19h11.6V9.6" />
  </S>
);
export const Back = (p: P) => (
  <S {...p}>
    <path d="M9.5 6 4 11.5 9.5 17" />
    <path d="M4.5 11.5H15a5 5 0 0 1 0 10h-2" />
  </S>
);
export const Wifi = (p: P) => (
  <S {...p}>
    <path d="M2.5 9a14 14 0 0 1 19 0" />
    <path d="M5.5 12.5a9.5 9.5 0 0 1 13 0" />
    <path d="M8.6 16a5 5 0 0 1 6.8 0" />
    <circle cx="12" cy="19.2" r="0.9" fill="currentColor" />
  </S>
);
export const Bluetooth = (p: P) => (
  <S {...p}>
    <path d="m7 7 10 10-5 4V3l5 4L7 17" />
  </S>
);
export const Cast = (p: P) => (
  <S {...p}>
    <path d="M3 8V6.5A1.5 1.5 0 0 1 4.5 5h15A1.5 1.5 0 0 1 21 6.5v11a1.5 1.5 0 0 1-1.5 1.5H14" />
    <path d="M3 12a7 7 0 0 1 7 7" />
    <path d="M3 15.5a3.5 3.5 0 0 1 3.5 3.5" />
    <circle cx="3.6" cy="18.6" r="0.6" fill="currentColor" />
  </S>
);
export const Tv = (p: P) => (
  <S {...p}>
    <rect x="2.5" y="4.5" width="19" height="12.5" rx="2" />
    <path d="M8.5 20.5h7" />
  </S>
);
export const Phone = (p: P) => (
  <S {...p}>
    <rect x="6.5" y="2.5" width="11" height="19" rx="2.6" />
    <path d="M10.5 18.5h3" />
  </S>
);
export const Cloud = (p: P) => (
  <S {...p}>
    <path d="M7 18.5h10.5a4 4 0 0 0 .4-7.98A6 6 0 0 0 6.3 9.6 4.5 4.5 0 0 0 7 18.5Z" />
  </S>
);
export const Shield = (p: P) => (
  <S {...p}>
    <path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.3 7.5 9.5 4.4-1.2 7.5-4.9 7.5-9.5V6Z" />
    <path d="m8.8 12.2 2.3 2.3 4.2-4.6" />
  </S>
);
export const Undo = (p: P) => (
  <S {...p}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
    <path d="M3.5 3.5v5h5" />
  </S>
);
export const Lock = (p: P) => (
  <S {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.2" />
    <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
  </S>
);
export const ListIcon = (p: P) => (
  <S {...p}>
    <path d="M8.5 6.5h12M8.5 12h12M8.5 17.5h8" />
    <circle cx="4" cy="6.5" r="0.9" fill="currentColor" />
    <circle cx="4" cy="12" r="0.9" fill="currentColor" />
    <circle cx="4" cy="17.5" r="0.9" fill="currentColor" />
  </S>
);
export const NoTrash = (p: P) => (
  <S {...p}>
    <path d="M4.5 7h15" />
    <path d="M9.5 7V4.8h5V7" />
    <path d="M6.5 7l.9 12.2a1.5 1.5 0 0 0 1.5 1.3h6.2a1.5 1.5 0 0 0 1.5-1.3L17.5 7" />
    <path d="M3 3l18 18" />
  </S>
);
export const Search = (p: P) => (
  <S {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </S>
);
export const Mic = (p: P) => (
  <S {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
    <path d="M12 17.5V21" />
  </S>
);
export const Power = (p: P) => (
  <S {...p}>
    <path d="M12 3v8" />
    <path d="M6.6 6.6a7.5 7.5 0 1 0 10.8 0" />
  </S>
);
export const Plus = (p: P) => (
  <S {...p}>
    <path d="M12 5v14M5 12h14" />
  </S>
);
export const Minus = (p: P) => (
  <S {...p}>
    <path d="M5 12h14" />
  </S>
);
export const Speaker = (p: P) => (
  <S {...p}>
    <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z" />
    <path d="M15.5 9a4 4 0 0 1 0 6" />
    <path d="M18 6.5a7.5 7.5 0 0 1 0 11" />
  </S>
);
export const Sparkle = (p: P) => (
  <S {...p}>
    <path d="M12 3.5c.4 3.9 2.6 6.1 6.5 6.5-3.9.4-6.1 2.6-6.5 6.5-.4-3.9-2.6-6.1-6.5-6.5 3.9-.4 6.1-2.6 6.5-6.5Z" />
    <path d="M18.5 15.5c.2 1.6 1 2.4 2.5 2.5-1.5.1-2.3.9-2.5 2.5-.2-1.6-1-2.4-2.5-2.5 1.5-.1 2.3-.9 2.5-2.5Z" />
  </S>
);
export const GlobeIcon = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <ellipse cx="12" cy="12" rx="8.5" ry="3.3" />
    <ellipse cx="12" cy="12" rx="3.3" ry="8.5" />
  </S>
);
export const Keyboard = (p: P) => (
  <S {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="2" />
    <path d="M6 9.5h.01M9.5 9.5h.01M13 9.5h.01M16.5 9.5h.01M6 13h.01M18 13h.01M8 15h8" />
  </S>
);
export const Eye = (p: P) => (
  <S {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="3" />
  </S>
);
export const Input = (p: P) => (
  <S {...p}>
    <path d="M5 9h14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 13.5Z" />
    <path d="M8 12h8" />
  </S>
);
export const Contrast = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" />
  </S>
);
export const Sliders = (p: P) => (
  <S {...p}>
    <path d="M6 4v16M12 4v16M18 4v16" />
    <path d="M4 15h4M10 8h4M16 13h4" />
  </S>
);
export const Timer = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="13.5" r="7.5" />
    <path d="M12 9.5v4l2.5 1.5" />
    <path d="M9.5 2.5h5" />
  </S>
);
export const Moon = (p: P) => (
  <S {...p}>
    <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
  </S>
);
export const Broom = (p: P) => (
  <S {...p}>
    <path d="m14.5 3.5-5 9" />
    <path d="M6.5 12.5h6.5l2 8.5H5.5Z" />
    <path d="M9 21l.5-4M12 21l.2-4" />
  </S>
);
export const Stack = (p: P) => (
  <S {...p}>
    <rect x="7" y="7" width="13" height="13" rx="2.2" />
    <path d="M4 16.5V6.2A2.2 2.2 0 0 1 6.2 4h10.3" />
  </S>
);
export const Film = (p: P) => (
  <S {...p}>
    <rect x="3.5" y="5" width="17" height="14" rx="2" />
    <path d="M7.5 5v14M16.5 5v14M3.5 9.5h4M16.5 9.5h4M3.5 14.5h4M16.5 14.5h4" />
  </S>
);
export const Diya = (p: P) => (
  <S {...p}>
    <path d="M12 3.5c1.8 2.2 1.8 4.3 0 5.6-1.8-1.3-1.8-3.4 0-5.6Z" />
    <path d="M3.5 12.5h17a8.5 8.5 0 0 1-17 0Z" />
  </S>
);
export const Play = (p: P) => (
  <S {...p}>
    <path d="M7 4.8v14.4a.8.8 0 0 0 1.2.7l11.6-7.2a.8.8 0 0 0 0-1.4L8.2 4.1a.8.8 0 0 0-1.2.7Z" fill="currentColor" stroke="none" />
  </S>
);
export const Pause = (p: P) => (
  <S {...p}>
    <rect x="6.5" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none" />
    <rect x="13.9" y="5" width="3.6" height="14" rx="1" fill="currentColor" stroke="none" />
  </S>
);
export const SoundOn = (p: P) => (
  <S {...p}>
    <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z" />
    <path d="M15.5 9a4 4 0 0 1 0 6" />
    <path d="M18 6.5a7.5 7.5 0 0 1 0 11" />
  </S>
);
export const SoundOff = (p: P) => (
  <S {...p}>
    <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5Z" />
    <path d="m16 9.5 5 5M21 9.5l-5 5" />
  </S>
);
export const Replay = (p: P) => (
  <S {...p}>
    <path d="M4 12a8 8 0 1 0 2.4-5.7" />
    <path d="M4 4v4.5h4.5" />
  </S>
);
export const Hand = (p: P) => (
  <S {...p}>
    <path d="M8.5 13V5.5a1.5 1.5 0 0 1 3 0V11" />
    <path d="M11.5 10.5V4a1.5 1.5 0 0 1 3 0v6.5" />
    <path d="M14.5 10.5V5.5a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-.6a6 6 0 0 1-4.6-2.2L2.8 15.6a1.6 1.6 0 0 1 2.4-2l3.3 2.9" />
  </S>
);
export const Remote = (p: P) => (
  <S {...p}>
    <rect x="7" y="2.5" width="10" height="19" rx="5" />
    <circle cx="12" cy="8.5" r="2.4" />
    <path d="M10 14h.01M14 14h.01M10 17h.01M14 17h.01" />
  </S>
);
export const Sun = (p: P) => (
  <S {...p}>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" />
  </S>
);
export const Code = (p: P) => (
  <S {...p}>
    <path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5" />
  </S>
);
export const Terminal = (p: P) => (
  <S {...p}>
    <rect x="2.5" y="4" width="19" height="16" rx="2.5" />
    <path d="m6.5 9 3 3-3 3M12 15h5" />
  </S>
);
export const Tablet = (p: P) => (
  <S {...p}>
    <rect x="4" y="2.5" width="16" height="19" rx="2.5" />
    <path d="M10.5 18.5h3" />
  </S>
);
export const Calendar = (p: P) => (
  <S {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </S>
);
export const Music = (p: P) => (
  <S {...p}>
    <path d="M9 18V5.5l11-2V16" />
    <circle cx="6.5" cy="18" r="2.5" />
    <circle cx="17.5" cy="16" r="2.5" />
  </S>
);
export const Users = (p: P) => (
  <S {...p}>
    <circle cx="9" cy="8.5" r="3.5" />
    <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
    <path d="M16 5.2a3.5 3.5 0 0 1 0 6.6M18 14.2a6.5 6.5 0 0 1 3.5 5.8" />
  </S>
);
export const Gauge = (p: P) => (
  <S {...p}>
    <path d="M4.2 17.5a9 9 0 1 1 15.6 0" />
    <path d="m12 13.5 4-5" />
    <circle cx="12" cy="13.5" r="1.3" fill="currentColor" />
  </S>
);
export const Chip = (p: P) => (
  <S {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
    <path d="M9.5 3v3M14.5 3v3M9.5 18v3M14.5 18v3M3 9.5h3M3 14.5h3M18 9.5h3M18 14.5h3" />
  </S>
);
export const Route = (p: P) => (
  <S {...p}>
    <circle cx="6" cy="18" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <path d="M8.5 18h6a3.5 3.5 0 0 0 0-7h-5a3.5 3.5 0 0 1 0-7h6" />
  </S>
);
export const Heart = (p: P) => (
  <S {...p}>
    <path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20Z" />
  </S>
);
export const Bolt = (p: P) => (
  <S {...p}>
    <path d="M13 2.5 4.5 13.5H12l-1 8 8.5-11H12Z" />
  </S>
);
export const FileText = (p: P) => (
  <S {...p}>
    <path d="M14 2.5H6.5A2 2 0 0 0 4.5 4.5v15a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V8Z" />
    <path d="M14 2.5V8h5.5M8.5 13h7M8.5 16.5h5" />
  </S>
);
