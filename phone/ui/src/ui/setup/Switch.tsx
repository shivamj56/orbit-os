// Settings › This TV › "Use the TV's own home screen" and "Use Orbit Home again": the TV's own `orbit-setup.sh switch
// stock|orbit`, run over the same guided path as Undo (Developer mode and Allow are Setup.tsx's screens). Unlike Undo,
// only the home screen changes.
import { closeSetup, confirmSwitch, finishSwitch, setCloseDev, switchAgain, tvName, useSetup, type Flow } from "../../setup/flow";
import { runWentWell, switchRows, whatStopped } from "../../setup/lines";
import * as I from "../icons";
import { Ring, StepRow } from "./Install";
import { Brand, Card, DoneMark, Lead, Primary, Rise, Screen, SectionLabel, Switch, TextButton, Title } from "./parts";

const SwitchBrand = () => <Brand aside={<span className="text-[13px] tracking-[0.3px] text-dusk">Home screen</span>} />;

/** The words of each way: what the button says, and what the person gets. */
export function switchWords(to: Flow["to"], name: string) {
  const tv = name === "your TV" ? "the TV" : name;
  return to === "stock"
    ? {
        title: "Use the TV's own home screen",
        lead: `${tv.charAt(0).toUpperCase()}${tv.slice(1)} goes back to the home screen it came with. Only the home screen changes: Orbit Home and Orbit Live TV stay on the TV, and you can come back to Orbit Home from here any time.`,
        button: "Use the TV's own home screen",
        doing: `Switching ${tv} to its own home screen`,
        done: "The TV's own home screen is back",
        after: "The TV shows it now, and starts on it. Orbit Home stays on the TV for when you want it again.",
        // setup/tv/orbit-setup.sh, switch_stock: the helper stays on, and it still takes the remote's Home key.
        note: "One thing stays for now: while Orbit's remote helper is on, the Home button on the TV's own remote still opens Orbit Home.",
      }
    : {
        title: "Use Orbit Home again",
        lead: `Orbit Home becomes ${tv}'s home screen again, with your greeting and Live TV first. The TV's own home screen stays on the TV, ready for another switch.`,
        button: "Use Orbit Home",
        doing: `Making Orbit Home ${tv}'s home screen`,
        done: "Orbit Home is Home again",
        after: "The TV shows Orbit Home now, and starts on it.",
        note: null,
      };
}

function Compare({ active, title, children }: { active: boolean; title: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className={`mt-[5px] h-2 w-2 shrink-0 rounded-full ${active ? "bg-cyan shadow-[0_0_10px_rgba(116,209,255,0.7)]" : "bg-white/22"}`} />
      <span className="min-w-0">
        <span className={`block text-[15px] font-semibold ${active ? "text-snow" : "text-haze"}`}>{title}</span>
        <span className="mt-0.5 block text-[13.5px] leading-[1.45] text-mist">{children}</span>
      </span>
    </div>
  );
}

export function SwitchConfirm() {
  const f = useSetup();
  const words = switchWords(f.to, tvName(f));
  if (f.tv?.address === "cloud") {
    return (
      <Screen label="Switching needs the home Wi-Fi" top={28}>
        <SwitchBrand />
        <Rise className="mt-10">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-ice/12 text-ice">
            <I.Wifi size={28} />
          </span>
        </Rise>
        <Rise className="mt-[18px] flex flex-col gap-2.5">
          <Title>Switching needs the home Wi-Fi</Title>
          <Lead>Orbit changes the TV's home screen over the Wi-Fi it is on. Join this phone to the TV's Wi-Fi, then open Settings again.</Lead>
        </Rise>
        <Rise className="mt-auto pt-6">
          <Primary onPress={closeSetup}>Close</Primary>
        </Rise>
      </Screen>
    );
  }
  return (
    <Screen label={words.title} top={28}>
      <SwitchBrand />
      <Rise className="mt-8">
        <span
          className="grid h-14 w-14 place-items-center rounded-[20px] border border-ice/28 text-ice"
          style={{ background: "linear-gradient(145deg, rgba(116,209,255,0.18), rgba(233,179,255,0.12))" }}
        >
          {f.to === "stock" ? <I.Home size={28} /> : <I.Planet size={28} />}
        </span>
      </Rise>
      <Rise className="mt-[18px] flex flex-col gap-2.5">
        <Title>{words.title}</Title>
        <Lead>{words.lead}</Lead>
      </Rise>
      <Rise className="mt-5">
        <Card className="flex flex-col gap-3.5 p-4">
          <SectionLabel>Not the same as Undo</SectionLabel>
          <Compare active title="Switching the home screen">
            Only Home changes. Every app stays as it is now, and you can switch back any time.
          </Compare>
          <Compare active={false} title="Undo Orbit OS on this TV">
            Takes Orbit off the TV entirely: the apps Orbit switched off come back on, the TV's settings go back, and Orbit's own apps come off.
          </Compare>
        </Card>
      </Rise>
      {f.conn.state !== "connected" && (
        <Rise className="mt-4">
          <p className="text-[13.5px] leading-snug text-dusk">The TV's USB debugging has to be on for this. The next screen shows how.</p>
        </Rise>
      )}
      <Rise className="mt-auto flex flex-col gap-1.5 pt-6">
        <Primary onPress={confirmSwitch}>{words.button}</Primary>
        <TextButton tone="mist" onPress={closeSetup}>
          Not now
        </TextButton>
      </Rise>
    </Screen>
  );
}

