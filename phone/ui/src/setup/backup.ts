// A backup of a TV's own setup (phone/SPEC.md, "Backups in Google Drive"): everything needed to put the TV back the way
// it was before Orbit OS, as one small JSON file in the person's own Google Drive. Orbit never changes Android itself: it
// switches apps off and changes the home screen. So the file keeps orbit-undo.sh's record, what the TV is, which apps
// were on and off, and the home screen, accessibility and screensaver settings the TV had.
import type { DriveBackup, SetupProps } from "../bridge";
import { ORBIT_HOMES, mergeUndo } from "./plan";
import { num, t, tn } from "../i18n";

export const BACKUP_KIND = "orbit-tv-backup";
export const BACKUP_VERSION = 1;

export interface TvBackup {
  kind: typeof BACKUP_KIND;
  version: typeof BACKUP_VERSION;
  /** When this copy was made (ISO 8601). */
  made: string;
  /** The Orbit app that made it ("Orbit 1.4.0"). */
  app: string;
  tv: {
    name: string;
    /** Its address on the home Wi-Fi when the copy was made. */
    address: string;
    model: string | null;
    manufacturer: string | null;
    brand: string | null;
    device: string | null;
    /** Android's version, "14". */
    android: string | null;
    sdk: number | null;
  };
  /** When Orbit Setup changed the TV (ISO 8601), when this phone knows. */
  setUp: string | null;
  /** The TV as it was before Orbit OS. Null where nothing says how it was. */
  original: {
    /** The home screen, "com.google.android.apps.tv.launcherx/.MainActivity" (or only its package). */
    home: string | null;
    /** enabled_accessibility_services ("" when none) and accessibility_enabled ("0" or "1"). */
    accessibility: { services: string; enabled: string | null } | null;
    /** screensaver_components ("" when it was not set). */
    screensaver: string | null;
    /**
     * Every installed package, on or off. `from` says how it is known: "setup" read the TV before changing it; "record"
     * read it later and worked it back with the undo record (what setup switched off was on, what it installed was not
     * there).
     */
    packages: { enabled: string[]; disabled: string[]; from: "setup" | "record" } | null;
  };
  /** orbit-undo.sh's record, a line each: what Undo pushes to the TV as undo.txt to put it all back. */
  undo: string[];
}

export interface BackupInput {
  tv: { name: string; address: string };
  /** What the TV said about itself (setupConnect); `model` is the fallback without it. */
  props?: SetupProps | null;
  model?: string | null;
  /** The undo record: the TV's own lines first, then this phone's copy (mergeUndo keeps each once). */
  undo: readonly string[];
  /** When setup ran (ms since 1970). */
  setUpAt?: number | null;
  /** The TV's apps as read before setup ("setup"), or later ("now"; worked back with the record). */
  packages?: { enabled: readonly string[]; disabled: readonly string[]; when: "setup" | "now" } | null;
  /** The TV's settings as read now, for what the record does not say (Orbit's own helper and screensaver left out). */
  now?: { home?: string | null; a11y?: string | null; a11yOn?: string | null; screensaver?: string | null } | null;
  made: Date;
  app: string;
}

/** The undo record's lines for one key ("enable", "home", …), without the key. */
function field(undo: readonly string[], key: string): string[] {
  return undo.filter((l) => l.startsWith(`${key} `)).map((l) => l.slice(key.length + 1));
}

/** Orbit Home's own components (its helper, its screensaver, itself as Home), under either of its ids. */
const isOrbitPart = (component: string) => [...ORBIT_HOMES].some((id) => component === id || component.startsWith(`${id}/`));

/** Whether there is anything to keep: a backup is only made from a record of what Orbit changed. */
export function canBackUp(undo: readonly string[]): boolean {
  return mergeUndo(undo).length > 0;
}

