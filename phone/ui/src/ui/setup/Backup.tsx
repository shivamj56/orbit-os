// Backups of a TV's own setup in the person's Google Drive (phone/SPEC.md, "Backups in Google Drive"): Settings › This
// TV › Back up, the card on Ready after a setup, and Settings › Backups with "Put this TV back".
import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import type { DriveBackup } from "../../bridge";
import {
  closeSetup,
  deleteBackup,
  finishBackup,
  loadBackups,
  readTvForBackup,
  restoreFrom,
  saveBackup,
  setCloseDev,
  signInAndList,
  signInAndSave,
  tvName,
  useSetup,
  type DriveTrouble,
  type Flow,
} from "../../setup/flow";
import { exactBytes, groupBackups, sizeText } from "../../setup/backup";
import { useWorld } from "../../store";
import { GoogleMark } from "../Connect";
import * as I from "../icons";
import { Brand, Card, DoneMark, Lead, Primary, Quiet, Rise, Screen, SectionLabel, Spinner, Switch, TextButton, Title, Trouble, ease } from "./parts";
import { t, rich, tm, currentLanguage } from "../../i18n";

const BackupBrand = ({ word = "Backup" }: { word?: string }) => <Brand aside={<span className="text-[13px] tracking-[0.3px] text-dusk">{word}</span>} />;

/** A Drive failure's title: what happened, in a few words; the text under it says what to do. */
export function troubleTitle(trouble: DriveTrouble): string {
  switch (trouble.reason) {
    case "noAccount":
      return t("Sign in with Google first");
    case "refused":
      return t("Google Drive was not allowed");
    case "full":
      return t("Your Google Drive is full");
    case "offline":
      return t("No internet on this phone");
    case "file":
      return t("That backup could not be read");
    default:
      return t("Google Drive did not take it");
  }
}

export function when(ms: number): string {
  const d = new Date(ms);
  // English keeps the day-month order it always had; every other language writes dates its own way, in Western digits.
  const code = currentLanguage().code;
  const lang = code === "en" ? "en-GB" : `${code}-u-nu-latn`;
  return t("{date}, {time}", {
    date: d.toLocaleDateString(lang, { day: "numeric", month: "short", year: "numeric" }),
    time: d.toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" }),
  });
}

function Keeps({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <I.Check size={18} strokeWidth={2.2} className="mt-0.5 shrink-0 text-sage" />
      <span className="text-[14.5px] leading-[1.45] text-haze">{children}</span>
    </div>
  );
}

/** "This backup uses 6.4 KB of your Google Drive", and the exact count. */
function SizeLine({ bytes }: { bytes: number }) {
  return (
    <div className="flex items-center gap-3.5 rounded-[18px] border border-cyan/25 bg-cyan/[0.06] px-4 py-3.5">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-cyan/14 text-cyan">
        <I.CloudUp size={22} />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] leading-snug font-semibold text-snow">{t("This backup uses {size} of your Google Drive", { size: sizeText(bytes) })}</span>
        <span className="tabular mt-0.5 block text-[12.5px] text-mist">{t("{size}, in a hidden folder only Orbit can open", { size: exactBytes(bytes) })}</span>
      </span>
    </div>
  );
}

/** What to press: save, sign in first, try again, or done. Shared by the backup screen and Ready's card. */
function BackupActions({ f, compact = false, onDone }: { f: Flow; compact?: boolean; onDone?: () => void }) {
  const { account } = useWorld();
  const b = f.backup;
  const Button = compact ? Quiet : Primary;
  if (b.state === "saved") {
    return onDone ? <Primary onPress={onDone} busy={f.closing}>{t("Done")}</Primary> : null;
  }
  if (!account.signedIn || b.error?.reason === "noAccount") {
    return (
      <Button onPress={signInAndSave} busy={f.signingIn || b.state === "saving"} label={t("Continue with Google, then back up")}>
        {!f.signingIn && b.state !== "saving" && <GoogleMark />}
        {f.signingIn ? t("Opening Google") : b.state === "saving" ? t("Saving to Google Drive") : t("Continue with Google")}
      </Button>
    );
  }
  return (
    <Button onPress={saveBackup} busy={b.state === "saving"} disabled={!b.text}>
      {b.state === "saving" ? t("Saving to Google Drive") : b.state === "failed" ? t("Try again") : t("Back up to Google Drive")}
    </Button>
  );
}

