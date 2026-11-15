# Security

Orbit OS runs on people's TVs and phones and changes how a TV is set up, so a security problem matters more than an
ordinary bug. Thank you for reporting one privately.

## How to report

Never in a public issue, pull request or discussion. Use either:

- **GitHub's private vulnerability reporting**: the **Report a vulnerability** button on this repository's
  **Security** tab. Only the maintainer sees the report.
- **Email**: heyshivm2002@gmail.com.

Please say:

- which part is affected (see below) and its version: Orbit's version is in the app under Settings › About, and for
  code from this repository the commit;
- how to reproduce it, step by step;
- what it lets someone do, and what they need first (on the same Wi-Fi as the TV, a paired phone, a signed-in Google
  account, access to the TV's debugging connection).

Orbit OS is made by one person. You will get an answer, and the fix goes into `main` and the next Orbit release on
Google Play. Please give that time before you tell anyone else.

## What is in scope

- **Orbit, the phone app** (`phone/app`, `phone/ui`): the bridge between the page and the app, pairing and the token it
  keeps, Orbit Setup's debugging connection to the TV and the key it signs with, the cloud client, backups.
- **The TV's setup and undo scripts** (`setup/tv/`): `orbit-setup.sh` and `orbit-undo.sh`, which the phone runs in
  the TV's own shell.
- **Orbit Home** (`launcher/app`): the door it opens for the phone (HTTP on port 8090, pointer datagrams on UDP 8091,
  pairing codes and tokens), Help mode's pictures of the screen, and its cloud link.
- **Orbit Live TV** (`launcher/livetv`): the channel list and the servers it is allowed to play from.
- **The Firebase relay and its rules** (`phone/firebase/`): `database.rules.json`, which decide who can read and write
  what in the Realtime Database.

Anything else in this repository: report it the same private way.

Not in scope: Google's own services (Firebase, Google sign-in, Google Drive) and the TVs' own firmware. Please report
those to their makers.

## Known and by design

- The TV's door is plain HTTP inside the home network. Orbit Home answers only private, link-local and loopback
  addresses, and every route but pairing needs the token a phone gets by typing the code the TV shows
  (`docs/architecture.md`, `docs/privacy.md`).
- The Firebase web client ID and database address in `phone/app/lib/cloud/backend.dart` are not secrets: every
  Firebase app ships them. What protects the data is the database rules in `phone/firebase/database.rules.json`, so a
  way around those rules is in scope.
