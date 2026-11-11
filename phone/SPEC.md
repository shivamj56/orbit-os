# Orbit — the phone remote for the Family room TV

Two halves that meet at one contract:

- `phone/ui/` — the whole interface: React + TypeScript + Tailwind + Framer Motion + GSAP, built by Vite with
  vite-plugin-singlefile into ONE self-contained file, `phone/ui/dist/index.html` (scripts, styles, fonts inlined).
  It never talks to the network itself. Everything goes through `window.orbit` (below). Opened in a desktop
  browser it uses a built-in mock TV, so the design can be tried without a phone or a TV.
- `phone/app/` — Flutter (Android first), package `dev.shiv.orbit`, label "Orbit". A full-screen WebView shows
  `assets/ui/index.html` (a copy of `phone/ui/dist/index.html`, made by `phone/app/tool/sync_ui.sh`). Flutter does
  what a page cannot: find the TV, pair, keep the token, talk HTTP and UDP to the TV, haptics, the phone's own volume
  keys, keep the screen awake.

## The bridge (JS <-> Flutter)

Flutter registers a JavaScriptChannel named `OrbitNative`. The page sends strings of JSON:

    OrbitNative.postMessage('{"id":12,"op":"key","args":{"key":"up"}}')

`id` is a positive integer chosen by the page; `"id":0` means "no reply wanted" (used for pointer moves).
Flutter answers each request with a non-zero id by running:

    window.orbitReceive({"id":12,"ok":true,"data":{...}})
    window.orbitReceive({"id":12,"ok":false,"error":"That is not the code on the TV. 4 tries left.","status":403})

and pushes events (no id) the same way:

    window.orbitReceive({"event":"status","data":{...}})
    window.orbitReceive({"event":"tvstate","data":{...}})
    window.orbitReceive({"event":"volumeKey","data":{"dir":"up"}})
    window.orbitReceive({"event":"lifecycle","data":{"state":"resumed"|"paused"}})

The page defines `window.orbitReceive` before it sends anything, then sends `{"id":1,"op":"hello"}`; Flutter must
queue events until the first `hello` arrives (the page may load after Flutter is ready).

### status event / `hello` and `status` replies

    {"state":"searching"|"found"|"needsPairing"|"pairing"|"connected"|"offline",
     "tv":{"name":"Family room","address":"192.168.1.7","port":8090,"udp":8091} | null,
     "found":[{"name":"Family room","address":"192.168.1.7","port":8090}],   // during searching/found
     "via":"wifi",                                                          // "cloud" later
     "error": "text for the person" | null}

Flutter sends a fresh status event whenever any of it changes.

### ops (page -> Flutter)

