// The pieces every Orbit Setup screen is made of, as the canvas draws them: the step bar with its seven segments, the
// 56 px buttons, glass cards, and the motion the screens rise with.
import { motion, type HTMLMotionProps } from "framer-motion";
import type { ReactNode } from "react";
import { haptic } from "../../bridge";
import * as I from "../icons";
import { spring } from "../kit";

export const ease = [0.25, 1, 0.5, 1] as const;

/** Each block of a screen rises a moment after the one above it. */
export const rise = {
  hidden: { opacity: 0, y: 14 },
  shown: { opacity: 1, y: 0, transition: { duration: 0.5, ease } },
};

const stagger = { hidden: {}, shown: { transition: { staggerChildren: 0.055, delayChildren: 0.05 } } };

/** One screen: the canvas's margins, the phone's bars kept clear, and scrolling when a small phone needs it. */
export function Screen({ children, label, top = 20 }: { children: ReactNode; label: string; top?: number }) {
  return (
    <motion.main
      aria-label={label}
      className="relative flex h-full flex-col overflow-y-auto overscroll-contain px-6 pb-[max(28px,var(--inset-bottom))]"
      style={{ paddingTop: `max(${top}px, var(--inset-top))` }}
      initial="hidden"
      animate="shown"
      variants={stagger}
    >
      {children}
    </motion.main>
  );
}

export const Rise = ({ children, className = "", ...rest }: HTMLMotionProps<"div"> & { children?: ReactNode }) => (
  <motion.div variants={rise} className={className} {...rest}>
    {children}
  </motion.div>
);

/** The top of a numbered step: Back, the seven segments, "3 of 7". */
export function StepBar({ step, total = 7, onBack }: { step: number; total?: number; onBack?: () => void }) {
  return (
    <Rise className="flex h-11 shrink-0 items-center gap-3">
      {onBack && (
        <button
          type="button"
          aria-label="Back"
          onClick={() => {
            haptic("light");
            onBack();
          }}
          className="-ml-2.5 grid h-11 w-11 shrink-0 place-items-center rounded-full text-haze active:bg-white/6"
        >
          <I.Caret size={22} strokeWidth={2} />
        </button>
      )}
      <div
        className="grid flex-1 gap-[5px]"
        style={{ gridTemplateColumns: `repeat(${total}, minmax(0, 1fr))` }}
        role="progressbar"
        aria-label="Setup steps"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={step}
      >
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className="relative h-1 overflow-hidden rounded-full bg-white/12">
            {i < step && (
              <motion.span
                className="absolute inset-0 origin-left rounded-full bg-cyan"
                initial={i === step - 1 ? { scaleX: 0 } : false}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.55, ease, delay: 0.15 }}
              />
            )}
          </span>
        ))}
      </div>
      <span className="tabular min-w-[34px] text-right text-[13px] text-dusk">
        {step} of {total}
      </span>
    </Rise>
  );
}

/** The setup's own word mark: "Orbit" in its ribbon, and a small word beside it. */
export function Brand({ aside }: { aside?: ReactNode }) {
  return (
    <Rise className="flex min-h-11 shrink-0 items-center justify-between gap-3">
      <span className="setup-ribbon-text font-display text-[24px] font-medium tracking-[-0.2px]">Orbit</span>
      {aside}
    </Rise>
  );
}

export function Title({ children, size = 30, className = "" }: { children: ReactNode; size?: number; className?: string }) {
  return (
    <h1 className={`m-0 font-display font-semibold tracking-[-0.5px] text-snow ${className}`} style={{ fontSize: size, lineHeight: 1.15 }}>
      {children}
    </h1>
  );
}

export const Lead = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <p className={`m-0 text-[15px] leading-[1.5] text-mist ${className}`}>{children}</p>
);

export const SectionLabel = ({ children, aside }: { children: ReactNode; aside?: ReactNode }) => (
  <div className="flex items-baseline justify-between gap-3">
    <span className="text-[13px] font-semibold tracking-[0.6px] text-dusk uppercase">{children}</span>
    {aside && <span className="text-[13px] text-dusk">{aside}</span>}
  </div>
);

