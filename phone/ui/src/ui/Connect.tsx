import { AnimatePresence, motion, useAnimationControls } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { bridge, BridgeError, cloud, haptic, type Status, type TvRef } from "../bridge";
import { Globe } from "../globe/Globe";
import { openSetup } from "../setup/flow";
import { setAccount, useWorld } from "../store";
import { Press, spring } from "./kit";
import { Chevron, Globe as GlobeIcon, Planet, Tv, Wifi } from "./icons";

const fade = {
  initial: { opacity: 0, y: 14, filter: "blur(6px)" },
  animate: { opacity: 1, y: 0, filter: "blur(0px)" },
  exit: { opacity: 0, y: -10, filter: "blur(6px)" },
  transition: { duration: 0.42, ease: [0.25, 1, 0.5, 1] },
} as const;

/**
 * Before the remote: find the TV on the Wi-Fi and pair once with the six digits it shows; or, from anywhere (and
 * when the Wi-Fi will not reach it), sign in with Google and link the TV once with the eight digits it shows.
 */
export function Connect({ status }: { status: Status }) {
  const { account } = useWorld();
  const [linking, setLinking] = useState(false);
  const state = status.state;
  const asleep = state === "searching" || state === "offline";
  const pairing = state === "needsPairing" || state === "pairing";
  useEffect(() => {
    if (account.tvLinked) setLinking(false);
  }, [account.tvLinked]);
  // No TV with Orbit on this Wi-Fi: after a few seconds of looking (a saved TV usually answers sooner), offer to put
  // Orbit OS on one.
  const [lookedLong, setLookedLong] = useState(false);
  useEffect(() => {
    setLookedLong(false);
    if (state !== "searching") return;
    const t = window.setTimeout(() => setLookedLong(true), 2500);
    return () => window.clearTimeout(t);
  }, [state]);
  const offerSetup = !linking && !pairing && (state === "offline" || (state === "searching" && lookedLong));

  return (
    <div className="relative flex h-full flex-col overflow-y-auto px-6 pt-[max(28px,var(--inset-top))] pb-[max(22px,var(--inset-bottom))]">
      <header className="flex items-center justify-between">
        <span className="font-display text-[19px] font-light tracking-[0.02em]">
          <span className="ribbon-text font-normal">Orbit</span>
        </span>
        <span className="flex items-center gap-1.5 text-[12px] text-faint">
          {linking ? <GlobeIcon size={14} /> : <Wifi size={14} />} {linking ? "From anywhere" : "Home Wi-Fi"}
        </span>
      </header>

      <div className={`mx-auto mt-3 transition-[width] duration-500 ${linking || pairing ? "w-[min(52vw,220px)]" : "w-[min(70vw,300px)]"}`}>
        <Globe mode="focus" asleep={asleep && !linking} />
      </div>

      <div className="relative mt-1">
        <AnimatePresence mode="wait">
          {linking ? (
            <motion.div key="link" {...fade}>
              <LinkTv onBack={() => setLinking(false)} />
            </motion.div>
          ) : state === "searching" ? (
            <motion.div key="searching" {...fade} className="text-center">
              <h1 className="font-display text-[29px] leading-tight font-light tracking-[-0.015em]">Looking for your TV</h1>
              <p className="mt-2 text-[14px] text-muted">{status.error || "Keep the phone on the same Wi-Fi as the TV."}</p>
              <Dots />
            </motion.div>
          ) : state === "found" ? (
            <motion.div key="found" {...fade}>
              <h1 className="text-center font-display text-[29px] leading-tight font-light tracking-[-0.015em]">Found it</h1>
              <p className="mt-2 text-center text-[14px] text-muted">Tap your TV to connect.</p>
              <ul className="mt-5 space-y-2.5">
                {(status.found ?? []).map((t) => (
                  <li key={t.address}>
                    <TvRow tv={t} />
                  </li>
                ))}
              </ul>
            </motion.div>
          ) : pairing ? (
            <motion.div key="pair" {...fade}>
              <Pairing tv={status.tv} />
            </motion.div>
          ) : (
            <motion.div key="offline" {...fade} className="text-center">
              <h1 className="font-display text-[29px] leading-tight font-light tracking-[-0.015em]">Can't reach the TV</h1>
              <p className="mx-auto mt-2 max-w-[32ch] text-[14px] text-muted">
                {status.error || "Is the TV on, and the phone on the home Wi-Fi?"}
              </p>
              <Press
                label="Try again"
                onPress={() => bridge.call("discover").catch(() => {})}
                className="glass mx-auto mt-5 h-11 rounded-full px-6 text-[15px]"
              >
                Try again
              </Press>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {!linking && !pairing && (
        <div className="mt-auto pt-5">
          <AnimatePresence initial={false}>{offerSetup && <SetupOffer />}</AnimatePresence>
          <Anywhere onLink={() => setLinking(true)} />
          <ManualAddress />
        </div>
      )}
    </div>
  );
}

/** Orbit Setup's way in, for a home with no Orbit TV yet. */
function SetupOffer() {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.42, ease: [0.25, 1, 0.5, 1] }}
      className="overflow-hidden"
    >
      <motion.button
        type="button"
        whileTap={{ scale: 0.98 }}
        transition={spring}
        onClick={() => {
          haptic("medium");
          openSetup("install");
        }}
        className="glass mb-3 flex w-full items-center gap-3.5 rounded-[24px] p-4 text-left"
      >
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-white/6 text-cyan">
          <Planet size={22} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15.5px]">Set up Orbit OS on a TV</span>
          <span className="mt-0.5 block text-[13px] leading-snug text-faint">No Orbit TV here yet? This phone puts it on one, over the Wi-Fi.</span>
        </span>
        <Chevron dir="right" size={18} className="shrink-0 text-faint" />
      </motion.button>
    </motion.div>
  );
}

