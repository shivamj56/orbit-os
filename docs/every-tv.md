# Orbit on every TV

Orbit OS itself (Orbit Home, switching apps off, backups) needs **Google TV or Android TV**: only they let an app change
the home screen, through their own debugging connection, without rooting the TV. Every other smart TV keeps its home
screen and its apps. On those, **Orbit is the phone remote**, through the TV's own remote-control service on the home
Wi-Fi (since Orbit 1.6.0). How the phone app does it is in [phone/SPEC.md](../phone/SPEC.md), "Every TV"; the code is
[phone/app/lib/tv/brands](../phone/app/lib/tv/brands).

This page is the research behind it, November 2026. It came from published documentation and widely used open-source
libraries, read through web searches; (U) marks what was not confirmed.

## The platforms

| Platform | Phone control over Wi-Fi | Home screen / switch apps off | Our app on the TV | Effort | Risk |
|---|---|---|---|---|---|
| Android TV / Google TV | ADB (today). Android TV Remote v2: pair on 6467 (TLS, on-screen code), control on 6466; library androidtvremote2 (HA) | Yes, via ADB | APK | done (S to add the remote protocol and Wireless debugging) | Low |
| Fire TV (Fire OS 7/8) | ADB from another device still works (U, test) | Partly. Some apps can be switched off. Custom launcher and home button: blocked. Since Feb 2024 (7.6.6.9 / 8.1.0.3) Amazon blocks apps from connecting to the TV's OWN local ADB | Sideloaded APK | M | High (Amazon keeps changing it) |
| Fire TV Vega OS (2025 sticks) | No ADB | No | Amazon Appstore only; APKs don't run | L | Very high |
| Samsung Tizen | WebSocket wss :8002 (old sets :8001). The TV shows "Allow" once and gives a token. Library samsungtvws | No | Tizen web app, Developer Mode + Samsung certificates | M for remote, L for an app | Medium. Some 2024 sets time out after connecting |
| LG webOS | SSAP WebSocket :3001 (old :3000). Pairing prompt on the TV, self-signed cert. Library aiowebostv | No (only by rooting) | LG store, or Developer Mode (time-limited session, renewable) | M for remote | Medium. Some pairing failures reported (G5) |
| Roku OS (incl. TCL/Hisense Roku TVs) | ECP over HTTP :8060. Keypresses need "Control by mobile apps" on (Roku OS 14.1+) | No | Store only (one dev sideload) | S for remote | Medium. Mostly a US platform |
| VIDAA (Hisense/Toshiba) | MQTT :36669, TLS, PIN on newer sets. Reverse-engineered (ha_vidaatv, ha_hisense_tv) | No | (U) | M | Medium (varies by firmware) |
| Vizio SmartCast | HTTPS :7345 (old :9000), PIN. pyvizio | No | No | M | Not sold in India |
| Philips | Android models = Google TV. Saphi/Titan: JointSpace :1925 with PIN | Android models only | Titan = web apps (U) | S to M | Philips moves 2026 models to Titan OS |
| Sony Bravia | Google TV (as above) + REST/IRCC-IP with a PSK | Yes (Google TV) | APK | S | Low |
| Apple TV | Companion protocol (pyatv): pair, keys, text, list and open apps | No | App Store + Apple developer account | M | tvOS 18.4 connection bugs reported |
| JioTele OS (Thomson, Kodak, BPL…) | None found (U) | (U) | JioStore; a Thomson executive says APKs can be sideloaded | M (U) | Unknown. Jio hasn't said if it is Android |
| Coolita (Coocaa, Elista) | None found (U) | (U) | (U) | L | Small |

## India: brand → OS
- **Google TV / Android TV:** Sony; TCL (at least some); Vu; Acer; Haier; Toshiba (some, e.g. C350NP); Xiaomi X Pro (2025).
- **Fire TV:** Xiaomi FX / FX Pro / F series.
- **Tizen:** Samsung.
- **webOS:** LG.
- **VIDAA:** some Hisense and Toshiba models.
- **JioTele OS:** new Thomson, Kodak and BPL models.
- **Coolita:** Coocaa, Elista.
- **Unconfirmed (U):** Panasonic India, Realme, OnePlus, Onida, Infinix, Croma, iFFALCON. Most are believed to be Android/Google TV, but this was not checked.

