// Orbit Setup's screens, one at a time, sliding the way the person goes (phone/SPEC.md, "Orbit Setup"; the design is
// the canvas "Orbit Setup", phone row). This file: the frame, Welcome, Find, Developer mode and Allow.
import { AnimatePresence, MotionConfig, motion, useReducedMotion, useTime, useTransform } from "framer-motion";
import { useEffect, useState, type ComponentType } from "react";
import {
  back,
  chooseAddress,
  chooseTv,
  closeSetup,
  continueFromAllow,
  itsOn,
  modelName,
  rescan,
  retryConnect,
  start,
  stepCount,
  tvName,
  useSetup,
  type Flow,
  type SetupStep,
  type SetupTv,
} from "../../setup/flow";
import { catalog } from "../../setup/catalog";
import * as I from "../icons";
import { AccountScreen } from "./Account";
import { BackupScreen, BackupsScreen } from "./Backup";
import { Failed, Installing, Ready, You } from "./Install";
import { PlanScreen, Questions } from "./Choices";
import { SwitchConfirm, Switched, Switching } from "./Switch";
import { UndoConfirm, Undone, Undoing } from "./Undo";
import { Brand, Card, DoneMark, Lead, NumberedStep, Primary, Rise, Screen, SectionLabel, Spinner, StepBar, TextButton, Title, Trouble, ease } from "./parts";

const SCREENS: Record<SetupStep, ComponentType> = {
  welcome: Welcome,
  find: Find,
  devmode: DevMode,
  allow: Allow,
  questions: Questions,
  plan: PlanScreen,
  installing: Installing,
  failed: Failed,
  you: You,
  ready: Ready,
  undo: UndoConfirm,
  undoing: Undoing,
  undone: Undone,
  switch: SwitchConfirm,
  switching: Switching,
  switched: Switched,
  backup: BackupScreen,
  backups: BackupsScreen,
  account: AccountScreen,
};

const slide = {
  enter: (dir: number) => ({ opacity: 0, x: dir * 28, filter: "blur(6px)" }),
  center: { opacity: 1, x: 0, filter: "blur(0px)", transition: { duration: 0.42, ease } },
  exit: (dir: number) => ({ opacity: 0, x: dir * -22, filter: "blur(6px)", transition: { duration: 0.2, ease: [0.5, 0, 0.75, 0] as const } }),
};