| op | args | what Flutter does | reply data |
|---|---|---|---|
| hello | – | flush queued events, start finding the TV if none is saved | status |
| status | – | – | status |
| discover | – | NSD `_orbit._tcp` + scan of the phone's own /24 for port 8090 (GET `/api/state` answers 401 JSON with `"ok":false` on a TV) | `{"found":[...]}` |
| connect | `{"address":"192.168.1.7","port":8090}` | choose this TV (saved); if a token is saved, check it with GET /api/state | status |
| manualAddress | `{"address":"192.168.1.7"}` | like connect, for a typed address | status |
| askCode | – | POST /api/askcode `{}` (the TV shows a 6-digit code in its Island) | `{}` |
| pair | `{"code":"123456"}` | POST /api/pair → keep `token` in secure storage, state → connected | status |
| forget | – | drop the token and the saved TV, state → searching | status |
| state | – | GET /api/state | the TV's state JSON (below) |
| apps | – | GET /api/apps | the TV's answer, unchanged |
| icon | `{"pkg":"com.netflix.ninja"}` | GET /api/icon?pkg=… (cache in memory and on disk) | `{"src":"data:image/png;base64,…"}` |
| key | `{"key":"up"}` | POST /api/key | `{}` |
| media | `{"action":"play_pause"}` | POST /api/media | `{}` |
| volume | `{"level":12}` | POST /api/volume | `{"volume":12,"max":100}` |
| volumeStep | `{"dir":"up"\|"down"}` | POST /api/key `{"key":"volup"\|"voldown"}` | `{}` |
| type | `{"text":"…","submit":false}` | POST /api/type | the TV's answer |
| open | `{"url":"https://…"}` | POST /api/open | the TV's answer |
| launch | `{"pkg":"…"}` | POST /api/launch | the TV's answer |
| sleep | – | POST /api/sleep | `{}` |
| pointer | `{"type":"move","dx":3.5,"dy":-1.2}` (id 0) | one UDP datagram (below), nothing else | – |
| pointer | `{"type":"scroll","dx":0,"dy":-8}` (id 0) | one UDP datagram | – |
| pointer | `{"type":"click"}` / `{"type":"longpress"}` / `{"type":"hide"}` | POST /api/pointer `{"action":…}` | the TV's answer |
| haptic | `{"kind":"tick"\|"light"\|"medium"\|"heavy"\|"success"\|"error"}` | HapticFeedback (selectionClick / light / medium / heavy; success = medium, error = heavy twice) | – (id 0 allowed) |
| keepAwake | `{"on":true}` | wakelock while the app is in front | `{}` |
| settings | `{"volumeKeys":true}` | the phone's volume keys turn the TV up/down (default true) | `{}` |

HTTP errors come back as `ok:false` with the TV's `error` text and `status`. A 401 means the token is no longer
known: drop it and go to `needsPairing`. A network failure → `offline` (retry every 3 s while the app is in front).

## The TV's door (HTTP, port 8090, home Wi-Fi only)

Plain HTTP/1.1, one request per connection. Every request: `Host: <tv address>:8090` (the http package does it),
JSON bodies with `Content-Type: application/json`, and after pairing `x-portal-token: <32 hex>`. Never send an
`Origin` header (the TV refuses a mismatched one).

- POST /api/askcode `{}` → `{"ok":true}` (at most every 20 s; the TV shows the code for 3 minutes)
- POST /api/pair `{"code":"123456"}` → `{"ok":true,"token":"<32 hex>"}` | 403 wrong (n tries left) | 409 no code | 429
- GET /api/state without a known token → 401 `{"ok":false,"error":"…","tv":"Family room"}` (the name from the TV build
  of 10 Nov 11:00 on; older builds leave `tv` out); with one →
  `{"ok":true,"tv":"Family room","app":"YouTube","pkg":"com.google.android.youtube.tv",
  "title":"…","artist":"…","playing":true,"position":12345,"duration":600000,"player":"YouTube","volume":12,
  "max":100,"muted":false,"udp":8091,"pointer":true}`
- GET /api/apps → a bare JSON array, sorted by label: `[{"pkg":"com.netflix.ninja","label":"Netflix"}, …]`
- GET /api/icon?pkg=… → image/png, the app's TV banner (or its icon), fitted into 320 x 180 (token in the header,
  or `&t=<token>`)
- POST /api/key `{"key":k}` with k one of: `back home up down left right ok recents settings mute volup voldown`
- POST /api/media `{"action":"play_pause"|"next"|"previous"|"forward"|"rewind"}`
- POST /api/volume `{"level":n}`
- POST /api/type `{"text":"…","submit":bool}` — into the box with the cursor, else the first box on the screen. With no
  box, Home opens its own search with the words, and YouTube and Prime Video (which draw their own letters) open their
  results: `{"ok":true,"opened":"search"|"YouTube"|"Prime Video"}`
- POST /api/open `{"url":"https://…"}`
- POST /api/launch `{"pkg":"…"}`
- POST /api/sleep
- POST /api/pointer `{"action":"click"|"longpress"|"hide"}`

## From anywhere: Firebase (project `orbit-family-room`, made 10 Nov)