function Dots() {
  return (
    <div className="mt-5 flex justify-center gap-2" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-cyan"
          animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1.15, 0.8] }}
          transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

function TvRow({ tv }: { tv: TvRef }) {
  return (
    <Press
      label={`Connect to ${tv.name}`}
      onPress={() => bridge.call("connect", { address: tv.address, port: tv.port }).catch(() => {})}
      className="glass w-full rounded-[22px] px-4 py-3.5"
    >
      <span className="flex w-full items-center gap-3.5 text-left">
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-white/6 text-cyan">
          <Tv size={22} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[16px] font-medium">{tv.name === "TV" ? "Your TV" : tv.name}</span>
          <span className="tabular block text-[12.5px] text-faint">{tv.address}</span>
        </span>
        <span className="text-[13px] text-cyan">Connect</span>
      </span>
    </Press>
  );
}

/** Digit boxes over one hidden input, in groups (3 + 3 for pairing, 4 + 4 for linking). */
function CodeBoxes({ length, group, value, busy, onChange }: {
  length: number;
  group: number;
  value: string;
  busy: boolean;
  onChange: (v: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = window.setTimeout(() => input.current?.focus(), 450);
    return () => window.clearTimeout(t);
  }, []);
  const wide = length > 6;
  return (
    <label className={`relative mx-auto flex w-fit ${wide ? "gap-1.5" : "gap-2"}`} onClick={() => input.current?.focus()}>
      {Array.from({ length }, (_, i) => {
        const digit = value[i];
        const active = i === Math.min(value.length, length - 1) && !busy;
        return (
          <motion.span
            key={i}
            className={`grid place-items-center rounded-2xl border font-light tabular transition-colors ${
              wide ? "h-[50px] w-[33px] text-[22px]" : "h-[58px] w-[46px] text-[26px]"
            } ${active ? "border-cyan/70 bg-cyan/8" : digit ? "border-white/16 bg-white/6" : "border-white/8 bg-white/3"} ${
              i === group ? "ml-2.5" : ""
            }`}
            animate={digit ? { scale: [0.86, 1] } : { scale: 1 }}
            transition={spring}
          >
            {digit ?? (active ? <motion.span className="h-6 w-[2px] rounded bg-cyan" animate={{ opacity: [1, 0] }} transition={{ duration: 0.9, repeat: Infinity }} /> : "")}
          </motion.span>
        );
      })}
      <input
        ref={input}
        value={value}
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label={`${length}-digit code`}
        maxLength={length}
        className="absolute inset-0 opacity-0"
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, length);
          if (v.length > value.length) haptic("tick");
          onChange(v);
        }}
      />
    </label>
  );
}

function Pairing({ tv }: { tv: TvRef | null }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const asked = useRef(false);
  const shake = useAnimationControls();
  const ask = () => bridge.call("askCode").catch((e: BridgeError) => setError(e.message));

  useEffect(() => {
    // Nobody should have to find a menu on the TV: the code is asked for as soon as this shows.
    if (!asked.current) {
      asked.current = true;
      ask();
    }
  }, []);

  const submit = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      await bridge.call("pair", { code: value });
      haptic("success");
    } catch (e) {
      haptic("error");
      setError((e as Error).message);
      setCode("");
      shake.start({ x: [0, -12, 11, -8, 6, -3, 0], transition: { duration: 0.46 } });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="text-center">
      <h1 className="font-display text-[28px] leading-tight font-light tracking-[-0.015em]">Enter the code on your TV</h1>
      <p className="mt-2 text-[14px] text-muted">
        {tv && tv.name !== "TV" ? <>It is at the top of <span className="text-text">{tv.name}</span> now.</> : "It is at the top of the TV now."}
      </p>
      <motion.div animate={shake} className="mt-6">
        <CodeBoxes length={6} group={3} value={code} busy={busy} onChange={(v) => {
          setCode(v);
          if (v.length === 6) submit(v);
        }} />
      </motion.div>
      <div className="mt-4 min-h-[22px] text-[13.5px] text-rose" role="alert">{error}</div>
      <Press label="Show a new code on the TV" onPress={() => { setError(null); ask(); }} className="mx-auto mt-1 h-10 rounded-full px-4 text-[14px] text-cyan">
        Show a new code on the TV
      </Press>
    </div>
  );
}

