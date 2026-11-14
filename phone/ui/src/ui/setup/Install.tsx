// Orbit Setup once the person said "Set up my TV": the run on the TV, a setup that stopped, the name and the account,
// and Ready.
import { AnimatePresence, animate, motion, useMotionValue, useTransform } from "framer-motion";
import { useEffect, useState } from "react";
import {
  NAME_MAX,
  back,
  closeSetup,
  continueFromInstall,
  finishName,
  openRemote,
  setCloseDev,
  setName,
  signIn,
  skipName,
  tryAgain,
  tvName,
  undoHere,
  useSetup,
  type Flow,
} from "../../setup/flow";
import { installRows, whatStopped, type Row } from "../../setup/lines";
import { disabledByRecord } from "../../setup/plan";
import { LINKS, openLink } from "../../links";
import { cloudOn, signedInWith, waysWords } from "../../signin";
import { useWorld } from "../../store";
import * as I from "../icons";
import { SetupSignIn } from "../SignIn";
import { BackupCard } from "./Backup";
import { Brand, Card, DoneMark, Lead, Primary, Quiet, Rise, Screen, SectionLabel, Spinner, StepBar, Switch, TextButton, Title, ease } from "./parts";

/** The clock, once every `ms` while `on`: for "about a minute left". */
function useNow(ms: number, on = true) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms, on]);
  return now;
}

/** How far a run has come: the files on their way are the first few per cent, then the script's own count. */
export function runPercent(f: Flow): number {
  if (f.run.done?.ok) return 100;
  const started = f.run.order.length > 0 || f.run.progress > 0;
  return started ? Math.max(4, f.run.progress) : Math.round(f.pushed * 4);
}

function timeLeft(f: Flow, now: number): string {
  if (f.run.done?.ok) return "done";
  if (f.pushed < 1) return "sending Orbit to the TV";
  const p = f.run.progress;
  const spent = now - f.runStarted;
  if (p < 8 || spent < 5000) return "starting";
  const left = (spent * (100 - p)) / p;
  if (left < 40_000) return "less than a minute left";
  if (left < 90_000) return "about a minute left";
  return `about ${Math.round(left / 60_000)} minutes left`;
}

/** The ring of the canvas: a 10 px track and the setup's ribbon going round it. */
export function Ring({ value, sub }: { value: number; sub: string }) {
  const r = 92;
  const around = 2 * Math.PI * r;
  const shown = useMotionValue(value);
  const text = useTransform(shown, (v) => `${Math.round(v)}%`);
  useEffect(() => {
    const a = animate(shown, value, { duration: 0.7, ease });
    return () => a.stop();
  }, [value, shown]);
  return (
    <div className="relative grid aspect-square h-full max-h-[210px] place-items-center" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value)} aria-valuetext={`${Math.round(value)}%, ${sub}`}>
      <svg viewBox="0 0 210 210" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <linearGradient id="setup-progress" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#74D1FF" />
            <stop offset="0.55" stopColor="#ADC6FF" />
            <stop offset="1" stopColor="#E9B3FF" />
          </linearGradient>
        </defs>
        <circle cx="105" cy="105" r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
        <motion.circle
          cx="105"
          cy="105"
          r={r}
          fill="none"
          stroke="url(#setup-progress)"
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={around}
          initial={false}
          animate={{ strokeDashoffset: around * (1 - Math.max(0.5, value) / 100) }}
          transition={{ duration: 0.7, ease }}
          transform="rotate(-90 105 105)"
        />
      </svg>
      <div className="relative flex flex-col items-center gap-0.5">
        <motion.span className="tabular font-display text-[46px] font-medium tracking-[-1px]">{text}</motion.span>
        <span className="text-[13px] text-mist">{sub}</span>
      </div>
    </div>
  );
}