Why: the owner's phone cannot reach the TV over the home Wi-Fi at all (not even Chrome at 192.168.1.7:8090), and he
wants "sign in with the TV's Google account → control from anywhere". The phone and the TV become the SAME Firebase user
(the owner's Google account), and talk through the Realtime Database. Values: `phone/firebase/config.json`; rules:
`phone/firebase/database.rules.json` (published, tested with REST 10 Nov 12:20).

Database (`databaseURL` in config.json, Singapore). Everything lives under `/orbit/{uid}` (uid = that Google account's
Firebase uid, the same on phone and TV); only that user can read or write it.

| path | written by | what |
|---|---|---|
| `/orbit/{uid}/tv/name` | TV | the TV's name, "Family room" |
| `/orbit/{uid}/tv/online` | TV | `{".sv":"timestamp"}` every 60 s while the TV is awake (every 15 s while watched) |
| `/orbit/{uid}/tv/state` | TV | the same object as GET /api/state (without `ok`), every 2 s while watched, and right after each command |
| `/orbit/{uid}/watch` | phone | `{".sv":"timestamp"}` every 10 s while Orbit is in front and using the cloud; the TV counts itself watched for 25 s after each change it sees |
| `/orbit/{uid}/cmd/{pushId}` | phone | `{"path":"/api/key","body":{"key":"up"},"at":{".sv":"timestamp"}}` — any POST route of the door, plus `/api/state`, `/api/apps`, `/api/icon` (`body` `{"pkg":…}`) and `/api/pointer` with `{"action":"move"\|"scroll","dx":…,"dy":…}` (max 10 a second over the cloud) |
| `/orbit/{uid}/res/{pushId}` | TV | `{"status":200,"body":<the door's JSON answer>}`; `/api/icon` answers `{"png":"<base64>"}`; the phone reads it once and deletes it |
| `/orbit/{uid}/tv/unlink` | phone | `true` → the TV signs out and goes back to showing a link code; the TV deletes the key |

The TV acts only on commands that arrive while its stream is open (a command already waiting when it connects is stale:
it is deleted unanswered), in pushId order, and deletes each command after answering it. A command gets no answer if
the TV is asleep: the phone gives up after 8 s ("The TV is not answering").

Linking (once). The TV, not linked yet, signs in ANONYMOUSLY (REST), writes `/link/{8 digits}` =
`{"tv":"<anon uid>","at":{".sv":"timestamp"}}` and shows "Orbit link code 1234 5678" in its Island for 10 minutes
(again, with a new code, the next time Home comes back while unlinked, at most every 10 minutes). The phone, signed in
with Google, writes the Google ID token it signed in with (audience = the web client ID) to `/link/{code}/token`
(the rules let only a Google-signed-in user write it, once, and only while the code exists; a wrong code → permission
denied → "That code is not on the TV"). The TV reads the token, deletes `/link/{code}` while still anonymous, signs in
with it (identitytoolkit `accounts:signInWithIdp`, `providerId=google.com`) — from then on it IS that Google user — and
writes `/orbit/{uid}/tv/name` and `online`, which is how the phone sees the link worked (wait up to 25 s).

Bridge ops added for this (page → Flutter):

| op | args | does | reply |
|---|---|---|---|
| account | – | – | `{"signedIn":bool,"email":str\|null,"tvLinked":bool,"tvOnline":bool,"tvName":str\|null}` |
| signIn | – | Google sign-in (Credential Manager, serverClientId = webClientId) → FirebaseAuth | account |
| signOut | – | FirebaseAuth + Google sign out | account |
| linkTv | `{"code":"12345678"}` | writes the token, waits ≤ 25 s for `tv/online` | account (`tvLinked:true`) or ok:false "That code is not on the TV." / "The TV did not answer. Is it on?" |
| unlinkTv | – | writes `tv/unlink` | account |

Event `account` (same shape) whenever it changes. Transport choice: the home Wi-Fi door when it answers (faster);
otherwise, signed in and the TV online in the cloud (`tv/online` within 3 minutes) → `status.state = "connected"`,
`status.via = "cloud"`, `status.tv = {"name":…, "address":"cloud", "port":0, "udp":null}`. Over the cloud: `tvstate`
events come from `/orbit/{uid}/tv/state`; pointer moves are batched to ≤ 10 a second; haptics stay local.

## Help mode (10 Nov): see the TV's screen from the phone and press its buttons

Why: the owner lives away from home; his parents call when the TV does something they don't understand. Help mode
shows him the TV's screen (menus, apps, settings; a playing video shows grey or black, the TV cannot capture its video
layer and DRM apps blank themselves) and lets him press buttons or tap the spot on the picture to click there.

