// What the screens offer for the phone they are on (phone/SPEC.md, "The bridge" and "From anywhere"): an iPhone's
// "Continue with Apple" before Google's, no volume-buttons row where the phone has none, and nothing about accounts,
// the link from anywhere or Drive backups in a build of the app without the cloud. The screens are drawn to HTML as
// a server would (no DOM here), with the stores they read held still.
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OLDER_PHONE, signedOut, type Account, type Phone, type Status } from "./bridge";
import { cloudOn, driveIsChosen, signedInWith, waysWords } from "./signin";
import { Connect } from "./ui/Connect";
import { SettingsSheet } from "./ui/Sheets";
import { SetupSignIn, SignInPills } from "./ui/SignIn";
import { AccountScreen } from "./ui/setup/Account";
import { You } from "./ui/setup/Install";

const held = vi.hoisted(() => ({ world: null as unknown }));

vi.mock("./store", async (original) => ({ ...(await original<typeof import("./store")>()), useWorld: () => held.world }));
vi.mock("./demo", async (original) => ({ ...(await original<typeof import("./demo")>()), useDemo: () => false }));
vi.mock("./setup/flow", async (original) => {
  const flow = await original<typeof import("./setup/flow")>();
  return { ...flow, useSetup: () => flow.flowNow() };
});

const IPHONE: Phone = { platform: "ios", volumeKeys: false, signIn: ["apple", "google"] };
const ANDROID: Phone = OLDER_PHONE;
const CONNECTED: Status = { state: "connected", tv: { name: "Family room", address: "192.168.1.20", port: 8090, udp: 8091 }, via: "wifi", error: null };
const SEARCHING: Status = { state: "searching", tv: null, found: [], via: "wifi", error: null };
const APPLE_ACCOUNT: Account = { ...signedOut(), signedIn: true, email: "asha.k@privaterelay.appleid.com", provider: "apple" };

function hold(phone: Phone, account: Partial<Account> = {}, status: Status = CONNECTED) {
  held.world = {
    status,
    tv: null,
    settings: { haptics: true, volumeKeys: true, speed: 1, mode: "focus" },
    account: { ...signedOut(), ...account },
    phone,
    page: "remote",
  };
}

const draw = <P extends object>(component: ComponentType<P>, props: P) => renderToStaticMarkup(createElement(component, props));
const settings = () => draw(SettingsSheet, { open: true, onClose: () => {}, status: CONNECTED });

/** The sign-in buttons' titles as they read, top to bottom (the words on the page, not their labels for screen readers). */
const buttons = (html: string) =>
  html
    .split(/<[^>]+>/)
    .map((text) => text.trim())
    .filter((text) => /^Continue with \w+$/.test(text));

describe("the sign-in buttons", () => {
  beforeEach(() => hold(IPHONE));

  it("are one per way the phone offers, in its order: an iPhone's Apple first", () => {
    const pills = draw(SignInPills, { ways: ["apple", "google"], busy: null, onPress: () => {} });
    expect(buttons(pills)).toEqual(["Continue with Apple", "Continue with Google"]);
    expect(buttons(draw(SignInPills, { ways: ["google"], busy: null, onPress: () => {} }))).toEqual(["Continue with Google"]);
    // Whatever order the phone gives is the order shown.
    expect(buttons(draw(SignInPills, { ways: ["google", "apple"], busy: null, onPress: () => {} }))).toEqual(["Continue with Google", "Continue with Apple"]);
    const setup = draw(SetupSignIn, { ways: ["apple", "google"], busy: null, onPress: () => {}, size: "h-[52px]", alone: { className: "glass", dark: false } });
    expect(buttons(setup)).toEqual(["Continue with Apple", "Continue with Google"]);
  });

  it("give Apple's the same size and shape as Google's, white with black, and Google's beside it the same", () => {
    const pills = draw(SignInPills, { ways: ["apple", "google"], busy: null, onPress: () => {} });
    const classes = [...pills.matchAll(/<button[^>]*class="([^"]*)"/g)].map((m) => m[1]);
    expect(classes).toHaveLength(2);
    expect(classes[0]).toBe(classes[1]);
    expect(classes[0]).toContain("h-12 w-full rounded-full bg-white text-black font-system");
    // Alone, Google's keeps the remote's own white pill.
    expect(draw(SignInPills, { ways: ["google"], busy: null, onPress: () => {} })).toContain("h-12 w-full rounded-full bg-text text-ink");
  });

  it("say which sheet is opening, and wait while it is open", () => {
    const html = draw(SignInPills, { ways: ["apple", "google"], busy: "apple", onPress: () => {} });
    expect(html).toContain("Opening Apple…");
    expect(html.match(/<button[^>]*disabled=""/g)).toHaveLength(2);
    const setup = draw(SetupSignIn, { ways: ["apple", "google"], busy: "apple", onPress: () => {}, size: "", alone: { className: "", dark: false } });
    expect(setup).toContain("Opening Apple<");
  });

  it("show on the Connect screen and in Settings as the phone offers them", () => {
    expect(buttons(draw(Connect, { status: SEARCHING }))).toEqual(["Continue with Apple", "Continue with Google"]);
    expect(buttons(settings())).toEqual(["Continue with Apple", "Continue with Google"]);
    expect(buttons(draw(You, {}))).toEqual(["Continue with Apple", "Continue with Google"]);
    hold(ANDROID);
    expect(buttons(draw(Connect, { status: SEARCHING }))).toEqual(["Continue with Google"]);
    expect(buttons(settings())).toEqual(["Continue with Google"]);
    expect(buttons(draw(You, {}))).toEqual(["Continue with Google"]);
  });
});

