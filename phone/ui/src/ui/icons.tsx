// One family of line icons on a 24 grid: 1.75 strokes, round ends, drawn for this remote rather than borrowed.
import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 24, children, ...rest }: P) {
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
      {...rest}
    >
      {children}
    </svg>
  );
}

export const Back = (p: P) => (
  <Svg {...p}>
    <path d="M9 14.5 4 9.5l5-5" />
    <path d="M4.5 9.5h10a5.5 5.5 0 0 1 0 11H11" />
  </Svg>
);
export const Home = (p: P) => (
  <Svg {...p}>
    <path d="M4 10.6 12 4l8 6.6V19a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 19z" />
    <path d="M9.6 20.6v-5.2h4.8v5.2" />
  </Svg>
);
export const Recents = (p: P) => (
  <Svg {...p}>
    <rect x="6.5" y="7" width="11" height="13" rx="2.2" />
    <path d="M8.5 4h7" />
    <path d="M4 10.5v6" opacity=".55" />
    <path d="M20 10.5v6" opacity=".55" />
  </Svg>
);
export const Keyboard = (p: P) => (
  <Svg {...p}>
    <rect x="2.75" y="6" width="18.5" height="12" rx="2.6" />
    <path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M7.5 14h9" />
  </Svg>
);
export const Apps = (p: P) => (
  <Svg {...p}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.8" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8" />
  </Svg>
);
export const Power = (p: P) => (
  <Svg {...p}>
    <path d="M12 3.5v7.5" />
    <path d="M7 6.4a7.5 7.5 0 1 0 10 0" />
  </Svg>
);
export const Speaker = ({ level = 2, muted = false, ...p }: P & { level?: 0 | 1 | 2; muted?: boolean }) => (
  <Svg {...p}>
    <path d="M4.5 9.5h3l4.5-4v13l-4.5-4h-3z" />
    {muted ? (
      <path d="m16 9.5 5 5m0-5-5 5" />
    ) : (
      <>
        {level >= 1 && <path d="M15.5 9.2a4 4 0 0 1 0 5.6" />}
        {level >= 2 && <path d="M18.3 6.6a7.6 7.6 0 0 1 0 10.8" />}
      </>
    )}
  </Svg>
);
export const Minus = (p: P) => (
  <Svg {...p}>
    <path d="M6 12h12" />
  </Svg>
);
export const Plus = (p: P) => (
  <Svg {...p}>
    <path d="M12 6v12M6 12h12" />
  </Svg>
);
export const Play = (p: P) => (
  <Svg {...p} fill="currentColor" stroke="none">
    <path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.4-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z" />
  </Svg>
);
export const Pause = (p: P) => (
  <Svg {...p} fill="currentColor" stroke="none">
    <rect x="6.5" y="5" width="4" height="14" rx="1.3" />
    <rect x="13.5" y="5" width="4" height="14" rx="1.3" />
  </Svg>
);
export const Prev = (p: P) => (
  <Svg {...p}>
    <path d="M6 5.5v13" />
    <path d="M18.5 6.2v11.6a.8.8 0 0 1-1.25.66L9.3 12.66a.8.8 0 0 1 0-1.32l7.95-5.8a.8.8 0 0 1 1.25.66z" fill="currentColor" stroke="none" />
  </Svg>
);
export const Next = (p: P) => (
  <Svg {...p}>
    <path d="M18 5.5v13" />
    <path d="M5.5 6.2v11.6a.8.8 0 0 0 1.25.66l7.95-5.8a.8.8 0 0 0 0-1.32l-7.95-5.8a.8.8 0 0 0-1.25.66z" fill="currentColor" stroke="none" />
  </Svg>
);
export const Rewind = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
    <path d="M4.5 4.5v3.6h3.6" />
    <text x="12" y="15.2" fontSize="7.2" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="Inter" fontWeight="600">10</text>
  </Svg>
);
export const Forward = (p: P) => (
  <Svg {...p}>
    <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
    <path d="M19.5 4.5v3.6h-3.6" />
    <text x="12" y="15.2" fontSize="7.2" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="Inter" fontWeight="600">10</text>
  </Svg>
);
export const Gear = (p: P) => (
  <Svg {...p}>
    <path d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z" />
    <path d="M19.3 13.4a7.6 7.6 0 0 0 0-2.8l2-1.5-2-3.4-2.3 1a7.4 7.4 0 0 0-2.4-1.4L14.3 3h-4.6l-.3 2.3A7.4 7.4 0 0 0 7 6.7l-2.3-1-2 3.4 2 1.5a7.6 7.6 0 0 0 0 2.8l-2 1.5 2 3.4 2.3-1a7.4 7.4 0 0 0 2.4 1.4l.3 2.3h4.6l.3-2.3a7.4 7.4 0 0 0 2.4-1.4l2.3 1 2-3.4z" />
  </Svg>
);
export const Link = (p: P) => (
  <Svg {...p}>
    <path d="M10 14a4.2 4.2 0 0 0 6 0l3-3a4.2 4.2 0 0 0-6-6l-1 1" />
    <path d="M14 10a4.2 4.2 0 0 0-6 0l-3 3a4.2 4.2 0 0 0 6 6l1-1" />
  </Svg>
);
export const Search = (p: P) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.4-4.4" />
  </Svg>
);
export const Close = (p: P) => (
  <Svg {...p}>
    <path d="M6.5 6.5l11 11m0-11-11 11" />
  </Svg>
);
export const FocusMark = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 3.5v2.5M12 18v2.5M3.5 12H6M18 12h2.5" />
  </Svg>
);
export const CursorMark = (p: P) => (
  <Svg {...p}>
    <path d="M5.5 4.2 19 10.4l-5.9 1.9-2.4 6-5.2-14.1z" />
  </Svg>
);
export const Tv = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="5" width="18" height="12" rx="2.4" />
    <path d="M8.5 20.5h7" />
  </Svg>
);
export const Wifi = (p: P) => (
  <Svg {...p}>
    <path d="M3.5 9.4a12.2 12.2 0 0 1 17 0" />
    <path d="M6.6 12.6a7.8 7.8 0 0 1 10.8 0" />
    <path d="M9.7 15.7a3.4 3.4 0 0 1 4.6 0" />
    <path d="M12 19h.01" />
  </Svg>
);
export const Globe = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17" />
    <path d="M12 3.5a13 13 0 0 1 0 17 13 13 0 0 1 0-17z" />
  </Svg>
);
export const Send = (p: P) => (
  <Svg {...p}>
    <path d="M4.5 12 20 4.5 13.5 20l-2.2-6.3z" />
    <path d="m11.3 13.7 4.2-4.2" />
  </Svg>
);
export const Check = (p: P) => (
  <Svg {...p}>
    <path d="m5 12.5 4.2 4.2L19 7" />
  </Svg>
);
/** Help: a ring buoy, its four bands at the diagonals. */
export const Lifebuoy = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="3.6" />
    <path d="m5.99 5.99 3.46 3.46M14.55 14.55l3.46 3.46M18.01 5.99l-3.46 3.46M9.45 14.55l-3.46 3.46" />
  </Svg>
);
const turns = { up: 0, right: 90, down: 180, left: 270 } as const;
export const Chevron = ({ dir = "up", ...p }: P & { dir?: keyof typeof turns }) => (
  <Svg {...p}>
    <path d="m6.5 14.5 5.5-5.5 5.5 5.5" transform={`rotate(${turns[dir]} 12 12)`} />
  </Svg>
);
export const Eye = (p: P) => (
  <Svg {...p}>
    <path d="M2.8 12s3.4-6.2 9.2-6.2 9.2 6.2 9.2 6.2-3.4 6.2-9.2 6.2S2.8 12 2.8 12z" />
    <circle cx="12" cy="12" r="2.7" />
  </Svg>
);