export const Card = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <div className={`setup-card rounded-[20px] ${className}`}>{children}</div>
);

interface ButtonProps {
  children: ReactNode;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  className?: string;
  label?: string;
}

/** The one thing a screen asks for: sky blue, 56 px. */
export function Primary({ children, onPress, disabled, busy, className = "", label }: ButtonProps) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={onPress}
      whileTap={{ scale: 0.97 }}
      transition={spring}
      className={`flex h-14 w-full shrink-0 items-center justify-center gap-2.5 rounded-[18px] bg-cyan text-[17px] font-semibold text-deep disabled:opacity-45 ${busy ? "disabled:opacity-80" : ""} ${className}`}
    >
      {busy && <Spinner size={18} dark />}
      {children}
    </motion.button>
  );
}

/** A second way on: glass, 52 px. */
export function Quiet({ children, onPress, disabled, busy, className = "", label }: ButtonProps) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={disabled || busy}
      onClick={onPress}
      whileTap={{ scale: 0.97 }}
      transition={spring}
      className={`flex h-[52px] w-full shrink-0 items-center justify-center gap-2.5 rounded-[18px] border border-white/12 bg-white/6 text-[16px] font-semibold text-haze disabled:opacity-45 ${className}`}
    >
      {busy && <Spinner size={16} />}
      {children}
    </motion.button>
  );
}

/** Words that act: ice blue, 44 px tall. */
export function TextButton({ children, onPress, className = "", tone = "ice", disabled }: ButtonProps & { tone?: "ice" | "mist" }) {
  return (
    <button
      type="button"
      onClick={onPress}
      disabled={disabled}
      className={`min-h-11 shrink-0 px-3 text-[15px] font-medium disabled:opacity-45 ${tone === "ice" ? "text-ice" : "text-mist"} ${className}`}
    >
      {children}
    </button>
  );
}

export function Spinner({ size = 20, dark = false }: { size?: number; dark?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 animate-spin rounded-full border-solid ${dark ? "border-deep/25 border-t-deep" : "border-cyan/25 border-t-cyan"}`}
      style={{ width: size, height: size, borderWidth: Math.max(2, Math.round(size / 8.5)), animationDuration: "0.9s" }}
    />
  );
}

/** A sage tick in a soft circle: done. */
export function DoneMark({ size = 30 }: { size?: number }) {
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-sage/18 text-sage" style={{ width: size, height: size }}>
      <I.Check size={Math.round(size * 0.57)} strokeWidth={2.4} />
    </span>
  );
}

/** A numbered step of something to do with the remote. */
export function NumberedStep({ n, children, done }: { n: number; children: ReactNode; done?: boolean }) {
  return (
    <div className="flex items-start gap-3.5">
      {done ? (
        <DoneMark size={28} />
      ) : (
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-cyan/16 text-[14px] font-semibold text-cyan">{n}</span>
      )}
      <span className="pt-1 text-[15px] leading-[1.45] text-haze">{children}</span>
    </div>
  );
}

/** On and off, as the canvas draws it: 52 by 32. */
export function Switch({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className="relative grid h-11 w-[52px] shrink-0 place-items-center"
    >
      <span className={`relative block h-8 w-[52px] rounded-full transition-colors duration-200 ${on ? "bg-cyan" : "bg-white/16"}`}>
        <motion.span
          className={`absolute top-[3px] h-[26px] w-[26px] rounded-full ${on ? "bg-white" : "bg-[#c3c9d9]"}`}
          animate={{ left: on ? 23 : 3 }}
          transition={spring}
        />
      </span>
    </button>
  );
}

/** A calm note for when something did not work: what happened, in plain words. */
export function Trouble({ children, title }: { children?: ReactNode; title: string }) {
  return (
    <div role="alert" className="flex items-start gap-3 rounded-[18px] border border-rose/30 bg-rose/8 px-4 py-3.5">
      <I.Alert size={20} className="mt-px shrink-0 text-rose" />
      <div className="min-w-0">
        <p className="text-[15px] leading-snug font-medium text-snow">{title}</p>
        {children && <div className="mt-1 text-[13px] leading-snug text-mist">{children}</div>}
      </div>
    </div>
  );
}