TV routes (door and cloud alike):

- POST /api/help `{"on":true}` → `{"ok":true,"on":true}`; `{"on":false}` → `{"ok":true,"on":false}`. While on, the TV
  takes a picture of its screen about twice a second and sends one only when it changed (at least one every 5 s):
  - over the cloud: PUT `/orbit/{uid}/screen` = `{"at":<server ms>,"seq":n,"w":640,"h":360,"jpg":"<base64 JPEG>"}`
    (about 20 to 40 KB each);
  - over the Wi-Fi door: GET /api/screen → `image/jpeg` of the newest picture (404 while help is off), header
    `x-screen-seq: n`.
  Help ends by itself 30 s after the phone stops watching (the `watch` heartbeat, or no /api/screen read for 30 s on
  the Wi-Fi), after 30 minutes, or when the TV goes to standby; the TV then deletes `/orbit/{uid}/screen`. While it is
  on, the TV shows a small note at the top of its screen: "● Shiv can see this screen" (the linked account's first
  name; "Orbit" when it has none), so nobody at home is watched without knowing.
- POST /api/pointer `{"action":"tap","x":640,"y":360}` → the ring jumps to (x, y) in TV pixels of 1280 x 720 and clicks
  there (the same click as `{"action":"click"}`). x, y outside the screen are clamped.

Bridge ops (page → Flutter):

| op | args | does | reply |
|---|---|---|---|
| help | `{"on":bool}` | cloud: cmd /api/help, then (on) listen to `/orbit/{uid}/screen` and push each change as a `screen` event, (off) stop listening. Wi-Fi: POST /api/help, then GET /api/screen every 700 ms while on and push it as a `screen` event when `x-screen-seq` changed | the TV's answer |
| tapAt | `{"x":640,"y":360}` | POST /api/pointer `{"action":"tap","x":…,"y":…}` | the TV's answer |

Event `screen`: `{"jpg":"<base64 JPEG>","w":640,"h":360,"seq":n,"at":ms}`. Flutter turns help off by itself when the
app goes to the background (lifecycle paused) and on again when it comes back with the Help page still open (the page
sends `help` again on `lifecycle: resumed`).

Details the phone keeps (app 1.2.0, 10 Nov):
- `at` is in the phone's own clock (ms since 1970), so the page can say "Updated 3s ago". Over the cloud, the picture
  already at `/orbit/{uid}/screen` when the phone starts listening keeps the TV's time (server ms turned into the
  phone's clock with `.info/serverTimeOffset`), and is not passed on at all when it is 30 s old or more (left over from
  an earlier help); every picture the TV writes after that gets the time it arrived, so a TV clock that is off never
  hides a fresh picture. Over the Wi-Fi door `at` is when the picture arrived, and `w` and `h` come from the JPEG's own
  header.
- The `help` switches go to the TV one at a time, in order (an "off" sent on the way to the background reaches the TV
  before the next "on"). `help` with `"on":true` while the app is in the background answers 409. A page that loads
  again turns help off. If the way to the TV changes while help is on (the Wi-Fi door starts answering, or stops), the
  phone asks for help again the new way and watches the pictures there.