export function StepRow({ row }: { row: Row }) {
  return (
    <motion.div layout="position" className="flex min-h-10 items-center gap-3 py-1">
      <span className="grid h-5 w-5 shrink-0 place-items-center">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span key={row.state} className="grid place-items-center" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={{ duration: 0.2 }}>
            {row.state === "done" ? (
              <I.Check size={20} strokeWidth={2.4} className="text-sage" />
            ) : row.state === "skipped" ? (
              <I.Check size={18} strokeWidth={2} className="text-dusk" />
            ) : row.state === "active" ? (
              <Spinner size={16} />
            ) : row.state === "fail" ? (
              <I.Alert size={20} className="text-rose" />
            ) : (
              <span className="block h-3 w-3 rounded-full border-[1.6px] border-ice/40" />
            )}
          </motion.span>
        </AnimatePresence>
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={`block text-[15px] leading-snug ${
            row.state === "active" || row.state === "fail" ? "font-semibold text-snow" : row.state === "done" ? "text-mist" : "text-dusk"
          }`}
        >
          {row.text}
        </span>
        {row.detail && <span className="mt-0.5 block text-[12.5px] leading-snug text-mist">The TV said: {row.detail}</span>}
      </span>
    </motion.div>
  );
}

// ---- 6. installing ----

export function Installing() {
  const f = useSetup();
  const now = useNow(1000, !f.run.done);
  const rows = installRows(f.run, f.disableCount);
  const done = f.run.done?.ok === true;
  const trouble = done ? rows.filter((r) => r.state === "fail") : [];
  const name = tvName(f);
  return (
    <Screen label={`Setting up ${name}`}>
      <StepBar step={6} />
      <Rise className="mt-[26px] flex shrink-0 items-center justify-center" style={{ height: "clamp(160px, 27vh, 230px)" }}>
        <Ring value={runPercent(f)} sub={timeLeft(f, now)} />
      </Rise>
      <Rise className="mt-2.5 flex flex-col items-center gap-1.5 text-center">
        <Title size={26} className="tracking-[-0.4px]">
          {done ? `${name === "your TV" ? "Your TV" : name} is set up` : `Setting up ${name}`}
        </Title>
        <Lead>{done ? "Orbit OS is on the TV." : "Keep the TV on and this app open."}</Lead>
      </Rise>
      <Rise className="mt-[22px]">
        <Card className="flex flex-col gap-1 px-4 py-2.5" aria-live="polite">
          {rows.map((r) => (
            <StepRow key={r.key} row={r} />
          ))}
        </Card>
      </Rise>
      {trouble.length > 0 && (
        <Rise className="mt-3">
          <p className="rounded-[16px] bg-white/[0.035] px-4 py-3 text-[13.5px] leading-snug text-mist">
            {trouble.length === 1 ? "One thing did not work. " : "A few things did not work. "}
            The rest of Orbit OS works, and setting it up again later tries {trouble.length === 1 ? "it" : "them"} once more.
          </p>
        </Rise>
      )}
      <Rise className="mt-auto flex flex-col gap-2 pt-5">
        <Quiet onPress={continueFromInstall} disabled={!done}>
          Continue
        </Quiet>
        <span className="text-center text-[13px] text-dusk">{done ? (trouble.length ? "Continue when you are ready" : "Moving on") : "Orbit moves on by itself when the TV is ready"}</span>
      </Rise>
    </Screen>
  );
}

// ---- a setup that stopped ----

