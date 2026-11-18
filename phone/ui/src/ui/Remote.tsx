import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { haptic, tv, type Key, type Status, type TvState } from "../bridge";
import { Globe, type Dir } from "../globe/Globe";
import { openHelp, patchTv, updateSettings, useWorld } from "../store";
import { openSettings } from "./panel";
import { ORBIT_HOMES } from "../setup/plan";
import * as I from "./icons";
import { Press, Toast, spring } from "./kit";
import { AppsSheet, PlayerSheet, SleepSheet, TypeSheet, useIcon } from "./Sheets";
import { t, tm } from "../i18n";

type SheetName = "apps" | "type" | "player" | "sleep" | null;

/** The remote: the TV's name and what is on, the globe in the middle, the three keys, and the dock. */
export function Remote({ status }: { status: Status }) {
  const { tv: state, settings } = useWorld();
  const [sheet, setSheet] = useState<SheetName>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [touching, setTouching] = useState(false);
  const [flash, setFlash] = useState<{ dir: Dir; n: number } | null>(null);
  const toastTimer = useRef(0);
  const mode = settings.mode;

  const say = useCallback((text: string) => {
    setToast(text);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1800);
  }, []);
  const fail = useCallback((e: unknown) => {
    haptic("error");
    say(tm((e as Error).message) || t("The TV did not take that."));
  }, [say]);
  const key = useCallback((k: Key) => tv.key(k).catch(fail), [fail]);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  return (
    <div className="relative flex h-full flex-col px-5 pt-[max(18px,var(--inset-top))] pb-[max(14px,var(--inset-bottom))]">
      <Toast text={toast} />

      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate font-display text-[23px] leading-tight font-normal tracking-[-0.01em]">
            {state?.tv || status.tv?.name || t("Your TV")}
          </h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-muted">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-mint/60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-mint" />
            </span>
            {status.via === "cloud" ? t("Connected from anywhere") : t("On your home Wi-Fi")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Press label={t("Help: see the TV's screen")} onPress={openHelp} feel="medium" className="glass h-11 rounded-full pr-4 pl-3 text-text">
            <span className="flex items-center gap-2 text-[14px] font-medium">
              <I.Lifebuoy size={18} className="text-gold" />
              {t("Help")}
            </span>
          </Press>
          <Press label={t("Settings")} onPress={openSettings} className="glass h-11 w-11 shrink-0 rounded-full text-muted">
            <I.Gear size={20} />
          </Press>
        </div>
      </header>

      <NowPlaying state={state} onOpen={() => setSheet("player")} onFail={fail} />

      <ModeSwitch
        mode={mode}
        onChange={(m) => {
          haptic("medium");
          updateSettings({ mode: m });
          // Back to the remote's own focus: the pointer leaves the TV's screen at once.
          if (m === "focus") tv.hidePointer().catch(() => {});
        }}
      />

      <div className="relative flex min-h-0 flex-1 items-center justify-center">
        <div className="relative aspect-square h-full max-h-[min(84vw,400px)] max-w-full">
          <DirectionTicks flash={flash} visible={mode === "focus"} />
          <Globe
            mode={mode}
            speed={settings.speed}
            onTouch={setTouching}
            onStep={(dir) => {
              haptic("tick");
              setFlash((f) => ({ dir, n: (f?.n ?? 0) + 1 }));
              key(dir);
            }}
            onTap={() => {
              haptic("light");
              if (mode === "focus") key("ok");
              else tv.click(false).catch(fail);
            }}
            onLong={() => {
              haptic("medium");
              if (mode === "focus") {
                key("recents");
                say(t("Recent apps"));
              } else tv.click(true).catch(fail);
            }}
            onMove={(dx, dy) => tv.move(dx, dy)}
            onScroll={(dx, dy) => tv.scroll(dx, dy)}
          />
        </div>
      </div>
      <p className={`-mt-1 mb-3 text-center text-[12px] text-faint transition-opacity duration-300 ${touching ? "opacity-0" : "opacity-100"}`}>
        {mode === "focus" ? t("Roll to move  ·  tap for OK  ·  hold for recent apps") : t("Glide to point  ·  tap to click  ·  two fingers to scroll")}
      </p>

      <div className="mb-4 grid grid-cols-3 gap-3">
        <KeyButton label={t("Back")} onPress={() => key("back")}>
          <I.Back size={24} />
        </KeyButton>
        <KeyButton label={t("Home")} onPress={() => key("home")}>
          <I.Home size={24} />
        </KeyButton>
        <KeyButton label={t("Recent")} onPress={() => key("recents")}>
          <I.Recents size={24} />
        </KeyButton>
      </div>

      <Dock state={state} {...volumeKeys(state, fail)} onSheet={setSheet} />

      <AppsSheet open={sheet === "apps"} onClose={() => setSheet(null)} onLaunched={(label) => say(t("Opening {app}", { app: label }))} onFail={fail} />
      <TypeSheet open={sheet === "type"} onClose={() => setSheet(null)} onDone={say} onFail={fail} />
      <PlayerSheet open={sheet === "player"} onClose={() => setSheet(null)} state={state} onFail={fail} />
      <SleepSheet
        open={sheet === "sleep"}
        onClose={() => setSheet(null)}
        onSleep={() => {
          setSheet(null);
          tv.sleep().then(() => say(t("Good night"))).catch(fail);
        }}
      />
    </div>
  );
}

