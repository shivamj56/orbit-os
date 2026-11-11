import { describe, expect, it } from "vitest";
import type { DriveBackup, SetupProps } from "../bridge";
import {
  BACKUP_KIND,
  backupBytes,
  backupText,
  buildBackup,
  canBackUp,
  exactBytes,
  groupBackups,
  originalPackages,
  parseBackup,
  sizeText,
  type BackupInput,
} from "./backup";

/** UTF-8 bytes counted by hand, code point by code point (not with the encoder backupBytes uses). */
function utf8Length(text: string): number {
  let n = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

const PROPS: SetupProps = { model: "MiTV-AXFU0", manufacturer: "Xiaomi", brand: "Xiaomi", device: "arctictale", sdk: 34, release: "14" };
const STOCK = "com.google.android.apps.tv.launcherx/.MainActivity";

/** The record a first setup of the family room TV says. */
const UNDO = [
  `home ${STOCK}`,
  "enable com.miui.tv.analytics",
  "enable com.google.android.apps.tv.launcherx",
  "uninstall dev.shiv.orbit.home",
  "a11y com.example.reader/.Reader",
  "a11y_on 1",
  "setting secure screensaver_components com.google.android.apps.tv.dreamx/.Ambient",
  "uninstall dev.shiv.orbit.live",
];

function input(over: Partial<BackupInput> = {}): BackupInput {
  return {
    tv: { name: "Family room", address: "192.168.1.7" },
    props: PROPS,
    undo: UNDO,
    setUpAt: Date.UTC(2026, 10, 8, 18, 30),
    packages: {
      enabled: ["com.netflix.ninja", "com.miui.tv.analytics", "com.google.android.apps.tv.launcherx", "android"],
      disabled: ["com.old.thing"],
      when: "setup",
    },
    made: new Date(Date.UTC(2026, 10, 11, 12, 4)),
    app: "Orbit 1.4.0",
    ...over,
  };
}

describe("the backup file", () => {
  it("keeps the record, what the TV is, the date, and how it was before Orbit", () => {
    const b = buildBackup(input());
    expect(b.kind).toBe(BACKUP_KIND);
    expect(b.version).toBe(1);
    expect(b.made).toBe("2026-11-11T12:04:00.000Z");
    expect(b.setUp).toBe("2026-11-08T18:30:00.000Z");
    expect(b.tv).toEqual({ name: "Family room", address: "192.168.1.7", model: "MiTV-AXFU0", manufacturer: "Xiaomi", brand: "Xiaomi", device: "arctictale", android: "14", sdk: 34 });
    expect(b.undo).toEqual(UNDO);
    expect(b.original.home).toBe(STOCK);
    expect(b.original.accessibility).toEqual({ services: "com.example.reader/.Reader", enabled: "1" });
    expect(b.original.screensaver).toBe("com.google.android.apps.tv.dreamx/.Ambient");
    expect(b.original.packages).toEqual({
      enabled: ["android", "com.google.android.apps.tv.launcherx", "com.miui.tv.analytics", "com.netflix.ninja"],
      disabled: ["com.old.thing"],
      from: "setup",
    });
  });

  it("keeps an undo line's last space, and each line once", () => {
    const b = buildBackup(input({ undo: ["a11y ", "a11y_on 0", "setting secure screensaver_components ", "a11y ", `home ${STOCK}`] }));
    expect(b.undo).toEqual(["a11y ", "a11y_on 0", "setting secure screensaver_components ", `home ${STOCK}`]);
    expect(b.original.accessibility).toEqual({ services: "", enabled: "0" });
    expect(b.original.screensaver).toBe("");
  });

  it("works a later reading of the apps back with the record", () => {
    // Read after setup: what it switched off reads as off, and Orbit's own apps are there.
    const later = {
      enabled: ["com.netflix.ninja", "dev.shiv.orbit.home", "dev.shiv.orbit.live", "android"],
      disabled: ["com.miui.tv.analytics", "com.google.android.apps.tv.launcherx", "com.old.thing"],
      when: "now" as const,
    };
    expect(originalPackages(later, UNDO)).toEqual({
      enabled: ["android", "com.google.android.apps.tv.launcherx", "com.miui.tv.analytics", "com.netflix.ninja"],
      disabled: ["com.old.thing"],
      from: "record",
    });
    // A reading from before setup comes through the same rule unchanged.
    expect(originalPackages(input().packages, UNDO)?.enabled).toEqual(originalPackages(later, UNDO)?.enabled);
  });

  it("takes the TV's settings now for what the record does not say, without Orbit's own parts", () => {
    const b = buildBackup(
      input({
        undo: ["enable com.miui.tv.analytics"],
        now: {
          home: "dev.shiv.orbit.home/com.gathin.tvhome.MainActivity",
          a11y: "com.example.reader/.Reader:dev.shiv.orbit.home/com.gathin.tvhome.HomeKeyService",
          a11yOn: "1",
          screensaver: "dev.shiv.orbit.home/com.gathin.tvhome.ClockDream",
        },
      }),
    );
    expect(b.original.home).toBeNull();
    expect(b.original.accessibility).toEqual({ services: "com.example.reader/.Reader", enabled: "1" });
    expect(b.original.screensaver).toBeNull();
  });

  it("is not made without a record of what Orbit changed", () => {
    expect(canBackUp([])).toBe(false);
    expect(canBackUp(["", "  "])).toBe(false);
    expect(canBackUp(["enable com.miui.tv.analytics"])).toBe(true);
    expect(() => buildBackup(input({ undo: [] }))).toThrow(/no record/);
  });

  it("knows its size in bytes: what it takes in Google Drive", () => {
    const text = backupText(buildBackup(input()));
    expect(text).toBe(JSON.stringify(JSON.parse(text)));
    expect(backupBytes(text)).toBe(utf8Length(text));
    // A name in another script counts its UTF-8 bytes, not its letters.
    const hindi = backupText(buildBackup(input({ tv: { name: "बैठक", address: "192.168.1.7" } })));
    expect(backupBytes(hindi)).toBe(utf8Length(hindi));
    expect(backupBytes(hindi)).toBeGreaterThan(hindi.length);
  });

  it("is a few KB for a whole TV, and says so in plain words", () => {
    const packages = Array.from({ length: 180 }, (_, i) => `com.vendor.app${String(i).padStart(3, "0")}.service`);
    const text = backupText(buildBackup(input({ packages: { enabled: packages, disabled: [], when: "setup" } })));
    const bytes = backupBytes(text);
    expect(bytes).toBeGreaterThan(5 * 1024);
    expect(bytes).toBeLessThan(10 * 1024);
    expect(sizeText(bytes)).toMatch(/^\d(\.\d)? KB$/);
    expect(sizeText(812)).toBe("812 bytes");
    expect(sizeText(1)).toBe("1 byte");
    expect(sizeText(6144)).toBe("6 KB");
    expect(sizeText(6554)).toBe("6.4 KB");
    expect(sizeText(18 * 1024 + 100)).toBe("18 KB");
    expect(sizeText(1024 * 1024 * 1.2)).toBe("1.2 MB");
    expect(exactBytes(6554)).toBe("6,554 bytes");
  });
});

describe("a backup read back from Drive", () => {
  it("is taken when it is Orbit's, with its record", () => {
    const text = backupText(buildBackup(input()));
    const back = parseBackup(text);
    expect(back.undo).toEqual(UNDO);
    expect(back.tv.name).toBe("Family room");
  });

  it("is refused when it is not one, is newer, or has no record", () => {
    expect(() => parseBackup("not json")).toThrow("That file is not an Orbit backup.");
    expect(() => parseBackup(JSON.stringify({ kind: "something else" }))).toThrow("That file is not an Orbit backup.");
    const b = buildBackup(input());
    expect(() => parseBackup(JSON.stringify({ ...b, version: 2 }))).toThrow(/newer Orbit/);
    expect(() => parseBackup(JSON.stringify({ ...b, undo: [] }))).toThrow(/no record/);
    expect(() => parseBackup(JSON.stringify({ ...b, undo: [1, 2] }))).toThrow(/no record/);
  });
});

describe("the list of backups", () => {
  const item = (id: string, tv: string, model: string | null, at: number): DriveBackup => ({ id, tv, address: "192.168.1.7", model, at, size: 6000 });

  it("puts each TV's backups together, newest first, the TVs by their newest", () => {
    const groups = groupBackups([
      item("a", "Family room", "MiTV-AXFU0", 100),
      item("b", "Bedroom", null, 300),
      item("c", "Family room", "MiTV-AXFU0", 200),
      item("d", "family room ", "MiTV-AXFU0", 50),
    ]);
    expect(groups.map((g) => g.tv)).toEqual(["Bedroom", "Family room"]);
    expect(groups[1].items.map((b) => b.id)).toEqual(["c", "a", "d"]);
    expect(groups[1].model).toBe("MiTV-AXFU0");
  });
});
