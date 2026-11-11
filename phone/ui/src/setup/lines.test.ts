import { describe, expect, it } from "vitest";
import { applyOutput, failedStep, freshRun, installRows, parseLine, undoRows, whatStopped } from "./lines";

describe("parseLine", () => {
  it("reads a step with and without its text", () => {
    expect(parseLine("@orbit step check start")).toEqual({ kind: "step", id: "check", state: "start", text: "" });
    expect(parseLine("@orbit step home fail Orbit Home did not install")).toEqual({
      kind: "step",
      id: "home",
      state: "fail",
      text: "Orbit Home did not install",
    });
    expect(parseLine("@orbit step disable ok 2 could not be switched off\r")).toMatchObject({ state: "ok", text: "2 could not be switched off" });
  });

  it("reads progress and keeps it between 0 and 100", () => {
    expect(parseLine("@orbit progress 64")).toEqual({ kind: "progress", value: 64 });
    expect(parseLine("@orbit progress 140")).toEqual({ kind: "progress", value: 100 });
  });

  it("keeps an undo line exactly, its last space too", () => {
    expect(parseLine("@orbit undo enable com.miui.tv.analytics")).toEqual({ kind: "undo", line: "enable com.miui.tv.analytics" });
    expect(parseLine("@orbit undo a11y ")).toEqual({ kind: "undo", line: "a11y " });
    expect(parseLine("@orbit undo setting secure screensaver_components com.x/.Dream\r")).toEqual({
      kind: "undo",
      line: "setting secure screensaver_components com.x/.Dream",
    });
  });

  it("reads done, and Flutter's exit line", () => {
    expect(parseLine("@orbit done ok")).toEqual({ kind: "done", ok: true, text: "" });
    expect(parseLine("@orbit done fail Orbit Home did not start; the TV keeps its own home screen")).toEqual({
      kind: "done",
      ok: false,
      text: "Orbit Home did not start; the TV keeps its own home screen",
    });
    expect(parseLine("@orbit-exit 0")).toEqual({ kind: "exit", code: 0 });
    expect(parseLine("@orbit-exit 1")).toEqual({ kind: "exit", code: 1 });
  });

  it("takes everything else as log", () => {
    for (const line of ["off com.miui.tv.analytics", "Success", "@orbit", "@orbit undo ", "@orbit step home maybe", "@orbit done later", "@orbitx step a ok"]) {
      expect(parseLine(line).kind).toBe("log");
    }
  });
});

const INSTALL = [
  "@orbit undo home com.google.android.apps.tv.launcherx/.MainActivity",
  "@orbit step check start",
  "@orbit step check ok",
  "@orbit progress 5",
  "@orbit step record start",
  "@orbit step record ok",
  "@orbit step disable start",
  "off com.miui.tv.analytics",
  "@orbit undo enable com.miui.tv.analytics",
  "@orbit progress 23",
].join("\n");