- While help is on over the cloud, the `watch` heartbeat keeps going even if the cloud stops carrying the TV for a moment.
- `tapAt`: the phone rounds x and y and keeps them within 0..1279 and 0..719 too.
- The page asks for help the moment Help is pressed (the first picture is often there by the time its page has come
  in), turns it off when the page goes or the TV is out of reach, and after 10 s without a picture says "The TV did not
  send its screen. Is it on?" with Try again (which sends `help` on again).

## Found on the real TV (MiTV-AXFU0, Android 14), 10 Nov

- The TV registers `_orbit._tcp` ("Family room", port 8090, TXT `v=1`, `udp=8091`): its own log says
  "MdnsAdvertiser Adding service", yet a Mac on the same Wi-Fi never sees it (Google's own `_androidtvremote2._tcp`
  from the same TV it does see). So the /24 scan is not optional: it is how the app finds this TV today.
- The TV has neither `android.hardware.touchscreen` nor `faketouch`, and Android then drops an accessibility service's
  taps without a word. A pointer click therefore: on Home, goes straight to Home's own hit test (the row turns to the
  card under the ring, the middle card opens); in other apps, clicks the clickable view under the ring, or focuses the
  focusable one and presses OK; with nothing under the ring, presses OK on whatever has the focus. Scroll: the list
  under the ring, else the remote's arrows. Long press is a long click on a view that takes one, else nothing.
- Arrows, OK, Back and Home from the phone are Android's global D-pad actions (Android 13+). They skip the TV helper's
  own key filter, so the TV routes them to its recent apps row first when that is open, and Home from the phone gets the
  same way back into the app's card as the remote's Home.

## Pointer datagrams (UDP, port from state `udp`, default 8091)

ASCII, one line, fields separated by single spaces:

    o1 <token> <seq> m <dx> <dy>      move the cursor (dx, dy in TV pixels at 1280x720, floats, may be negative)
    o1 <token> <seq> s <dx> <dy>      scroll (same units)