export function Failed() {
  const f = useSetup();
  const name = tvName(f);
  const stopped = whatStopped(f.run, "install", f.disableCount);
  const switchedOff = disabledByRecord(f.run.undo).length;
  const canPutBack = !f.runError && (f.run.undo.length > 0 || !!f.record);
  return (
    <Screen label="Setup stopped">
      <StepBar step={6} onBack={back} />
      <Rise className="mt-[30px]">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-ice/12 text-ice">
          <I.Alert size={28} />
        </span>
      </Rise>
      <Rise className="mt-[18px] flex flex-col gap-2.5">
        <Title>Setup stopped</Title>
        <Lead>
          {f.runError
            ? "The connection to the TV closed before the setup finished. Nothing is broken."
            : `Nothing is broken: ${name === "your TV" ? "the TV" : name} still has its own home screen.`}
          {!f.runError && switchedOff > 0 ? " Some apps were already switched off; Put back what changed switches them on again." : ""}
        </Lead>
      </Rise>
      <Rise className="mt-5">
        <Card className="p-4">
          <SectionLabel>What stopped</SectionLabel>
          <p className="mt-2 text-[15px] leading-snug text-snow">{f.runError ?? stopped.text}</p>
          {!f.runError && stopped.detail && <p className="mt-1 text-[13px] leading-snug text-mist">The TV said: {stopped.detail}</p>}
        </Card>
      </Rise>
      <Rise className="mt-auto flex flex-col gap-2.5 pt-6">
        <Primary onPress={tryAgain}>{f.runError ? "Connect and try again" : "Try again"}</Primary>
        {canPutBack && <Quiet onPress={undoHere}>Put back what changed</Quiet>}
        <TextButton tone="mist" onPress={closeSetup}>
          Close
        </TextButton>
      </Rise>
    </Screen>
  );
}

// ---- 7. your name and account ----

/** Orbit Home's own greeting, as the TV writes it at this hour. */
export function tvGreeting(now: Date, name: string): { title: string; line: string } {
  const h = now.getHours();
  const [title, line] =
    h >= 5 && h < 12
      ? ["Good Morning", "Hello, I wish you a wonderful day"]
      : h >= 12 && h < 17
        ? ["Good Afternoon", "Hello, I wish you a wonderful day"]
        : h >= 17 && h < 22
          ? ["Good Evening", "Hello, I wish you a relaxing evening"]
          : ["Good Night", "Hello, I wish you a peaceful night"];
  return { title: name ? `${title}, ${name}` : title, line };
}

