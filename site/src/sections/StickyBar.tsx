import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { OrbitMark } from "@/components/kit/brand";
import * as I from "@/components/kit/icons";
import { DOWNLOAD_URL, REPO_URL } from "@/lib/links";

/** On phones: a slim bar at the bottom with Download, once the hero's own buttons have scrolled away. */
export function StickyBar() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const end = () => document.getElementById("credits-end");
    const on = () => {
      const past = window.scrollY > window.innerHeight * 0.9;
      const e = end();
      const atEnd = e ? e.getBoundingClientRect().top < window.innerHeight : false;
      setShow(past && !atEnd);
    };
    on();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    return () => {
      window.removeEventListener("scroll", on);
      window.removeEventListener("resize", on);
    };
  }, []);
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="bar"
          initial={{ y: "110%" }}
          animate={{ y: 0 }}
          exit={{ y: "110%" }}
          transition={{ type: "spring", stiffness: 380, damping: 34 }}
          className="fixed inset-x-0 bottom-0 z-50 px-[var(--gutter-l)] pb-[max(12px,env(safe-area-inset-bottom))] md:hidden"
        >
          <div className="flex items-center gap-2 rounded-[1.4rem] border border-line bg-surface/85 p-2 pl-3 shadow-[0_20px_50px_-20px_rgb(var(--shadow-rgb)/var(--shadow-a))] backdrop-blur-xl">
            <OrbitMark size={26} />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[0.875rem] font-semibold text-ink">Orbit OS</div>
              <div className="truncate text-[0.75rem] text-dim">Free · five minutes</div>
            </div>
            <a href={REPO_URL} target="_blank" rel="noopener" aria-label="Star on GitHub" className="grid size-11 place-items-center rounded-full text-soft active:scale-95">
              <I.GitHub size={19} />
            </a>
            <a
              href={DOWNLOAD_URL}
              target="_blank"
              rel="noopener"
              className="inline-flex h-11 items-center gap-2 rounded-full px-4 text-[0.9375rem] font-semibold text-cta-ink shadow-[0_10px_30px_-12px_var(--cta-glow)] active:scale-[0.97]"
              style={{ background: "var(--cta)" }}
            >
              <I.Download size={17} strokeWidth={2.2} />
              Download
            </a>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