function Saved({ saved, email }: { saved: NonNullable<Flow["backup"]["saved"]>; email: string | null }) {
  return (
    <motion.div
      className="flex items-center gap-3 rounded-[18px] border border-sage/35 bg-sage/8 px-4 py-3.5"
      role="status"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease }}
    >
      <DoneMark size={30} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] font-semibold">{t("Saved in your Google Drive")}</span>
        <span className="text-[13px] break-words text-mist">
          {when(saved.at)} · {sizeText(saved.size)}
          {email ? ` · ${email}` : ""}
        </span>
      </div>
    </motion.div>
  );
}

// ---- Settings › This TV › Back up ----

export function BackupScreen() {
  const f = useSetup();
  const { account } = useWorld();
  const b = f.backup;
  const name = tvName(f);
  const shown = name === "your TV" ? t("this TV") : name;
  const android = f.conn.props?.release ?? f.record?.props?.release;
  const cloud = f.tv?.address === "cloud";
  return (
    <Screen label={t("Back up {shown}", { shown })} top={28}>
      <BackupBrand />
      <Rise className="mt-8">
        <span
          className="grid h-14 w-14 place-items-center rounded-[20px] border border-ice/28 text-ice"
          style={{ background: "linear-gradient(145deg, rgba(116,209,255,0.18), rgba(233,179,255,0.12))" }}
        >
          <I.CloudUp size={28} />
        </span>
      </Rise>
      <Rise className="mt-[18px] flex flex-col gap-2.5">
        <Title>{name === "your TV" ? t("Back up this TV's own setup") : t("Back up {tv}'s own setup", { tv: name })}</Title>
        <Lead>{t("How the TV was before Orbit OS, kept in your own Google Drive, so it can always be put back, even from a new phone.")}</Lead>
      </Rise>
      <Rise className="mt-5">
        <Card className="flex flex-col gap-3 p-4">
          <SectionLabel>{t("What it keeps")}</SectionLabel>
          <Keeps>{t("The record of everything Orbit changed")}</Keeps>
          <Keeps>{android ? t("The TV's model, Android {version}, and the date", { version: android }) : t("The TV's model and Android version, and the date")}</Keeps>
          <Keeps>{t("Every app on the TV, and which were switched on")}</Keeps>
          <Keeps>{t("The TV's own home screen, accessibility and screensaver settings")}</Keeps>
        </Card>
        <p className="mt-2.5 px-1 text-[12.5px] leading-snug text-dusk">{t("Orbit never changes Android itself, so this small file is all it takes to put the TV back.")}</p>
      </Rise>

      <Rise className="mt-4 flex flex-col gap-3" aria-live="polite">
        {!f.recordLoaded || b.state === "idle" ? (
          <div className="flex items-center gap-3 text-[14px] text-mist">
            <Spinner size={18} /> {t("Getting the backup ready")}
          </div>
        ) : b.state === "needsTv" ? (
          <p className="rounded-[16px] bg-white/[0.035] px-4 py-3 text-[14px] leading-snug text-haze">
            {cloud
              ? t("This phone does not have the TV's list of apps. Orbit reads it from the TV over the home Wi-Fi: join this phone to the TV's Wi-Fi, then open Back up again.")
              : t("This phone does not have the TV's list of apps yet, so Orbit reads it from the TV first. The TV's USB debugging has to be on; the next screen shows how.")}
          </p>
        ) : b.state === "none" ? (
          <Trouble title={t("There is nothing to back up yet")}>
            {t("Orbit has no record of what it changed on this TV, so a backup could not say how the TV was. A TV set up with Orbit Setup has one.")}
          </Trouble>
        ) : (
          <>
            <SizeLine bytes={b.bytes} />
            {account.signedIn && b.state !== "saved" && (
              <p className="px-1 text-[13px] leading-snug text-mist">
                {rich(t("It goes to the Google Drive of {email}."), { email: <span className="break-all text-snow">{account.email}</span> })}
              </p>
            )}
            {b.state === "saved" && b.saved && <Saved saved={b.saved} email={account.email} />}
            {b.state === "failed" && b.error && b.error.reason !== "noAccount" && <Trouble title={troubleTitle(b.error)}>{tm(b.error.text)}</Trouble>}
            {b.error?.reason === "noAccount" && <p className="px-1 text-[13px] leading-snug text-dusk">{tm(b.error.text)}</p>}
            {f.signInError && (
              <p role="alert" className="px-1 text-[13px] leading-snug text-rose">
                {tm(f.signInError)}
              </p>
            )}
          </>
        )}
      </Rise>

      {f.conn.state === "connected" && (b.state === "saved" || b.state === "ready" || b.state === "failed" || b.state === "none") && (
        <Rise className="mt-4">
          <Card className="flex items-center gap-3.5 rounded-[18px] p-4">
            <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <span className="text-[15px] font-semibold">{t("Close developer mode")}</span>
              <span className="text-[13px] leading-[1.4] text-mist">{t("Recommended, once Orbit has read the TV.")}</span>
            </div>
            <Switch on={f.closeDev} onChange={setCloseDev} label={t("Close developer mode")} />
          </Card>
        </Rise>
      )}

      <Rise className="mt-auto flex flex-col gap-1.5 pt-6">
        {b.state === "needsTv" ? (
          cloud ? (
            <Primary onPress={closeSetup}>{t("Close")}</Primary>
          ) : (
            <Primary onPress={readTvForBackup}>{t("Read the TV")}</Primary>
          )
        ) : b.state === "none" ? (
          <Primary onPress={finishBackup} busy={f.closing}>
            {t("Close")}
          </Primary>
        ) : (
          <BackupActions f={f} onDone={finishBackup} />
        )}
        {b.state !== "saved" && b.state !== "none" && !(b.state === "needsTv" && cloud) && (
          <TextButton tone="mist" onPress={finishBackup} disabled={b.state === "saving"}>
            {t("Not now")}
          </TextButton>
        )}
      </Rise>
    </Screen>
  );
}