`seq` is an integer that goes up by one per datagram from each phone (start anywhere, wrap at 2^31). The TV drops a
datagram whose seq is not newer than the last one it took. Fire and forget; at most 60 a second (the page already
throttles to the screen's frames).

## Orbit Setup (11 Nov): put Orbit OS on a TV from the phone, no computer

The design is the canvas "Orbit Setup" (phone row: Welcome, Find, Developer mode, Allow, Questions, Plan, Installing,
Your name and account, Ready). The page drives the flow and decides what to change; Flutter finds TVs, opens the TV's
own debugging connection (ADB over Wi-Fi, port 5555) and moves files. Everything that changes the TV is ONE script,
`setup/tv/orbit-setup.sh`, run by the TV's own shell, so the phone, a computer and later a TV app all do the same thing.

### Ops (page -> Flutter)

| op | args | what Flutter does | reply data |
|---|---|---|---|
| setupScan | `{"seconds":4}` | NSD browse `_androidtvremote2._tcp`, `_googlecast._tcp` and `_orbit._tcp` together for that long, merged by address. Name: TXT `fn`, else the service name; model: TXT `md` when given | `{"tvs":[{"name":"Family room","address":"192.168.1.7","model":"MiTV-AXFU0","orbit":true}]}` (`model` may be null; `orbit` = it answered `_orbit._tcp`) |
| setupProbe | `{"address":"…","port":5555}` | TCP connect, 1.5 s timeout, closed at once | `{"open":true}` |
| setupConnect | `{"address":"…","port":5555}` | open ADB (classic TCP protocol, RSA auth with the app's own 2048-bit key, made once and kept in app storage). When the TV must show "Allow USB debugging?", push event `setupAuth` `{"state":"waiting"}`; give up after 90 s. Then read `getprop` | `{"model":"MiTV-AXFU0","manufacturer":"Xiaomi","brand":"Xiaomi","device":"arctictale","sdk":34,"release":"14"}`; errors `ok:false` with `reason` `"unreachable"` / `"refused"` (the TV said Cancel) / `"timeout"` / `"tls"` (only Wireless debugging, not supported yet) |
| setupShell | `{"cmd":"pm list packages","timeoutMs":20000}` | one shell command on the open connection | `{"out":"…"}` (stdout and stderr, at most 512 KB) |
| setupPush | `{"asset":"orbit-home.apk","to":"/data/local/tmp/orbit/orbit-home.apk"}` or `{"text":"…","to":"…"}` | ADB sync push, mode 0644. `asset` is one of the bundled files below | `{"bytes":3506975}` |
| setupRun | `{"cmd":"sh /data/local/tmp/orbit/orbit-setup.sh install"}` | shell with streaming output: every output line goes out as event `setupLine` `{"line":"…"}` as it arrives; the command is run as `<cmd>; echo @orbit-exit $?` | `{"exit":0}` |
| setupClose | – | close the ADB connection | `{}` |
| setupRecord | save `{"key":"<tv address>","record":{…}}`, load `{"key":"…"}` | app storage, one JSON record per TV | `{"record":{…}}` or `{"record":null}` |
| setupAdopt | `{"address":"192.168.1.7","port":8090,"token":"<the 32 hex of token.txt>","name":"Family room"}` | after the script's `pair` step: save this TV and token exactly as a finished `pair` would (secure storage), state → connected (check with GET /api/state; retry for 30 s while Orbit Home starts) | status |

Bundled files (Flutter assets under `assets/setup/`, copied by `phone/app/tool/sync_setup.sh` before a build):
`orbit-home.apk` (launcher/app release), `orbit-live.apk` (launcher/livetv release), `orbit-setup.sh` and
`orbit-undo.sh` (from `setup/tv/`). The phone app's own APK grows by about 5 MB.

### The script (`setup/tv/orbit-setup.sh`)

The page pushes into `/data/local/tmp/orbit/`: both APKs, the script, and

- `plan.txt`: one `key=value` per line: `home=1` (install Orbit Home and make it Home), `live=1` (install Orbit Live
  TV), `stock=<package of the TV's own launcher, read before anything changes>`
- `disable.txt`: the packages to switch off, one per line
- `name.txt`: the name for the greeting (UTF-8, may be empty)
- `token.txt`: 32 hex characters made by the phone; the TV's door takes it as an already paired phone, so no code is
  typed during setup. `phone.txt`: the phone's name for the TV's list of phones.

Then `setupRun` `sh /data/local/tmp/orbit/orbit-setup.sh install`. Later, `… name` sends only a new `name.txt`, and
`orbit-undo.sh` puts everything back from `undo.txt`. Lines starting `@orbit` are for the page, the rest is log:

    @orbit step <id> start|ok|skip|fail [text]   ids in order: check record disable home helper grants live name pair
    @orbit progress <0-100>
    @orbit undo <line>                          the undo record, one line at a time (the page saves all of them)
    @orbit done ok|fail [text]

The script refuses the system's core packages, never uninstalls a factory app, and if anything fails from `home` on
it gives Home back to the stock launcher before it stops. The undo record is also kept on the TV at
`/data/local/tmp/orbit/undo.txt`.

### Name and pairing on the TV

The script hands `name.txt`, `token.txt` and `phone.txt` to Orbit Home through its theme provider (`content write`,
so the files belong to Orbit Home), into `/sdcard/Android/data/com.gathin.tvhome/files/setup/`; a plain copy is the
fallback on firmware without the provider. Orbit Home reads `setup/name.txt` for the greeting when its theme sets no `greeting_name`, and its door adds
`setup/token.txt` to its paired phones once (then deletes the file). The page then talks to the door at port 8090
with that token, as after a normal pairing.

### What the page keeps

The page's catalog (`phone/ui/src/setup/catalog.json`) says, for each known package, what it is in plain words, its
group and whether it is safe to switch off, plus which question keeps it. Unknown packages are never touched: every package
in the catalog is one that is safe to switch off, and only those are offered on any TV. A model the catalog knows (from
`devices/`) adds its own rules, such as packages that must go together.
