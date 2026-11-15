# Orbit OS website

The public page for Orbit OS: one self-contained `dist/index.html` (scripts, styles, fonts, pictures and the boot film
are all inside it), so it can be hosted anywhere or opened straight from disk. At runtime it fetches nothing except the
optional star count from `api.github.com`; when that fails (offline, or GitHub says no) the page simply leaves the
number out.

```bash
cd site
npm install
npm run build      # type-checks, then writes dist/index.html (about 2.5 MB)
npm run dev        # http://127.0.0.1:5290
```

Vite 6, React 19, TypeScript, Tailwind CSS 4, Motion, GSAP, Lenis, cobe, and `vite-plugin-singlefile` with a huge
`assetsInlineLimit`. Works with the Node 20 on this Mac.

## Two themes

Night (the TV's dark room) and Daylight (pearl paper, ink type, the same iridescent light made deep enough to read),
both designed, every colour a token in `src/styles.css`. The page follows the system setting; `<html data-theme="light">`
or `"dark"` overrides it either way, and the sun/moon button in the bar sets it and remembers it (localStorage, in a
try/catch). The WebGL scenes take the theme too: the hero's ring is added light at night and deep ink-iridescence by
day, the Galaxy turns to ink dust, the Orb and the globe change their looks. Devices stay devices: the TV, the phone's
screen, the terminal and the film are dark in both themes, and the end credits always play in a dark cinema.

The theme rules and the base (font, size, colours) are unlayered and a step more specific than a bare `:root` or `body`,
so a host page that wraps this one in its own skeleton (with `:root{color-scheme:light}` and `body{font:14px system-ui}`,
unlayered) cannot override them.

## What is on the page

| Section | What it does |
|---|---|
| Hero | One intro on one clock: the TV rises and powers on, the ring draws itself around it, then the headline (React Bits **SplitText**), the line and the buttons. A hand-written WebGL2 scene (`components/hero/OrbitStage.tsx`): the real Orbit Home on a TV, an orbit ring with real depth, dust, a satellite and a floor light. React Bits **Galaxy** behind. The Download button is Magic UI **Shimmer Button** (the only shimmer on the page) with React Bits **Magnet** and **ClickSpark**; Star on GitHub is React Bits **StarBorder**. Scrolling lifts the words away while the TV dollies in. |
| Try it now | Orbit Home rebuilt in the DOM (`demo/`): a curved glass row on a critically damped spring, focus glow in each app's colour, the greeting for the time of day. Driven by Orbit's own WebGL globe, a D-pad, the keyboard or a click, inside a Magic UI **Android** phone. Live TV zaps like an old set (the picture folds into a line and opens out), the number flips (React Bits **SplitFlapText**); the Control Center pours down like a liquid (a spring-driven clip path). Volume, the Island and three small quests. |
| By the numbers | Only measured or counted values (devices/xiaomi-mitv-axfu0, Orbit's own lists), on Magic UI **Number Ticker** and React Bits **SpotlightCard**. |
| Clutter versus calm | A before/after line, moved by scrolling until you take it: a drawn, brand-free sketch against the real Orbit Home. |
| Five minutes, no computer | The real setup screens as a deck that stacks as you scroll (React Bits **ScrollStack**), each in a Magic UI **Android** phone. |
| Made for Indian homes | The channel line-up as a scroll-reactive ticker (React Bits **LogoLoop**, names only), Orbit Home's real festival greetings (from `HomeDays.java`) with the next one on the visitor's calendar, the real Control Center photo in React Bits **TiltedCard**, and Help mode for parents. |
| Phone superpowers | Phone, the world and the TV joined by Magic UI **Animated Beam**; Magic UI **Globe** (cobe) for "from anywhere", React Bits **DecryptedText** for the link code, Magic UI **Orbiting Circles** for the remote's tools. |
| Safety you can feel | React Bits **SquishSwitch** undoes and reapplies the real 32-app plan on a little TV; Magic UI **Number Ticker**; four React Bits **SpotlightCard** facts. |
| Tested TVs | The Xiaomi TV A Pro, what it taught Orbit, and a call for testers. |
| Under the hood | Phone → the TV's own debugging switch → one script → an undo record, with the script's own protocol in Magic UI **Terminal** and links to the docs. |
| Roadmap | Now, next, later, with React Bits **StatusMark**. |
| Questions | The old page's answers and two more. |
| Star | React Bits **Orb** inside Magic UI **Orbiting Circles**, one big Star button, the live count when GitHub answers. |
| End credits | The lights go down; the owner's boot film under a projector beam (React Bits **LightRays**) with film grain (React Bits **Noise**); the credits roll down to Made in India and the last Download and Star. |
| On phones | A slim download bar at the bottom once the hero's buttons have scrolled away. |

## Components taken from other projects

Each file keeps a header naming its source, its licence and anything changed. They keep their own licences, whose
texts are beside them (`components/reactbits/LICENSE.md`, `components/magicui/LICENSE.md`): the React Bits files are
not under Orbit OS's GPL ([NOTICE.md](../NOTICE.md)).

| Component | From | Licence | Installed with | Changes |
|---|---|---|---|---|
| Galaxy | React Bits, David Haz | MIT + Commons Clause | `npx shadcn@latest add https://reactbits.dev/r/Galaxy-TS-TW` | class names joined without a space |
| SplitText | React Bits | MIT + Commons Clause | `…/r/SplitText-TS-TW` | an optional `gradient` painted across the split letters; `startDelay` for the intro |
| BlurText | React Bits | MIT + Commons Clause | `…/r/BlurText-TS-TW` | an `as` prop for headings; words split on spaces (the registry copy split every letter) |
| ClickSpark | React Bits | MIT + Commons Clause | `…/r/ClickSpark-TS-TW` | the wrapper takes its size from `className` |
| Magnet | React Bits | MIT + Commons Clause | `…/r/Magnet-TS-TW` | none |
| StarBorder | React Bits | MIT + Commons Clause | `…/r/StarBorder-TS-TW` | a missing space between class names; a track colour missing a channel |
| SquishSwitch | React Bits | MIT + Commons Clause | `…/r/SquishSwitch-TS-TW` | none |
| SpotlightCard | React Bits | MIT + Commons Clause | `…/r/SpotlightCard-TS-TW` | border and shadow colours missing a channel (the border drew yellow) |
| SplitFlapText | React Bits | MIT + Commons Clause | `…/r/SplitFlapText-TS-TW` | class names joined without a space (its tiles never got their look) |
| Orb | React Bits | MIT + Commons Clause | `…/r/Orb-TS-TW` | class names joined without a space |
| ScrollStack | React Bits | MIT + Commons Clause | `…/r/ScrollStack-TS-TW` | shadow colours missing channels |
| TiltedCard | React Bits | MIT + Commons Clause | `…/r/TiltedCard-TS-TW` | none |
| LogoLoop | React Bits | MIT + Commons Clause | `…/r/LogoLoop-TS-TW` | class names joined without a space |
| StatusMark | React Bits | MIT + Commons Clause | `…/r/StatusMark-TS-TW` | an SVG view box and path that had lost numbers |
| LightRays | React Bits | MIT + Commons Clause | `…/r/LightRays-TS-TW` | none |
| Noise | React Bits | MIT + Commons Clause | `…/r/Noise-TS-TW` | none |
| DecryptedText | React Bits | MIT + Commons Clause | `…/r/DecryptedText-TS-TW` | class names joined without a space |
| Animated Beam | Magic UI, Dillion Verma | MIT | `npx shadcn@latest add https://magicui.design/r/animated-beam.json` | none |
| Orbiting Circles | Magic UI | MIT | `…/r/orbiting-circles.json` | the orbit path uses Orbit's line colour |
| Number Ticker | Magic UI | MIT | `…/r/number-ticker.json` | colour from the page; a quicker spring |
| Android | Magic UI | MIT | `…/r/android.json` | cropped view box, unique clip id, live screen content, the page's themes |
| Globe | Magic UI (drawn with cobe, MIT) | MIT | `…/r/globe.json` | pixel ratio capped at 2, paused off screen, night and day looks |
| Terminal | Magic UI | MIT | `…/r/terminal.json` | colour classes that had spaces in them; a night terminal; Orbit's dots |
| Shimmer Button | Magic UI | MIT | `…/r/shimmer-button.json` | renders as a link; a wider ring; a broken class removed |

21st.dev lists these Magic UI components too, but its registry (`https://21st.dev/r/…`) answers "authentication
required" without a 21st.dev account, so they were installed from Magic UI's own registry, the same source.

Several React Bits registry copies had lost characters (spaces inside strings, repeated numbers), which is where most
of the fixes above come from. React Bits is MIT with the Commons Clause (no selling the components themselves), which
fits this free project.

## Orbit's own parts

- `components/globe/`: Orbit's globe touchpad and its shader from `phone/ui/src/globe`; the pixel ratio is capped at 2 and
  it stops drawing off screen.
- `components/hero/OrbitStage.tsx` and `orbitMath.ts`: the hero scene, plain WebGL2, no library.
- `demo/`: the pretend TV (Home row, Live TV, Control Center) and the phone remote.
- `data/festivals.ts`: Orbit Home's festival days, copied from `launcher/app/src/main/java/com/gathin/tvhome/HomeDays.java`.

## Assets

| File | From | How |
|---|---|---|
| `assets/img/home.webp`, `control-center.webp` | `docs/assets/*.jpg` | `python3 scripts/prepare-assets.py <setup screenshots>` |
| `assets/setup/*.webp` | the phone app's own setup mock, 780 × 1688 screenshots, no private data | same script, from the folder it is given (or `ORBIT_SETUP_SHOTS`) |
| `assets/film/boot-intro.mp4`, `poster.webp` | `launcher/app/src/main/res/raw/boot_intro.mp4`, its first 0.8 s cut | same script (it never overwrites the cut film) |
| `assets/brand/shiv-mark.svg` | `work/family-room/intro/logo/shiv-mark.svg` | same script |
| `assets/brand/qr-release.svg` | the download link, for visitors on a computer | `node scripts/make-qr.mjs` |
| `data/channels.json` | `launcher/livetv/src/main/assets/channels.json`, names, numbers and groups only | `node scripts/make-channels.mjs` |

Channel and app names appear as plain words only, never their logos. The "before" side of the slider is drawn, not a
screenshot of another company's home screen.

## Fonts

Outfit, Inter and JetBrains Mono from `@fontsource-variable` (SIL Open Font License), latin subset only, inlined.

## Behaviour notes

- Every WebGL canvas (Galaxy, the hero scene, the globe touchpad, the cobe globe, the Orb, the light rays) draws only
  near or on screen and caps the pixel ratio at 2.
- `prefers-reduced-motion`: still frames for the WebGL, no smooth scrolling, no auto-play, no credit roll, no typing,
  the same content.
- The demo takes Left and Right whenever it is on screen; Up, Down, Enter and Escape only after you touch or focus it,
  so the page's own scrolling is never stolen by surprise.
