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

const AccountBrand = () => <Brand aside={<span className="text-[13px] tracking-[0.3px] text-dusk">Account</span>} />;

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
  // An account that signed in with Apple: the Apple ID stays, and its backups are in a Google Drive the person chose.
  const apple = account.provider === "apple";
  if (a.state === "deleted") {
    return (
      <Screen label="Your Orbit account is deleted" top={28}>
        <AccountBrand />
        <Rise className="mt-8">
          <DoneMark size={56} />
        </Rise>
        <Rise className="mt-[18px] flex flex-col gap-2.5">
          <Title>Your Orbit account is deleted</Title>
          <Lead>{email ? `Orbit no longer has an account for ${email}, and this phone is signed out.` : "Orbit no longer has your account, and this phone is signed out."}</Lead>
        </Rise>
        <Rise className="mt-5">
          <Card className="flex flex-col gap-3 p-4">
            <Stays>The account and everything Orbit's cloud kept for it are gone</Stays>
            <Stays>
              {a.backups
                ? a.removed === 0
                  ? "There were no TV backups in your Google Drive"
                  : `Your TV backups in Google Drive are deleted${a.removed ? ` (${a.removed})` : ""}`
                : "Your TV backups stay in your Google Drive"}
            </Stays>
            <Stays>Your TV still has Orbit OS and works on the home Wi-Fi as before</Stays>
          </Card>
        </Rise>
        <Rise className="mt-auto pt-6">
          <Primary onPress={closeSetup}>Done</Primary>
        </Rise>
      </Screen>
    );
  }
  const busy = a.state === "deleting";
  return (
    <Screen label="Delete your Orbit account" top={28}>
      <AccountBrand />
      <Rise className="mt-8">
        <span className="grid h-14 w-14 place-items-center rounded-[20px] border border-rose/30 bg-rose/10 text-rose">
          <I.Person size={28} />
        </span>
      </Rise>
      <Rise className="mt-[18px] flex flex-col gap-2.5">
        <Title>Delete your Orbit account</Title>
        <Lead>
          {email ? (
            <>
              {apple ? "Signed in with Apple as" : "Signed in as"} <span className="break-all text-haze">{email}</span>. Deleting cannot be undone.
            </>
          ) : (
            "Deleting cannot be undone."
          )}
        </Lead>
      </Rise>
      <Rise className="mt-5">
        <Card className="flex flex-col gap-3 p-4">
          <SectionLabel>What is deleted</SectionLabel>
          {apple ? (
            <>
              <Goes>Your Orbit account: the sign-in Orbit keeps for this Apple ID</Goes>
              <Goes>Orbit's link to your Apple ID: Orbit stops using Sign in with Apple</Goes>
            </>
          ) : (
            <Goes>Your Orbit account: the sign-in Orbit keeps for this Google account</Goes>
          )}
          <Goes>Everything Orbit's cloud keeps for it: your TV's link and name, what the TV last said, commands on their way, and Help mode's pictures</Goes>
          <div className="mt-1 border-t border-white/7 pt-3">
            <Tick on={a.backups} onChange={setDeleteBackups} label="Also delete my TV backups from Google Drive">
              <span className="block text-[14.5px] font-semibold text-snow">Also delete my TV backups from Google Drive</span>
              <span className="mt-0.5 block text-[13px] leading-snug text-mist">
                The files in Orbit's own hidden folder of {apple ? "the Google Drive you chose for them" : "your Drive"}. Without them a lost record cannot
                be brought back.
              </span>
            </Tick>
          </div>
        </Card>
      </Rise>
      <Rise className="mt-3">
        <Card className="flex flex-col gap-3 p-4">
          <SectionLabel>What stays</SectionLabel>
          <Stays>Your TV: Orbit OS stays on it and keeps working on the home Wi-Fi. It is no longer reachable from anywhere.</Stays>
          {apple ? (
            <>
              <Stays>Your Apple ID</Stays>
              <Stays>The Google account you chose for the backups, if any, and everything else in its Drive</Stays>
            </>
          ) : (
            <Stays>Your Google account, and everything else in your Google Drive</Stays>
          )}
          <Stays>This phone's pairing with the TV on the home Wi-Fi (Settings › Forget this TV removes it)</Stays>
        </Card>
      </Rise>
      {a.state === "failed" && a.error && (
        <Rise className="mt-4">
          <Trouble title={a.error.reason === "other" ? "The account was not deleted" : troubleTitle(a.error)}>{a.error.text}</Trouble>
        </Rise>
      )}
      <Rise className="mt-4 flex flex-col gap-1">
        <p className="px-1 text-[13px] leading-snug text-dusk">
          {apple ? "Apple may ask you to sign in once more, to be sure it is you." : "Google may ask you to choose your account once more, to be sure it is you."}
        </p>
        <div className="flex flex-wrap gap-x-4">
          <TextButton className="-ml-2 flex items-center gap-1.5" onPress={() => openLink(LINKS.deleteAccount)}>
            How deleting works <I.External size={15} />
          </TextButton>
          <TextButton className="flex items-center gap-1.5" onPress={() => openLink(LINKS.privacy)}>
            Privacy policy <I.External size={15} />
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
          {busy ? "Deleting your account" : a.state === "failed" ? "Try again" : "Delete my account"}
        </motion.button>
        <TextButton tone="mist" onPress={closeSetup} disabled={busy}>
          Keep my account
        </TextButton>
      </Rise>
    </Screen>
  );
}