/** The whole of Orbit Setup: the screen for the step the flow is at. */
export function Setup() {
  const f = useSetup();
  const Step = SCREENS[f.step];
  return (
    <MotionConfig reducedMotion="user">
      <div className="absolute inset-0 overflow-hidden bg-night text-snow">
        <AnimatePresence mode="wait" initial={false} custom={f.dir}>
          <motion.div key={f.step} custom={f.dir} variants={slide} initial="enter" animate="center" exit="exit" className="absolute inset-0">
            <Step />
          </motion.div>
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}

// ---- 1. welcome ----

function Welcome() {
  return (
    <Screen label="Orbit Setup" top={28}>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-[120px] -left-[60px] h-[360px] w-[510px] rounded-full"
        style={{ background: "radial-gradient(closest-side, rgba(116,209,255,0.14), rgba(9,12,22,0))" }}
      />
      <Brand aside={<span className="text-[13px] tracking-[0.3px] text-dusk">Setup</span>} />
      <Rise className="relative flex items-center justify-center" style={{ height: "clamp(180px, 34vh, 300px)" }}>
        <PlanetArt />
      </Rise>
      <Rise className="relative flex flex-col gap-3">
        <Title size={34} className="leading-[1.12] tracking-[-0.6px]">
          Put Orbit OS on your TV
        </Title>
        <p className="text-[16px] leading-[1.5] text-mist">No computer and no code. This phone does the work over the Wi-Fi, in about five minutes.</p>
      </Rise>
      <Rise className="relative mt-6">
        <Card className="flex flex-col gap-3.5 p-[18px]">
          <Need icon={<I.Wifi size={22} className="text-cyan" />}>The TV is on, and on the same Wi-Fi as this phone</Need>
          <Need icon={<I.Remote size={22} className="text-ice" />}>The TV's remote is in your hand</Need>
          <Need icon={<I.Undo size={22} className="text-lilac" />}>Everything it switches off comes back with one tap</Need>
        </Card>
      </Rise>
      <Rise className="relative mt-auto flex flex-col items-stretch gap-2 pt-6">
        <Primary onPress={start}>Start setup</Primary>
        <TextButton onPress={closeSetup}>Not now</TextButton>
      </Rise>
    </Screen>
  );
}

function Need({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3.5">
      <span className="mt-px shrink-0">{icon}</span>
      <span className="text-[15px] leading-[1.45] text-haze">{children}</span>
    </div>
  );
}

/** The planet in its ring, with a satellite going round: behind the planet on the far side, in front on the near. */
function PlanetArt() {
  const still = useReducedMotion();
  const time = useTime();
  const angle = useTransform(time, (t) => 0.67 + (still ? 0 : (t / 9000) * Math.PI * 2));
  const x = useTransform(angle, (a) => 150 * Math.cos(a));
  const y = useTransform(angle, (a) => 38 * Math.sin(a));
  const near = useTransform(angle, (a) => (Math.sin(a) >= 0 ? 1 : 0));
  const far = useTransform(angle, (a) => (Math.sin(a) < 0 ? 0.55 : 0));
  return (
    <svg viewBox="0 0 320 260" className="h-full w-auto max-w-full" aria-hidden="true">
      <defs>
        <linearGradient id="setup-ring" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#74D1FF" />
          <stop offset="0.5" stopColor="#ADC6FF" />
          <stop offset="1" stopColor="#E9B3FF" />
        </linearGradient>
        <radialGradient id="setup-planet" cx="0.38" cy="0.32" r="0.8">
          <stop offset="0" stopColor="#1D2A56" />
          <stop offset="1" stopColor="#0A0F22" />
        </radialGradient>
        <radialGradient id="setup-sat">
          <stop offset="0" stopColor="#FFFFFF" />
          <stop offset="0.4" stopColor="#74D1FF" />
          <stop offset="1" stopColor="#74D1FF" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g transform="translate(160 130) rotate(-14)">
        <path d="M -150 0 A 150 38 0 0 1 150 0" fill="none" stroke="url(#setup-ring)" strokeWidth="2" opacity="0.45" />
        <motion.g style={{ x, y, opacity: far }}>
          <circle r="11" fill="url(#setup-sat)" />
          <circle r="2.6" fill="#FFFFFF" />
        </motion.g>
      </g>
      <circle cx="160" cy="130" r="76" fill="url(#setup-planet)" stroke="rgba(173,198,255,0.45)" strokeWidth="1.2" />
      <ellipse cx="160" cy="130" rx="76" ry="26" fill="none" stroke="rgba(173,198,255,0.22)" />
      <ellipse cx="160" cy="130" rx="76" ry="54" fill="none" stroke="rgba(173,198,255,0.16)" />
      <ellipse cx="160" cy="130" rx="28" ry="76" fill="none" stroke="rgba(173,198,255,0.18)" />
      <ellipse cx="160" cy="130" rx="56" ry="76" fill="none" stroke="rgba(173,198,255,0.14)" />
      <g transform="translate(160 130) rotate(-14)">
        <path d="M 150 0 A 150 38 0 0 1 -150 0" fill="none" stroke="url(#setup-ring)" strokeWidth="2.4" />
        <motion.g style={{ x, y, opacity: near }}>
          <circle r="16" fill="url(#setup-sat)" />
          <circle r="3.6" fill="#FFFFFF" />
        </motion.g>
      </g>
    </svg>
  );
}

// ---- 2. find ----

/** Where the chips of found TVs sit around the radar (left and top of the chip, in % of the radar's box). */
const CHIP_SPOTS = [
  { left: "62%", top: "20%" },
  { left: "8%", top: "64%" },
  { left: "58%", top: "72%" },
];

/** The model in plain words; the address too when two TVs on the Wi-Fi share a name. */
function modelLine(tv: SetupTv, all: SetupTv[]): string {
  const known = tv.model ? catalog.models[tv.model]?.name ?? tv.model : null;
  const twin = all.some((t) => t !== tv && t.name === tv.name);
  return [known ?? (tv.manual ? "Typed address" : "Android TV"), twin || !known ? tv.address : null].filter(Boolean).join(" · ");
}

function Find() {
  const f = useSetup();
  const tvs = f.scan.tvs;
  const bar = stepCount(f, "find");
  // Undo from a backup: the TV the backup was made on is marked, and the button says what happens.
  const from = f.fromBackup;
  const title = from ? `Which TV is ${from.tv}?` : "Find your TV";
  return (
    <Screen label={title}>
      <StepBar step={bar.step} total={bar.total} onBack={back} />
      <Rise className="mt-[22px] flex flex-col gap-2">
        <Title>{title}</Title>
        {from && (
          <Lead>
            Choose the TV to put back. When the backup was made it was at <span className="tabular text-haze">{from.address}</span>.
          </Lead>
        )}
        <div className="flex min-h-6 items-center gap-2 text-[15px] text-mist" aria-live="polite">
          {f.scan.busy ? (
            <>
              <span className="h-2 w-2 rounded-full bg-cyan" style={{ animation: "setup-blink 1.6s ease-in-out infinite" }} />
              <span>Looking on this Wi-Fi</span>
            </>
          ) : (
            <>
              <span>{tvs.length ? (tvs.length === 1 ? "Found one TV" : `Found ${tvs.length} TVs`) : "No TV found yet"}</span>
              <button type="button" onClick={rescan} className="-my-2.5 min-h-11 px-2 font-medium text-ice">
                Look again
              </button>
            </>
          )}
        </div>
        {!tvs.length && f.scan.error && (
          <p role="alert" className="text-[13px] leading-snug text-rose">
            Orbit could not look on this Wi-Fi. {f.scan.error}
          </p>
        )}
      </Rise>

      <Rise className="relative flex shrink-0 items-center justify-center" style={{ height: "clamp(170px, 30vh, 270px)" }} aria-hidden="true">
        <div className="relative aspect-square h-full max-h-[240px]">
          {[0, 0.9, 1.8].map((delay, i) => (
            <span
              key={delay}
              className="absolute inset-0 rounded-full border-[1.5px]"
              style={{
                borderColor: ["rgba(116,209,255,0.55)", "rgba(173,198,255,0.5)", "rgba(233,179,255,0.45)"][i],
                animation: `setup-pulse 2.7s ease-out ${delay}s infinite`,
                opacity: f.scan.busy ? undefined : 0,
                animationPlayState: f.scan.busy ? "running" : "paused",
              }}
            />
          ))}
          <span className="absolute inset-[15%] rounded-full border border-dashed border-white/8" />
          <span className="absolute top-1/2 left-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-ice/35 bg-night-tile">
            <I.Phone size={26} className="text-ice" />
          </span>
          <AnimatePresence>
            {tvs.slice(0, CHIP_SPOTS.length).map((tv, i) => (
              <motion.span
                key={tv.address}
                className="absolute flex max-w-[150px] items-center gap-1.5 rounded-[14px] border border-cyan/40 bg-cyan/14 py-1.5 pr-2.5 pl-2 text-[12px] whitespace-nowrap text-[#cdebff]"
                style={CHIP_SPOTS[i]}
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={{ type: "spring", stiffness: 420, damping: 26 }}
              >
                <I.Tv size={14} className="shrink-0 text-cyan" />
                <span className="truncate">{tv.name}</span>
              </motion.span>
            ))}
          </AnimatePresence>
        </div>
      </Rise>

      {tvs.length > 0 && (
        <Rise>
          <SectionLabel>Found on this Wi-Fi</SectionLabel>
          <ul className="mt-3 flex flex-col gap-3">
            {tvs.map((tv) => (
              <motion.li
                key={tv.address}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease }}
                className="flex items-center gap-3.5 rounded-[20px] border border-cyan/35 bg-white/5 p-4"
              >
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[14px] bg-night-tile text-cyan">
                  <I.Tv size={24} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
                  <span className="truncate text-[17px] font-semibold">{tv.name === "TV" ? "Your TV" : tv.name}</span>
                  <span className="tabular truncate text-[13px] text-mist">{modelLine(tv, tvs)}</span>
                  {from && tv.address === from.address ? (
                    <span className="flex items-center gap-1.5 text-[12.5px] text-cyan">
                      <I.CloudDown size={13} className="shrink-0" /> Where the backup was made
                    </span>
                  ) : (
                    tv.orbit && (
                      <span className="flex items-center gap-1.5 text-[12.5px] text-dusk">
                        <I.Planet size={13} className="shrink-0" /> Orbit OS is on it
                      </span>
                    )
                  )}
                </span>
                <motion.button
                  type="button"
                  aria-label={`${from ? "Put back" : "Set up"} ${tv.name === "TV" ? "this TV" : tv.name}`}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => chooseTv(tv)}
                  className="h-11 shrink-0 rounded-[14px] bg-cyan px-[18px] text-[15px] font-semibold text-deep"
                >
                  This one
                </motion.button>
              </motion.li>
            ))}
          </ul>
        </Rise>
      )}

      <Rise className="mt-auto pt-5">
        <NotListed />
      </Rise>
    </Screen>
  );
}

