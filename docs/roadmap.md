# Roadmap

Orbit OS today is set up by hand, with the tools in `tools/` run from a computer. The next stage removes the
computer: a person who has never opened a terminal should be able to put Orbit OS on their TV in a few minutes,
from the TV or from their phone, and take it off again just as easily.

## 1. Orbit Setup: no computer, no code

Everything Orbit OS changes on a TV needs the TV's own debugging connection (switching apps off, choosing the
home screen, turning on the helper service). Both the phone and the TV can open that connection themselves, so
the setup can live in either.

| | From the phone | From the TV |
|---|---|---|
| Start | Install Orbit, open it on the same Wi-Fi | Install the Orbit Setup app on the TV |
| Find the TV | Orbit finds it on the Wi-Fi | Not needed |
| Developer mode | Pictures of the TV's own menus: About › press OK seven times › USB debugging | The same pictures, on the TV |
| Connect | The phone connects to the TV's debugging port; the TV asks *Allow?*, the remote presses OK | The app connects to the TV itself, the same *Allow?* |
| Questions | Big cards on the phone | Big cards on the TV, moved with the remote |
| Install | The phone sends Orbit Home and Live TV to the TV and installs them | The app installs them from inside itself |
| Finish | Pairs the phone, then asks to switch debugging off again | Shows a code for the phone |

The questions come from what is on the TV, never from a list typed by hand:

- *Do you cast from your phone?* keeps or switches off the Cast service.
- *Do you use the TV's own channel app?* keeps or switches off the maker's live channels.
- *Do you play films from a USB drive?* keeps the gallery and video player.
- *Do you use voice search?* keeps the assistant.
- Ads, telemetry and promoted rows are suggested off, each with a one-line reason; anything a person cannot judge
  is left alone.

Every answer is recorded on the phone or TV, so **Undo everything** is one button.

## 2. A library of TVs

`devices/` grows into a library: for each model, its packages with a plain description of each, which ones are
safe to switch off, which ones must go together, and what its remote's buttons send. Setup reads the model code
from the TV and picks the matching entry, or the closest one with only the safe suggestions.

## 3. Your name, your account

- First start on the TV: *What should Orbit call you?*, your email, and a code for the phone. The greeting, the
  Island and Help mode use that name; nothing personal is built into the apps.
- Orbit on the phone signs in with the same account and lists every TV linked to it.
- The phone's remote reads each TV's buttons and apps from that TV, so the same app fits any TV.

## 4. Before going public

- Give the TV apps their own ids (`dev.shiv.orbit.home`, `dev.shiv.orbit.live`) in place of the ones inherited
  from CleanYourTV. On a TV that already runs Orbit OS this means one reinstall, so it goes with the first release.
- Choose a licence.
- Build signed APKs on GitHub for every release, with checksums.
- A short demo video and screenshots of every screen; issue templates; a security contact.

## 5. Launch

GitHub Trending has no application form: it lists the repositories that gain the most stars in a day or a week.
So the launch is about being worth starring and being seen in the same few days:

- A README that shows the product in the first screen, a 60-second video, and an install that needs no computer.
- Posts where TV owners already are: r/AndroidTV, r/GoogleTV, r/androidapps, XDA Forums, Hacker News (Show HN),
  Product Hunt.
- Pull requests to the curated "awesome" lists for Android TV.
- Quick answers to the first issues: early stars come from early users who were helped.
