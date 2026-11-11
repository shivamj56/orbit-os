# Orbit OS website

The public page for Orbit OS: one self-contained `dist/index.html` (scripts, styles, fonts, pictures and the boot film
are all inside it), so it can be hosted anywhere or opened straight from disk. At runtime it fetches nothing except the
optional star count from `api.github.com`; when that fails (offline, or the repository is still private) the page simply
leaves the number out.

```bash
cd site
npm install
npm run build      # type-checks, then writes dist/index.html (about 3 MB)
npm run dev        # http://127.0.0.1:5290
```

Vite 6, React 19, TypeScript, Tailwind CSS 4, Motion, GSAP, Lenis, and `vite-plugin-singlefile` with a huge
`assetsInlineLimit`. Works with the Node 20 on this Mac.

## What is on the page

| Section | What it does |
|---|---|
| Hero | React Bits **Galaxy** in Orbit's three lights; a hand-written WebGL2 scene (`components/hero/OrbitStage.tsx`) with the real Orbit Home picture on a TV and an iridescent orbit ring around it, with depth (the ring passes behind and in front of the TV), dust and a satellite; React Bits **SplitText** headline; the Download button leans to the cursor (**Magnet**) and sparks (**ClickSpark**); Star on GitHub has a star running its edge (**StarBorder**). Clicking the TV pulls the Control Center down over Home. |
| Try it now | Orbit Home rebuilt in the DOM (`demo/`): a curved glass row on a cylinder, focus glow in each app's colour, the greeting for the time of day. Driven by Orbit's own WebGL **globe** (copied from `phone/ui/src/globe`), an on-screen D-pad, the keyboard, or a click. OK on Live TV opens a zapper with the real channel names and numbers (React Bits **SplitFlapText** for the number); Settings pulls down a Control Center with spatial navigation; volume and the Island work too. Three small quests end in a Download button. |
| Five minutes, no computer | A pinned phone stepping through the real setup screenshots as you scroll. |
| Clutter versus calm | A before/after slider: a drawn, brand-free sketch of an ad-filled home screen against the real Orbit Home picture. |
| Phone superpowers | Phone, cloud and TV joined by Magic UI **Animated Beam**; the remote's tools in Magic UI **Orbiting Circles**. |
| Safety you can feel | React Bits **SquishSwitch** undoes and reapplies the real 32-app plan from Orbit Setup; Magic UI **Number Ticker**; four React Bits **SpotlightCard** facts. |
| Tested TVs, Questions | The Xiaomi TV A Pro and what was measured on it (from `devices/xiaomi-mitv-axfu0`), a call for testers, the FAQ. |
| Star | React Bits **Orb** inside two Magic UI **Orbiting Circles** around one big Star button, with the live count when GitHub answers. |
| End credits | The owner's boot film (muted until "Sound on"), then film credits that roll, ending on Made in India and the final Download and Star. |

Section headings resolve out of blur with React Bits **BlurText**; the demo's TV frame has a Magic UI **Border Beam**.

## Components taken from other projects

Each file keeps a header naming its source, its licence and anything changed.

| Component | From | Licence | Installed with | Changes |
|---|---|---|---|---|
| Galaxy | React Bits, David Haz | MIT + Commons Clause | `npx shadcn@latest add https://reactbits.dev/r/Galaxy-TS-TW` | none; Orbit's palette through props |
| SplitText | React Bits | MIT + Commons Clause | `…/r/SplitText-TS-TW` | an optional `gradient` painted continuously across the split letters |
| BlurText | React Bits | MIT + Commons Clause | `…/r/BlurText-TS-TW` | an `as` prop for headings; words split on spaces (the registry copy split every letter) |
| ClickSpark | React Bits | MIT + Commons Clause | `…/r/ClickSpark-TS-TW` | the wrapper takes its size from `className` |
| Magnet | React Bits | MIT + Commons Clause | `…/r/Magnet-TS-TW` | none |
| StarBorder | React Bits | MIT + Commons Clause | `…/r/StarBorder-TS-TW` | a missing space between class names; the default track colour was missing a channel |
| SquishSwitch | React Bits | MIT + Commons Clause | `…/r/SquishSwitch-TS-TW` | none |
| SpotlightCard | React Bits | MIT + Commons Clause | `…/r/SpotlightCard-TS-TW` | the default border and shadow colours were missing a channel (the border drew yellow) |
| SplitFlapText | React Bits | MIT + Commons Clause | `…/r/SplitFlapText-TS-TW` | none |
| Orb | React Bits | MIT + Commons Clause | `…/r/Orb-TS-TW` | class names were joined without a space |
| Animated Beam | Magic UI, Dillion Verma | MIT | `npx shadcn@latest add https://magicui.design/r/animated-beam.json` | none |
| Orbiting Circles | Magic UI | MIT | `…/r/orbiting-circles.json` | the orbit path uses Orbit's line colour |
| Border Beam | Magic UI | MIT | `…/r/border-beam.json` | none |
| Number Ticker | Magic UI | MIT | `…/r/number-ticker.json` | the text colour comes from the page |

21st.dev lists these Magic UI components too, but its registry (`https://21st.dev/r/…`) answers "authentication
required" without a 21st.dev account, so they were installed from Magic UI's own registry, the same source.

React Bits is MIT with the Commons Clause (no selling the components themselves), which fits this free project.

## Orbit's own parts

- `components/globe/` is Orbit's globe touchpad and its shader from `phone/ui/src/globe`, with two web changes: the pixel
  ratio is capped at 2 and it stops drawing off screen.
- `components/hero/OrbitStage.tsx` and `orbitMath.ts`: the hero scene, plain WebGL2, no library.
- `demo/`: the pretend TV (Home row, Live TV, Control Center) and the phone remote.

## Assets

| File | From | How |
|---|---|---|
| `assets/img/home.webp`, `control-center.webp` | `docs/assets/*.jpg` | `python3 scripts/prepare-assets.py` |
| `assets/setup/*.webp` | the phone app's own setup mock, 780 × 1688 screenshots, no private data | same script (pass the folder if it moves) |
| `assets/film/boot-intro.mp4`, `poster.webp` | `launcher/app/src/main/res/raw/boot_intro.mp4`, untouched | same script |
| `assets/brand/shiv-mark.svg` | `work/family-room/intro/logo/shiv-mark.svg` | same script |
| `assets/brand/qr-release.svg` | the download link, for visitors on a computer | `node scripts/make-qr.mjs` |
| `data/channels.json` | `launcher/livetv/src/main/assets/channels.json`, names, numbers and groups only | `node scripts/make-channels.mjs` |

Channel and app names appear as plain words only, never their logos. The "before" side of the slider is drawn, not a
screenshot of another company's home screen.

## Fonts

Outfit, Inter and JetBrains Mono from `@fontsource-variable` (SIL Open Font License), latin subset only, inlined.

## Behaviour notes

- Every WebGL canvas (Galaxy, the hero scene, the globe, the Orb) draws only while on screen and caps the pixel ratio at 2.
- `prefers-reduced-motion`: still frames for the WebGL, no smooth scrolling, no auto-play, no credit roll, the same content.
- The demo takes Left and Right whenever it is on screen; Up, Down, Enter and Escape only after you touch or focus it, so
  the page's own scrolling is never stolen by surprise.
- Dark only, on purpose (`color-scheme: dark`).
