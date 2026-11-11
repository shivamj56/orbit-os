import { OrbitMark, Wordmark } from "@/components/kit/brand";
import { ISSUES_URL, RELEASES_URL, REPO_URL } from "@/lib/links";
import { goTo } from "@/lib/scroll";

export function Footer() {
  return (
    <footer className="border-t border-white/[0.06] bg-[#020306] pt-10 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      <div className="wrap flex flex-wrap items-center justify-between gap-x-10 gap-y-6">
        <div className="flex items-center gap-3 text-ink">
          <OrbitMark size={26} />
          <Wordmark className="text-[1.0625rem]" />
          <span className="text-[0.8125rem] text-dim">© 2026 Shivam Jha</span>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2 text-[0.875rem]">
          <a className="text-soft transition-colors hover:text-ink" href={REPO_URL} target="_blank" rel="noopener">
            GitHub
          </a>
          <a className="text-soft transition-colors hover:text-ink" href={RELEASES_URL} target="_blank" rel="noopener">
            Releases
          </a>
          <a className="text-soft transition-colors hover:text-ink" href={ISSUES_URL} target="_blank" rel="noopener">
            Report a problem
          </a>
          <a
            className="text-soft transition-colors hover:text-ink"
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              goTo("top");
            }}
          >
            Back to the top
          </a>
        </nav>
      </div>
      <p className="wrap mt-6 text-[0.75rem] leading-relaxed text-faint">
        Orbit OS is not made by, or connected with, Google or any TV maker. App and channel names belong to their owners and are used here only to say what runs on the TV.
      </p>
    </footer>
  );
}
