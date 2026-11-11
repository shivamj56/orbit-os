import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";
import { useSetup } from "./setup/flow";
import { startWorld, useWorld } from "./store";
import { Connect } from "./ui/Connect";
import { Help } from "./ui/Help";
import { closeSettings, useSettingsOpen } from "./ui/panel";
import { Remote } from "./ui/Remote";
import { SettingsSheet } from "./ui/Sheets";
import { Setup } from "./ui/setup/Setup";

/** The room behind everything: the TV's halo ribbon along the top edge, and two low lights. */
function Backdrop() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute -top-40 -left-32 h-[420px] w-[420px] rounded-full bg-[#74d1ff] opacity-[0.07] blur-[90px]" />
      <div className="absolute -right-40 bottom-24 h-[460px] w-[460px] rounded-full bg-[#ff74d1] opacity-[0.06] blur-[100px]" />
      <div className="ribbon-line absolute top-0 left-[12%] h-[2px] w-[76%] opacity-70 blur-[0.3px]" />
      <div className="ribbon-line absolute top-0 left-[22%] h-[18px] w-[56%] opacity-25 blur-[14px]" />
    </div>
  );
}

export function App() {
  useEffect(() => startWorld(), []);
  const { status, page } = useWorld();
  // Orbit Setup comes over everything while it is open: the TV it sets up connects half way, and setup still goes on.
  const setup = useSetup().open;
  const settings = useSettingsOpen();
  const view = setup ? "setup" : status.state !== "connected" ? "connect" : page === "help" ? "help" : "remote";
  return (
    <div className="grain relative h-full overflow-hidden bg-ink">
      <Backdrop />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={view}
          className="relative h-full"
          initial={{ opacity: 0, scale: 0.98, filter: "blur(8px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, scale: 1.02, filter: "blur(8px)" }}
          transition={{ duration: 0.45, ease: [0.25, 1, 0.5, 1] }}
        >
          {view === "setup" ? (
            <Setup />
          ) : view === "connect" ? (
            <Connect status={status} />
          ) : view === "help" ? (
            <Help status={status} />
          ) : (
            <Remote status={status} />
          )}
        </motion.div>
      </AnimatePresence>
      <SettingsSheet open={settings && !setup} onClose={closeSettings} status={status} />
    </div>
  );
}
