import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { haptic, tv, type Key, type Status } from "../bridge";
import type { Dir } from "../globe/Globe";
import { retryHelp, startHelp, stopHelp, useHelp, type HelpView, type Picture } from "../help";
import { closeHelp, useWorld } from "../store";
import * as I from "./icons";
import { Press, Toast, spring } from "./kit";
import { DirectionTicks, KeyButton, VolumeGroup, volumeKeys } from "./Remote";

/** No picture for this long (the TV sends one at least every 5 s): the TV is off, or help did not start. */
const QUIET_MS = 10_000;
/** The TV's screen in its own pixels: where a tap on the picture lands. */
const TV_W = 1280;
const TV_H = 720;
/** The TV pointer's ring, as the TV draws it. */
const RING_MASK = "radial-gradient(circle, transparent 54%, #000 57%)";

const rise = { hidden: { opacity: 0, y: 12 }, shown: { opacity: 1, y: 0 } };

/**
 * Help: the TV's screen, live, for helping someone at home from anywhere. Tap the picture to click that spot on the
 * TV, or press the keys under it. While this is open the TV sends pictures of its screen, and says so at its top.
 */
export function Help({ status }: { status: Status }) {
  const { tv: state } = useWorld();
  const help = useHelp();
  const now = useNow(1000);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef(0);

  const say = useCallback((text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1800);
  }, []);
  const fail = useCallback((e: unknown) => {
    haptic("error");
    say((e as Error).message || "The TV did not take that.");
  }, [say]);
  const key = useCallback((k: Key) => tv.key(k).catch(fail), [fail]);

  // Help on while this page is here (it was asked for already when Help was pressed), off when it goes.
  useEffect(() => {
    startHelp();
    return () => {
      stopHelp();
      window.clearTimeout(toastTimer.current);
    };
  }, []);

  const picture = help.picture;
  const quiet = now - Math.max(picture?.got ?? 0, help.since) > QUIET_MS;
  const trouble = help.error ?? (quiet ? "The TV did not send its screen. Is it on?" : null);
  const live = !!picture && !trouble;
  const name = state?.tv || status.tv?.name || "";

  return (
    <div className="relative flex h-full flex-col px-5 pt-[max(18px,var(--inset-top))] pb-[max(14px,var(--inset-bottom))]">
      <Toast text={toast} />
      <motion.div
        className="flex min-h-0 flex-1 flex-col"
        initial="hidden"
        animate="shown"
        variants={{ shown: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } } }}
      >
        <motion.header variants={rise} transition={spring} className="flex items-center gap-3">
          <Press label="Back to the remote" onPress={closeHelp} className="glass h-11 w-11 shrink-0 rounded-full text-muted">
            <I.Chevron dir="left" size={20} />
          </Press>
          <div className="min-w-0">
            <h1 className="truncate font-display text-[23px] leading-tight font-normal tracking-[-0.01em]">Help</h1>
            <p className="mt-0.5 truncate text-[12.5px] text-muted">
              {name && name !== "TV" ? `${name}'s screen` : "The TV's screen"}
              {status.via === "cloud" ? ", from anywhere" : ""}
            </p>
          </div>
        </motion.header>

        <motion.section variants={rise} transition={spring} className="mt-4" aria-label="The TV's screen">
          <TvPicture
            picture={picture}
            trouble={trouble}
            onRetry={retryHelp}
            onTap={(x, y) => {
              haptic("light");
              tv.tapAt(x, y).catch(fail);
            }}
          />
          <div className="mt-2.5 flex items-center justify-between gap-3 px-1">
            <span className="flex min-w-0 items-center gap-2 text-[12.5px] text-muted">
              <LiveDot live={live} />
              <span className="tabular truncate">{caption(help, picture, trouble, now)}</span>
            </span>
            <span className={`shrink-0 text-[12px] text-faint transition-opacity duration-300 ${live ? "opacity-100" : "opacity-0"}`}>
              Tap the picture to click
            </span>
          </div>
          <p className="mt-3 flex items-start gap-2 px-1 text-[12.5px] leading-snug text-faint">
            <I.Eye size={15} className="mt-px shrink-0" />
            The TV shows a small note at the top while you can see its screen.
          </p>
        </motion.section>

        <motion.div variants={rise} transition={spring} className="relative flex min-h-0 flex-1 items-center justify-center py-4">
          <DPad onKey={key} />
        </motion.div>

        <motion.div variants={rise} transition={spring}>
          <div className="mb-3 grid grid-cols-3 gap-3">
            <KeyButton label="Back" onPress={() => key("back")}>
              <I.Back size={24} />
            </KeyButton>
            <KeyButton label="Home" onPress={() => key("home")}>
              <I.Home size={24} />
            </KeyButton>
            <KeyButton label="Settings" onPress={() => key("settings")}>
              <I.Gear size={23} />
            </KeyButton>
          </div>
          <nav className="glass flex items-center rounded-[26px] p-1.5" aria-label="Volume">
            <VolumeGroup state={state} {...volumeKeys(state, fail)} />
          </nav>
        </motion.div>
      </motion.div>
    </div>
  );
}