/** The backup itself. Throws when there is no undo record (then nothing says how the TV was). */
export function buildBackup(input: BackupInput): TvBackup {
  const undo = mergeUndo(input.undo);
  if (!undo.length) throw new Error(t("There is no record of what Orbit changed on this TV."));
  const props = input.props ?? null;
  const now = input.now ?? {};

  // The home screen before Orbit: the record's own line; else the TV's now, unless that is Orbit Home.
  const home = field(undo, "home")[0]?.trim() || (now.home && !isOrbitPart(now.home) ? now.home : null);

  // Accessibility: the record's lines; else the TV's now, with Orbit's helper taken out of the list.
  const a11y = field(undo, "a11y");
  const a11yOn = field(undo, "a11y_on");
  let accessibility: TvBackup["original"]["accessibility"] = null;
  if (a11y.length) accessibility = { services: a11y[0], enabled: a11yOn[0]?.trim() || null };
  else if (typeof now.a11y === "string") {
    const services = now.a11y
      .split(":")
      .filter((s) => s && !isOrbitPart(s))
      .join(":");
    // With Orbit's helper the only service, nothing says whether accessibility was on before it.
    accessibility = { services, enabled: services ? (now.a11yOn ?? null) : null };
  }

  // The screensaver: the record's setting line; else the TV's now, unless it is Orbit's clock.
  const saver = undo.find((l) => l.startsWith("setting secure screensaver_components "));
  const screensaver =
    saver !== undefined
      ? saver.slice("setting secure screensaver_components ".length)
      : typeof now.screensaver === "string" && !now.screensaver.split(",").some((c) => isOrbitPart(c.trim()))
        ? now.screensaver
        : null;

  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    made: input.made.toISOString(),
    app: input.app,
    tv: {
      name: input.tv.name,
      address: input.tv.address,
      model: props?.model || input.model || null,
      manufacturer: props?.manufacturer || null,
      brand: props?.brand || null,
      device: props?.device || null,
      android: props?.release || null,
      sdk: typeof props?.sdk === "number" && props.sdk > 0 ? props.sdk : null,
    },
    setUp: input.setUpAt ? new Date(input.setUpAt).toISOString() : null,
    original: { home, accessibility, screensaver, packages: originalPackages(input.packages ?? null, undo) },
    undo,
  };
}

/**
 * The apps as they were before Orbit, worked back with the record: what setup switched off ("enable" lines) was on, and
 * what it installed ("uninstall" lines) was not there. A reading taken before setup changed anything comes through as it
 * is (nothing in it was switched off or installed yet), so the same rule serves a reading from any time.
 */
export function originalPackages(
  read: BackupInput["packages"],
  undo: readonly string[],
): TvBackup["original"]["packages"] {
  if (!read) return null;
  const sorted = (s: Iterable<string>) => [...new Set(s)].sort();
  const switchedOff = new Set(field(undo, "enable").map((p) => p.trim()));
  const installed = new Set(field(undo, "uninstall").map((p) => p.trim()));
  const enabled = new Set([...read.enabled, ...switchedOff].filter((p) => !installed.has(p)));
  const disabled = [...read.disabled].filter((p) => !enabled.has(p) && !installed.has(p));
  return { enabled: sorted(enabled), disabled: sorted(disabled), from: read.when === "setup" ? "setup" : "record" };
}

/** The file exactly as it goes to Drive: compact JSON. */
export const backupText = (backup: TvBackup): string => JSON.stringify(backup);

/** What the file takes in Drive: its UTF-8 bytes. */
export const backupBytes = (text: string): number => new TextEncoder().encode(text).length;

/** "812 bytes", "6.4 KB", "18 KB", "1.2 MB". */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return tn(bytes, "{n} byte", "{n} bytes");
  const kb = bytes / 1024;
  if (kb < 10) return t("{size} KB", { size: num(kb, { maximumFractionDigits: 1 }) });
  if (kb < 1024) return t("{size} KB", { size: num(Math.round(kb)) });
  const mb = kb / 1024;
  return t("{size} MB", { size: mb < 10 ? num(mb, { maximumFractionDigits: 1 }) : num(Math.round(mb)) });
}

/** "6,552 bytes": the exact count, for under the rounded one. */
export const exactBytes = (bytes: number): string => tn(bytes, "{n} byte", "{n} bytes");

/** A file from Drive, checked: it must be one of Orbit's TV backups with an undo record. Throws otherwise. */
export function parseBackup(text: string): TvBackup {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(t("That file is not an Orbit backup."));
  }
  const b = data as Partial<TvBackup> | null;
  if (!b || typeof b !== "object" || b.kind !== BACKUP_KIND) throw new Error(t("That file is not an Orbit backup."));
  if (typeof b.version !== "number" || b.version > BACKUP_VERSION) throw new Error(t("This backup was made by a newer Orbit. Update Orbit, then try again."));
  if (!Array.isArray(b.undo) || !b.undo.every((l) => typeof l === "string")) throw new Error(t("This backup has no record of what Orbit changed."));
  const undo = mergeUndo(b.undo);
  if (!undo.length) throw new Error(t("This backup has no record of what Orbit changed."));
  if (!b.tv || typeof b.tv.name !== "string") throw new Error(t("That file is not an Orbit backup."));
  return { ...(b as TvBackup), undo };
}

/** Backups of the same TV together (its name and model), newest first; the TVs by their newest backup. */
export function groupBackups(list: readonly DriveBackup[]): { key: string; tv: string; model: string | null; address: string; items: DriveBackup[] }[] {
  const groups = new Map<string, { key: string; tv: string; model: string | null; address: string; items: DriveBackup[] }>();
  for (const b of [...list].sort((x, y) => y.at - x.at)) {
    const key = `${b.tv.trim().toLowerCase()}|${(b.model ?? "").toLowerCase()}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { key, tv: b.tv, model: b.model, address: b.address, items: [] }));
    g.items.push(b);
  }
  return [...groups.values()];
}