// ---- the card on Ready, after a setup ----

export function BackupCard() {
  const f = useSetup();
  const { account } = useWorld();
  const b = f.backup;
  if (b.state !== "ready" && b.state !== "saving" && b.state !== "saved" && b.state !== "failed") return null;
  return (
    <Card className="flex flex-col gap-3 rounded-[18px] p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[12px] bg-cyan/14 text-cyan">
          <I.CloudUp size={20} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <span className="text-[15px] font-semibold">{t("Keep a copy in Google Drive")}</span>
          <span className="text-[13px] leading-[1.45] text-mist">
            {t("How this TV was before Orbit OS, so it can always be put back. This backup uses {size} of your Google Drive.", { size: sizeText(b.bytes) })}
          </span>
        </div>
      </div>
      <AnimatePresence initial={false} mode="wait">
        {b.state === "saved" && b.saved ? (
          <Saved key="saved" saved={b.saved} email={account.email} />
        ) : (
          <motion.div key="act" className="flex flex-col gap-2.5" exit={{ opacity: 0 }}>
            {b.state === "failed" && b.error && b.error.reason !== "noAccount" && <Trouble title={troubleTitle(b.error)}>{tm(b.error.text)}</Trouble>}
            <BackupActions f={f} compact />
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}

// ---- Settings › Backups ----

export function BackupsScreen() {
  const f = useSetup();
  const { account } = useWorld();
  const list = f.backups;
  const groups = groupBackups(list.items);
  const email = list.email ?? account.email;
  return (
    <Screen label={t("Backups in Google Drive")} top={28}>
      <BackupBrand word={t("Backups")} />
      <Rise className="mt-8 flex flex-col gap-2.5">
        <Title>{t("Backups in Google Drive")}</Title>
        <Lead>
          {email ? (
            <>
              {rich(t("Each TV's own setup, as Orbit saved it to the Google Drive of {email}."), { email: <span className="break-all text-haze">{email}</span> })}
            </>
          ) : (
            t("Each TV's own setup, as Orbit saved it to your Google Drive.")
          )}
        </Lead>
      </Rise>

      <Rise className="mt-5 flex flex-col gap-4" aria-live="polite">
        {list.state === "loading" || list.state === "idle" ? (
          <div className="flex items-center gap-3 text-[14px] text-mist">
            <Spinner size={18} /> {t("Asking Google Drive")}
          </div>
        ) : list.state === "failed" && list.error?.reason === "noAccount" ? (
          <Card className="flex flex-col gap-2 p-4">
            <span className="text-[15px] font-semibold">{t("Sign in with Google to see them")}</span>
            <span className="text-[13.5px] leading-[1.45] text-mist">{t("Orbit keeps backups in the Google Drive of the account it is signed in with.")}</span>
          </Card>
        ) : list.state === "failed" && list.error ? (
          <Trouble title={troubleTitle(list.error)}>{tm(list.error.text)}</Trouble>
        ) : groups.length === 0 ? (
          <Card className="flex flex-col gap-2 p-4">
            <span className="text-[15px] font-semibold">{t("No backups yet")}</span>
            <span className="text-[13.5px] leading-[1.45] text-mist">
              {t("Back a TV up at the end of Orbit Setup, or any time from Settings › This TV › Back up.")}
            </span>
          </Card>
        ) : (
          groups.map((g) => (
            <section key={g.key} aria-label={t("Backups of {tv}", { tv: g.tv })} className="flex flex-col gap-2">
              <div className="flex items-center gap-3 px-1">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[13px] bg-night-tile text-cyan">
                  <I.Tv size={20} />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[16px] font-semibold">{g.tv}</span>
                  <span className="tabular block truncate text-[12.5px] text-mist">{[g.model, g.address].filter(Boolean).join(" · ")}</span>
                </span>
              </div>
              <Card className="flex flex-col divide-y divide-white/7 px-4">
                {g.items.map((b, i) => (
                  <BackupRow key={b.id} b={b} newest={i === 0} f={f} />
                ))}
              </Card>
            </section>
          ))
        )}
        {list.state === "done" && list.error && <Trouble title={troubleTitle(list.error)}>{tm(list.error.text)}</Trouble>}
      </Rise>

      <Rise className="mt-auto flex flex-col gap-1.5 pt-6">
        {f.signInError && (
          <p role="alert" className="px-1 text-center text-[13px] leading-snug text-rose">
            {tm(f.signInError)}
          </p>
        )}
        {list.state === "failed" && list.error?.reason === "noAccount" ? (
          <Primary onPress={signInAndList} busy={f.signingIn} label={t("Continue with Google")}>
            {!f.signingIn && <GoogleMark />}
            {f.signingIn ? t("Opening Google") : t("Continue with Google")}
          </Primary>
        ) : (
          list.state === "failed" && <Primary onPress={loadBackups}>{t("Try again")}</Primary>
        )}
        <TextButton tone="mist" onPress={closeSetup}>
          {t("Close")}
        </TextButton>
      </Rise>
    </Screen>
  );
}

function BackupRow({ b, newest, f }: { b: DriveBackup; newest: boolean; f: Flow }) {
  const [asking, setAsking] = useState(false);
  const opening = f.backups.opening === b.id;
  const deleting = f.backups.deleting === b.id;
  const busy = !!f.backups.opening || !!f.backups.deleting;
  return (
    <div className="flex flex-col gap-3 py-3.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-[15px] text-snow">{when(b.at)}</span>
          <span className="tabular mt-0.5 block text-[12.5px] text-mist">
            {sizeText(b.size)}
            {newest ? " " + t("· the newest") : ""}
          </span>
        </span>
      </div>
      <AnimatePresence initial={false} mode="wait">
        {asking ? (
          <motion.div key="ask" className="flex flex-col gap-2" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease }}>
            <span className="text-[13.5px] leading-snug text-haze">{t("Delete this backup from your Google Drive? It cannot be brought back.")}</span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => deleteBackup(b.id).then(() => setAsking(false))}
                disabled={busy}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[14px] border border-rose/40 bg-rose/10 text-[15px] font-semibold text-rose disabled:opacity-50"
              >
                {deleting && <Spinner size={15} />} {t("Delete")}
              </button>
              <button type="button" onClick={() => setAsking(false)} className="h-11 flex-1 rounded-[14px] border border-white/12 bg-white/6 text-[15px] font-semibold text-haze">
                {t("Keep it")}
              </button>
            </div>
          </motion.div>
        ) : (
          <motion.div key="acts" className="flex items-center gap-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <button
              type="button"
              onClick={() => restoreFrom(b)}
              disabled={busy}
              aria-label={t("Put {tv} back with the backup of {date}", { tv: b.tv, date: when(b.at) })}
              className="flex h-11 flex-1 items-center justify-center gap-2 rounded-[14px] bg-cyan text-[15px] font-semibold text-deep disabled:opacity-50"
            >
              {opening ? <Spinner size={15} dark /> : <I.CloudDown size={18} />}
              {opening ? t("Opening the backup") : t("Put this TV back")}
            </button>
            <button
              type="button"
              onClick={() => setAsking(true)}
              disabled={busy}
              aria-label={t("Delete the backup of {date}", { date: when(b.at) })}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-[14px] border border-white/12 bg-white/5 text-mist disabled:opacity-50"
            >
              <I.Trash size={19} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
