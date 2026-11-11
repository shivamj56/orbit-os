import { describe, expect, it } from "vitest";
import debloat from "../../../../devices/xiaomi-mitv-axfu0/debloat.txt?raw";
import { catalog, type Catalog } from "./catalog";
import {
  buildPlan,
  choicesOf,
  disabledByRecord,
  isCore,
  isSwitchable,
  mergeUndo,
  overridePackage,
  pairsOf,
  parsePackages,
  stockLauncher,
  visibleQuestions,
} from "./plan";

/** The family room TV as it came: every package of its switch-off list, plus what it keeps and the system's own. */
const TV_LIST = debloat
  .split("\n")
  .map((l) => l.replace(/#.*/, "").trim())
  .filter(Boolean);
const KEPT = [
  "com.netflix.ninja",
  "com.google.android.youtube.tv",
  "com.mitv.livetv",
  "com.mitv.overseaservice",
  "com.google.android.katniss",
  "com.android.vending",
  "com.android.tv.settings",
  "com.google.android.gms",
  "com.google.android.tv.remote.service",
  "android",
  "com.android.systemui",
  "com.android.providers.settings",
];
const MITV = [...TV_LIST, ...KEPT];
const ALL_OFF = { cast: "off", usb: "off", voice: "off", channels: "off", ads: "off" } as const;

/** A small catalog of my own, for the rules the real one does not reach. */
function fixture(over: Partial<Catalog> = {}): Catalog {
  return {
    version: 1,
    coreRe: catalog.coreRe,
    coreOk: catalog.coreOk,
    groups: {
      tracking: { label: "Ads and tracking", about: "", default: "off" },
      unused: { label: "Unused", about: "", default: "off" },
      stockHome: { label: "The stock home screen", about: "", default: "off", requiredWithHome: true },
      cast: { label: "Casting", about: "", default: "keep" },
    },
    questions: [
      { id: "cast", group: "cast", title: "", help: "", keep: "", off: "" },
      { id: "ads", group: "tracking", title: "", help: "", keep: "", off: "", recommend: "off" },
    ],
    packages: {
      "a.track": { label: "Tracker", group: "tracking" },
      "a.unused": { label: "Unused A", group: "unused" },
      "b.unused": { label: "Unused B", group: "unused" },
      "a.home": { label: "Stock home", group: "stockHome" },
      "a.setup": { label: "Stock setup", group: "unused" },
      "a.cast": { label: "Cast", group: "cast" },
      "com.android.systemui": { label: "System UI", group: "unused" },
      "com.android.providers.media": { label: "Media storage", group: "unused" },
      "com.android.providers.calendar": { label: "Calendar storage", group: "unused" },
      "a.never": { label: "Never off", group: "unused" },
    },
    neverOff: ["a.never"],
    models: {},
    ...over,
  };
}

describe("reading the TV", () => {
  it("takes the packages out of pm's list and nothing else", () => {
    const out = "package:com.netflix.ninja\r\npackage:android\n\nWARNING: linker: something\npackage:com.mitv.livetv  \n";
    expect(parsePackages(out)).toEqual(["com.netflix.ninja", "android", "com.mitv.livetv"]);
  });

  it("finds the stock launcher on resolve-activity's last line", () => {
    const out =
      "priority=0 preferredOrder=0 match=0x108000 specificIndex=-1 isDefault=true\n" +
      "com.google.android.apps.tv.launcherx/com.google.android.apps.tv.launcherx.home.HomeActivity\n";
    expect(stockLauncher(out)).toBe("com.google.android.apps.tv.launcherx");
  });

  it("names no stock launcher when Orbit Home is already Home, or Android has none", () => {
    expect(stockLauncher("priority=0\ncom.gathin.tvhome/.MainActivity")).toBeNull();
    // Orbit Home under its id from 11 Nov, with its classes' package written in full.
    expect(stockLauncher("priority=0\ndev.shiv.orbit.home/com.gathin.tvhome.MainActivity")).toBeNull();
    expect(stockLauncher("No activity found")).toBeNull();
    expect(stockLauncher("")).toBeNull();
  });
});

describe("core packages and neverOff", () => {
  it("knows the system's own packages, except the providers coreOk lets go", () => {
    expect(isCore(catalog, "android")).toBe(true);
    expect(isCore(catalog, "com.android.systemui")).toBe(true);
    expect(isCore(catalog, "com.android.providers.media")).toBe(true);
    expect(isCore(catalog, "com.android.providers.calendar")).toBe(false);
    expect(isCore(catalog, "com.netflix.ninja")).toBe(false);
  });

  it("offers only catalog packages that are neither core nor on neverOff", () => {
    const c = fixture();
    expect(isSwitchable(c, "a.unused")).toBe(true);
    expect(isSwitchable(c, "com.android.systemui")).toBe(false);
    expect(isSwitchable(c, "com.android.providers.media")).toBe(false);
    expect(isSwitchable(c, "com.android.providers.calendar")).toBe(true);
    expect(isSwitchable(c, "a.never")).toBe(false);
    expect(isSwitchable(c, "not.in.the.catalog")).toBe(false);
  });

  it("never puts a core, neverOff or unknown package on the plan, even in a group that goes off", () => {
    const c = fixture();
    const plan = buildPlan({
      catalog: c,
      enabled: ["a.unused", "com.android.systemui", "com.android.providers.media", "com.android.providers.calendar", "a.never", "x.unknown"],
      answers: {},
    });
    expect(plan.disable).toEqual(["a.unused", "com.android.providers.calendar"]);
    const listed = plan.groups.flatMap((g) => g.items.map((i) => i.pkg));
    expect(listed).not.toContain("com.android.systemui");
    expect(listed).not.toContain("a.never");
    expect(listed).not.toContain("x.unknown");
  });

  it("keeps the real catalog's neverOff and core packages on, on the family room TV", () => {
    const plan = buildPlan({ catalog, enabled: MITV, model: "MiTV-AXFU0", answers: ALL_OFF });
    for (const p of catalog.neverOff) expect(plan.disable).not.toContain(p);
    for (const p of plan.disable) expect(isCore(catalog, p)).toBe(false);
    expect(plan.disable).toContain("com.android.providers.calendar");
    expect(plan.disable).not.toContain("com.mitv.livetv");
    expect(plan.disable).not.toContain("com.netflix.ninja");
  });

  it("leaves out what is already off on the TV", () => {
    const plan = buildPlan({ catalog, enabled: KEPT, answers: ALL_OFF });
    expect(plan.disable).toEqual(["com.google.android.katniss"]);
  });
});

describe("answers", () => {
  it("switches off exactly the family room TV's own list when every answer is off but voice", () => {
    const plan = buildPlan({ catalog, enabled: MITV, model: "MiTV-AXFU0", answers: { ...ALL_OFF, voice: "keep" } });
    expect([...plan.disable].sort()).toEqual([...TV_LIST].sort());
    expect(plan.disable).toHaveLength(32);
    expect(plan.kept.map((g) => g.id)).toEqual(["voice"]);
  });

  it("keeps a group answered keep, and off the plan entirely", () => {
    const plan = buildPlan({ catalog, enabled: MITV, model: "MiTV-AXFU0", answers: { ...ALL_OFF, cast: "keep", usb: "keep" } });
    expect(plan.disable).not.toContain("com.google.android.apps.mediashell");
    expect(plan.disable).not.toContain("com.mitv.videoplayer");
    expect(plan.groups.map((g) => g.id)).not.toContain("cast");
    expect(plan.kept.map((g) => g.id)).toEqual(["cast", "usb"]);
  });

  it("puts a keep group answered off on the plan, because of the answer", () => {
    const plan = buildPlan({ catalog, enabled: MITV, model: "MiTV-AXFU0", answers: ALL_OFF });
    const cast = plan.groups.find((g) => g.id === "cast")!;
    expect(cast.why).toBe("answer");
    expect(cast.items.map((i) => [i.pkg, i.off])).toEqual([["com.google.android.apps.mediashell", true]]);
  });

  it("switches tracking off only when ads was answered off, and otherwise lists it for a person to pick", () => {
    const off = buildPlan({ catalog, enabled: MITV, answers: ALL_OFF }).groups.find((g) => g.id === "tracking")!;
    expect(off.why).toBe("default");
    expect(off.off).toBe(12);

    const look = buildPlan({ catalog, enabled: MITV, answers: { ...ALL_OFF, ads: "keep" } });
    const tracking = look.groups.find((g) => g.id === "tracking")!;
    expect(tracking.why).toBe("choose");
    expect(tracking.items).toHaveLength(12);
    expect(tracking.off).toBe(0);
    expect(look.disable).not.toContain("com.miui.tv.analytics");

    const picked = buildPlan({ catalog, enabled: MITV, answers: { ...ALL_OFF, ads: "keep" }, overrides: { "com.miui.tv.analytics": "off" } });
    expect(picked.disable).toContain("com.miui.tv.analytics");
    expect(picked.groups.find((g) => g.id === "tracking")!.off).toBe(1);
  });

  it("switches groups whose default is off without a question, and lets a person keep single packages", () => {
    const plan = buildPlan({ catalog, enabled: MITV, answers: ALL_OFF, overrides: { "com.google.android.youtube.tvmusic": "keep" } });
    const unused = plan.groups.find((g) => g.id === "unused")!;
    expect(unused.why).toBe("default");
    expect(unused.items.find((i) => i.pkg === "com.google.android.youtube.tvmusic")!.off).toBe(false);
    expect(plan.disable).not.toContain("com.google.android.youtube.tvmusic");
    expect(plan.disable).toContain("com.google.android.play.games");
  });
});

describe("the stock home screen", () => {
  it("is always on the plan while Orbit Home is installed, required and not to be kept", () => {
    const plan = buildPlan({
      catalog,
      enabled: MITV,
      model: "MiTV-AXFU0",
      answers: ALL_OFF,
      overrides: { "com.google.android.apps.tv.launcherx": "keep", "com.google.android.apps.tv.dreamx": "keep" },
    });
    const home = plan.groups.find((g) => g.id === "stockHome")!;
    expect(home.why).toBe("required");
    expect(home.items).toHaveLength(4);
    expect(home.items.every((i) => i.off && i.lock === "required")).toBe(true);
    expect(plan.disable).toContain("com.google.android.apps.tv.launcherx");
    expect(plan.disable).toContain("com.google.android.apps.tv.dreamx");
  });

  it("stays on when Orbit Home is not installed", () => {
    const plan = buildPlan({ catalog, enabled: MITV, answers: ALL_OFF, home: false });
    expect(plan.disable).not.toContain("com.google.android.apps.tv.launcherx");
    expect(plan.groups.map((g) => g.id)).not.toContain("stockHome");
  });
});

describe("together pairs", () => {
  const pair = (models: Catalog["models"], groups?: Partial<Catalog["groups"]>) =>
    fixture({ models, groups: { ...fixture().groups, ...(groups as Catalog["groups"]) } });

  it("keeps the family room TV's pair in the pair's own order: setupwraith before launcherx", () => {
    const plan = buildPlan({ catalog, enabled: MITV, model: "MiTV-AXFU0", answers: ALL_OFF });
    const [first, second] = pairsOf(catalog, "MiTV-AXFU0")[0];
    expect(plan.disable.indexOf(first)).toBeGreaterThanOrEqual(0);
    expect(plan.disable.indexOf(first)).toBeLessThan(plan.disable.indexOf(second));
  });

  it("puts the pair's order first even when the catalog lists them the other way", () => {
    const c = pair({ M: { name: "M", together: [["b.unused", "a.unused"]] } });
    expect(buildPlan({ catalog: c, enabled: ["a.unused", "b.unused"], model: "M" }).disable).toEqual(["b.unused", "a.unused"]);
  });

  it("takes a partner off with a required one", () => {
    const c = pair({ M: { name: "M", together: [["a.setup", "a.home"]] } });
    const plan = buildPlan({ catalog: c, enabled: ["a.setup", "a.home"], model: "M", overrides: { "a.setup": "keep" } });
    expect(plan.disable).toEqual(["a.setup", "a.home"]);
    expect(plan.groups.flatMap((g) => g.items).every((i) => i.lock === "required")).toBe(true);
  });

  it("keeps both on when the partner is one Orbit may not switch off", () => {
    const c = pair({ M: { name: "M", together: [["a.unused", "a.never"]] } });
    const plan = buildPlan({ catalog: c, enabled: ["a.unused", "a.never"], model: "M" });
    expect(plan.disable).toEqual([]);
    expect(plan.groups[0].items[0]).toMatchObject({ pkg: "a.unused", off: false, lock: "together" });
  });

  it("keeps both on when the answers kept the partner's group", () => {
    const c = pair({ M: { name: "M", together: [["a.unused", "a.cast"]] } });
    const plan = buildPlan({ catalog: c, enabled: ["a.unused", "a.cast"], model: "M", answers: { cast: "keep" } });
    expect(plan.disable).toEqual([]);
  });

  it("keeps both on when two members disagree, and moves both when a person switches one", () => {
    const c = pair({ M: { name: "M", together: [["a.unused", "b.unused"]] } });
    const input = { catalog: c, enabled: ["a.unused", "b.unused"], model: "M" };
    expect(buildPlan({ ...input, overrides: { "a.unused": "keep" } }).disable).toEqual([]);

    const plan = buildPlan(input);
    expect(plan.disable).toEqual(["a.unused", "b.unused"]);
    const kept = overridePackage(plan, {}, pairsOf(c, "M"), "a.unused", false);
    expect(kept).toEqual({ "a.unused": "keep", "b.unused": "keep" });
    expect(buildPlan({ ...input, overrides: kept }).disable).toEqual([]);
  });

  it("does nothing for a pair whose partner is not switched on", () => {
    const c = pair({ M: { name: "M", together: [["a.unused", "b.unused"]] } });
    expect(buildPlan({ catalog: c, enabled: ["a.unused"], model: "M" }).disable).toEqual(["a.unused"]);
  });

  it("does not move a locked package", () => {
    const plan = buildPlan({ catalog, enabled: MITV, model: "MiTV-AXFU0", answers: ALL_OFF });
    const pairs = pairsOf(catalog, "MiTV-AXFU0");
    expect(overridePackage(plan, {}, pairs, "com.google.android.apps.tv.launcherx", false)).toEqual({});
  });
});

describe("questions", () => {
  it("asks all five on the family room TV", () => {
    expect(visibleQuestions(catalog, MITV).map((q) => q.id)).toEqual(["cast", "usb", "voice", "channels", "ads"]);
  });

  it("asks only about groups that have an app switched on", () => {
    const enabled = ["com.google.android.apps.mediashell", "com.netflix.ninja", "com.mitv.gallery"];
    expect(visibleQuestions(catalog, enabled).map((q) => q.id)).toEqual(["cast", "usb"]);
  });

  it("asks about ads when any tracking package is on, and not otherwise", () => {
    expect(visibleQuestions(catalog, ["com.google.android.feedback"]).map((q) => q.id)).toEqual(["ads"]);
    expect(visibleQuestions(catalog, ["com.netflix.ninja"]).map((q) => q.id)).toEqual([]);
  });

  it("does not ask about apps that are already off or that Orbit may not switch off", () => {
    const c = fixture({ packages: { ...fixture().packages, "a.never": { label: "", group: "cast" } } });
    expect(visibleQuestions(c, ["a.never"]).map((q) => q.id)).toEqual([]);
  });

  it("shows the recommended answer first", () => {
    const ads = catalog.questions.find((q) => q.id === "ads")!;
    const cast = catalog.questions.find((q) => q.id === "cast")!;
    expect(choicesOf(ads)).toEqual(["off", "keep"]);
    expect(choicesOf(cast)).toEqual(["keep", "off"]);
  });
});

describe("the undo record", () => {
  it("keeps every line once, first seen first, and an empty a11y list's space", () => {
    expect(mergeUndo(["enable a", "home x/.H"], ["enable a", "a11y", "enable b", "", "a11y_on 1\r"])).toEqual([
      "enable a",
      "home x/.H",
      "a11y ",
      "enable b",
      "a11y_on 1",
    ]);
  });

  it("names what setup switched off", () => {
    expect(disabledByRecord(["home x/.H", "enable com.a", "uninstall com.gathin.tvhome", "enable com.b"])).toEqual(["com.a", "com.b"]);
  });
});
