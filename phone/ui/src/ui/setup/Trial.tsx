// Trying Orbit on the TV for 15 minutes before setting it up (phone/SPEC.md, "Trying Orbit before setting it up"):
// Orbit Home goes on as an ordinary app, the TV's own home screen stays Home, and when the time is up the person
// chooses: set Orbit up, or take it off again. Find, Developer mode and Allow are Setup.tsx's screens.
import {
  closeSetup,
  endTrialNow,
  finishUntrial,
  removeTrial,
  setCloseDev,
  setUpAfterTrial,
  showTrialAgain,
  TRIAL_SECONDS,
  trialClock,
  tryTrialAgain,
  tvName,
  untrialAgain,
  useSetup,
  type Flow,
} from "../../setup/flow";
import { runWentWell, trialRows, untrialRows, whatStopped } from "../../setup/lines";
import * as I from "../icons";
import { Ring, StepRow, useNow } from "./Install";
import { Brand, Card, DoneMark, Lead, Primary, Quiet, Rise, Screen, SectionLabel, Switch, TextButton, Title } from "./parts";

const TrialBrand = () => <Brand aside={<span className="text-[13px] tracking-[0.3px] text-dusk">Try Orbit</span>} />;

/** "the TV" for a TV without a name of its own, else its name. */
const shownName = (f: Flow) => {
  const name = tvName(f);
  return name === "your TV" ? "the TV" : name;
};

/** How far the start of a trial has come: Orbit Home on its way (the slow part), then the script's own count. */
function trialPercent(f: Flow): number {
  if (f.run.done?.ok) return 100;
  if (f.run.progress > 0) return Math.max(30, f.run.progress);
  if (f.run.order.length) return 30;
  return Math.round(f.pushed * 28);
}

function Tip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3.5">
      <span className="mt-px shrink-0">{icon}</span>
      <span className="text-[14.5px] leading-[1.45] text-haze">{children}</span>
    </div>
  );
}

function Stopped({ title, lead, text, detail, again, close }: { title: string; lead: string; text: string; detail?: string; again: () => void; close: () => void }) {
  return (
    <Screen label={title} top={28}>
      <TrialBrand />
      <Rise className="mt-8">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-ice/12 text-ice">
          <I.Alert size={28} />
        </span>
      </Rise>
      <Rise className="mt-[18px] flex flex-col gap-2.5">
        <Title>{title}</Title>
        <Lead>{lead}</Lead>
      </Rise>
      <Rise className="mt-5">
        <Card className="p-4">
          <SectionLabel>What stopped</SectionLabel>
          <p className="mt-2 text-[15px] leading-snug text-snow">{text}</p>
          {detail && <p className="mt-1 text-[13px] leading-snug text-mist">The TV said: {detail}</p>}
        </Card>
      </Rise>
      <Rise className="mt-auto flex flex-col gap-1.5 pt-6">
        <Primary onPress={again}>Try again</Primary>
        <TextButton tone="mist" onPress={close}>
          Close
        </TextButton>
      </Rise>
    </Screen>
  );
}

/** The trial starting on the TV, then its minutes running out (or what stopped it). */
export function Trying() {
  const f = useSetup();
  if (f.trial.state === "failed") {
    const stopped = whatStopped(f.run, "trial");
    return (
      <Stopped
        title="The trial did not start"
        lead={f.runError ? "The connection to the TV closed before the trial started." : "The TV is just as it was before."}
        text={f.runError ?? stopped.text}
        detail={f.runError ? undefined : stopped.detail}
        again={tryTrialAgain}
        close={closeSetup}
      />
    );
  }
  // "over" too: the screen shows 0:00 while it slides away to the choice.
  if (f.trial.state === "on" || f.trial.state === "over") return <Running />;
  const tv = shownName(f);
  return (
    <Screen label={`Putting Orbit on ${tv}`} top={28}>
      <TrialBrand />
      <Rise className="mt-[26px] flex shrink-0 items-center justify-center" style={{ height: "clamp(160px, 27vh, 230px)" }}>
        <Ring value={trialPercent(f)} sub={f.pushed < 1 ? "sending Orbit Home" : "starting"} />
      </Rise>
      <Rise className="mt-2.5 flex flex-col items-center gap-1.5 text-center">
        <Title size={26} className="tracking-[-0.4px]">
          Putting Orbit on {tv}
        </Title>
        <Lead>Keep the TV on and this app open. Nothing on the TV is switched off.</Lead>
      </Rise>
      <Rise className="mt-[22px]">
        <Card className="flex flex-col gap-1 px-4 py-2.5" aria-live="polite">
          {trialRows(f.run).map((r) => (
            <StepRow key={r.key} row={r} />
          ))}
        </Card>
      </Rise>
    </Screen>
  );
}

