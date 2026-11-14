// Signing in to Orbit's cloud (phone/SPEC.md, "From anywhere"): the ways this phone offers, in the order it gives them
// (an iPhone puts Apple's first, as Apple asks), the words for them, and whether the cloud is there at all.
import type { Account, Phone, SignInWay } from "./bridge";

export const WAY_NAMES: Record<SignInWay, string> = { apple: "Apple", google: "Google" };

/** "Google", "Apple or Google": the ways, in their order. */
export function waysWords(ways: readonly SignInWay[]): string {
  const names = ways.map((w) => WAY_NAMES[w]);
  if (names.length < 2) return names[0] ?? WAY_NAMES.google;
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}

/** "Signed in with Apple": how the account on this phone signed in. */
export const signedInWith = (account: Pick<Account, "provider">) => `Signed in with ${WAY_NAMES[account.provider ?? "google"]}`;

/**
 * Whether accounts, the TV's link from anywhere and Drive backups can work at all: not in a build of the app without the
 * cloud, nor, signed out, on a phone that offers no way to sign in. Without it nothing offers a button that can only fail.
 */
export const cloudOn = (account: Pick<Account, "available" | "signedIn">, phone: Pick<Phone, "signIn">) =>
  account.available && (account.signedIn || phone.signIn.length > 0);

/**
 * Backups of an account that signed in with Apple go to a Google Drive the person picks in Google's own sheet the first
 * time, not to the account's own: the words say "a Google Drive you choose". Signed out, they do on a phone that offers
 * Apple's sign-in.
 */
export const driveIsChosen = (account: Pick<Account, "signedIn" | "provider">, phone: Pick<Phone, "signIn">) =>
  account.signedIn ? account.provider === "apple" : phone.signIn.includes("apple");
