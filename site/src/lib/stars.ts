import { useEffect, useState } from "react";
import { REPO_API } from "./links";

/**
 * The repository's live star count, or null. The page must look complete without it: the repository may still be
 * private, the visitor may be offline, or the API may say no. One request per visit, cached for the session.
 */
let pending: Promise<number | null> | null = null;

function fetchStars(): Promise<number | null> {
  if (pending) return pending;
  pending = (async () => {
    try {
      const cached = sessionStorage.getItem("orbit-stars");
      if (cached !== null) return cached === "" ? null : Number(cached);
    } catch {
      /* storage may be blocked */
    }
    let value: number | null = null;
    try {
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), 4500);
      const res = await fetch(REPO_API, { signal: ctrl.signal, headers: { Accept: "application/vnd.github+json" } });
      window.clearTimeout(timer);
      if (res.ok) {
        const json = (await res.json()) as { stargazers_count?: unknown };
        if (typeof json.stargazers_count === "number" && Number.isFinite(json.stargazers_count)) value = json.stargazers_count;
      }
    } catch {
      value = null;
    }
    try {
      sessionStorage.setItem("orbit-stars", value === null ? "" : String(value));
    } catch {
      /* ignore */
    }
    return value;
  })();
  return pending;
}

export function useStars(): number | null {
  const [stars, setStars] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    // Ask after the page has settled, so the request never competes with the first paint.
    const t = window.setTimeout(() => {
      fetchStars().then((n) => live && setStars(n));
    }, 1200);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, []);
  return stars;
}