function NowPlaying({ state, onOpen, onFail }: { state: TvState | null; onOpen: () => void; onFail: (e: unknown) => void }) {
  const pkg = state?.pkg && !ORBIT_HOMES.has(state.pkg) ? state.pkg : null;
  const art = useIcon(pkg);
  const hasMedia = !!state?.title;
  const head = hasMedia ? state!.title : state?.app || t("Home");
  const sub = hasMedia ? [state!.player || state!.app, state!.playing ? t("Playing") : t("Paused")].filter(Boolean).join("  ·  ") : t("On the TV now");
  return (
    <motion.div layout className="glass mt-4 flex items-center gap-3 rounded-[22px] p-2.5 pr-3" transition={spring}>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={t("What is playing")}>
        <span className="relative h-11 w-[78px] shrink-0 overflow-hidden rounded-[12px] bg-white/6">
          <AnimatePresence>
            {art ? (
              <motion.img key={art} src={art} alt="" className="absolute inset-0 h-full w-full object-cover" initial={{ opacity: 0 }} animate={{ opacity: 1 }} />
            ) : (
              <span className="absolute inset-0 grid place-items-center text-muted">
                <I.Tv size={20} />
              </span>
            )}
          </AnimatePresence>
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-medium">{head}</span>
          <span className="block truncate text-[12.5px] text-muted">{sub}</span>
        </span>
      </button>
      {hasMedia && (
        <Press
          label={state!.playing ? t("Pause") : t("Play")}
          onPress={() => {
            tv.media("play_pause").catch(onFail);
            patchTv({ playing: !state!.playing });
          }}
          className="h-10 w-10 shrink-0 rounded-full bg-text text-ink"
        >
          {state!.playing ? <I.Pause size={17} /> : <I.Play size={17} />}
        </Press>
      )}
    </motion.div>
  );
}