// ---- Orbit Setup ----

/** The setup's own back and forward arrows: taller than the remote's chevrons, as the canvas draws them. */
export const Caret = ({ dir = "left", ...p }: P & { dir?: "left" | "right" }) => (
  <Svg {...p}>
    <path d={dir === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
  </Svg>
);
export const Cast = (p: P) => (
  <Svg {...p}>
    <path d="M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" />
    <path d="M2 12a9 9 0 0 1 9 9" />
    <path d="M2 16a5 5 0 0 1 5 5" />
    <path d="M2.5 20.5h.01" />
  </Svg>
);
export const Usb = (p: P) => (
  <Svg {...p}>
    <rect x="9" y="2.5" width="6" height="5" />
    <rect x="6.5" y="7.5" width="11" height="14" rx="2.5" />
    <path d="M10.5 12h3" />
  </Svg>
);
export const Mic = (p: P) => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
    <path d="M12 17.5v3.5" />
  </Svg>
);
/** A TV with its aerial: channels, and Orbit Live TV. */
export const Channels = (p: P) => (
  <Svg {...p}>
    <rect x="3" y="7.5" width="18" height="13" rx="2" />
    <path d="M8 3l4 4.5L16 3" />
  </Svg>
);
export const Shield = (p: P) => (
  <Svg {...p}>
    <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
    <path d="M9 12l2 2 4-4" />
  </Svg>
);
export const Remote = (p: P) => (
  <Svg {...p}>
    <rect x="7" y="2.5" width="10" height="19" rx="5" />
    <circle cx="12" cy="8" r="2" />
    <path d="M10 13h4" />
    <path d="M10 16h4" />
  </Svg>
);
export const Undo = (p: P) => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 3v5h5" />
  </Svg>
);
export const Phone = (p: P) => (
  <Svg {...p}>
    <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
    <path d="M10.5 18.5h3" />
  </Svg>
);
export const Person = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 20.5c1.6-3.6 4.5-5.5 8-5.5s6.4 1.9 8 5.5" />
  </Svg>
);
/** Orbit Home: a planet in its ring. */
export const Planet = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="5" />
    <ellipse cx="12" cy="12" rx="10.5" ry="3.6" transform="rotate(-18 12 12)" />
  </Svg>
);
export const Alert = (p: P) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.6v5.2" />
    <path d="M12 16.4h.01" />
  </Svg>
);