describe("Settings on the phone it is on", () => {
  it("has the volume-buttons row only where Orbit may use the volume buttons", () => {
    hold(ANDROID);
    expect(settings()).toContain("Phone&#x27;s volume buttons");
    hold(IPHONE);
    expect(settings()).not.toContain("volume buttons");
  });

  it("says how the account signed in, and shows an Apple relay address as it is", () => {
    hold(IPHONE, APPLE_ACCOUNT);
    expect(settings()).toContain("Signed in with Apple as <span");
    expect(settings()).toContain("asha.k@privaterelay.appleid.com");
    hold(ANDROID, { signedIn: true, email: "you@gmail.com", provider: "google" });
    expect(settings()).toContain("Signed in with Google as <span");
  });

  it("says an Apple account's backups go to a Google Drive the person chooses", () => {
    hold(IPHONE, APPLE_ACCOUNT);
    expect(settings()).toContain("as a small file in a Google Drive you choose.");
    hold(ANDROID, { signedIn: true, email: "you@gmail.com", provider: "google" });
    expect(settings()).toContain("as a small file in your own Google Drive.");
  });
});

describe("a build of the app without the cloud", () => {
  const CLOUD = ["From anywhere", "Use from anywhere", "Back up this TV", "Backups in Google Drive", "Continue with", "Your account", "Delete my Orbit account"];

  it("offers nothing that needs it: no account, no link, no Drive", () => {
    for (const phone of [IPHONE, ANDROID]) {
      hold(phone, { available: false });
      for (const html of [settings(), draw(Connect, { status: SEARCHING }), draw(You, {})]) {
        for (const words of CLOUD) expect(html).not.toContain(words);
      }
      // What does not need the cloud stays.
      expect(settings()).toContain("Undo Orbit OS on this TV");
      expect(draw(You, {})).toContain("Your name");
    }
  });

  it("is told apart from a build with the cloud, where all of it shows", () => {
    hold(ANDROID);
    const html = settings();
    for (const words of ["From anywhere", "Back up this TV", "Backups in Google Drive", "Continue with Google"]) expect(html).toContain(words);
    expect(draw(Connect, { status: SEARCHING })).toContain("Use from anywhere");
  });
});

describe("deleting an account that signed in with Apple", () => {
  it("keeps the Apple ID, stops Sign in with Apple, and still offers to delete the Drive backups", () => {
    hold(IPHONE, APPLE_ACCOUNT);
    const html = draw(AccountScreen, {});
    expect(html).toContain("Signed in with Apple as");
    expect(html).toContain("Your Apple ID");
    expect(html).toContain("Orbit stops using Sign in with Apple");
    expect(html).toContain("Also delete my TV backups from Google Drive");
    expect(html).not.toContain("this Google account");
  });

  it("keeps Google's words for a Google account", () => {
    hold(ANDROID, { signedIn: true, email: "you@gmail.com", provider: "google" });
    const html = draw(AccountScreen, {});
    expect(html).toContain("the sign-in Orbit keeps for this Google account");
    expect(html).toContain("Your Google account, and everything else in your Google Drive");
    expect(html).not.toContain("Apple");
  });
});

describe("the words for the ways", () => {
  it("name them in their order, and how the account signed in", () => {
    expect(waysWords(["google"])).toBe("Google");
    expect(waysWords(["apple", "google"])).toBe("Apple or Google");
    expect(signedInWith({ provider: "apple" })).toBe("Signed in with Apple");
    // An older app's account says no provider: it is Google's.
    expect(signedInWith({ provider: null })).toBe("Signed in with Google");
  });

  it("know when the cloud is there, and when the Drive is one the person chooses", () => {
    expect(cloudOn({ available: true, signedIn: false }, IPHONE)).toBe(true);
    expect(cloudOn({ available: false, signedIn: false }, IPHONE)).toBe(false);
    expect(cloudOn({ available: true, signedIn: false }, { signIn: [] })).toBe(false);
    expect(driveIsChosen(APPLE_ACCOUNT, IPHONE)).toBe(true);
    expect(driveIsChosen({ signedIn: true, provider: "google" }, IPHONE)).toBe(false);
    expect(driveIsChosen({ signedIn: false, provider: null }, IPHONE)).toBe(true);
    expect(driveIsChosen({ signedIn: false, provider: null }, ANDROID)).toBe(false);
  });
});
