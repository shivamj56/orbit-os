// Settings › "Delete my Orbit account" (phone/SPEC.md, "Deleting the account"): exactly what goes and what stays, one
// choice about the Drive backups, and how it went. Nothing on the TV changes.
import { motion } from "framer-motion";
import { closeSetup, deleteAccount, setDeleteBackups, useSetup } from "../../setup/flow";
import { LINKS, openLink } from "../../links";
import { useWorld } from "../../store";
import * as I from "../icons";
import { spring } from "../kit";
import { Brand, Card, DoneMark, Lead, Primary, Rise, Screen, SectionLabel, Spinner, TextButton, Title, Trouble } from "./parts";
import { troubleTitle } from "./Backup";
import { t, rich, tm } from "../../i18n";

const AccountBrand = () => <Brand aside={<span className="text-[13px] tracking-[0.3px] text-dusk">{t("Account")}</span>} />;

function Goes({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <I.Close size={17} strokeWidth={2.2} className="mt-0.5 shrink-0 text-rose" />
      <span className="text-[14.5px] leading-[1.45] text-haze">{children}</span>
    </div>
  );
}

function Stays({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <I.Check size={18} strokeWidth={2.2} className="mt-0.5 shrink-0 text-sage" />
      <span className="text-[14.5px] leading-[1.45] text-haze">{children}</span>
    </div>
  );
}

/** A box to tick, 44 px tall, as the setup's switches are. */
function Tick({ on, onChange, children, label }: { on: boolean; onChange: (on: boolean) => void; children: React.ReactNode; label: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} className="flex min-h-11 w-full items-start gap-3 text-left">
      <span className={`mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[7px] border-[1.5px] transition-colors ${on ? "border-cyan bg-cyan text-deep" : "border-white/30 bg-transparent"}`}>
        {on && (
          <motion.span initial={{ scale: 0.4 }} animate={{ scale: 1 }} transition={spring}>
            <I.Check size={15} strokeWidth={3} />
          </motion.span>
        )}
      </span>
      <span className="min-w-0">{children}</span>
    </button>
  );
}

export function AccountScreen() {
  const f = useSetup();
  const { account } = useWorld();
  const a = f.account;
  const email = a.email ?? account.email;
  if (a.state === "deleted") {
    return (
      <Screen label={t("Your Orbit account is deleted")} top={28}>
        <AccountBrand />
        <Rise className="mt-8">
          <DoneMark size={56} />
        </Rise>
        <Rise className="mt-[18px] flex flex-col gap-2.5">
          <Title>{t("Your Orbit account is deleted")}</Title>
          <Lead>{email ? t("Orbit no longer has an account for {email}, and this phone is signed out.", { email }) : t("Orbit no longer has your account, and this phone is signed out.")}</Lead>
        </Rise>
        <Rise className="mt-5">
          <Card className="flex flex-col gap-3 p-4">
            <Stays>{t("The account and everything Orbit's cloud kept for it are gone")}</Stays>
            <Stays>
              {a.backups
                ? a.removed === 0
                  ? t("There were no TV backups in your Google Drive")
                  : a.removed
                    ? t("Your TV backups in Google Drive are deleted ({n})", { n: a.removed })
                    : t("Your TV backups in Google Drive are deleted")
                : t("Your TV backups stay in your Google Drive")}
            </Stays>
            <Stays>{t("Your TV still has Orbit OS and works on the home Wi-Fi as before")}</Stays>
          </Card>
        </Rise>
        <Rise className="mt-auto pt-6">
          <Primary onPress={closeSetup}>{t("Done")}</Primary>
        </Rise>
      </Screen>
    );
  }
  const busy = a.state === "deleting";
  return (
    <Screen label={t("Delete your Orbit account")} top={28}>
      <AccountBrand />
      <Rise className="mt-8">
        <span className="grid h-14 w-14 place-items-center rounded-[20px] border border-rose/30 bg-rose/10 text-rose">
          <I.Person size={28} />
        </span>
      </Rise>
      <Rise className="mt-[18px] flex flex-col gap-2.5">
        <Title>{t("Delete your Orbit account")}</Title>
        <Lead>
          {email ? (
            <>
              {rich(t("Signed in as {email}. Deleting cannot be undone."), { email: <span className="break-all text-haze">{email}</span> })}
            </>
          ) : (
            t("Deleting cannot be undone.")
          )}
        </Lead>
      </Rise>
      <Rise className="mt-5">
        <Card className="flex flex-col gap-3 p-4">
          <SectionLabel>{t("What is deleted")}</SectionLabel>
          <Goes>{t("Your Orbit account: the sign-in Orbit keeps for this Google account")}</Goes>
          <Goes>{t("Everything Orbit's cloud keeps for it: your TV's link and name, what the TV last said, commands on their way, and Help mode's pictures")}</Goes>
          <div className="mt-1 border-t border-white/7 pt-3">
            <Tick on={a.backups} onChange={setDeleteBackups} label={t("Also delete my TV backups from Google Drive")}>
              <span className="block text-[14.5px] font-semibold text-snow">{t("Also delete my TV backups from Google Drive")}</span>
              <span className="mt-0.5 block text-[13px] leading-snug text-mist">{t("The files in Orbit's own hidden folder of your Drive. Without them a lost record cannot be brought back.")}</span>
            </Tick>
          </div>
        </Card>
      </Rise>
      <Rise className="mt-3">
        <Card className="flex flex-col gap-3 p-4">
          <SectionLabel>{t("What stays")}</SectionLabel>
          <Stays>{t("Your TV: Orbit OS stays on it and keeps working on the home Wi-Fi. It is no longer reachable from anywhere.")}</Stays>
          <Stays>{t("Your Google account, and everything else in your Google Drive")}</Stays>
          <Stays>{t("This phone's pairing with the TV on the home Wi-Fi (Settings › Forget this TV removes it)")}</Stays>
        </Card>
      </Rise>
      {a.state === "failed" && a.error && (
        <Rise className="mt-4">
          <Trouble title={a.error.reason === "other" ? t("The account was not deleted") : troubleTitle(a.error)}>{tm(a.error.text)}</Trouble>
        </Rise>
      )}
      <Rise className="mt-4 flex flex-col gap-1">
        <p className="px-1 text-[13px] leading-snug text-dusk">{t("Google may ask you to choose your account once more, to be sure it is you.")}</p>
        <div className="flex flex-wrap gap-x-4">
          <TextButton className="-ml-2 flex items-center gap-1.5" onPress={() => openLink(LINKS.deleteAccount)}>
            {t("How deleting works")}{" "}<I.External size={15} />
          </TextButton>
          <TextButton className="flex items-center gap-1.5" onPress={() => openLink(LINKS.privacy)}>
            {t("Privacy policy")}{" "}<I.External size={15} />
          </TextButton>
        </div>
      </Rise>
      <Rise className="mt-auto flex flex-col gap-1.5 pt-6">
        <motion.button
          type="button"
          onClick={() => deleteAccount(email)}
          disabled={busy || !account.signedIn}
          whileTap={{ scale: 0.97 }}
          transition={spring}
          aria-busy={busy || undefined}
          className="flex h-14 w-full items-center justify-center gap-2.5 rounded-[18px] bg-rose text-[17px] font-semibold text-[#2a0710] disabled:opacity-55"
        >
          {busy && <Spinner size={18} dark />}
          {busy ? t("Deleting your account") : a.state === "failed" ? t("Try again") : t("Delete my account")}
        </motion.button>
        <TextButton tone="mist" onPress={closeSetup} disabled={busy}>
          {t("Keep my account")}
        </TextButton>
      </Rise>
    </Screen>
  );
}
