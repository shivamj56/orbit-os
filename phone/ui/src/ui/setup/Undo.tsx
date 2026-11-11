// Undo Orbit OS on a TV: what will come back, the run of orbit-undo.sh, and how it went. Developer mode and Allow are
// the setup's own screens (Setup.tsx), shown again when the debugging connection is not open.
import { back, closeSetup, confirmUndo, finishUndo, knownUndo, setCloseDev, tvName, undoAgain, useSetup } from "../../setup/flow";
import { when } from "./Backup";
import { undoRows, whatStopped } from "../../setup/lines";
import { disabledByRecord } from "../../setup/plan";
import * as I from "../icons";
import { Ring, StepRow, runPercent } from "./Install";
import { Brand, Card, DoneMark, Lead, Primary, Rise, Screen, SectionLabel, Spinner, Switch, TextButton, Title } from "./parts";

const UndoBrand = () => <Brand aside={<span className="text-[13px] tracking-[0.3px] text-dusk">Undo</span>} />;

function ComesBack({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <I.Check size={18} strokeWidth={2.2} className="mt-0.5 shrink-0 text-sage" />
      <span className="text-[15px] leading-[1.45] text-haze">{children}</span>
    </div>
  );
}

export function UndoConfirm() {
  const f = useSetup();
  const name = tvName(f);
  const shown = name === "your TV" ? "this TV" : name;
  if (f.tv?.address === "cloud") {
    return (
      <Screen label="Undo needs the home Wi-Fi" top={28}>
        <UndoBrand />
        <Rise className="mt-10">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-ice/12 text-ice">
            <I.Wifi size={28} />
          </span>
        </Rise>
        <Rise className="mt-[18px] flex flex-col gap-2.5">
          <Title>Undo needs the home Wi-Fi</Title>
          <Lead>Orbit puts the TV back over the Wi-Fi it is on. Join this phone to the TV's Wi-Fi, then open Undo again from Settings.</Lead>
        </Rise>
        <Rise className="mt-auto pt-6">
          <Primary onPress={closeSetup}>Close</Primary>
        </Rise>
      </Screen>
    );
  }
  // This phone's record, and a backup's from Google Drive when Undo started from one.
  const lines = knownUndo(f);
  const apps = disabledByRecord(lines).length;
  const home = lines.some((l) => l.startsWith("home "));
  const removes = lines.some((l) => /^uninstall (com\.gathin\.|dev\.shiv\.orbit\.)/.test(l));
  const settings = lines.some((l) => /^(a11y|a11y_on|setting) /.test(l));
  const open = f.conn.state === "connected";
  const from = f.fromBackup;
  return (
    <Screen label="Undo Orbit OS" top={28}>
      <UndoBrand />
      <Rise className="mt-8">
        <span className="grid h-14 w-14 place-items-center rounded-[20px] border border-ice/28 text-ice" style={{ background: "linear-gradient(145deg, rgba(116,209,255,0.18), rgba(233,179,255,0.12))" }}>
          <I.Undo size={28} />
        </span>
      </Rise>
      <Rise className="mt-[18px] flex flex-col gap-2.5">
        <Title>Undo Orbit OS on {shown}</Title>
        <Lead>
          {!f.recordLoaded && !from
            ? "Looking for what Orbit changed on this TV."
            : from
              ? `Orbit puts back what it changed on this TV, from the backup of ${when(from.at)} in your Google Drive:`
              : lines.length
                ? "Orbit puts back what it changed on this TV:"
                : "This phone has no record of setting this TV up. Orbit uses the record the TV keeps of what changed."}
        </Lead>
      </Rise>
      {!f.recordLoaded ? (
        <Rise className="mt-6 flex items-center gap-3 text-[14px] text-mist">
          <Spinner size={18} /> Reading this phone's record
        </Rise>
      ) : (
        lines.length > 0 && (
          <Rise className="mt-5">
            <Card className="flex flex-col gap-3 p-4">
              {home && <ComesBack>The TV's own home screen comes back</ComesBack>}
              {apps > 0 && <ComesBack>{apps === 1 ? "The app" : `The ${apps} apps`} Orbit switched off come back on</ComesBack>}
              {settings && <ComesBack>The TV's settings go back as they were</ComesBack>}
              {removes && <ComesBack>Orbit Home and Orbit Live TV come off the TV</ComesBack>}
            </Card>
          </Rise>
        )
      )}
      {!open && f.recordLoaded && (
        <Rise className="mt-4">
          <p className="text-[13.5px] leading-snug text-dusk">The TV's USB debugging has to be on for this. The next screen shows how.</p>
        </Rise>
      )}
      <Rise className="mt-auto flex flex-col gap-1.5 pt-6">
        <Primary onPress={confirmUndo} disabled={!f.recordLoaded}>
          Undo everything
        </Primary>
        <TextButton tone="mist" onPress={back}>
          Not now
        </TextButton>
      </Rise>
    </Screen>
  );
}

export function Undoing() {
  const f = useSetup();
  const name = tvName(f);
  return (
    <Screen label={`Putting ${name} back`} top={28}>
      <UndoBrand />
      <Rise className="mt-[26px] flex shrink-0 items-center justify-center" style={{ height: "clamp(160px, 27vh, 230px)" }}>
        <Ring value={runPercent(f)} sub={f.pushed < 1 ? "sending the record" : "putting it back"} />
      </Rise>
      <Rise className="mt-2.5 flex flex-col items-center gap-1.5 text-center">
        <Title size={26} className="tracking-[-0.4px]">
          Putting {name} back
        </Title>
        <Lead>Keep the TV on and this app open.</Lead>
      </Rise>
      <Rise className="mt-[22px]">
        <Card className="flex flex-col gap-1 px-4 py-2.5" aria-live="polite">
          {undoRows(f.run).map((r) => (
            <StepRow key={r.key} row={r} />
          ))}
        </Card>
      </Rise>
    </Screen>
  );
}

export function Undone() {
  const f = useSetup();
  const ok = f.run.done?.ok === true && !f.runError;
  const rows = undoRows(f.run);
  const missed = rows.filter((r) => r.state === "fail");
  const name = tvName(f);
  const shown = name === "your TV" ? "Your TV" : name;
  if (!ok) {
    const stopped = whatStopped(f.run, "undo");
    return (
      <Screen label="Undo stopped" top={28}>
        <UndoBrand />
        <Rise className="mt-8">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-ice/12 text-ice">
            <I.Alert size={28} />
          </span>
        </Rise>
        <Rise className="mt-[18px] flex flex-col gap-2.5">
          <Title>Undo stopped</Title>
          <Lead>{f.runError ? "The connection to the TV closed before Undo finished." : "Orbit could not put everything back yet."}</Lead>
        </Rise>
        <Rise className="mt-5">
          <Card className="p-4">
            <SectionLabel>What stopped</SectionLabel>
            <p className="mt-2 text-[15px] leading-snug text-snow">{f.runError ?? stopped.text}</p>
            {!f.runError && stopped.detail && <p className="mt-1 text-[13px] leading-snug text-mist">The TV said: {stopped.detail}</p>}
          </Card>
        </Rise>
        <Rise className="mt-auto flex flex-col gap-1.5 pt-6">
          <Primary onPress={undoAgain}>Try again</Primary>
          <TextButton tone="mist" onPress={finishUndo}>
            Close
          </TextButton>
        </Rise>
      </Screen>
    );
  }
  return (
    <Screen label={`${shown} is back as it was`} top={28}>
      <UndoBrand />
      <Rise className="mt-8">
        <DoneMark size={56} />
      </Rise>
      <Rise className="mt-[18px] flex flex-col gap-2.5">
        <Title>{missed.length ? "Nearly all of it is back" : `${shown} is back as it was`}</Title>
        <Lead>
          {missed.length
            ? "Orbit put back what it could. What did not go back is below."
            : "Every app Orbit switched off is on again, and the TV's own home screen is back."}
        </Lead>
      </Rise>
      <Rise className="mt-5">
        <Card className="flex flex-col gap-1 px-4 py-2.5">
          {rows.map((r) => (
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
        <Primary onPress={finishUndo} busy={f.closing}>
          Done
        </Primary>
      </Rise>
    </Screen>
  );
}