export function You() {
  const f = useSetup();
  const { account, phone } = useWorld();
  // A build of the app without the cloud has no account to offer here: the step is the name alone.
  const withCloud = cloudOn(account, phone);
  const greeting = tvGreeting(new Date(), f.name.trim());
  const privacy = (
    <TextButton className="-ml-3 flex items-center gap-1.5 self-start text-[13.5px]" onPress={() => openLink(LINKS.privacy)}>
      Privacy policy <I.External size={14} />
    </TextButton>
  );
  return (
    <Screen label={withCloud ? "Your name and account" : "Your name"}>
      <StepBar step={7} />
      <Rise className="mt-5 flex flex-col gap-2">
        <Title>Make it yours</Title>
        <Lead>
          {withCloud ? "Your TV greets you by name, and your account lets this phone reach the TV from anywhere." : "Your TV greets you by name."}
        </Lead>
      </Rise>
      <Rise className="mt-[18px]">
        <div className="relative flex h-[122px] flex-col items-center justify-center gap-1.5 overflow-hidden rounded-2xl border border-white/12 bg-night-screen px-4" aria-label={`On your TV: ${greeting.title}`}>
          <div
            className="absolute -bottom-[70px] left-1/2 h-[120px] w-[260px] -translate-x-1/2 rounded-full"
            style={{ background: "radial-gradient(closest-side, rgba(233,179,255,0.22), rgba(5,7,13,0))" }}
          />
          <span className="absolute top-2.5 left-3 text-[10px] tracking-[0.6px] text-slate uppercase">On your TV</span>
          <span className="relative max-w-full truncate font-display text-[25px] font-light tracking-[-0.3px]">{greeting.title}</span>
          <span className="relative text-[11.5px] text-mist">{greeting.line}</span>
        </div>
      </Rise>
      <Rise className="mt-[22px] flex flex-col gap-2">
        <label htmlFor="setup-name" className="text-[14px] font-semibold text-haze">
          Your name
        </label>
        <input
          id="setup-name"
          type="text"
          value={f.name}
          maxLength={NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && finishName()}
          placeholder="What should the TV call you?"
          autoComplete="given-name"
          enterKeyHint="done"
          className="h-[52px] rounded-[14px] border border-white/14 bg-white/5 px-4 text-[16px] text-snow placeholder:text-slate focus:border-cyan focus:shadow-[0_0_0_3px_rgba(116,209,255,0.18)] focus:outline-none"
        />
      </Rise>
      {withCloud ? (
        <Rise className="mt-[22px] flex flex-col gap-2">
          <span className="text-[14px] font-semibold text-haze">Your account</span>
          {account.signedIn ? (
            <div className="setup-card flex min-h-[52px] items-center gap-3 rounded-[16px] px-4 py-2.5">
              <DoneMark size={26} />
              <span className="min-w-0 flex-1 text-[14px] text-haze">
                {signedInWith(account)} as <span className="break-all text-snow">{account.email}</span>
              </span>
            </div>
          ) : (
            <SetupSignIn
              ways={phone.signIn}
              busy={f.signingIn}
              onPress={signIn}
              size="h-[52px] rounded-[16px] text-[16px] font-semibold"
              alone={{ className: "border border-white/14 bg-white/6 text-snow", dark: false }}
            />
          )}
          {f.signInError ? (
            <p role="alert" className="text-[13px] leading-snug text-rose">
              {f.signInError}
            </p>
          ) : (
            !account.signedIn && (
              <p className="text-[13px] leading-snug text-dusk">
                {waysWords(phone.signIn)} gives Orbit your email, so there is nothing to type. You can also do it later in Settings.
              </p>
            )
          )}
          {privacy}
        </Rise>
      ) : (
        <Rise className="mt-2 flex flex-col">{privacy}</Rise>
      )}
      <Rise className="mt-auto flex flex-col gap-2 pt-6">
        <Primary onPress={finishName} busy={f.nameBusy}>
          {f.nameBusy ? "Sending your name" : "Finish"}
        </Primary>
        {f.nameError ? (
          <>
            <p role="alert" className="text-center text-[13px] leading-snug text-rose">
              {f.nameError}
            </p>
            <TextButton onPress={skipName}>Finish without the name</TextButton>
          </>
        ) : (
          <span className="text-center text-[13px] text-dusk">Your name stays on your TV</span>
        )}
      </Rise>
    </Screen>
  );
}

// ---- 8. ready ----

export function Ready() {
  const f = useSetup();
  const { account, status } = useWorld();
  const name = tvName(f);
  const shown = name === "your TV" ? "Your TV" : name;
  const linked = account.tvLinked;
  return (
    <Screen label="Your TV is ready" top={28}>
      <Brand
        aside={
          <span className="flex min-w-0 items-center gap-1.5 rounded-xl border border-sage/30 bg-sage/10 px-2.5 py-1.5 text-[12.5px] text-[#bff1db]">
            <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-sage" />
            <span className="truncate">
              {shown} · {linked ? "linked" : status.state === "connected" ? "connected" : "set up"}
            </span>
          </span>
        }
      />
      <Rise className="mt-[26px]">
        <HomePreview name={f.name.trim()} />
      </Rise>
      <Rise className="mt-6 flex flex-col gap-2">
        <Title size={32} className="tracking-[-0.6px]">
          Your TV is ready
        </Title>
        <Lead>
          Orbit OS is on {shown === "Your TV" ? "your TV" : shown}, and this phone is its remote{linked ? ", at home or away" : ""}.
        </Lead>
      </Rise>
      <Rise className="mt-5">
        <Card className="flex items-center gap-3.5 rounded-[18px] p-4">
          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <span className="text-[15px] font-semibold">Close developer mode</span>
            <span className="text-[13px] leading-[1.4] text-mist">Recommended. Orbit keeps working; this shuts the door the setup used.</span>
          </div>
          <Switch on={f.closeDev} onChange={setCloseDev} label="Close developer mode" />
        </Card>
      </Rise>
      <Rise className="mt-3">
        <BackupCard />
      </Rise>
      <Rise className="mt-3.5 flex flex-col gap-2.5 px-1 pt-1">
        <div className="flex items-start gap-3">
          <I.Gear size={20} className="mt-px shrink-0 text-ice" />
          <span className="text-[14px] leading-[1.45] text-haze">The remote's Settings button opens the Control Center</span>
        </div>
        <div className="flex items-start gap-3">
          <I.Channels size={20} className="mt-px shrink-0 text-lilac" />
          <span className="text-[14px] leading-[1.45] text-haze">Live TV is the first tile on Home</span>
        </div>
      </Rise>
      <Rise className="mt-auto flex flex-col gap-1.5 pt-6">
        <Primary onPress={openRemote} busy={f.closing}>
          Open the remote
        </Primary>
        <TextButton tone="mist" onPress={undoHere} disabled={f.closing}>
          Undo everything on this TV
        </TextButton>
      </Rise>
    </Screen>
  );
}

