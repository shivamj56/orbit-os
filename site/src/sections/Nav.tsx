import { useEffect, useState } from "react";
import { OrbitMark, Wordmark } from "@/components/kit/brand";
import { DownloadButton } from "@/components/kit/buttons";
import * as I from "@/components/kit/icons";
import { REPO_URL } from "@/lib/links";
import { formatStars } from "@/lib/format";
import { goTo } from "@/lib/scroll";

const LINKS = [
  { id: "try", label: "Try it" },
  { id: "setup", label: "Setup" },
  { id: "phone", label: "Phone" },
  { id: "safety", label: "Safety" },
  { id: "faq", label: "Questions" },
];

/** A floating glass bar: the mark, the sections, Star and Download. It firms up once the hero is behind you. */
export function Nav({ stars }: { stars: number | null }) {
  const [solid, setSolid] = useState(false);
  useEffect(() => {
    const on = () => setSolid(window.scrollY > window.innerHeight * 0.6);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 pt-[max(10px,env(safe-area-inset-top))]">
      {/* Once the page scrolls, content fades out under the floating bar instead of showing in the gap above it. */}
      <div
        aria-hidden="true"
        className={`absolute inset-x-0 top-0 h-[calc(5.5rem+env(safe-area-inset-top))] bg-gradient-to-b from-[#05070d] via-[#05070d]/85 to-transparent transition-opacity duration-500 ${
          solid ? "opacity-100" : "opacity-0"
        }`}
      />
      <div className="gutters relative">
        <nav
          aria-label="Main"
          className={`pointer-events-auto mx-auto flex h-14 max-w-[1120px] items-center gap-2 rounded-full border py-1.5 pr-1.5 pl-3.5 transition-[background-color,border-color,box-shadow] duration-500 ${
            solid
              ? "border-white/10 bg-[#0b1020]/80 shadow-[0_20px_50px_-24px_rgba(0,0,0,0.9)] backdrop-blur-xl"
              : "border-white/[0.07] bg-[#05070d]/35 backdrop-blur-md"
          }`}
        >
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              goTo("top");
            }}
            className="flex items-center gap-2 rounded-full pr-2 text-ink"
            aria-label="Orbit OS, back to the top"
          >
            <OrbitMark size={28} />
            <Wordmark className="max-[360px]:hidden" />
          </a>
          <ul className="mx-auto hidden items-center gap-1 lg:flex">
            {LINKS.map((l) => (
              <li key={l.id}>
                <a
                  href={`#${l.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    goTo(l.id);
                  }}
                  className="rounded-full px-3.5 py-2 text-[0.875rem] text-soft transition-colors hover:bg-white/[0.06] hover:text-ink"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
          <div className="ml-auto flex items-center gap-1.5 lg:ml-0">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noopener"
              className="inline-flex h-11 items-center gap-2 rounded-full px-3.5 text-[0.875rem] text-soft transition-colors hover:bg-white/[0.06] hover:text-ink"
              aria-label={stars !== null ? `Star on GitHub, ${stars} stars` : "Star on GitHub"}
            >
              <I.GitHub size={18} />
              <span className="hidden sm:inline">Star</span>
              {stars !== null && (
                <span className="inline-flex items-center gap-1 font-mono text-[0.75rem] text-[#FFE9B3]">
                  <I.Star size={11} filled />
                  {formatStars(stars)}
                </span>
              )}
            </a>
            <DownloadButton size="md" label="Download" sub={null} magnetic={false} />
          </div>
        </nav>
      </div>
    </header>
  );
}
