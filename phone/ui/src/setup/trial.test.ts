import { describe, expect, it } from "vitest";
import { TRIAL_SECONDS, trialClock } from "./flow";
import { applyOutput, freshRun, runWentWell, trialRows, untrialRows, whatStopped } from "./lines";

// What `sh /data/local/tmp/orbit/orbit-setup.sh trial 900` says (setup/tv/orbit-setup.sh, cmd_trial), and what Flutter
// adds when the command ends.
const TRIAL_OK = [
  "@orbit step check start",
  "@orbit step check ok",
  "@orbit progress 10",
  "@orbit step record start",
  "@orbit undo home com.google.android.apps.tv.launcherx/.MainActivity",
  "@orbit step record ok",
  "@orbit progress 15",
  "@orbit step install start",
  "@orbit undo uninstall dev.shiv.orbit.home",
  "@orbit step install ok",
  "@orbit progress 70",
  "@orbit step keep start",
  "@orbit step keep ok",
  "@orbit progress 80",
  "@orbit step open start",
  "@orbit step open ok",
  "@orbit progress 100",
  "@orbit done ok",
  "@orbit-exit 0",
].join("\n");

// orbit-undo.sh with a trial's record: the TV's own home screen made Home again, Orbit Home taken off.
const UNTRIAL_OK = [
  "@orbit step home start",
  "@orbit step home ok",
  "@orbit progress 30",
  "@orbit step enable start",
  "@orbit step enable ok 0 switched on",
  "@orbit progress 60",
  "@orbit step helper start",
  "@orbit step helper ok",
  "@orbit progress 75",
  "@orbit step apps start",
  "removed dev.shiv.orbit.home",
  "@orbit step apps ok",
  "@orbit progress 100",
  "@orbit done ok",
  "@orbit-exit 0",
].join("\n");

describe("a trial's lines", () => {
  it("show four rows that move from waiting to done, and keep the trial's record", () => {
    const started = trialRows(applyOutput(freshRun(), "@orbit step check start"));
    expect(started.map((r) => [r.text, r.state])).toEqual([
      ["Checking the TV", "active"],
      ["Installing Orbit Home, as an app", "pending"],
      ["Keeping the TV's own home screen", "pending"],
      ["Opening Orbit Home on the TV", "pending"],
    ]);
    const run = applyOutput(freshRun(), TRIAL_OK);
    expect(runWentWell(run)).toBe(true);
    expect(trialRows(run).map((r) => [r.text, r.state])).toEqual([
      ["Checked the TV", "done"],
      ["Installed Orbit Home, as an app", "done"],
      ["The TV's own home screen stays Home", "done"],
      ["Orbit Home is on the TV now", "done"],
    ]);
    expect(run.undo).toEqual(["home com.google.android.apps.tv.launcherx/.MainActivity", "uninstall dev.shiv.orbit.home"]);
  });

  it("say what stopped, with the TV's own words under the plain ones", () => {
    const run = applyOutput(
      freshRun(),
      [
        "@orbit step check start",
        "@orbit step check ok",
        "@orbit step install start",
        "@orbit step install ok",
        "@orbit step keep start",
        "removed dev.shiv.orbit.home",
        "@orbit step keep fail The TV would not keep its own home screen",
        "@orbit done fail The TV would not keep its own home screen next to Orbit Home, so Orbit Home was taken off again",
        "@orbit-exit 1",
      ].join("\n"),
    );
    expect(runWentWell(run)).toBe(false);
    expect(trialRows(run)[2]).toEqual({ key: "keep", text: "The TV would not keep its own home screen", state: "fail" });
    expect(trialRows(run)[3].state).toBe("pending");
    expect(whatStopped(run, "trial")).toEqual({
      text: "The TV would not keep its own home screen",
      detail: "The TV would not keep its own home screen next to Orbit Home, so Orbit Home was taken off again",
    });
  });

  it("tell a TV that is set up already apart from one that stopped", () => {
    const refused = applyOutput(
      freshRun(),
      "@orbit step check start\n@orbit step check fail Orbit OS is already set up on this TV\n@orbit done fail Orbit OS is already set up on this TV\n@orbit-exit 1",
    );
    expect(whatStopped(refused, "trial")).toEqual({ text: "The TV did not pass the check", detail: "Orbit OS is already set up on this TV" });
    const old = applyOutput(freshRun(), "usage: sh /data/local/tmp/orbit/orbit-setup.sh install|name|switch stock|switch orbit\n@orbit-exit 2");
    expect(whatStopped(old, "trial")).toEqual({ text: "This copy of Orbit Setup cannot run a trial" });
    const cut = applyOutput(freshRun(), "@orbit step check start\n@orbit-exit 137");
    expect(whatStopped(cut, "trial")).toEqual({ text: "The trial stopped before it started" });
  });
});

describe("taking Orbit off after a trial", () => {
  it("reads orbit-undo.sh in two rows: the TV's own home screen, then Orbit Home going", () => {
    const run = applyOutput(freshRun(), UNTRIAL_OK);
    expect(runWentWell(run)).toBe(true);
    expect(untrialRows(run)).toEqual([
      { key: "home", text: "The TV's own home screen is Home", state: "done" },
      { key: "apps", text: "Took Orbit Home off the TV", state: "done" },
    ]);
    const gone = applyOutput(freshRun(), UNTRIAL_OK.replace("removed dev.shiv.orbit.home\n", ""));
    expect(untrialRows(gone)[1].text).toBe("Orbit Home was already off the TV");
  });

  it("says when Orbit Home stays", () => {
    const run = applyOutput(freshRun(), "@orbit step home start\n@orbit step home fail Orbit Home is still the home screen\n@orbit done ok\n@orbit-exit 0");
    expect(runWentWell(run)).toBe(false);
    expect(whatStopped(run, "untrial")).toEqual({ text: "Orbit Home is still the home screen", detail: undefined });
  });
});

describe("the trial's clock", () => {
  it("lasts 15 minutes and reads like the TV's own pill", () => {
    expect(TRIAL_SECONDS).toBe(900);
    expect(trialClock(900_000)).toBe("15:00");
    expect(trialClock(899_001)).toBe("15:00");
    expect(trialClock(899_000)).toBe("14:59");
    expect(trialClock(61_000)).toBe("1:01");
    expect(trialClock(1)).toBe("0:01");
    expect(trialClock(0)).toBe("0:00");
    expect(trialClock(-20)).toBe("0:00");
  });
});
