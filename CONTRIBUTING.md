# Contributing to Orbit OS

Thank you for helping. Orbit OS started as one person's project for a family room TV and is now open to everyone:
each TV report, bug, idea and pull request makes it work in more homes.

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md). A security problem goes in private, as
[SECURITY.md](SECURITY.md) says, never in a public issue.

## Ways to help

- **Tell us how Orbit runs on your TV.** Orbit OS is tested on one TV so far, the Xiaomi TV A Pro. A
  [TV report](https://github.com/shivamj56/orbit-os/issues/new?template=tv-report.yml) with your TV's model code
  (Settings › System › About), its Android TV or Google TV version and what worked is the most useful thing you can
  send: it is how the library of TVs grows.
- **Report a bug** with the [bug report](https://github.com/shivamj56/orbit-os/issues/new?template=bug.yml): what
  happened, what you expected, the steps, your phone and TV, and Orbit's version (Settings › About in the app).
- **Suggest an idea** with the [idea form](https://github.com/shivamj56/orbit-os/issues/new?template=idea.yml).
- **Add your TV to [`devices/`](devices).** Copy the closest folder, name it after the model code, and change the list
  after reading what is on the TV ([devices/README.md](devices/README.md)). Each group of packages to switch off says
  why, and the folder's README says what must go together.
- **Send code.** For anything bigger than a small fix, open an issue first and say what you plan, so that nobody
  spends days on something that cannot go in.

## Set up

What each part needs and how to build it is in the README, under [Build from source](README.md#build-from-source);
setting a TV up by hand from a computer is in [docs/build-and-install.md](docs/build-and-install.md). Read
[docs/architecture.md](docs/architecture.md) for how the parts fit, and [phone/SPEC.md](phone/SPEC.md) before you
change anything between the phone and the TV: it is the contract both sides keep.

You do not need Orbit's signing keys or its Firebase project:

- The TV apps build and sign with your own debug key.
- The phone app's tests and analyzer need no Firebase settings. Building its APK does need a `google-services.json`
  from a Firebase project of your own; the README says how.
- The interface in `phone/ui` runs in a desktop browser against a pretend TV: `npm run dev` in `phone/ui`.

## Which tests to run

Run the tests of every part you change, and say in the pull request which ones you ran.

| You changed | Run |
|---|---|
| `phone/ui` | `npm test` and `npm run build` in `phone/ui` |
| `phone/app` | `flutter test` and `flutter analyze` in `phone/app` |
| `launcher/app` or `launcher/livetv` | `./gradlew :app:testReleaseUnitTest :livetv:testReleaseUnitTest` in `launcher`, then a release build: `./gradlew :app:assembleRelease :livetv:assembleRelease` |
| `setup/tv`, `tools`, `tests` or a `.md` page | `pytest tests` at the repository's root, or with nothing to install `python3 -m unittest discover -s tests -v` |
| `site` | `npm run build` in `site` |
| The bridge or the TV's door (`phone/SPEC.md`) | The tests of both sides: `phone/ui`, `phone/app` and `launcher` |

`tests/` also checks every page: each relative link and anchor must lead somewhere, and each table row must have the
cells its header names. A fresh clone of `phone/app` has no asset folders yet; the README's
[Run the tests](README.md#run-the-tests) says how to put them in.

## Safety rules for anything that changes a TV

Orbit OS runs on people's own TVs, often a family's only one. These rules hold for every change to `setup/tv/`,
`tools/`, the catalog of apps (`phone/ui/src/setup/catalog.json`), a device's list or Orbit Home's guards:

1. **Switch apps off, never uninstall them.** Undo switches them back on. The only apps Orbit OS ever removes are its
   own, Orbit Home and Orbit Live TV, when setup installed them, or an earlier build of them once the new one is in
   its place.
2. **Never switch off the system's core packages.** The scripts refuse them (`CORE_RE` in `setup/tv/orbit-setup.sh`
   and in `tools/disable.sh`), and the catalog lists only packages that are safe to switch off; keep the three in
   step. Some TVs need two packages switched off together, or Home stops working: each `devices/<tv>/README.md` says
   which.
3. **Write the undo record first.** Read how the TV is before you change it, and put each change on the record as you
   make it. `orbit-setup.sh` records the TV's home screen, accessibility services and screensaver before anything
   else, and adds an `enable` or `uninstall` line for every app it switches off or installs; `tools/disable.sh` saves
   its record before the first command reaches the TV. A change with no line on the record is one Undo cannot take
   back.
4. **Only Android's own settings.** Orbit OS uses the TV's own debugging connection and the commands Android gives it
   (`pm`, `cmd`, `settings`, `am`, `content`, `appops`). No root, no unlocked bootloader, no change to the firmware, no
   factory reset.
5. **Test Undo.** `tests/test_orbit_setup_script.py` runs the setup and undo scripts against a pretend TV: add a test
   for what you change. On a real TV, run Undo afterwards and check that the TV's own home screen, every app that was
   switched off, and its accessibility and screensaver settings came back.

And on a real TV:

- Before pressing keys, installing or restarting, make sure the TV is idle on Home and nobody is watching.
- Wait 20 seconds after a change before restarting: a plain `reboot` can lose the package manager's last few seconds
  of changes.
- Keys sent with `input keyevent` never reach the helper service's key filter: test keys through the phone door
  (`/api/key`) or with the remote.
- Undo by hand uses the same list path that was applied: the record of what changed is kept under that path.
- `tools/tv.py --push` can hang on large files; use `tools/b64push.py`.

## Pull requests

- One change per pull request, with a title that says what it does. Say why in the description, and link the issue
  it closes.
- Say which tests you ran, and on which phone and TV (model and Android version) you tried the change.
- For a change to the TV side, say that Undo still puts the TV back.
- For a change people can see, add screenshots or a short video, before and after.
- Keep the internal names from the first version: the Java packages `com.gathin.tvhome` and `com.gathin.livetv`,
  by which every component of Orbit's apps is named on a TV, and `~/.cleanyourtv/`, which holds every TV's undo
  record on a computer. Renaming them would lose those records and the components TVs already know.
- No personal values in tracked files: a name for the greeting, cloud keys and a TV's address belong in that TV's own
  theme on your computer. Never commit signing keys (`*.jks`, `key.properties`), `google-services.json`,
  `phone/firebase/config.json`, APKs, or the `backup/`, `shots/` and `work/` folders, which can hold a TV's serial
  number or your Wi-Fi's name.
- Write the way the rest of the repository is written: plain, precise English, and comments that say why.

## Licence

Orbit OS is under the GNU General Public License v3.0 or later ([LICENSE](LICENSE), [NOTICE.md](NOTICE.md)). By
contributing, you agree that your contribution is licensed under GPL-3.0-or-later.
