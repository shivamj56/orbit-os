import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { OrbitMark, Wordmark } from "@/components/kit/brand";
import { DownloadButton } from "@/components/kit/buttons";
import * as I from "@/components/kit/icons";
import { REPO_URL } from "@/lib/links";
import { formatStars } from "@/lib/format";
import { goTo } from "@/lib/scroll";
import { useSetTheme, useThemeValue } from "@/lib/themeContext";

const LINKS = [
  { id: "try", label: "Try it" },
  { id: "setup", label: "Setup" },
  { id: "phone", label: "Phone" },
  { id: "safety", label: "Safety" },
  { id: "hood", label: "Developers" },
  { id: "faq", label: "Questions" },
];

/** A floating glass bar: the mark, the sections, the theme, Star and Download. It firms up once the hero is behind you. */
export function Nav({ stars }: { stars: number | null }) {
  const [solid, setSolid] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  useEffect(() => {
    const on = () => setSolid(window.scrollY > window.innerHeight * 0.6);
    on();
    window.addEventListener("scroll", on, { passive: true });
    // The section under the bar lights its link.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id);
      },
      { rootMargin: "-45% 0px -50% 0px" },
    );
    LINKS.forEach((l) => {
      const el = document.getElementById(l.id);
      if (el) io.observe(el);
    });
    return () => {
      window.removeEventListener("scroll", on);
      io.disconnect();
    };
  }, []);

  return (
    <motion.header
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.9, delay: 0.25, ease: [0.19, 1, 0.22, 1] }}
      className="pointer-events-none fixed inset-x-0 top-0 z-50 pt-[max(10px,env(safe-area-inset-top))]"
    >
      {/* Once the page scrolls, content fades out under the floating bar instead of showing in the gap above it. */}
      <div
        aria-hidden="true"
        className={`absolute inset-x-0 top-0 h-[calc(5.5rem+env(safe-area-inset-top))] bg-gradient-to-b from-page via-page/85 to-transparent transition-opacity duration-500 ${solid ? "opacity-100" : "opacity-0"}`}
      />
      <div className="gutters relative">
        <nav
          aria-label="Main"
          className={`pointer-events-auto mx-auto flex h-14 max-w-[1180px] items-center gap-1.5 rounded-full border py-1.5 pr-1.5 pl-3.5 transition-[background-color,border-color,box-shadow] duration-500 ${
            solid ? "border-line bg-surface/80 shadow-[0_20px_50px_-24px_rgb(var(--shadow-rgb)/var(--shadow-a))] backdrop-blur-xl" : "border-line bg-page/40 backdrop-blur-md"
          }`}
        >
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              goTo("top");
            }}
            className="flex shrink-0 items-center gap-2 rounded-full pr-2 text-ink"
            aria-label="Orbit OS, back to the top"
          >
            <OrbitMark size={28} />
            <Wordmark className="max-[380px]:hidden" />
          </a>
          <ul className="mx-auto hidden items-center gap-0.5 lg:flex">
            {LINKS.map((l) => (
              <li key={l.id} className="relative">
                <a
                  href={`#${l.id}`}
                  aria-current={active === l.id ? "true" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    goTo(l.id);
                  }}
                  className={`relative block rounded-full px-3.5 py-2 text-[0.875rem] transition-colors ${active === l.id ? "text-ink" : "text-soft hover:text-ink"}`}
                >
                  {active === l.id && <motion.span layoutId="nav-active" className="absolute inset-0 -z-10 rounded-full bg-veil/[0.07]" transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="ml-auto flex items-center gap-1 lg:ml-0">
            <ThemeToggle />
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener"
              className="inline-flex h-11 items-center gap-2 rounded-full px-3 text-[0.875rem] text-soft transition-colors hover:bg-veil/[0.06] hover:text-ink"
              aria-label={stars !== null ? `Star on GitHub, ${stars} stars` : "Star on GitHub"}
            >
              <I.GitHub size={18} />
              <span className="hidden sm:inline">Star</span>
              {stars !== null && (
                <span className="inline-flex items-center gap-1 font-mono text-[0.75rem] text-accent-3">
                  <I.Star size={11} filled />
                  {formatStars(stars)}
                </span>
              )}
            </a>
            <DownloadButton size="md" label="Download" sub={null} magnetic={false} className="max-[359px]:hidden" />
          </div>
        </nav>
      </div>
    </motion.header>
  );
}

/** Day or night: a sun that sets into a moon. Remembered on this device. */
function ThemeToggle() {
  const theme = useThemeValue();
  const setTheme = useSetTheme();
  const day = theme === "light";
  return (
    <button
      type="button"
      onClick={() => setTheme(day ? "dark" : "light")}
      aria-label={day ? "Switch to the night theme" : "Switch to the daylight theme"}
      title={day ? "Night" : "Daylight"}
      className="relative grid size-11 place-items-center overflow-hidden rounded-full text-soft transition-colors hover:bg-veil/[0.06] hover:text-ink active:scale-95"
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={day ? "sun" : "moon"}
          initial={{ y: 14, opacity: 0, rotate: -40 }}
          animate={{ y: 0, opacity: 1, rotate: 0 }}
          exit={{ y: -14, opacity: 0, rotate: 40 }}
          transition={{ type: "spring", stiffness: 420, damping: 28 }}
        >
          {day ? <I.Sun size={19} /> : <I.Moon size={18} />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