function NotListed() {
  const [typing, setTyping] = useState(false);
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1.5 rounded-[18px] bg-white/[0.03] p-4">
      <span className="text-[15px] font-medium text-haze">Not listed?</span>
      <span className="text-[14px] leading-[1.45] text-mist">
        Turn the TV on and check it uses the same Wi-Fi. A TV on a cable can still be found if it is on the same router.
      </span>
      <AnimatePresence initial={false} mode="wait">
        {typing ? (
          <motion.form
            key="form"
            className="mt-2 flex flex-col gap-2"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.3, ease }}
            onSubmit={(e) => {
              e.preventDefault();
              setError(chooseAddress(address));
            }}
          >
            <label htmlFor="setup-address" className="text-[13px] text-dusk">
              On the TV: Settings › Network & Internet, then your Wi-Fi
            </label>
            <div className="flex gap-2">
              <input
                id="setup-address"
                autoFocus
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setError(null);
                }}
                placeholder="192.168.1.20"
                inputMode="decimal"
                autoComplete="off"
                aria-invalid={!!error}
                className="tabular h-12 min-w-0 flex-1 rounded-[14px] border border-white/14 bg-white/5 px-4 text-[16px] text-snow placeholder:text-slate focus:border-cyan focus:shadow-[0_0_0_3px_rgba(116,209,255,0.18)] focus:outline-none"
              />
              <button type="submit" disabled={!address.trim()} className="h-12 shrink-0 rounded-[14px] bg-cyan px-4 text-[15px] font-semibold text-deep disabled:opacity-45">
                Use it
              </button>
            </div>
            {error && (
              <span role="alert" className="text-[13px] leading-snug text-rose">
                {error}
              </span>
            )}
          </motion.form>
        ) : (
          <motion.div key="link" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button type="button" onClick={() => setTyping(true)} className="mt-1 min-h-11 self-start text-[15px] font-medium text-ice">
              Type the TV's address
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---- 3. developer mode ----

/** Once more after a setup: Developer options are already there, only USB debugging needs turning on. */
const isAgain = (f: Flow) => f.mode !== "install" || !!f.tv?.orbit;

function DevMode() {
  const f = useSetup();
  const again = isAgain(f);
  const bar = stepCount(f, "devmode");
  const name = tvName(f);
  return (
    <Screen label={again ? "Turn on USB debugging" : "Turn on developer mode"}>
      <StepBar step={bar.step} total={bar.total} onBack={back} />
      <Rise className="mt-[22px] flex flex-col gap-2">
        <Title>{again ? "Turn on USB debugging" : "Turn on developer mode"}</Title>
        <Lead>
          {again
            ? "Orbit needs the same door it used to set the TV up. Do this with the remote; Orbit moves on as soon as it sees the change."
            : "Android keeps this switch on the TV itself. Do these steps with the remote; Orbit moves on as soon as it sees the change."}
        </Lead>
      </Rise>
      <Rise className="mt-5">{again ? <DebugArt /> : <AboutArt name={f.tv && !f.tv.manual && name !== "your TV" ? name : null} />}</Rise>
      <Rise className="mt-[18px] flex flex-col gap-3.5">
        {again ? (
          <>
            <NumberedStep n={1}>
              Open <b className="font-semibold text-snow">Settings › System › Developer options</b>
            </NumberedStep>
            <NumberedStep n={2}>
              Turn on <b className="font-semibold text-snow">USB debugging</b>
            </NumberedStep>
            <p className="pl-[42px] text-[13px] leading-snug text-dusk">
              No Developer options? Open System › About and press OK seven times on Android TV OS build.
            </p>
          </>
        ) : (
          <>
            <NumberedStep n={1}>
              Open <b className="font-semibold text-snow">Settings › System › About</b>
            </NumberedStep>
            <NumberedStep n={2}>
              Select <b className="font-semibold text-snow">Android TV OS build</b> and press OK seven times
            </NumberedStep>
            <NumberedStep n={3}>
              Back in <b className="font-semibold text-snow">System › Developer options</b>, turn on <b className="font-semibold text-snow">USB debugging</b>
            </NumberedStep>
          </>
        )}
      </Rise>
      <Rise className="mt-auto flex flex-col gap-2 pt-5">
        <div className="setup-card flex min-h-[64px] items-center gap-3 rounded-[18px] px-4 py-2.5" aria-live="polite">
          {f.probe.open && !f.probe.busy ? <DoneMark size={22} /> : <Spinner size={20} />}
          <span className="flex-1 text-[14px] text-haze">
            {f.probe.busy ? "Looking for it" : f.probe.open ? "USB debugging is on" : again ? "Waiting for USB debugging" : "Waiting for developer mode"}
          </span>
          <button type="button" onClick={itsOn} disabled={f.probe.busy} className="h-11 shrink-0 px-1 text-[15px] font-semibold text-ice disabled:opacity-45">
            {f.probe.open ? "Continue" : "It's on"}
          </button>
        </div>
        {f.probe.note && (
          <p role="alert" className="px-1 text-[13px] leading-snug text-rose">
            {f.probe.note}
          </p>
        )}
      </Rise>
    </Screen>
  );
}

/** The TV's About page, with the build row pressed seven times over and over, and Android's countdown. */
function AboutArt({ name }: { name: string | null }) {
  const still = useReducedMotion();
  const [presses, setPresses] = useState(4);
  useEffect(() => {
    if (still) return;
    let n = 0;
    const t = window.setInterval(() => {
      n = n >= 10 ? 0 : n + 1;
      setPresses(Math.min(7, n));
    }, 620);
    return () => window.clearInterval(t);
  }, [still]);
  const left = 7 - presses;
  const toast = presses >= 7 ? "You are now a developer!" : presses >= 3 ? `You are now ${left} ${left === 1 ? "step" : "steps"} away from being a developer.` : null;
  return (
    <div aria-hidden="true">
      <TvPicture place="Settings › System" title="About">
        <div className="mt-2.5 flex flex-col gap-1">
          <ArtRow label="Device name" value={name ?? <ArtBar />} />
          <ArtRow label="Android TV OS version" value={<ArtBar width={20} />} />
          <motion.div
            key={presses}
            className="flex items-center justify-between rounded-[10px] bg-snow px-2.5 py-2 text-[11px] font-semibold text-[#0a0f22] shadow-[0_0_0_3px_rgba(116,209,255,0.45)]"
            initial={still || presses === 0 ? false : { scale: 0.97, boxShadow: "0 0 0 6px rgba(116,209,255,0.7)" }}
            animate={{ scale: 1, boxShadow: "0 0 0 3px rgba(116,209,255,0.45)" }}
            transition={{ duration: 0.35 }}
          >
            <span>Android TV OS build</span>
            <span className="h-2 w-24 rounded-full bg-[#0a0f22]/20" />
          </motion.div>
        </div>
        <AnimatePresence>
          {toast && (
            <motion.div
              key={toast}
              className="absolute bottom-3 left-1/2 rounded-xl bg-[rgba(40,46,66,0.95)] px-3 py-[7px] text-[10.5px] whitespace-nowrap text-snow"
              initial={{ opacity: 0, y: 6, x: "-50%" }}
              animate={{ opacity: 1, y: 0, x: "-50%" }}
              exit={{ opacity: 0, x: "-50%" }}
              transition={{ duration: 0.2 }}
            >
              {toast}
            </motion.div>
          )}
        </AnimatePresence>
      </TvPicture>
      <div className="mt-2.5 flex items-center justify-center gap-2">
        {Array.from({ length: 7 }, (_, i) => (
          <span key={i} className={`h-[9px] w-[9px] rounded-full transition-colors duration-200 ${i < presses ? "bg-cyan" : "border-[1.5px] border-ice/50"}`} />
        ))}
        <span className="ml-1.5 text-[13px] text-mist">Seven presses of OK</span>
      </div>
    </div>
  );
}

/** The TV's Developer options, with USB debugging switching on. */
function DebugArt() {
  const still = useReducedMotion();
  const [on, setOn] = useState(true);
  useEffect(() => {
    if (still) return;
    const t = window.setInterval(() => setOn((v) => !v), 1600);
    return () => window.clearInterval(t);
  }, [still]);
  return (
    <div aria-hidden="true">
      <TvPicture place="Settings › System" title="Developer options">
        <div className="mt-2.5 flex flex-col gap-1">
          <ArtRow label="Stay awake" value={<ArtSwitch on={false} />} />
          <div className="flex items-center justify-between rounded-[10px] bg-snow px-2.5 py-2 text-[11px] font-semibold text-[#0a0f22] shadow-[0_0_0_3px_rgba(116,209,255,0.45)]">
            <span>USB debugging</span>
            <ArtSwitch on={on} dark />
          </div>
          <ArtRow label="Wireless debugging" value={<ArtSwitch on={false} />} />
        </div>
      </TvPicture>
    </div>
  );
}

/** A value the picture does not spell out (it is the TV's own). */
const ArtBar = ({ width = 56 }: { width?: number }) => <span className="inline-block h-1.5 rounded-full bg-white/15 align-middle" style={{ width }} />;

function ArtSwitch({ on, dark }: { on: boolean; dark?: boolean }) {
  return (
    <span className={`relative inline-block h-3.5 w-6 rounded-full transition-colors duration-300 ${on ? "bg-cyan" : dark ? "bg-[#0a0f22]/25" : "bg-white/20"}`}>
      <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-[left] duration-300 ${on ? "left-[12px]" : "left-0.5"}`} />
    </span>
  );
}

function TvPicture({ place, title, children, height = 194 }: { place: string; title: string; children: React.ReactNode; height?: number }) {
  return (
    <div className="relative flex flex-col overflow-hidden rounded-2xl border border-white/12 bg-night-screen px-4 pt-4" style={{ height }}>
      <span className="text-[10px] tracking-[0.6px] text-dusk uppercase">On your TV · {place}</span>
      <span className="mt-1 text-[17px] font-semibold">{title}</span>
      {children}
    </div>
  );
}

function ArtRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-2.5 py-1.5 text-[11px] text-mist">
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

// ---- 4. allow ----

/** What the open connection is for, once Allow was pressed. */
const ALLOWED: Record<Flow["mode"], string> = {
  install: "Orbit can set it up now",
  undo: "Orbit can put it back now",
  switch: "Orbit can switch the home screen now",
  backup: "Orbit can read the TV for the backup now",
  backups: "Orbit can put it back now",
  account: "Orbit is connected to the TV",
};

function Allow() {
  const f = useSetup();
  const c = f.conn;
  const bar = stepCount(f, "allow");
  const name = tvName(f);
  const model = modelName(f);
  return (
    <Screen label="Press Allow on the TV">
      <StepBar step={bar.step} total={bar.total} onBack={back} />
      <Rise className="mt-[22px] flex flex-col gap-2">
        <Title>Press Allow on the TV</Title>
        <Lead>
          {f.mode === "install"
            ? "The TV is asking whether this phone may set it up. It is Android's own question, and it is asked only once."
            : "If the TV asks whether this phone may connect, allow it. It is Android's own question; a TV that was told to always allow this phone does not ask."}
        </Lead>
      </Rise>
      <Rise className="mt-5">
        <AllowArt done={c.state === "connected"} />
      </Rise>
      <Rise className="mt-5 flex flex-col gap-3.5">
        <NumberedStep n={1}>
          Tick <b className="font-semibold text-snow">Always allow</b>, so Orbit can put things back later without asking again
        </NumberedStep>
        <NumberedStep n={2}>
          Move to <b className="font-semibold text-snow">Allow</b> and press OK on the remote
        </NumberedStep>
      </Rise>
      <Rise className="mt-auto flex flex-col gap-3.5 pt-5">
        <AnimatePresence mode="wait" initial={false}>
          {c.state === "connected" ? (
            <motion.div key="ok" className="flex flex-col gap-3.5" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease }}>
              <div className="flex items-center gap-3 rounded-[18px] border border-sage/35 bg-sage/8 px-4 py-3.5" role="status">
                <DoneMark size={30} />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-[15px] font-semibold">Connected to {name === "your TV" ? model ?? "the TV" : name}</span>
                  <span className="text-[13px] text-mist">{ALLOWED[f.mode]}</span>
                </div>
              </div>
              {f.read.state === "failed" && !f.continuing && <Trouble title={f.read.error ?? "Orbit could not read the TV."} />}
              <Primary onPress={continueFromAllow} busy={f.continuing}>
                {f.continuing ? "Reading the TV" : f.read.state === "failed" ? "Try again" : "Continue"}
              </Primary>
            </motion.div>
          ) : c.state === "failed" ? (
            <motion.div key="failed" className="flex flex-col gap-3.5" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease }}>
              <Trouble title={c.error ?? "The TV did not open the connection."} />
              <Primary onPress={retryConnect}>Try again</Primary>
            </motion.div>
          ) : (
            <motion.div key="wait" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="setup-card flex min-h-[64px] items-center gap-3 rounded-[18px] px-4 py-2.5" role="status">
                <Spinner size={20} />
                <span className="flex-1 text-[14px] text-haze">
                  {c.state === "waiting" ? "Waiting for Allow on the TV" : `Connecting to ${name === "your TV" ? "the TV" : name}`}
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </Rise>
    </Screen>
  );
}

/** Android's own question, drawn as the TV shows it (the fingerprint left out: it is this phone's, not a sample's). */
function AllowArt({ done }: { done: boolean }) {
  return (
    <div className="relative flex h-[210px] items-center justify-center overflow-hidden rounded-2xl border border-white/12 bg-night-screen" aria-hidden="true">
      <div className="absolute inset-0 bg-black/55" />
      <motion.div
        className="relative flex w-[286px] max-w-[88%] flex-col gap-2 rounded-xl bg-[#2b2f3a] px-4 pt-4 pb-3.5 shadow-[0_18px_40px_rgba(0,0,0,0.5)]"
        animate={{ opacity: done ? 0.35 : 1, scale: done ? 0.96 : 1 }}
        transition={{ duration: 0.4, ease }}
      >
        <span className="text-[14px] font-semibold">Allow USB debugging?</span>
        <span className="text-[10.5px] leading-[1.45] text-[#c3c9d9]">The computer's RSA key fingerprint is:</span>
        <span className="flex gap-1">
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className="h-1.5 w-5 rounded-full bg-[#c3c9d9]/25" />
          ))}
        </span>
        <div className="-mx-2 mt-0.5 flex items-center gap-2 rounded-lg px-2 py-1.5 shadow-[inset_0_0_0_2px_rgba(116,209,255,0.7)]">
          <span className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] bg-cyan text-deep">
            <I.Check size={10} strokeWidth={3.4} />
          </span>
          <span className="text-[11px] text-snow">Always allow from this computer</span>
        </div>
        <div className="mt-1 flex justify-end gap-1.5">
          <span className="rounded-lg px-3 py-1.5 text-[11px] font-semibold text-[#c3c9d9]">Cancel</span>
          <span className="rounded-lg bg-snow px-3.5 py-1.5 text-[11px] font-semibold text-[#0a0f22]">Allow</span>
        </div>
      </motion.div>
      <AnimatePresence>
        {done && (
          <motion.span className="absolute" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 380, damping: 22 }}>
            <span className="grid h-16 w-16 place-items-center rounded-full bg-sage/20 text-sage backdrop-blur">
              <I.Check size={34} strokeWidth={2.4} />
            </span>
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
