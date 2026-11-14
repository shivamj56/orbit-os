# Build and install

## What you need

| For | Needs |
|---|---|
| Orbit Home and Orbit Live TV | JDK 17, Android SDK platform 34 with build-tools 34.0.0 |
| Orbit, the phone app | Node 20 or later, Flutter 3 |
| The TV tools | Python 3.9 or later; `python3 -m venv tools/venv && tools/venv/bin/pip install -r tools/requirements.txt` |
| The TV | An Android TV or Google TV on the same Wi-Fi as your computer, with network debugging on. Tested on Google TV 14; the apps install from Android 8, but older systems are untried |

## Build the TV apps

```bash
cd launcher
./gradlew :app:assembleRelease :livetv:assembleRelease
./gradlew :app:testReleaseUnitTest :livetv:testReleaseUnitTest
```

The apps land in `launcher/app/build/outputs/apk/release/` and `launcher/livetv/build/outputs/apk/release/`.

> [!WARNING]
> Both TV apps are signed with the key in `$ANDROID_USER_HOME` (by default `~/.android`). Android installs an update
> only over an app signed with the same key, so build every update with the same `ANDROID_USER_HOME` and keep a
> copy of its key. Without it, an update means uninstalling Orbit Home and setting the TV up again.

Orbit Home is `dev.shiv.orbit.home` and Orbit Live TV `dev.shiv.orbit.live`. Builds before 11 Nov used
`com.gathin.tvhome` and `com.gathin.livetv`; Android treats those as other apps, so the steps below put the new ones
beside them. Orbit Setup's `install` moves such a TV over and removes the earlier apps
([phone/SPEC.md](../phone/SPEC.md), "From the earlier ids").

## Build the phone app

```bash
cd phone/ui && npm ci && npm run build          # makes dist/index.html, the whole interface
cd ../app && tool/sync_ui.sh                     # copies it into the app
tool/sync_setup.sh                               # copies both TV APKs (built above) and setup/tv's scripts in
flutter build apk --release --target-platform android-arm,android-arm64
```

GitHub Actions builds it the same way, with the same keys kept as secrets: [ci-cd.md](ci-cd.md). The iPhone app is
built on a Mac with Xcode: [ios.md](ios.md).

A release build is signed with `phone/app/android/app/orbit-release.jks` and the passwords in
`phone/app/android/key.properties`. Neither is in git; keep a copy of both. Tests: `flutter test` in `phone/app`.

### The cloud link (optional)

Orbit works on the Wi-Fi without any of this. To use it away from home:

1. Create a Firebase project. Turn on Google and Anonymous sign-in, and a Realtime Database.
2. Publish `phone/firebase/database.rules.json` as the database's rules.
3. Register the Android app (`dev.shiv.orbit`) with your release key's SHA-1, then save the project's settings as
   `phone/firebase/config.json` and `phone/app/android/app/google-services.json` (both kept out of git). For the
   iPhone, also register the iOS app `dev.shiv.orbit`, turn on Apple sign-in, and put its `GoogleService-Info.plist` in
   place with `phone/app/tool/ios_firebase.sh` ([ios.md](ios.md)).
4. Put the web API key and the database address in the TV's theme as `orbit_api_key` and `orbit_database_url`.

## Put it on a TV

1. **Turn on network debugging.** On the TV: Settings › System › About, press OK on *Android TV OS build* seven
   times, then Settings › System › Developer options › USB debugging. Note the TV's address under Settings ›
   Network.
2. **Say hello.** `TV_HOST=<tv ip> tools/tv.py --probe`. The TV asks *Allow USB debugging?*: tick *Always allow from
   this computer* and press Allow.
3. **Switch off what you do not use.** Copy a folder from `devices/` for your TV, read its list, then
   `TV_HOST=<tv ip> tools/disable.sh devices/<your tv>/debloat.txt`. It records what it changed, so the undo can
   put it back.
4. **Install Orbit Home** and make it the home screen, with the helper service on:
   `SKIP_BUILD=1 HOME_KEY_SERVICE=1 TV_HOST=<tv ip> launcher/build-and-install.sh`.
5. **Give it its look:** `TV_HOST=<tv ip> tools/theme.sh devices/<your tv>/theme`.
6. **Install Orbit Live TV:**
   ```bash
   TV_HOST=<tv ip> tools/b64push.py launcher/livetv/build/outputs/apk/release/livetv-release.apk /data/local/tmp/livetv.apk
   TV_HOST=<tv ip> tools/tv.py "pm install -r /data/local/tmp/livetv.apk && rm /data/local/tmp/livetv.apk"
   ```
7. **Pair the phone.** Install Orbit, open it on the same Wi-Fi, tap the TV and type the code it shows.
8. **Close the door.** Switch USB debugging off again, then `tools/adb-closed.py <tv ip>` should say the port is
   closed.

## Undo

```bash
TV_HOST=<tv ip> tools/restore.sh devices/<your tv>/debloat.txt com.google.android.apps.tv.launcherx
```

It turns back on everything the list switched off and gives Home back to the TV's own launcher. Use the same list
path you applied: the record of what was changed is kept under that path.

## Rules that keep a TV safe

- Switch apps off, never uninstall them, and never switch off the system's core packages (`tools/disable.sh`
  refuses them).
- Some TVs need two packages switched off together, or Home stops working; each `devices/<tv>/README.md` says
  which.
- Wait 20 seconds after a change before restarting the TV: a plain reboot can lose the last few seconds of changes.
- Do not press keys, install or restart while someone is watching.
- Keys pressed with `input keyevent` never reach the helper service. Test keys through the phone door
  (`/api/key`) or from the remote.
