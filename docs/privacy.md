# Orbit privacy policy

Effective 11 November 2026. This covers Orbit, the phone app of Orbit OS (Android package `dev.shiv.orbit`), and what
it does with your data. Orbit is made by one developer, Shivam Anil Jha.

This policy is published at https://shivamj56.github.io/orbit-os-site/privacy.html, and Orbit links to it from
Settings › About.

The short version: Orbit keeps what it needs to be your TV's remote on your phone. When you link your TV for use away
from home, commands and the TV's replies pass through Google's Firebase. When you make a backup, it goes into your own
Google Drive. There are no analytics, no ads, and nothing is sold.

## What stays on your phone

- **Your Google account's name and email address**, when you sign in with Google. Google's sign-in and Firebase
  Authentication keep them on the phone so you stay signed in. Orbit shows your email in Settings.
- **Your TV**: its name, its address on your home Wi-Fi, and the pairing token the TV gave this phone. The token is
  encrypted with a key held in your phone's Android Keystore.
- **What Orbit Setup changed on each TV it set up**: the undo record (which apps it switched off, the TV's own home
  screen, its accessibility and screensaver settings, and which of Orbit's apps it installed), the TV's model and
  Android version, and the list of apps on the TV that setup read. This is what lets Orbit put a TV back.
- **Pictures of your TV's apps** (their icons), kept in the app's cache so the remote opens quickly.
- **Your settings** in Orbit (the feel of the buttons, the volume keys, the pointer speed), and whether demo mode is on.

None of this leaves the phone except as described below. Android's cloud backup and device-to-device transfer are
switched off for Orbit, so it is not copied to Google's backups or to a new phone.

## On your home Wi-Fi

To find your TV, Orbit listens for the TV's own announcements on your Wi-Fi and checks the addresses of your local
network for the TV's port. It then talks to the TV directly over your home network: the buttons you press, what is
playing, app pictures, and in Help mode pictures of the TV's screen. This stays inside your home network and is not
stored anywhere else. It is plain HTTP inside your network; the TV only answers phones that are paired with it.

When Orbit Setup puts Orbit OS on a TV, the phone uses the TV's own debugging connection (after you press Allow on the
TV). It reads the TV's list of apps and model, and sends the setup files; the TV keeps its own copy of the undo record.

## Through Firebase, while your TV is linked

If you sign in with Google and link your TV, so that Orbit works away from home, the phone and the TV talk through
Google's Firebase Realtime Database (in Singapore). Under your account, and readable and writable only by your account:

- **Commands and replies**: each button press or request on its way to the TV, and the TV's answer. The TV deletes a
  command once it has answered it, and the phone deletes the answer once it has read it.
- **Your TV's name, when it was last online, and what it is doing** (the app in front, what is playing and the
  volume), so the remote can show it.
- **That the phone is watching**: a timestamp every few seconds while Orbit is open and using this way.
- **Help mode's screen pictures**: while you have Help open, the TV sends pictures of its screen (menus and apps; video
  shows grey or black). They are deleted when help ends. While help is on, the TV shows a note at the top of its screen
  saying that someone can see it.

Linking uses a short code the TV shows: the phone writes a Google sign-in token to that code once, and the TV deletes
the code when it has used it. Unlinking the TV in Settings removes its link.

Firebase is a Google service; Google processes this data for Orbit under Google's terms.

## In your Google Drive

If you make a backup (at the end of Orbit Setup, or in Settings › This TV › Back up), Orbit saves one small file
(about 6 KB) in your own Google Drive, in the hidden app folder that only Orbit can see (Google calls it
`appDataFolder`). Orbit asks Google for access to that folder only (`drive.appdata`); it cannot see or change anything
else in your Drive. A backup holds the undo record, your TV's name, address, model and Android version, the date, the
list of apps on the TV and which were switched on, and the TV's own home screen, accessibility and screensaver
settings. Settings › Backups lists your backups, can put a TV back from one, and can delete them. The backup counts
towards your Google storage like any file.

## What Orbit does not do

- No analytics, no crash reporting service, no advertising, and no tracking of any kind.
- Your data is never sold, rented or shared with anyone for marketing.
- Orbit does not use your location, contacts, camera or microphone.

## Delete your data

### Deleting your account and data

In the app: open **Settings**, go to **From anywhere**, and tap **Delete my Orbit account**. The next screen says
exactly what goes. With **Also delete my TV backups from Google Drive** left on, Orbit:

1. deletes every Orbit backup in your Google Drive;
2. asks your linked TV to unlink, then deletes everything Orbit's cloud keeps under your account (the TV's link and
   name, what it last said, commands on their way, and Help mode's pictures);
3. deletes your Orbit account from Firebase Authentication (Google may ask you to choose your account again first);
4. removes Orbit's access to your Google account, and signs you out.

Nothing on your TV changes: Orbit OS stays on it and keeps working on your home Wi-Fi.

Or email the developer at heyshivm2002@gmail.com from the account's address; we delete within 30 days. The same steps
are on the web at https://shivamj56.github.io/orbit-os-site/delete-account.html.

### Other data

- **On the phone**: Settings › Forget this TV removes the saved TV and its pairing token. Uninstalling Orbit removes
  everything Orbit keeps on the phone.
- **The link to your TV**: Settings › From anywhere › Unlink TV.
- **Backups one by one**: Settings › Backups, then the bin next to a backup. You can also delete all of Orbit's hidden
  data from Google Drive on the web: Settings › Manage apps, then Options next to Orbit, then Delete hidden app data.
- **Access to your Google account**: you can remove Orbit at any time at myaccount.google.com › Security › Your
  connections to third-party apps and services.
- **On the TV**: Settings › Undo Orbit OS on this TV puts the TV back the way it was and takes Orbit's apps off it.

## Children

Orbit is a remote for a family's TV and is not directed at children under 13. It does not knowingly collect data
about children.

## Changes

If this policy changes, the new version is published here with a new date, and Orbit's release notes say so.

## Contact

Questions, or anything that looks wrong: open an issue at https://github.com/shivamj56/orbit-os-site/issues (Settings ›
About › Report a problem). For deleting your account and data you can also email heyshivm2002@gmail.com.
