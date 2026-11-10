# Orbit OS: notes for coding agents

Orbit OS is Shivam Jha's project: Orbit Home and Orbit Live TV for Google TV (`launcher/`), and Orbit, the phone
remote (`phone/`). Read [README.md](README.md) and [docs/architecture.md](docs/architecture.md) first.

## Git

- Commit as `Shivam Jha <95514609+shivamj56@users.noreply.github.com>` (this repo's git config has it). No
  Co-Authored-By lines: the owner wants one author.
- `origin` is the owner's private repo. Push only when the owner asks.
- `upstream` is CleanYourTV, kept for reading only; its push URL is switched off on purpose. Never push there.
- Never commit `work/`, `backup/`, `shots/`, `tools/adbkey`, `tools/venv/`, signing keys (`*.jks`,
  `key.properties`), `phone/firebase/config.json`, `google-services.json` or APKs.
- No personal values in tracked files: a name for the greeting, cloud keys and a TV's address belong in that TV's
  own theme on the owner's computer.

## On a real TV

- Switch apps off, never uninstall them. Never switch off core packages, and keep the guard that keeps Orbit Home.
- Before pressing keys, installing or restarting: make sure the TV is idle on Home and nobody is watching.
- `input keyevent` never reaches the helper service's key filter; test keys through the phone door (`/api/key`)
  or uinput.
- A plain `reboot` loses package-manager writes from the last ~10 s: wait 20 s first.
- Undo uses the same list path that was applied; the restore record is keyed on that path.
- `tools/tv.py --push` can hang on large files; use `tools/b64push.py`.

## Build

- TV apps: `cd launcher && ./gradlew :app:assembleRelease :livetv:assembleRelease` with JDK 17 and Android SDK 34.
  Keep the same `ANDROID_USER_HOME`: its key signs both TV apps, and another key cannot update them.
- Unit tests: `./gradlew :app:testReleaseUnitTest :livetv:testReleaseUnitTest`; tool tests: `pytest tests`.
- Phone: `cd phone/ui && npm run build`, then `cd phone/app && tool/sync_ui.sh && flutter build apk --release`.
- The tools in `tools/` come from CleanYourTV: keep their internal names (`~/.cleanyourtv/` holds every TV's undo
  record, and renaming it would lose them).
