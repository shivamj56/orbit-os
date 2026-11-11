import type { CSSProperties } from "react";

/** React Bits SpotlightCard dressed in the page's own surface, line and shadow (both themes). */
export const orbitSpotlight = {
  "--spotlight-card-surface": "var(--surface)",
  "--spotlight-card-border": "var(--line)",
  "--spotlight-card-shadow": "0 30px 60px -40px rgb(var(--shadow-rgb) / var(--shadow-a))",
} as CSSProperties;