function Running() {
  const f = useSetup();
  const now = useNow(1000);
  const left = Math.max(0, f.trial.endsAt - now);
  const tv = shownName(f);
  return (
    <Screen label="Orbit is on your TV" top={28}>
      <TrialBrand />
      <Rise className="mt-[26px] flex shrink-0 items-center justify-center" style={{ height: "clamp(160px, 27vh, 230px)" }}>
        <Ring value={(left / (TRIAL_SECONDS * 1000)) * 100} sub="left" label={trialClock(left)} />
      </Rise>
      <Rise className="mt-2.5 flex flex-col items-center gap-1.5 text-center">
        <Title size={26} className="tracking-[-0.4px]">
          Orbit is on {tv}
        </Title>
        <Lead>Look around with the TV's own remote. When the time is up, the TV goes back to its own home screen by itself.</Lead>
      </Rise>
      <Rise className="mt-5">
        <Card className="flex flex-col gap-3.5 p-4">
          <Tip icon={<I.Home size={21} className="text-cyan" />}>Press Home on the TV's remote to go back to the TV's own home screen at any time.</Tip>
          <Tip icon={<I.Shield size={21} className="text-mint" />}>Nothing on the TV is switched off, and none of its settings changed.</Tip>
          <Tip icon={<I.Planet size={21} className="text-lilac" />}>When the time is up, you choose here: set Orbit up, or take it off again.</Tip>
        </Card>
      </Rise>
      <Rise className="mt-auto flex flex-col gap-1.5 pt-6">
        {f.conn.state === "connected" && <Quiet onPress={showTrialAgain}>Show Orbit on the TV again</Quiet>}
        <TextButton tone="mist" onPress={endTrialNow}>
          End the trial now
        </TextButton>
      </Rise>
    </Screen>
  );
}

function Choice({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full bg-cyan shadow-[0_0_10px_rgba(116,209,255,0.7)]" />
      <span className="min-w-0">
        <span className="block text-[15px] font-semibold text-snow">{title}</span>
        <span className="mt-0.5 block text-[13.5px] leading-[1.45] text-mist">{children}</span>
      </span>
    </div>
  );
}

/** The time is up: set Orbit up, or take it off again. */
export function Tried() {
  const f = useSetup();
  const tv = shownName(f);
  return (
    <Screen label="The trial is over" top={28}>
      <TrialBrand />
      <Rise className="mt-8">
        <span
          className="grid h-14 w-14 place-items-center rounded-[20px] border border-ice/28 text-ice"
          style={{ background: "linear-gradient(145deg, rgba(116,209,255,0.18), rgba(233,179,255,0.12))" }}
        >
          <I.Planet size={28} />
        </span>
      </Rise>
      <Rise className="mt-[18px] flex flex-col gap-2.5">
        <Title>The trial is over</Title>
        <Lead>
          {tv.charAt(0).toUpperCase()}
          {tv.slice(1)} is back on its own home screen. Orbit Home stays on it as an app until you choose.
        </Lead>
      </Rise>
      <Rise className="mt-5">
        <Card className="flex flex-col gap-3.5 p-4">
          <Choice title="Set up Orbit OS">Orbit Home becomes the home screen, the apps you choose are switched off, and this phone becomes the remote. Undo puts it all back.</Choice>
          <Choice title="Remove Orbit">Orbit Home comes off the TV, and the TV is just as it was.</Choice>
        </Card>
      </Rise>
      <Rise className="mt-auto flex flex-col gap-1.5 pt-6">
        <Primary onPress={setUpAfterTrial} busy={f.continuing}>
          {f.continuing ? "Reading the TV" : "Set up Orbit OS"}
        </Primary>
        <Quiet onPress={removeTrial} disabled={f.continuing}>
          Remove Orbit from the TV
        </Quiet>
        <TextButton tone="mist" onPress={closeSetup}>
          Not now
        </TextButton>
      </Rise>
    </Screen>
  );
}

