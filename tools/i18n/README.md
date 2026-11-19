# Orbit in every language

Orbit speaks every language Android itself offers: about 80, from Afrikaans to Zulu. The list lives once, in
[`phone/ui/src/i18n/languages.ts`](../../phone/ui/src/i18n/languages.ts).

| Where | English lives in | Translations live in | Picked by |
|---|---|---|---|
| The phone app's page | the code, as `t("…")`, `tn(…)`, `mark("…")` | `phone/ui/public/locales/<code>.json` | the phone's language, or Settings › Language |
| Messages from Flutter, the TV and the setup scripts | their own code | the same phone files (`tm()` translates them where they show) | the same |
| Orbit's own words on the TV | the launcher's code, as `Words.t("…")`, `Words.mark("…")`, `Words.n(…)` | `launcher/app/src/main/assets/words/<code>.json` | the TV's language, or `locale` in config.json |
| The launcher's older texts | `launcher/app/src/main/res/values/strings.xml` | `values-<code>/strings.xml` | the same |
| Orbit Live TV | `launcher/livetv/src/main/res/values/strings.xml` | `values-<code>/strings.xml` | the TV's language |

Every translation file is keyed by the English text itself, so a file reads like a two-column list.

Placeholders like `{name}`, tags like `<b>…</b>` and Android's `%1$s` must stay. A count's value is an object with the
language's plural forms (`"one"`, `"few"`, `"other"`…).

## Fix a translation

1. Open your language's file (for example `phone/ui/public/locales/pt-BR.json`) and find the English text.
2. Change only the translation. Keep every `{value}` and `<b>` tag; you may move them.
3. Run the tests: `cd phone/ui && npm test` checks every file's placeholders and plural forms.
4. Open a pull request. Most translations were first made with an AI model and are waiting for a native speaker like
   you, so corrections are very welcome.

## Add or change English in the code

1. Write the text in `t("…")`.
   - A count is `tn(n, "{n} app", "{n} apps")`.
   - Data shown later is `mark("…")` (on the TV, `Words.mark`).
   - On the phone, use single spaces and no space at either end: write `" " + t("· the newest")`, not `t(" · the newest")`.
     `extract.cjs` folds spaces, so the translation files key the folded text; a text written any other way is never
     found and stays English in every language (Orbit 1.5.1's remote hint). `i18n.test.ts` checks this. The TV
     extractor keeps spaces as written, because the TV draws them.
2. Run `node tools/i18n/extract.cjs` for the phone, and `node tools/i18n/extract-tv.cjs` for the TV. They rewrite
   `phone/ui/i18n/source.json` and `launcher/i18n/source.json`, the lists of every English text.
   - `--check` fails while a list is out of date, for CI.
3. Translate what is new. Untranslated texts show in English until then, so nothing breaks.

## Translating many texts at once

```bash
node tools/i18n/jobs.cjs .i18n-work                 # phone + launcher strings: what each language still needs
node tools/i18n/jobs-tv.cjs .i18n-work-tv           # Orbit's TV words + Live TV
# translate: see BRIEF.md (the rules every translator, person or model, follows); answers go to <dir>/out/<code>.json
node tools/i18n/validate.cjs .i18n-work hi pt-BR    # marks, plural forms, nothing missing
node tools/i18n/apply.cjs --phone .i18n-work        # into the app's files (never overwrites a translation)
node tools/i18n/apply.cjs --tv .i18n-work-tv
node tools/i18n/apply.cjs --locales                 # the launcher's locales_config.xml
```

`wrap-ui.cjs` is the one-off codemod that first put the page's English into `t()`. It is kept for texts written
before the next change, and it lists what it leaves for a person to do.
