import { AnimatePresence, motion, useDragControls, type PanInfo } from "framer-motion";
import { useEffect, useRef, type ReactNode } from "react";
import { haptic, type Haptic } from "../bridge";
import { Close } from "./icons";
import { t } from "../i18n";

export const spring = { type: "spring", stiffness: 520, damping: 34, mass: 0.7 } as const;
export const sheetSpring = { type: "spring", stiffness: 340, damping: 36, mass: 0.9 } as const;

interface PressProps {
  onPress?: () => void;
  onLong?: () => void;
  children: ReactNode;
  className?: string;
  label: string;
  feel?: Haptic | null;
  disabled?: boolean;
  /** A button that keeps going while held (volume). */
  repeat?: boolean;
}

/** Every button: it sinks under the finger, glows a little, and the phone ticks. */
export function Press({ onPress, onLong, children, className = "", label, feel = "light", disabled, repeat }: PressProps) {
  const t = useRef({ repeat: 0, long: 0, longDone: false, repeated: false });
  const stop = () => {
    window.clearTimeout(t.current.repeat);
    window.clearInterval(t.current.repeat);
    window.clearTimeout(t.current.long);
  };
  useEffect(() => stop, []);
  return (
    <motion.button
      type="button"
      aria-label={label}
      disabled={disabled}
      className={`relative grid place-items-center outline-none disabled:opacity-35 ${className}`}
      whileTap={{ scale: 0.9 }}
      transition={spring}
      onPointerDown={() => {
        if (disabled) return;
        stop();
        t.current.longDone = false;
        t.current.repeated = false;
        if (repeat) {
          t.current.repeat = window.setTimeout(() => {
            t.current.repeated = true;
            t.current.repeat = window.setInterval(() => {
              if (feel) haptic("tick");
              onPress?.();
            }, 110);
          }, 380);
        }
        if (onLong) {
          t.current.long = window.setTimeout(() => {
            t.current.longDone = true;
            haptic("medium");
            onLong();
          }, 520);
        }
      }}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onClick={() => {
        // A hold already did its work: the click that ends it must not do it once more.
        if (disabled || t.current.longDone || t.current.repeated) return;
        if (feel) haptic(feel);
        onPress?.();
      }}
    >
      {children}
    </motion.button>
  );
}

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  tall?: boolean;
}

/** A pane that rises from the bottom: drag it down or tap outside to put it away. */
export function Sheet({ open, onClose, title, children, tall }: SheetProps) {
  const drag = useDragControls();
  const close = useRef(onClose);
  close.current = onClose;
  // The title can change while the sheet is open (Settings › Language, or a new language): that is not a new sheet.
  const named = useRef(title);
  named.current = title;
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    window.addEventListener("keydown", esc);
    // The phone's Back closes the sheet, not the app: the sheet is one step of history while it is open.
    let popped = false;
    history.pushState({ orbitSheet: named.current }, "");
    const pop = () => {
      popped = true;
      close.current();
    };
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener("keydown", esc);
      window.removeEventListener("popstate", pop);
      // Closed from the page: its step comes off the history again.
      if (!popped) history.back();
    };
  }, [open]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="absolute inset-0 z-40" initial="hidden" animate="shown" exit="hidden">
          <motion.div
            className="absolute inset-0 bg-black/55"
            variants={{ hidden: { opacity: 0 }, shown: { opacity: 1 } }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
          />
          <motion.section
            role="dialog"
            aria-label={title}
            className={`glass-strong absolute inset-x-0 bottom-0 flex flex-col rounded-t-[var(--radius-sheet)] ${tall ? "h-[86%]" : "max-h-[86%]"}`}
            variants={{ hidden: { y: "105%" }, shown: { y: 0 } }}
            transition={sheetSpring}
            drag="y"
            dragControls={drag}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.02, bottom: 0.9 }}
            onDragEnd={(_, info: PanInfo) => {
              if (info.offset.y > 110 || info.velocity.y > 700) onClose();
            }}
          >
            <div
              className="flex cursor-grab touch-none flex-col items-center px-5 pt-3 pb-1"
              onPointerDown={(e) => drag.start(e)}
            >
              <div className="h-1.5 w-10 rounded-full bg-white/18" />
              <div className="mt-3 flex w-full items-center justify-between">
                <h2 className="font-display text-[22px] font-normal tracking-[-0.01em]">{title}</h2>
                <Press label={t("Close")} onPress={onClose} feel={null} className="glass h-10 w-10 rounded-full text-muted">
                  <Close size={18} />
                </Press>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-2 pb-[max(20px,var(--inset-bottom))]">
              {children}
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** A small line that says what happened, at the top, then goes. */
export function Toast({ text }: { text: string | null }) {
  return (
    <AnimatePresence>
      {text && (
        <motion.div
          key={text}
          className="glass pointer-events-none absolute top-[max(14px,calc(var(--inset-top)+8px))] left-1/2 z-50 rounded-full px-4 py-2 text-[13px] text-text"
          initial={{ opacity: 0, y: -14, x: "-50%", scale: 0.96 }}
          animate={{ opacity: 1, y: 0, x: "-50%", scale: 1 }}
          exit={{ opacity: 0, y: -10, x: "-50%", scale: 0.98 }}
          transition={spring}
        >
          {text}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