function ModeSwitch({ mode, onChange }: { mode: "focus" | "cursor"; onChange: (m: "focus" | "cursor") => void }) {
  const items = [
    { id: "focus" as const, label: t("Focus"), icon: <I.FocusMark size={16} /> },
    { id: "cursor" as const, label: t("Cursor"), icon: <I.CursorMark size={15} /> },
  ];
  return (
    <div className="mt-4 flex justify-center">
      <div className="glass relative flex rounded-full p-1" role="tablist" aria-label={t("How the globe works")}>
        {items.map((it) => (
          <button
            key={it.id}
            role="tab"
            aria-selected={mode === it.id}
            type="button"
            onClick={() => mode !== it.id && onChange(it.id)}
            className={`relative z-10 flex h-9 items-center gap-1.5 rounded-full px-4 text-[13.5px] transition-colors ${
              mode === it.id ? "text-ink" : "text-muted"
            }`}
          >
            {mode === it.id && (
              <motion.span layoutId="mode-pill" className="absolute inset-0 -z-10 rounded-full bg-text" transition={spring} />
            )}
            {it.icon}
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Four small lights around the ball: the one a step went to flares, so the direction is seen as well as felt. */
export function DirectionTicks({ flash, visible }: { flash: { dir: Dir; n: number } | null; visible: boolean }) {
  const spots: Record<Dir, string> = {
    up: "left-1/2 top-[4%] -translate-x-1/2",
    down: "left-1/2 bottom-[4%] -translate-x-1/2",
    left: "top-1/2 left-[4%] -translate-y-1/2",
    right: "top-1/2 right-[4%] -translate-y-1/2",
  };
  return (
    <div className={`pointer-events-none absolute inset-0 transition-opacity duration-500 ${visible ? "opacity-100" : "opacity-0"}`} aria-hidden="true">
      {(Object.keys(spots) as Dir[]).map((d) => (
        <motion.span
          key={d + (flash?.dir === d ? flash.n : 0)}
          className={`absolute h-1.5 w-1.5 rounded-full ${spots[d]}`}
          initial={flash?.dir === d ? { scale: 2.6, backgroundColor: "#ffffff", boxShadow: "0 0 18px 4px rgba(116,209,255,.9)" } : false}
          animate={{ scale: 1, backgroundColor: "rgba(255,255,255,0.22)", boxShadow: "0 0 0 0 rgba(116,209,255,0)" }}
          transition={{ duration: 0.45, ease: "easeOut" }}
        />
      ))}
    </div>
  );
}

export function KeyButton({ label, onPress, children }: { label: string; onPress: () => void; children: React.ReactNode }) {
  return (
    <Press label={label} onPress={onPress} className="glass h-[62px] rounded-[22px]">
      <span className="flex flex-col items-center gap-1 text-text">
        {children}
        <span className="text-[11px] tracking-[0.01em] text-faint">{label}</span>
      </span>
    </Press>
  );
}

function Dock({
  state,
  onVolume,
  onMute,
  onSheet,
}: {
  state: TvState | null;
  onVolume: (dir: 1 | -1) => void;
  onMute: () => void;
  onSheet: (s: SheetName) => void;
}) {
  return (
    <nav className="glass flex items-center gap-1 rounded-[26px] p-1.5" aria-label={t("TV controls")}>
      <VolumeGroup state={state} onVolume={onVolume} onMute={onMute} />
      <Press label={t("Keyboard")} onPress={() => onSheet("type")} className="h-[54px] w-[52px] rounded-[20px] text-text">
        <I.Keyboard size={22} />
      </Press>
      <Press label={t("Apps")} onPress={() => onSheet("apps")} className="h-[54px] w-[52px] rounded-[20px] text-text">
        <I.Apps size={21} />
      </Press>
      <Press label={t("Sleep")} onPress={() => onSheet("sleep")} className="h-[54px] w-[52px] rounded-[20px] text-rose">
        <I.Power size={21} />
      </Press>
    </nav>
  );
}

/** Volume down, the level (tap to mute), volume up: the dock's, and the Help page's. */
export function VolumeGroup({
  state,
  onVolume,
  onMute,
}: {
  state: TvState | null;
  onVolume: (dir: 1 | -1) => void;
  onMute: () => void;
}) {
  const share = state && state.max > 0 ? state.volume / state.max : 0;
  const level: 0 | 1 | 2 = share < 0.05 ? 0 : share < 0.5 ? 1 : 2;
  return (
    <div className="flex flex-1 items-center rounded-[20px] bg-white/[0.035]">
      <Press label={t("Volume down")} onPress={() => onVolume(-1)} repeat feel="tick" className="h-[54px] w-12 rounded-[20px] text-text">
        <I.Minus size={20} />
      </Press>
      <Press label={state?.muted ? t("Unmute") : t("Mute")} onPress={onMute} className="h-[54px] flex-1 rounded-[16px]">
        <span className="flex flex-col items-center gap-1">
          <span className={`flex items-center gap-1.5 ${state?.muted ? "text-rose" : "text-text"}`}>
            <I.Speaker size={17} level={level} muted={state?.muted} />
            <span className="tabular text-[14px] font-medium">{state ? state.volume : "–"}</span>
          </span>
          <span className="h-[3px] w-12 overflow-hidden rounded-full bg-white/10">
            <motion.span
              className="ribbon-line block h-full"
              animate={{ width: `${Math.round((state?.muted ? 0 : share) * 100)}%` }}
              transition={spring}
            />
          </span>
        </span>
      </Press>
      <Press label={t("Volume up")} onPress={() => onVolume(1)} repeat feel="tick" className="h-[54px] w-12 rounded-[20px] text-text">
        <I.Plus size={20} />
      </Press>
    </div>
  );
}

/** The volume keys as the remote presses them: the TV's own step, and the level moved ahead of the TV's answer. */
export function volumeKeys(state: TvState | null, fail: (e: unknown) => void) {
  return {
    onVolume: (dir: 1 | -1) => {
      tv.key(dir === 1 ? "volup" : "voldown").catch(fail);
      if (state) {
        const step = Math.max(1, Math.round(state.max / 30));
        patchTv({ volume: Math.max(0, Math.min(state.max, state.volume + dir * step)), muted: false });
      }
    },
    onMute: () => {
      tv.key("mute").catch(fail);
      if (state) patchTv({ muted: !state.muted });
    },
  };
}
