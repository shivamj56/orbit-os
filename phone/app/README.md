# Orbit (Flutter half)

The Android and iPhone app around `phone/ui`: a full-screen WebView showing `assets/ui/index.html`, and everything a
page cannot do (find the TV, pair, keep the token, HTTP and UDP to the TV, haptics, the volume keys on Android, keeping
the screen on). The iPhone build, on a Mac with Xcode: `../../docs/ios.md`.
The contract with the page and the TV is `../SPEC.md`.

Build (Flutter 3.47 at `~/development/flutter/bin`, JDK 17, Android SDK 36):

    tool/sync_ui.sh                      # phone/ui/dist/index.html -> assets/ui/index.html (--placeholder puts the test page back)
    flutter build apk --release --target-platform android-arm,android-arm64
    flutter test && flutter analyze

Release signing reads `android/key.properties` (mode 0600), which names `android/app/orbit-release.jks`. Neither is in
git: keep a copy of both somewhere safe, because an update to an installed Orbit must be signed with the same key.

Layout: `lib/tv/` the TV (discovery, HTTP, UDP pointer, secure storage, icon cache, the link's state machine),
`lib/bridge/` the page's `OrbitNative` channel and `window.orbitReceive`, `lib/native/` haptics, wakelock and the
`dev.shiv.orbit/native` channel to `MainActivity.kt` (volume keys, Back, cache directory) and on an iPhone to
`ios/Runner/NativeChannel.swift` (cache directory, links, Sign in with Apple), `lib/app/` the screen.
Tests run against a mock TV on 127.0.0.1 (`test/mock_tv.dart`).