/** How far taking Orbit off has come: the undo script on its way, then its own count. */
function untrialPercent(f: Flow): number {
  if (f.run.done) return 100;
  if (f.run.progress > 0) return Math.max(24, f.run.progress);
  if (f.run.order.length) return 24;
  return Math.round(f.pushed * 20);
}

export function Removing() {
  const f = useSetup();
  const tv = shownName(f);
  return (
    <Screen label={`Taking Orbit off ${tv}`} top={28}>
      <TrialBrand />
      <Rise className="mt-[26px] flex shrink-0 items-center justify-center" style={{ height: "clamp(160px, 27vh, 230px)" }}>
        <Ring value={untrialPercent(f)} sub={f.pushed < 1 ? "sending Orbit Setup" : "taking Orbit off"} />
      </Rise>
      <Rise className="mt-2.5 flex flex-col items-center gap-1.5 text-center">
        <Title size={26} className="tracking-[-0.4px]">
          Taking Orbit off {tv}
        </Title>
        <Lead>Keep the TV on and this app open.</Lead>
      </Rise>
      <Rise className="mt-[22px]">
        <Card className="flex flex-col gap-1 px-4 py-2.5" aria-live="polite">
          {untrialRows(f.run).map((r) => (
            <StepRow key={r.key} row={r} />
          ))}
        </Card>
      </Rise>
    </Screen>
  );
}

export function Removed() {
  const f = useSetup();
  const tv = shownName(f);
  const ok = !f.runError && runWentWell(f.run);
  if (!ok) {
    const stopped = whatStopped(f.run, "untrial");
    return (
      <Stopped
        title="Taking Orbit off stopped"
        lead={f.runError ? "The connection to the TV closed before Orbit was off. The TV still has its own home screen." : "The TV still has its own home screen."}
        text={f.runError ?? stopped.text}
        detail={f.runError ? undefined : stopped.detail}
        again={untrialAgain}
        close={finishUntrial}
      />
    );
  }
  return (
    <Screen label="Orbit is off the TV" top={28}>
      <TrialBrand />
      <Rise className="mt-8">
        <DoneMark size={56} />
      </Rise>
      <Rise className="mt-[18px] flex flex-col gap-2.5">
        <Title>Orbit is off the TV</Title>
        <Lead>
          {tv.charAt(0).toUpperCase()}
          {tv.slice(1)} is just as it was before the trial. You can try Orbit again, or set it up, from this app any time.
        </Lead>
      </Rise>
      <Rise className="mt-5">
        <Card className="flex flex-col gap-1 px-4 py-2.5">
          {untrialRows(f.run).map((r) => (
            <StepRow key={r.key} row={r} />
          ))}
        </Card>
      </Rise>
      <Rise className="mt-4">
        <Card className="flex items-center gap-3.5 rounded-[18px] p-4">
          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <span className="text-[15px] font-semibold">Close developer mode</span>
            <span className="text-[13px] leading-[1.4] text-mist">Recommended. It shuts the door Orbit used.</span>
          </div>
          <Switch on={f.closeDev} onChange={setCloseDev} label="Close developer mode" />
        </Card>
      </Rise>
      <Rise className="mt-auto pt-6">
        <Primary onPress={finishUntrial} busy={f.closing}>
          Done
        </Primary>
      </Rise>
    </Screen>
  );
}