/** How far the switch has come: the script and its record on the way, then its own word (it is quick). */
function switchPercent(f: Flow): number {
  if (f.run.done) return 100;
  if (f.run.progress > 0) return Math.max(40, f.run.progress);
  if (f.run.steps.switch?.state === "ok") return 92;
  if (f.run.order.length) return 60;
  return Math.round(f.pushed * 36);
}

export function Switching() {
  const f = useSetup();
  const words = switchWords(f.to, tvName(f));
  return (
    <Screen label={words.doing} top={28}>
      <SwitchBrand />
      <Rise className="mt-[26px] flex shrink-0 items-center justify-center" style={{ height: "clamp(160px, 27vh, 230px)" }}>
        <Ring value={switchPercent(f)} sub={f.pushed < 1 ? "sending Orbit Setup" : "switching"} />
      </Rise>
      <Rise className="mt-2.5 flex flex-col items-center gap-1.5 text-center">
        <Title size={26} className="tracking-[-0.4px]">
          {words.doing}
        </Title>
        <Lead>Keep the TV on and this app open.</Lead>
      </Rise>
      <Rise className="mt-[22px]">
        <Card className="flex flex-col gap-1 px-4 py-2.5" aria-live="polite">
          {switchRows(f.run, f.to).map((r) => (
            <StepRow key={r.key} row={r} />
          ))}
        </Card>
      </Rise>
    </Screen>
  );
}

export function Switched() {
  const f = useSetup();
  const words = switchWords(f.to, tvName(f));
  const ok = !f.runError && runWentWell(f.run);
  if (!ok) {
    const stopped = whatStopped(f.run, "switch", 0, f.to);
    return (
      <Screen label="The switch stopped" top={28}>
        <SwitchBrand />
        <Rise className="mt-8">
          <span className="grid h-14 w-14 place-items-center rounded-full bg-ice/12 text-ice">
            <I.Alert size={28} />
          </span>
        </Rise>
        <Rise className="mt-[18px] flex flex-col gap-2.5">
          <Title>The switch stopped</Title>
          <Lead>
            {f.runError
              ? "The connection to the TV closed before the switch finished. The TV still has a home screen."
              : "The TV still has a home screen: the one it had before."}
          </Lead>
        </Rise>
        <Rise className="mt-5">
          <Card className="p-4">
            <SectionLabel>What stopped</SectionLabel>
            <p className="mt-2 text-[15px] leading-snug text-snow">{f.runError ?? stopped.text}</p>
            {!f.runError && stopped.detail && <p className="mt-1 text-[13px] leading-snug text-mist">The TV said: {stopped.detail}</p>}
          </Card>
        </Rise>
        <Rise className="mt-auto flex flex-col gap-1.5 pt-6">
          <Primary onPress={switchAgain}>Try again</Primary>
          <TextButton tone="mist" onPress={finishSwitch}>
            Close
          </TextButton>
        </Rise>
      </Screen>
    );
  }
  return (
    <Screen label={words.done} top={28}>
      <SwitchBrand />
      <Rise className="mt-8">
        <DoneMark size={56} />
      </Rise>
      <Rise className="mt-[18px] flex flex-col gap-2.5">
        <Title>{words.done}</Title>
        <Lead>{words.after}</Lead>
      </Rise>
      <Rise className="mt-5">
        <Card className="flex flex-col gap-1 px-4 py-2.5">
          {switchRows(f.run, f.to).map((r) => (
            <StepRow key={r.key} row={r} />
          ))}
        </Card>
      </Rise>
      {words.note && (
        <Rise className="mt-3">
          <p className="rounded-[16px] bg-white/[0.035] px-4 py-3 text-[13.5px] leading-snug text-mist">{words.note}</p>
        </Rise>
      )}
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
        <Primary onPress={finishSwitch} busy={f.closing}>
          Done
        </Primary>
      </Rise>
    </Screen>
  );
}