function caption(help: HelpView, picture: Picture | null, trouble: string | null, now: number) {
  if (help.error) return "Help did not start";
  if (!picture) return trouble ? "No picture from the TV" : "Waiting for the TV…";
  return `Updated ${ago(now - picture.at)}`;
}

function ago(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 1) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`;
}

function useNow(every: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), every);
    return () => window.clearInterval(t);
  }, [every]);
  return now;
}

/** Red and breathing while the picture is live; grey while it waits. */
function LiveDot({ live }: { live: boolean }) {
  return (
    <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
      {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-live/60" />}
      <span className={`relative inline-flex h-2 w-2 rounded-full transition-colors duration-500 ${live ? "bg-live" : "bg-faint"}`} />
    </span>
  );
}

/** The TV's screen at 16:9. A tap on it is a click at that spot of the TV, with a ring where the finger was. */
function TvPicture({
  picture,
  trouble,
  onRetry,
  onTap,
}: {
  picture: Picture | null;
  trouble: string | null;
  onRetry: () => void;
  onTap: (x: number, y: number) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [rings, setRings] = useState<{ id: number; x: number; y: number }[]>([]);
  const next = useRef(0);

  const tap = (e: MouseEvent<HTMLDivElement>) => {
    if (!picture || trouble || !box.current) return;
    const r = box.current.getBoundingClientRect();
    // The picture keeps its own shape inside the box: a tap on a bar beside it is not on the TV.
    const fit = Math.min(r.width / picture.w, r.height / picture.h);
    const w = picture.w * fit;
    const h = picture.h * fit;
    const px = e.clientX - r.left - (r.width - w) / 2;
    const py = e.clientY - r.top - (r.height - h) / 2;
    if (px < 0 || py < 0 || px > w || py > h) return;
    const x = Math.min(TV_W - 1, Math.max(0, Math.round((px / w) * TV_W)));
    const y = Math.min(TV_H - 1, Math.max(0, Math.round((py / h) * TV_H)));
    const id = ++next.current;
    setRings((list) => [...list.slice(-3), { id, x: e.clientX - r.left, y: e.clientY - r.top }]);
    onTap(x, y);
  };

  return (
    <div
      ref={box}
      role="button"
      aria-label="The TV's screen. Tap a spot to click it on the TV."
      onClick={tap}
      className="relative aspect-video w-full overflow-hidden rounded-[22px] border border-white/8 bg-[#020307] shadow-[0_28px_60px_-30px_rgba(0,0,0,0.95)]"
    >
      <AnimatePresence>
        {picture ? (
          <motion.img
            key="picture"
            src={picture.src}
            alt=""
            draggable={false}
            className="absolute inset-0 h-full w-full object-contain"
            initial={{ opacity: 0, scale: 1.04, filter: "blur(12px)" }}
            animate={{ opacity: trouble ? 0.3 : 1, scale: 1, filter: trouble ? "blur(6px)" : "blur(0px)" }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.55, ease: [0.25, 1, 0.5, 1] }}
          />
        ) : (
          !trouble && <Waiting key="waiting" />
        )}
      </AnimatePresence>
      <AnimatePresence>{trouble && <Trouble key="trouble" text={trouble} onRetry={onRetry} />}</AnimatePresence>
      {rings.map((p) => (
        <TapRing key={p.id} x={p.x} y={p.y} onDone={() => setRings((list) => list.filter((q) => q.id !== p.id))} />
      ))}
      <span className="pointer-events-none absolute inset-0 rounded-[22px] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]" />
    </div>
  );
}

function Waiting() {
  return (
    <motion.div
      className="absolute inset-0 grid place-items-center overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      {/* A slow light across the dark glass, like a screen warming up. */}
      <motion.span
        className="absolute inset-y-0 left-0 w-1/2"
        style={{ background: "linear-gradient(90deg, transparent, rgb(255 255 255 / 0.045), transparent)" }}
        initial={{ x: "-100%" }}
        animate={{ x: "200%" }}
        transition={{ duration: 2.4, repeat: Infinity, ease: [0.45, 0, 0.55, 1] }}
      />
      <span className="relative flex flex-col items-center gap-3">
        <Dots />
        <span className="text-[13.5px] text-muted">Waiting for the TV…</span>
      </span>
    </motion.div>
  );
}

function Dots() {
  return (
    <span className="flex gap-2" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-cyan"
          animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1.15, 0.8] }}
          transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }}
        />
      ))}
    </span>
  );
}

function Trouble({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <motion.div
      className="absolute inset-0 grid place-items-center px-8 text-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      role="alert"
    >
      <div>
        <p className="mx-auto max-w-[30ch] text-[14px] leading-snug text-text">{text}</p>
        <Press label="Try again" onPress={onRetry} className="glass mx-auto mt-3.5 h-10 rounded-full px-5 text-[14px]">
          Try again
        </Press>
      </div>
    </motion.div>
  );
}

/** Where the finger landed: the TV pointer's own ring, opening out, and a spark at its middle. */
function TapRing({ x, y, onDone }: { x: number; y: number; onDone: () => void }) {
  return (
    <span className="pointer-events-none absolute" style={{ left: x, top: y }} aria-hidden="true">
      <motion.span
        className="absolute -top-6 -left-6 h-12 w-12 rounded-full"
        style={{ background: "conic-gradient(#74d1ff, #ff74d1, #ffe9b3, #74d1ff)", WebkitMask: RING_MASK, mask: RING_MASK }}
        initial={{ scale: 0.3, opacity: 1 }}
        animate={{ scale: 1.6, opacity: 0 }}
        transition={{ duration: 0.65, ease: [0.25, 1, 0.5, 1] }}
        onAnimationComplete={onDone}
      />
      <motion.span
        className="absolute -top-[5px] -left-[5px] h-2.5 w-2.5 rounded-full bg-white shadow-[0_0_14px_3px_rgba(116,209,255,0.75)]"
        initial={{ scale: 1, opacity: 1 }}
        animate={{ scale: 0.5, opacity: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
      />
    </span>
  );
}

/** The TV remote's ring: four arrows round an OK, each step lighting its side as the globe's do. */
function DPad({ onKey }: { onKey: (k: Key) => void }) {
  const [flash, setFlash] = useState<{ dir: Dir; n: number } | null>(null);
  const step = (dir: Dir) => {
    setFlash((f) => ({ dir, n: (f?.n ?? 0) + 1 }));
    onKey(dir);
  };
  const arrows: { dir: Dir; label: string; spot: string }[] = [
    { dir: "up", label: "Up", spot: "top-[2%] right-[30%] left-[30%] h-[29%]" },
    { dir: "down", label: "Down", spot: "right-[30%] bottom-[2%] left-[30%] h-[29%]" },
    { dir: "left", label: "Left", spot: "top-[30%] bottom-[30%] left-[2%] w-[29%]" },
    { dir: "right", label: "Right", spot: "top-[30%] right-[2%] bottom-[30%] w-[29%]" },
  ];
  return (
    <div className="relative aspect-square h-full max-h-[min(60vw,236px)] max-w-full">
      <div className="glass absolute inset-0 rounded-full" />
      <svg className="pointer-events-none absolute inset-0 h-full w-full text-white/[0.07]" viewBox="0 0 100 100" aria-hidden="true">
        <path
          d="M66.3 66.3 83.2 83.2M33.7 66.3 16.8 83.2M33.7 33.7 16.8 16.8M66.3 33.7 83.2 16.8"
          stroke="currentColor"
          strokeWidth="0.6"
          strokeLinecap="round"
        />
        <circle cx="50" cy="50" r="22.5" fill="none" stroke="currentColor" strokeWidth="0.6" />
      </svg>
      <DirectionTicks flash={flash} visible />
      {/* Press is always `relative`: each key sits in its own placed box. */}
      {arrows.map((a) => (
        <div key={a.dir} className={`absolute ${a.spot}`}>
          <Press label={a.label} onPress={() => step(a.dir)} feel="tick" className="h-full w-full rounded-[20px] text-muted">
            <I.Chevron dir={a.dir} size={26} />
          </Press>
        </div>
      ))}
      <div className="absolute inset-[31%]">
        <Press
          label="OK"
          onPress={() => onKey("ok")}
          className="h-full w-full rounded-full bg-text text-ink shadow-[0_14px_34px_-12px_rgba(0,0,0,0.9)]"
        >
          <span className="font-display text-[19px] font-medium tracking-[0.02em]">OK</span>
        </Press>
      </div>
    </div>
  );
}
