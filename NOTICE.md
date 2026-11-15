# Notices

Orbit OS, Copyright (C) 2026 Shivam Jha

This program is free software: you can redistribute it and/or modify it under the terms of the GNU General Public
License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later
version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied
warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License for more details.

You should have received a copy of the GNU General Public License along with this program. If not, see
<https://www.gnu.org/licenses/>. Its full text is in [LICENSE](LICENSE).

## What the GPL covers

Everything in this repository that was written or made for Orbit OS: Orbit Home and Orbit Live TV (`launcher/`),
Orbit, the phone app (`phone/`), the setup scripts (`setup/`), the device folders (`devices/`), the website's own
code (`site/`), the pictures and films made for Orbit OS, and the documentation. Orbit OS's changes to the parts
below are under the GPL too; the parts themselves keep their own licences.

## Parts that keep their own licences

### CleanYourTV (MIT)

Orbit OS grew out of [CleanYourTV](https://github.com/Gathin23/CleanYourTV) by Gathin. These parts come from it and
are used under the MIT licence below, whose notice is kept here as it requires:

- the TV tools in `tools/` and their tests in `tests/` (except `tests/test_orbit_setup_script.py`, which was written
  for Orbit OS);
- `launcher/build-and-install.sh` and `launcher/build-and-install.ps1`;
- the launcher code that Orbit Home started from in `launcher/app`, including its translations.

```text
MIT License

Copyright (c) 2026 Gathin

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Fonts (SIL Open Font License 1.1)

- **Inter**, by The Inter Project Authors: `launcher/app/src/main/res/font/inter.ttf`,
  `launcher/livetv/src/main/res/font/inter.ttf` and `phone/ui/src/assets/fonts/inter.ttf`. Licence:
  [launcher/third_party/Inter-OFL.txt](launcher/third_party/Inter-OFL.txt).
- **Outfit**, by The Outfit Project Authors: `launcher/app/src/main/res/font/outfit.ttf` and
  `phone/ui/src/assets/fonts/outfit.ttf`. Licence: [launcher/FONT-LICENSE-OFL.txt](launcher/FONT-LICENSE-OFL.txt).

### Icons

- **Fluent Emoji** by Microsoft (MIT): the Halloween pictures, `halloween_*.webp` in
  `launcher/app/src/main/res/drawable-nodpi/`. Licence and details:
  [launcher/ICONS-LICENSE-FLUENT-EMOJI.txt](launcher/ICONS-LICENSE-FLUENT-EMOJI.txt).
- **Material Design icons** by Google (Apache License 2.0): several of Orbit Home's `ic_*.xml` icons in
  `launcher/app/src/main/res/drawable/`. `ic_lock_open.xml` and `ic_swap_vert.xml` name their source; `ic_av`,
  `ic_ethernet`, `ic_input`, `ic_livetv`, `ic_lock`, `ic_picture`, `ic_settings` and `ic_wifi` draw the same icons.
  Licence: [launcher/third_party/Apache-2.0.txt](launcher/third_party/Apache-2.0.txt).

### Gradle wrapper (Apache License 2.0)

`launcher/gradlew`, `launcher/gradlew.bat` and `launcher/gradle/wrapper/gradle-wrapper.jar` are Gradle's own, by the
authors their headers name, under the Apache License 2.0
([launcher/third_party/Apache-2.0.txt](launcher/third_party/Apache-2.0.txt)).

### The website's components (`site/`)

The website is a separate work from the apps: nothing in Orbit Home, Orbit Live TV or the phone app uses these files.

- `site/src/components/reactbits/`: components from [React Bits](https://reactbits.dev) by David Haz, under the
  MIT + Commons Clause License Condition v1.0
  ([site/src/components/reactbits/LICENSE.md](site/src/components/reactbits/LICENSE.md)). **These files keep that
  licence and are not under the GPL.** The Commons Clause forbids selling or redistributing the components on their
  own, a restriction the GPL does not allow, so they cannot be part of a GPL work. If you reuse code from this
  repository, leave them out or follow their licence.
- `site/src/components/magicui/`: components from [Magic UI](https://magicui.design) by Dillion Verma, under the MIT
  licence ([site/src/components/magicui/LICENSE.md](site/src/components/magicui/LICENSE.md)). `globe.tsx` draws with
  cobe (MIT), which npm installs.

Each of these files names its source, its licence and what was changed in its first lines, and
[site/README.md](site/README.md) lists them.

### TV channel logos

The pictures in `launcher/livetv/src/main/assets/logos/` are the TV channels' own logos and trademarks. They belong to
their owners, are included only to show which channel is which, and are not covered by the GPL.

### Other names and marks

Google TV and Android TV are trademarks of Google LLC, and Xiaomi is a trademark of Xiaomi Corporation. Orbit Home's
boot film (`launcher/app/src/main/res/raw/boot_intro.mp4`) and its first frame
(`launcher/app/src/main/res/drawable-nodpi/boot_intro_first.png`) open on the Google TV logo, which is Google's. App
and channel names are used only to say what runs on a TV. Orbit OS is not made by, or connected with, Google or any
TV maker.

## Name and icon

The GPL covers the code, not the Orbit OS name or its icon: as section 7 of the GPL allows, no rights to them are
granted. A fork that is published, for example on an app store, must use its own name and icon, so that nobody takes
it for Orbit OS.