const TILES: { label: string; tint: [string, string] }[] = [
  // Neutral names: this preview is in store screenshots and the demo, so no other company's apps are on it.
  { label: "Live TV", tint: ["#b86bff", "#2a0b52"] },
  { label: "Movies", tint: ["#ff5a4e", "#5a0f12"] },
  { label: "Music", tint: ["#1ed7a0", "#063426"] },
  { label: "News", tint: ["#1aa3ff", "#062a52"] },
  { label: "Photos", tint: ["#f2c14e", "#3d2a06"] },
  { label: "Apps", tint: ["#34a853", "#0b2f19"] },
];

/** Orbit Home as the TV now shows it: the greeting over the curved row, Live TV first. */
function HomePreview({ name }: { name: string }) {
  const greeting = tvGreeting(new Date(), name);
  const focus = 1;
  return (
    <div className="rounded-[18px] border border-white/10 bg-[#11141f] p-[7px]" role="img" aria-label="Orbit Home on the TV: a curved row of apps under a greeting">
      <div className="relative h-[182px] overflow-hidden rounded-[12px]" style={{ containerType: "inline-size", background: "radial-gradient(60% 70% at 50% 62%, #3a0d2a 0%, #12060f 55%, #030304 100%)" }}>
        <div className="absolute inset-x-0 top-[9%] truncate px-4 text-center font-display font-light text-white/90" style={{ fontSize: "6cqw" }}>
          {greeting.title}
        </div>
        <div className="absolute inset-x-0 top-[27%] text-center text-white/55" style={{ fontSize: "2.4cqw" }}>
          {greeting.line}
        </div>
        <div className="absolute inset-x-0 top-[44%] h-[34%]">
          {TILES.map((t, i) => {
            const d = i - focus;
            return (
              <motion.div
                key={t.label}
                className="absolute top-0 h-full overflow-hidden rounded-[1.6cqw] border border-white/15"
                style={{ width: "17%", left: "41.5%", background: `linear-gradient(135deg, ${t.tint[0]}, ${t.tint[1]})` }}
                initial={{ x: `${d * 118 + 160}%`, opacity: 0 }}
                animate={{ x: `${d * 118}%`, scale: d === 0 ? 1.16 : 1 - Math.min(0.22, Math.abs(d) * 0.07), opacity: 1 - Math.abs(d) * 0.18, rotateY: d * -14 }}
                transition={{ type: "spring", stiffness: 260, damping: 30, delay: 0.25 + i * 0.05 }}
              >
                <div className="grid h-full place-items-center px-1 text-center font-display font-medium text-white" style={{ fontSize: "2.1cqw" }}>
                  {t.label}
                </div>
              </motion.div>
            );
          })}
        </div>
        <div className="absolute inset-x-0 top-[84%] text-center font-display text-white" style={{ fontSize: "3cqw" }}>
          {TILES[focus].label}
        </div>
      </div>
    </div>
  );
}
