import { useCallback, useEffect, useState } from "react";

export type Theme = "light" | "dark";
const KEY = "orbit-theme";

/** The theme the page is showing now: an explicit data-theme on <html> wins, else the system's setting. */
export function currentTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  const set = document.documentElement.getAttribute("data-theme");
  if (set === "light" || set === "dark") return set;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** Applies a theme the visitor chose before (kept in localStorage), before the first paint if possible. */
export function restoreTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") document.documentElement.setAttribute("data-theme", saved);
  } catch {
    /* storage may be blocked */
  }
}

/** The live theme, and a setter that remembers the choice. Follows <html data-theme> and the system setting. */
export function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setThemeState] = useState<Theme>(currentTheme);
  useEffect(() => {
    const sync = () => setThemeState(currentTheme());
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    mq.addEventListener("change", sync);
    const mo = new MutationObserver(sync);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    sync();
    return () => {
      mq.removeEventListener("change", sync);
      mo.disconnect();
    };
  }, []);
  const setTheme = useCallback((t: Theme) => {
    const root = document.documentElement;
    const apply = () => root.setAttribute("data-theme", t);
    // A soft cross-fade where the browser can do it.
    const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (doc.startViewTransition && !reduce) doc.startViewTransition(apply);
    else apply();
    try {
      localStorage.setItem(KEY, t);
    } catch {
      /* ignore */
    }
  }, []);
  return [theme, setTheme];
}
