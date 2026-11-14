# Orbit for iPhone

The same Orbit as on Android: the page from `phone/ui` in a full-screen WebView, and Flutter for everything a page
cannot do. The iPhone's own code is in `phone/app/ios` (Swift where Android has Kotlin). What differs from Android, and
why, is in [phone/SPEC.md](../phone/SPEC.md), "Orbit on iPhone" and "Sign in with Apple".

| | |
|---|---|
| Bundle id | `dev.shiv.orbit` (the same as the Android package) |
| Devices | iPhone only, portrait, iOS 15 or later |
| Apple team | `Z8Q945V7W2`, the company's Apple Developer account: the App Store shows the company's legal name as the seller |
| Version | `version:` in `phone/app/pubspec.yaml`, `1.5.0+6` = CFBundleShortVersionString 1.5.0, CFBundleVersion 6 |
| Sign-in | Sign in with Apple and Google, the same size, Apple first (App Store Guideline 4.8) |

## Where it stands (14 November 2026)

| Step | State |
|---|---|
| The app, its Swift code and its tests | done, on branch `ios/iphone-app` |
| Firebase: the iOS app `dev.shiv.orbit` in `orbit-family-room`, Apple sign-in on, the new link rule published | done (14 Nov) |
| Apple's updated Program License Agreement | **the Account Holder accepts it** in App Store Connect › Business. Until then every API call answers 403 `FORBIDDEN.REQUIRED_AGREEMENTS_MISSING_OR_EXPIRED` |
| Xcode on the Mac | **the owner installs it** from the Mac App Store |
| The app's record in App Store Connect | **made in the web page** (Apple's API cannot create apps); [below](#the-app-record) |
| The Sign in with Apple key, for deleting accounts | **made by the owner** in the developer site; [below](#sign-in-with-apple) |
| Build, upload, TestFlight | `phone/app/tool/ios_release.sh --upload` once the three above are done |
| Listing, screenshots, review notes | written; sent with `work/app-store/asc_listing.py` once the record exists. The privacy answers are typed in the web page (the API has no call for them) |
| Sending it to App Review | **only on the owner's word**, in App Store Connect |

## One-time setup on the Mac

1. Install **Xcode** from the Mac App Store, open it once and let it install its components. Then, in Terminal:
   ```bash
   sudo xcode-select -s /Applications/Xcode.app/Contents/Developer
   ```
   ```bash
   xcodebuild -downloadPlatform iOS
   ```
   The second one fetches the iPhone simulator and SDK (several GB).
2. **Firebase's iPhone settings**, kept out of git like `google-services.json`. The file downloaded on 14 Nov is in
   `work/app-store/GoogleService-Info.plist`:
   ```bash
   phone/app/tool/ios_firebase.sh work/app-store/GoogleService-Info.plist
   ```
   It copies the plist to `ios/Runner/` and writes `ios/Flutter/Firebase.xcconfig` (Google Sign-In's URL scheme). A
   build without them still works, with the cloud path off: the page then offers no sign-in at all.
3. **The App Store Connect API key** is `~/.appstoreconnect/private_keys/AuthKey_<key id>.p8`. Its key id and issuer id
   are in the company app's `mobile/eas.json` (`submit.production.ios`). Signing and uploading go through this key, so
   nobody signs in to Xcode. Never paste the key anywhere.

## Build and send to TestFlight

From the repository folder, the TV apps first (the iPhone app carries them for Orbit Setup, signed with the TV key):

```bash
(cd launcher && ANDROID_USER_HOME="$PWD/../work/android-home" ./gradlew :app:assembleRelease :livetv:assembleRelease)
```
```bash
(cd phone/ui && npm ci && npm run build) && phone/app/tool/sync_ui.sh && phone/app/tool/sync_setup.sh
```
```bash
ASC_KEY_ID=<key id> ASC_ISSUER_ID=<issuer id> phone/app/tool/ios_release.sh --upload
```

`ios_release.sh` refuses to start without the real page, the TV bundle or Firebase's settings, then archives with
Xcode, exports `phone/app/build/ios/ipa/Orbit.ipa`, checks its bundle id, its version against `pubspec.yaml`,
Firebase's plist and the Sign in with Apple entitlement, and with `--upload` sends it to App Store Connect. Without
`--upload` it only makes and checks the IPA. Apple takes 5 to 30 minutes to process a build; then it is in
TestFlight, where testers (people added in App Store Connect › TestFlight) install it with Apple's TestFlight app.

Every upload needs a higher build number: raise `+N` in `pubspec.yaml` (Android's versionCode is the same number,
so the two stores stay in step).

**If the archive stops with "Your team has no devices from which to generate a provisioning profile"**: Xcode's
automatic signing wants one registered iPhone for its development profile. Either register any iPhone's UDID once in
the developer site (Certificates, Identifiers & Profiles › Devices), or sign the archive by hand: an Apple Distribution
certificate and an App Store profile for `dev.shiv.orbit`, made with the API key, in the Mac's keychain. Both are new
items on the company's Apple account, so ask the owner first.

## Try it in the iPhone simulator

```bash
cd phone/app && flutter run -d "iPhone 17"
```

Everything but the TV's own network works there, and demo mode ("Try Orbit without a TV") shows every screen. The
simulator cannot do Sign in with Apple unless it is signed in to an Apple Account, and a debug build has no App Store
profile, so try Apple's sheet on a TestFlight build. The Swift tests run with:

```bash
xcodebuild test -workspace ios/Runner.xcworkspace -scheme Runner -destination 'platform=iOS Simulator,name=iPhone 17'
```

## On GitHub instead (optional)

[`.github/workflows/ios-build.yml`](../.github/workflows/ios-build.yml) runs only by hand (Actions › iOS build › Run
workflow), because a private repository pays ten times Linux's minutes on macOS. Unticked, it is a build check: the app
compiles for an iPhone, unsigned, with no secret. Ticked, it builds the TV apps, signs the iPhone app and sends it to
TestFlight, with these secrets (each from its file straight to GitHub, only if the owner wants builds on GitHub):

| Secret | What it is |
|---|---|
| `APP_STORE_CONNECT_KEY_ID`, `APP_STORE_CONNECT_ISSUER_ID` | the key's two ids |
| `APP_STORE_CONNECT_API_KEY_P8` | the key file's text: `gh secret set APP_STORE_CONNECT_API_KEY_P8 --repo shivamj56/orbit-os < ~/.appstoreconnect/private_keys/AuthKey_<key id>.p8` |
| `ORBIT_GOOGLE_SERVICE_INFO_PLIST_BASE64` | `base64 -i work/app-store/GoogleService-Info.plist \| gh secret set ORBIT_GOOGLE_SERVICE_INFO_PLIST_BASE64 --repo shivamj56/orbit-os` |
| `ORBIT_TV_DEBUG_KEYSTORE_BASE64` | the TV key, as for Android ([ci-cd.md](ci-cd.md#6-secrets)) |

## The app record

App Store Connect › Apps › + › New App, signed in as the Account Holder or an Admin:

| Field | Value |
|---|---|
| Platforms | iOS |
| Name | Orbit OS: Smart TV Remote (if taken: Orbit OS: TV Remote & Setup) |
| Primary language | English (U.K.), as on Google Play |
| Bundle ID | dev.shiv.orbit (registered by the first build; or Certificates, Identifiers & Profiles › Identifiers › +) |
| SKU | orbit-os-ios |
| User access | Full access |

Then, in the record:

- **Pricing and availability:** free, all countries. Under "iPhone and iPad apps on Apple silicon Mac" and Vision
  Pro, turn availability off: Orbit needs the home Wi-Fi of a phone.
- **App Privacy** (the web page only): data collected, all linked to the user, none used for tracking, all for App
  Functionality: Contact info › Email address and Name (optional sign-in), Identifiers › User ID (the account's id),
  Usage data › Product interaction (the TV's commands and what it plays, kept while a TV is linked). Help mode's
  pictures of the TV screen pass through and are deleted, so they are not "collected" in Apple's sense. Privacy policy
  URL: https://shivamj56.github.io/orbit-os-site/privacy.html.
- **Age rating:** none of the content questions apply: 4+.
- **App Review information:** the notes in `work/app-store/listing.md` (demo mode "Try Orbit without a TV", why Orbit
  carries two Android TV apps, how sign-in is used), a contact phone number and email of the owner's choosing.
- **Export compliance** is answered in the app itself (`ITSAppUsesNonExemptEncryption` NO: only Apple's and Google's
  HTTPS, the Keychain, and the RSA signature that authenticates the phone to the TV).

Name, subtitle, keywords, description, promotional text, URLs and screenshots go in with the API once the record
exists: `work/app-store/asc_listing.py` (it never submits anything for review).

## Sign in with Apple

Firebase has Apple switched on (Authentication › Sign-in method). Apple asks apps to revoke Sign in with Apple when an
account is deleted; Orbit does it through Firebase, which needs a Sign in with Apple key once:

1. developer.apple.com › Certificates, Identifiers & Profiles › Keys › +: name "Orbit Sign in with Apple", tick
   **Sign in with Apple**, Configure › primary App ID `dev.shiv.orbit`, Save, Register, and **Download** the `.p8`
   (Apple lets you download it once).
2. Firebase › Authentication › Sign-in method › Apple › OAuth code flow configuration: Apple team ID `Z8Q945V7W2`,
   the key's id, and the key's text.

Until then deleting an Apple account still deletes everything; only the revoke is skipped, and the person can remove
Orbit under Settings › Apple Account › Sign in with Apple on the iPhone.

A TV links to an Apple account only with Orbit Home 3.4 or later (Orbit 1.5 carries it): Orbit Setup puts it on the TV.