describe("a run", () => {
  it("collects steps, progress, undo lines and log", () => {
    const run = applyOutput(freshRun(), INSTALL);
    expect(run.order).toEqual(["check", "record", "disable"]);
    expect(run.steps.disable.state).toBe("start");
    expect(run.progress).toBe(23);
    expect(run.undo).toEqual(["home com.google.android.apps.tv.launcherx/.MainActivity", "enable com.miui.tv.analytics"]);
    expect(run.log).toEqual(["off com.miui.tv.analytics"]);
    expect(run.done).toBeNull();
  });

  it("lists the install as the design does, with the step under way", () => {
    const rows = installRows(applyOutput(freshRun(), INSTALL), 32);
    expect(rows.map((r) => [r.key, r.state, r.text])).toEqual([
      ["record", "done", "Saved how to undo all of it"],
      ["disable", "active", "Switching off 32 apps"],
      ["home", "pending", "Installing Orbit Home"],
      ["helper", "pending", "Turning on the remote helper"],
      ["live", "pending", "Installing Orbit Live TV"],
      ["pair", "pending", "Pairing this phone"],
    ]);
  });

  it("counts what could not be switched off, and a skipped name still pairs", () => {
    const run = applyOutput(
      freshRun(),
      [
        "@orbit step check ok",
        "@orbit step record ok",
        "@orbit step disable ok 2 could not be switched off",
        "@orbit step home ok",
        "@orbit step helper ok",
        "@orbit step grants ok",
        "@orbit step live ok",
        "@orbit step name skip",
        "@orbit step pair ok",
        "@orbit done ok",
      ].join("\n"),
    );
    const rows = installRows(run, 32);
    expect(rows.find((r) => r.key === "disable")!.text).toBe("Switched off 30 of 32 apps");
    expect(rows.find((r) => r.key === "pair")).toMatchObject({ state: "done", text: "Paired this phone" });
    expect(rows.every((r) => r.state === "done")).toBe(true);
  });

  it("names the step that stopped a run in plain words, with the script's own words beside", () => {
    const run = applyOutput(
      freshRun(),
      ["@orbit step check ok", "@orbit step record ok", "@orbit step disable ok", "@orbit step home start", "pm install com.gathin.tvhome: Failure", "@orbit step home fail Orbit Home did not start", "@orbit done fail Orbit Home did not start; the TV keeps its own home screen", "@orbit-exit 1"].join("\n"),
    );
    expect(failedStep(run)).toEqual({ id: "home", text: "Orbit Home did not start" });
    const rows = installRows(run, 3);
    expect(rows.find((r) => r.key === "home")).toMatchObject({ state: "fail", text: "Orbit Home did not install", detail: "Orbit Home did not start" });
    expect(rows.find((r) => r.key === "live")!.state).toBe("pending");
    expect(whatStopped(run, "install", 3)).toEqual({ text: "Orbit Home did not install", detail: "Orbit Home did not start" });
  });

  it("says what stopped a run that failed before any step", () => {
    const run = applyOutput(freshRun(), "@orbit done fail plan.txt is missing\n@orbit-exit 1");
    expect(whatStopped(run, "install")).toEqual({ text: "plan.txt is missing" });
  });

  it("treats a script that exits without done as stopped", () => {
    const run = applyOutput(freshRun(), "@orbit step check start\n@orbit-exit 137");
    expect(installRows(run, 1)[0].state).toBe("pending");
    expect(whatStopped(run, "install").text).toBe("The setup stopped before it finished");
  });

  it("shows a step it does not know as the script names it", () => {
    const run = applyOutput(freshRun(), "@orbit step wallpaper start Choosing a picture");
    expect(installRows(run, 0).slice(-1)[0]).toEqual({ key: "wallpaper", text: "Choosing a picture", state: "active" });
  });

  it("lists the undo, with how many apps came back", () => {
    const run = applyOutput(
      freshRun(),
      [
        "@orbit step home start",
        "@orbit step home ok",
        "@orbit progress 30",
        "@orbit step enable start",
        "@orbit step enable ok 32 switched on",
        "@orbit step helper ok",
        "@orbit step apps start",
        "removed com.gathin.tvhome",
        "@orbit step apps ok",
        "@orbit done ok",
      ].join("\n"),
    );
    expect(undoRows(run).map((r) => [r.state, r.text])).toEqual([
      ["done", "The TV's own home screen is back"],
      ["done", "Switched 32 apps back on"],
      ["done", "Put the TV's settings back"],
      ["done", "Took Orbit's own apps away"],
    ]);
  });

  it("does not claim to take away Orbit's apps when none were there", () => {
    const run = applyOutput(freshRun(), "@orbit step apps start\n@orbit step apps ok\n@orbit done ok");
    expect(undoRows(run).find((r) => r.key === "apps")!.text).toBe("No Orbit apps to take away");
  });
});