/** The way that does not need the Wi-Fi: Google, then the TV's link code, once. */
function Anywhere({ onLink }: { onLink: () => void }) {
  const { account } = useWorld();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await cloud.signIn();
      setAccount(next);
      haptic("success");
      if (!next.tvLinked) onLink();
    } catch (e) {
      setError((e as Error).message || "Google sign-in did not finish.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="glass rounded-[24px] p-4">
      <div className="flex items-center gap-2.5">
        <GlobeIcon size={19} className="text-gold" />
        <p className="text-[15.5px]">Use from anywhere</p>
      </div>
      {!account.signedIn ? (
        <>
          <p className="mt-1.5 text-[13px] leading-relaxed text-faint">
            Sign in with the Google account that is on the TV. Works away from home, and when the Wi-Fi will not reach the TV.
          </p>
          <Press label="Continue with Google" onPress={signIn} disabled={busy} feel="medium" className="mt-3.5 h-12 w-full rounded-full bg-text text-ink">
            <span className="flex items-center gap-2.5 text-[15px] font-medium">
              <GoogleMark /> {busy ? "Opening Google…" : "Continue with Google"}
            </span>
          </Press>
        </>
      ) : !account.tvLinked ? (
        <>
          <p className="mt-1.5 text-[13px] leading-relaxed text-faint">
            Signed in as <span className="text-muted">{account.email}</span>. Now link the TV once with the code it shows.
          </p>
          <Press label="Link your TV" onPress={onLink} feel="medium" className="mt-3.5 h-12 w-full rounded-full bg-text text-[15px] font-medium text-ink">
            Link your TV
          </Press>
        </>
      ) : (
        <p className="mt-1.5 text-[13px] leading-relaxed text-faint">
          {account.tvName || "Your TV"} is linked to <span className="text-muted">{account.email}</span>.{" "}
          {account.tvOnline ? "Connecting…" : "It is asleep or off now: turn it on with its remote, and Orbit connects by itself."}
        </p>
      )}
      {error && <p className="mt-2 text-[13px] text-rose" role="alert">{error}</p>}
    </div>
  );
}

function LinkTv({ onBack }: { onBack: () => void }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shake = useAnimationControls();
  const submit = async (value: string) => {
    setBusy(true);
    setError(null);
    try {
      setAccount(await cloud.linkTv(value));
      haptic("success");
    } catch (e) {
      haptic("error");
      setError((e as Error).message);
      setCode("");
      shake.start({ x: [0, -12, 11, -8, 6, -3, 0], transition: { duration: 0.46 } });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="text-center">
      <h1 className="font-display text-[28px] leading-tight font-light tracking-[-0.015em]">Link your TV</h1>
      <p className="mx-auto mt-2 max-w-[34ch] text-[14px] text-muted">
        Go to Home on the TV: its link code shows at the top for two minutes. Type the eight digits here.
      </p>
      <motion.div animate={shake} className="mt-6">
        <CodeBoxes length={8} group={4} value={code} busy={busy} onChange={(v) => {
          setCode(v);
          if (v.length === 8) submit(v);
        }} />
      </motion.div>
      <div className="mt-4 min-h-[22px] text-[13.5px]" role="alert">
        {busy ? <span className="text-muted">Linking…</span> : <span className="text-rose">{error}</span>}
      </div>
      <Press label="Back" onPress={onBack} feel={null} className="mx-auto mt-1 h-10 rounded-full px-4 text-[14px] text-faint">
        Back
      </Press>
    </div>
  );
}

export function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function ManualAddress() {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  return (
    <div className="mt-3">
      <AnimatePresence initial={false} mode="wait">
        {open ? (
          <motion.form
            key="form"
            {...fade}
            className="glass flex items-center gap-2 rounded-full p-1.5 pl-5"
            onSubmit={(e) => {
              e.preventDefault();
              if (address.trim()) bridge.call("manualAddress", { address: address.trim() }).catch(() => {});
            }}
          >
            <input
              autoFocus
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="192.168.1.20"
              inputMode="decimal"
              aria-label="The TV's address"
              className="tabular min-w-0 flex-1 bg-transparent text-[16px] text-text placeholder:text-faint focus:outline-none"
            />
            <button type="submit" className="h-11 rounded-full bg-text px-5 text-[15px] font-medium text-ink">
              Connect
            </button>
          </motion.form>
        ) : (
          <motion.div key="link" {...fade} className="text-center">
            <button type="button" className="h-10 px-3 text-[13px] text-faint" onClick={() => setOpen(true)}>
              Type the TV's address instead
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
