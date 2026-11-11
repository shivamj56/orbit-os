// Demo mode inside the app: the pretend TV on top (so the codes it shows and what the remote does can be seen), a clear
// Demo badge that leaves the demo with one tap, and the whole app under it, talking to the pretend TV only.
import { AnimatePresence, motion } from "framer-motion";
import { useState, type CSSProperties } from "react";
import { App } from "../App";
import { haptic } from "../bridge";
import { setDemoMode } from "../demo";
import { MockTv } from "./MockTv";

export function DemoFrame() {
  const [tvShown, setTvShown] = useState(true);
  return (
    <div className="flex h-full flex-col bg-ink">
      <div className="relative z-[70] shrink-0 bg-[#030407]" style={{ paddingTop: "var(--inset-top)" }}>
        <AnimatePresence initial={false}>
          {tvShown && (
            <motion.div
              key="tv"
              className="overflow-hidden"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.38, ease: [0.25, 1, 0.5, 1] }}
            >
              <MockTv compact />
            </motion.div>
          )}
        </AnimatePresence>
        <DemoBar tvShown={tvShown} onTv={() => setTvShown((v) => !v)} />
      </div>
      {/* The app's own top inset is the bar's now. */}
      <div className="relative min-h-0 flex-1" style={{ "--inset-top": "0px" } as CSSProperties}>
        <App />
      </div>
    </div>
  );
}

function DemoBar({ tvShown, onTv }: { tvShown: boolean; onTv: () => void }) {
  return (
    <div className="flex h-12 items-center gap-2 border-b border-white/6 px-3">
      <motion.button
        type="button"
        whileTap={{ scale: 0.95 }}
        aria-label="Demo mode is on: leave the demo"
        onClick={() => {
          haptic("medium");
          setDemoMode(false);
        }}
        className="flex h-9 shrink-0 items-center gap-2 rounded-full border border-cyan/45 bg-cyan/12 pr-3.5 pl-3 text-[13px]"
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan/60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan" />
        </span>
        <span className="font-semibold tracking-[0.06em] text-[#cdebff] uppercase">Demo</span>
        <span className="text-white/35">·</span>
        <span className="font-medium text-text">Leave</span>
      </motion.button>
      <span className="min-w-0 flex-1 truncate text-[12px] text-faint">A pretend TV. Yours is left alone.</span>
      <button type="button" onClick={onTv} className="h-9 shrink-0 rounded-full px-3 text-[12.5px] text-muted" aria-expanded={tvShown}>
        {tvShown ? "Hide TV" : "Show TV"}
      </button>
    </div>
  );
}