## Market share
- **World, Q4 2024 (TechInsights, shipments):**
  - Android/Google TV: >24%
  - Tizen: 16.9%
  - webOS: 11.8%
  - Roku: 9%
- **Europe 2025 (Omdia):**
  - Google TV: ~32%
  - Tizen: 2nd
  - VIDAA: ~14%, ahead of webOS
- **India:** no free OS split found. One paid report says Android TV is 67.38% (2025), but its method is unverified. Treat it as weak.

## The order Orbit follows
1. **Remote-only mode for Samsung and LG.** These are the biggest TVs in India that Orbit can't serve at all today. This is the direct answer to the ask. Then add Roku ECP.
2. **Google TV / Android TV made easier.**
   - Add Wireless debugging, so the pairing code works when the TV has no 5555 port.
   - Add the official Android TV Remote v2, so the remote works without developer settings.
   - This can be tested on the owner's Xiaomi.
3. **Fire TV, best effort.** Remote, plus switching off only the apps Amazon allows. Say plainly that the home screen can't be changed.
4. **VIDAA, Apple TV and JioTele OS,** when there is demand. Do JioTele only after a test on a real set.

What's honestly impossible without root: replacing the home screen or switching apps off on Samsung, LG, Roku, VIDAA, Vega OS and Apple TV.

## Sources
- [1] https://www.home-assistant.io/integrations/androidtv_remote
- [2] https://github.com/tronikos/androidtvremote2
- [3] https://aftvnews.com/amazon-blocks-long-running-fire-tv-capability-breaking-popular-apps-with-no-warning-and-giving-developers-the-runaround
- [4] https://www.fully-kiosk.com/docs/en/faq/fire
- [5] https://www.androidauthority.com/amazon-vega-os-fire-tv-stick-3602647/
- [6] https://pypi.org/project/samsungtvws/
- [7] https://forum.developer.samsung.com/t/issue-with-websocket-remote-control-on-samsung-tv-model-ua55du8300ulxl/40467
- [8] https://webostv.developer.lge.com/develop/getting-started/developer-mode-app
- [9] https://www.webosbrew.org/devmode/
- [10] https://developer.roku.com/dev/docs/external-control-api
- [11] https://github.com/warrenrees/ha_vidaatv
- [12] https://github.com/sehaas/ha_hisense_tv
- [13] https://www.home-assistant.io/integrations/vizio/
- [14] https://www.home-assistant.io/integrations/philips_js/
- [15] https://9to5google.com/2026/03/23/google-tv-just-lost-a-big-tv-brand-to-web-app-based-titan-os/
- [16] https://pro-bravia.sony.net/remote-display-control/ircc-ip/
- [17] https://postlund.github.io/pyatv/documentation/supported_features
- [18] https://www.fonearena.com/blog/453179/xiaomi-qled-tv-fx-pro-series-2025-price-india-features.html
- [19] https://www.business-standard.com/technology/tech-news/jio-announces-jiotele-os-for-smart-tvs-what-is-it-and-availability-details-125021800561_1.html
- [20] https://www.digit.in/features/tvs/worlds-first-jio-teleos-tv-and-evolving-smart-tv-market-a-conversation-with-thomsons-avneet-singh-marwah.html
- [21] https://croma.com/unboxed/best-smart-tv-brands-in-india
- [22] https://techinsights.com/ja/node/59348
- [23] https://www.businesswire.com/news/home/20260415032885/en/Omdia-VIDAA-Set-to-Overtake-LGs-webOS-in-Europe-as-Chinese-TV-Brands-Gain-Ground
- [24] https://counterpointresearch.com/en/insights/India-Smart-TV-Shipments-Stayed-Largely-Flat-in-2025
- [25] https://www.giiresearch.com/report/moi2124221-india-smart-tv-ott-market-share-analysis-industry.html
