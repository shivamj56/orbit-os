# Translating Orbit

Orbit is an open-source home screen for Android TVs and Google TVs. Its phone app is the TV's remote and sets Orbit
up on a TV. These texts are what people read in the phone app and on the TV.

## What you get

- `phone.json`: every phone text, `{ id, text, kind, one? }`. The `kind` tells you where it is shown:
  - `button`: keep it about as short as the English.
  - `heading`, `text`: ordinary text.
  - `spoken`: read out by screen readers.
  - `field`: a hint inside a text box.
  - `message`: an error or status coming from the TV, from Flutter or from the setup scripts.
- `jobs/<code>.json`: per language:
  - `phone`: the phone ids it needs.
  - `tv`: the TV launcher's strings it needs, `{ id, text, plural? }`.
  - `plural`: the language's plural categories.

## What you write

`out/<code>.json`, one JSON object, `id -> translation`. You may split it into parts: `out/<code>.1.json`,
`out/<code>.2.json`, … are merged. Rules for the values:

- Most texts take a plain string.
- **Counts** take an object with every category of the language's `plural` list, e.g. `{ "one": "…", "few": "…",
  "many": "…", "other": "…" }`:
  - a phone text with `one`;
  - a TV text with `plural`.
  - A language whose list is only `other` takes a plain string.
- Then run `node <repo>/tools/i18n/validate.cjs <work-dir> <code>` and fix everything it reports. A language is
  done when it says "all good".

## Rules

1. **Keep every mark exactly**: `{name}` values, `<b>…</b>` tags, Android's `%1$s` `%2$d` `%%` `%1$.1f`.
   - You may move them where your grammar needs them.
   - Never translate, drop or add one.
   - In counts, `{n}` (or `%1$d`) is the number. The `one` form may write the word instead of the number where that
     is natural.
2. **Never translate these names**: Orbit, Orbit OS, Orbit Home, Orbit Live TV, Orbit Setup, Google, Google Drive,
   Google TV, Android, Android TV, Chromecast, Wi-Fi, Bluetooth, USB, HDMI, YouTube, Netflix, Prime Video,
   Firebase, JSON, TLS, VPN, CPU, MB, GB, KB. Other makes of TV (Orbit 1.6.0 is their remote): Samsung, LG, Roku,
   Amazon, Fire TV, Apple TV, Tizen, webOS, ADB.
   - Keep **OK** as the remote's button name (Android shows "OK" on TVs in every language).
3. **The TV's own menus**: use the exact words Android TV / Google TV shows in your language. This covers Settings,
   System, About, Developer options, USB debugging, Wireless debugging, Android TV OS build, Allow, Always allow,
   Stay awake, Network & Internet, Display & Sound, and "You are now a developer!".
   - People must find these on their TV, so use Android's official translation even when another word sounds nicer.
   - The same holds for the other makes' menus: Samsung (General, External Device Manager), LG, Roku (Settings,
     System, Advanced system settings, Control by mobile apps, Network access, Default, Enabled) and Fire TV (My Fire
     TV, Developer options, ADB debugging, "Always allow from this computer"). Use the words those TVs show in your
     language when you know them; a TV that has no menu in your language keeps its English words.
4. **Voice**: plain, warm, short. Write what a careful native speaker would write for a polished app (the way Google
   writes its own apps in your language). Don't write word-for-word English.
   - Use the address form your language's Google apps use (for example German "du", French "vous", Hindi "आप").
   - Keep sentences short.
5. **Your language's own conventions**: punctuation (French spaces before `? ! :`, Spanish `¿ ¡`, Chinese and
   Japanese full-width punctuation, Arabic `،` and `؟`), quotation marks, word order and capitalisation (only
   English capitalises every word of a title: write titles the way your language does).
   - Numbers stay as `{n}`; never write digits yourself.
6. **Context you need**:
   - "TV" is the television.
   - "Home" is the TV's home screen.
   - "the remote" is the TV remote, which the phone becomes.
   - "Help" is a mode where the phone sees the TV's screen.
   - "Undo" puts the TV back as it was before Orbit.
   - "switch off" an app means disabling it (nothing is deleted).
   - "Focus" and "Cursor" are the remote's two modes: a trackball, or a touchpad.
   - Greetings ("Good Morning") are shown big on the TV.
   - Festival names are Indian festivals: keep the festival's own name ("Diwali", "Holi"), written in your script
     where your language does.
7. **TV strings**:
   - `date_format` is a Java date pattern (EEEE = weekday, d = day, MMMM = month name). Give the pattern your
     language uses, built from the same letters.
   - Persian month names (`shamsi_month_*`) are written the way your language writes them.
   - Short codes like FP1, SQ, QUALI are Formula 1 session codes: keep them.
8. **If a text is unclear**, choose the most natural meaning for a TV app.
   - Never leave English in a translation, except the names in rule 2.
   - Never add notes or explanations inside a value.
