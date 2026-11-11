import { describe, expect, it } from "vitest";
import { applyOutput, freshRun, parseLine, runWentWell, switchRows, whatStopped } from "./lines";

// What `sh /data/local/tmp/orbit/orbit-setup.sh switch stock|orbit` says (setup/tv/orbit-setup.sh, switch_stock and
// switch_orbit), and what Flutter adds when the command ends.
const STOCK_OK = ["@orbit step switch start", "on com.google.android.apps.tv.launcherx", "@orbit step switch ok", "@orbit done ok", "@orbit-exit 0"].join("\n");
const ORBIT_OK = [
  "@orbit step switch start",
  "off com.google.android.apps.tv.launcherx",
  "@orbit undo enable com.google.android.apps.tv.launcherx",
  "@orbit step switch ok",
  "@orbit done ok",
  "@orbit-exit 0",
].join("\n");

describe("the switch's lines", () => {
  it("are steps, a done and the exit like any other run", () => {
    expect(parseLine("@orbit step switch start")).toEqual({ kind: "step", id: "switch", state: "start", text: "" });
    expect(parseLine("@orbit step switch fail There is no record of the TV's own home screen")).toEqual({
      kind: "step",
      id: "switch",
      state: "fail",
      text: "There is no record of the TV's own home screen",
    });
    expect(parseLine("@orbit done fail Android kept Orbit Home as the home screen\r")).toEqual({
      kind: "done",
      ok: false,
      text: "Android kept Orbit Home as the home screen",
    });
  });

  it("show one row that moves from doing to done, in the words of the way chosen", () => {
    let run = applyOutput(freshRun(), "@orbit step switch start");
    expect(switchRows(run, "stock")).toEqual([{ key: "switch", text: "Bringing back the TV's own home screen", state: "active" }]);
    expect(switchRows(run, "orbit")).toEqual([{ key: "switch", text: "Making Orbit Home the home screen", state: "active" }]);
    run = applyOutput(freshRun(), STOCK_OK);
    expect(switchRows(run, "stock")).toEqual([{ key: "switch", text: "The TV's own home screen is Home", state: "done" }]);
    expect(runWentWell(run)).toBe(true);
    expect(run.exit).toBe(0);
    expect(run.log).toEqual(["on com.google.android.apps.tv.launcherx"]);
  });

  it("keep the record lines a switch back to Orbit Home says", () => {
    const run = applyOutput(freshRun(), ORBIT_OK);
    expect(run.undo).toEqual(["enable com.google.android.apps.tv.launcherx"]);
    expect(switchRows(run, "orbit")).toEqual([{ key: "switch", text: "Orbit Home is Home again", state: "done" }]);
    expect(runWentWell(run)).toBe(true);
  });

  it("say what stopped, with the TV's own words under the plain ones", () => {
    const run = applyOutput(
      freshRun(),
      [
        "@orbit step switch start",
        "@orbit step switch fail There is no record of the TV's own home screen",
        "@orbit done fail There is no record of the TV's own home screen, so Orbit Home stays Home",
        "@orbit-exit 1",
      ].join("\n"),
    );
    expect(runWentWell(run)).toBe(false);
    expect(switchRows(run, "stock")).toEqual([
      { key: "switch", text: "The TV's own home screen did not come back", state: "fail", detail: "There is no record of the TV's own home screen" },
    ]);
    expect(whatStopped(run, "switch", 0, "stock")).toEqual({
      text: "The TV's own home screen did not come back",
      detail: "There is no record of the TV's own home screen",
    });
    const orbit = applyOutput(freshRun(), "@orbit step switch start\n@orbit step switch fail Orbit Home is not on this TV\n@orbit done fail Orbit Home is not on this TV\n@orbit-exit 1");
    expect(whatStopped(orbit, "switch", 0, "orbit")).toEqual({ text: "Orbit Home did not become Home", detail: "Orbit Home is not on this TV" });
  });

  it("tell a script from before `switch` apart from one that stopped", () => {
    const old = applyOutput(freshRun(), "usage: sh /data/local/tmp/orbit/orbit-setup.sh install|name\n@orbit-exit 2");
    expect(runWentWell(old)).toBe(false);
    expect(whatStopped(old, "switch")).toEqual({ text: "This copy of Orbit Setup cannot switch the home screen" });
    const cut = applyOutput(freshRun(), "@orbit step switch start\n@orbit-exit 137");
    expect(switchRows(cut, "stock")[0].state).toBe("pending");
    expect(whatStopped(cut, "switch")).toEqual({ text: "The switch stopped before it finished" });
  });

  it("are not a success with a step that failed, even after done ok", () => {
    const odd = applyOutput(freshRun(), "@orbit step switch fail no\n@orbit done ok");
    expect(runWentWell(odd)).toBe(false);
  });
});
