// Every language Orbit speaks: the languages Android itself offers, each named in its own words. The TV side keeps the
// same list in launcher/app/src/main/res/xml/locales_config.xml (with Android's resource names: he is iw, id is in).

export interface Language {
  /** BCP 47 tag, also the file name in public/locales/ ("pt-BR" -> pt-BR.json). */
  code: string;
  /** The language's own name for itself, as the Language list shows it. */
  name: string;
  /** Its name in English, for searching the list and for people helping with translations. */
  english: string;
  /** Written right to left. */
  rtl?: boolean;
}

export const ENGLISH: Language = { code: "en", name: "English", english: "English" };

export const LANGUAGES: readonly Language[] = [
  { code: "af", name: "Afrikaans", english: "Afrikaans" },
  { code: "am", name: "አማርኛ", english: "Amharic" },
  { code: "ar", name: "العربية", english: "Arabic", rtl: true },
  { code: "as", name: "অসমীয়া", english: "Assamese" },
  { code: "ast", name: "Asturianu", english: "Asturian" },
  { code: "az", name: "Azərbaycan", english: "Azerbaijani" },
  { code: "be", name: "Беларуская", english: "Belarusian" },
  { code: "bg", name: "Български", english: "Bulgarian" },
  { code: "bn", name: "বাংলা", english: "Bengali" },
  { code: "bs", name: "Bosanski", english: "Bosnian" },
  { code: "ca", name: "Català", english: "Catalan" },
  { code: "cs", name: "Čeština", english: "Czech" },
  { code: "da", name: "Dansk", english: "Danish" },
  { code: "de", name: "Deutsch", english: "German" },
  { code: "el", name: "Ελληνικά", english: "Greek" },
  ENGLISH,
  { code: "es", name: "Español (España)", english: "Spanish (Spain)" },
  { code: "es-419", name: "Español (Latinoamérica)", english: "Spanish (Latin America)" },
  { code: "et", name: "Eesti", english: "Estonian" },
  { code: "eu", name: "Euskara", english: "Basque" },
  { code: "fa", name: "فارسی", english: "Persian", rtl: true },
  { code: "fi", name: "Suomi", english: "Finnish" },
  { code: "fil", name: "Filipino", english: "Filipino" },
  { code: "fr", name: "Français", english: "French" },
  { code: "fr-CA", name: "Français (Canada)", english: "French (Canada)" },
  { code: "gl", name: "Galego", english: "Galician" },
  { code: "gu", name: "ગુજરાતી", english: "Gujarati" },
  { code: "he", name: "עברית", english: "Hebrew", rtl: true },
  { code: "hi", name: "हिन्दी", english: "Hindi" },
  { code: "hr", name: "Hrvatski", english: "Croatian" },
  { code: "hu", name: "Magyar", english: "Hungarian" },
  { code: "hy", name: "Հայերեն", english: "Armenian" },
  { code: "id", name: "Indonesia", english: "Indonesian" },
  { code: "is", name: "Íslenska", english: "Icelandic" },
  { code: "it", name: "Italiano", english: "Italian" },
  { code: "ja", name: "日本語", english: "Japanese" },
  { code: "ka", name: "ქართული", english: "Georgian" },
  { code: "kk", name: "Қазақ тілі", english: "Kazakh" },
  { code: "km", name: "ខ្មែរ", english: "Khmer" },
  { code: "kn", name: "ಕನ್ನಡ", english: "Kannada" },
  { code: "ko", name: "한국어", english: "Korean" },
  { code: "ky", name: "Кыргызча", english: "Kyrgyz" },
  { code: "lo", name: "ລາວ", english: "Lao" },
  { code: "lt", name: "Lietuvių", english: "Lithuanian" },
  { code: "lv", name: "Latviešu", english: "Latvian" },
  { code: "mk", name: "Македонски", english: "Macedonian" },
  { code: "ml", name: "മലയാളം", english: "Malayalam" },
  { code: "mn", name: "Монгол", english: "Mongolian" },
  { code: "mr", name: "मराठी", english: "Marathi" },
  { code: "ms", name: "Melayu", english: "Malay" },
  { code: "my", name: "မြန်မာ", english: "Burmese" },
  { code: "nb", name: "Norsk bokmål", english: "Norwegian Bokmål" },
  { code: "ne", name: "नेपाली", english: "Nepali" },
  { code: "nl", name: "Nederlands", english: "Dutch" },
  { code: "or", name: "ଓଡ଼ିଆ", english: "Odia" },
  { code: "pa", name: "ਪੰਜਾਬੀ", english: "Punjabi" },
  { code: "pl", name: "Polski", english: "Polish" },
  { code: "pt-BR", name: "Português (Brasil)", english: "Portuguese (Brazil)" },
  { code: "pt-PT", name: "Português (Portugal)", english: "Portuguese (Portugal)" },
  { code: "ro", name: "Română", english: "Romanian" },
  { code: "ru", name: "Русский", english: "Russian" },
  { code: "si", name: "සිංහල", english: "Sinhala" },
  { code: "sk", name: "Slovenčina", english: "Slovak" },
  { code: "sl", name: "Slovenščina", english: "Slovenian" },
  { code: "sq", name: "Shqip", english: "Albanian" },
  { code: "sr", name: "Српски", english: "Serbian (Cyrillic)" },
  { code: "sr-Latn", name: "Srpski (latinica)", english: "Serbian (Latin)" },
  { code: "sv", name: "Svenska", english: "Swedish" },
  { code: "sw", name: "Kiswahili", english: "Swahili" },
  { code: "ta", name: "தமிழ்", english: "Tamil" },
  { code: "te", name: "తెలుగు", english: "Telugu" },
  { code: "th", name: "ไทย", english: "Thai" },
  { code: "tr", name: "Türkçe", english: "Turkish" },
  { code: "uk", name: "Українська", english: "Ukrainian" },
  { code: "ur", name: "اردو", english: "Urdu", rtl: true },
  { code: "uz", name: "Oʻzbek", english: "Uzbek" },
  { code: "vi", name: "Tiếng Việt", english: "Vietnamese" },
  { code: "zh-CN", name: "简体中文", english: "Chinese (Simplified)" },
  { code: "zh-HK", name: "繁體中文（香港）", english: "Chinese (Hong Kong)" },
  { code: "zh-TW", name: "繁體中文（台灣）", english: "Chinese (Taiwan)" },
  { code: "zu", name: "isiZulu", english: "Zulu" },
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code.toLowerCase(), l]));

/** Android's and older browsers' names for some of these. */
const ALIASES: Record<string, string> = {
  iw: "he",
  in: "id",
  tl: "fil",
  no: "nb",
  nn: "nb",
  pt: "pt-BR",
  "zh-hans": "zh-CN",
  "zh-sg": "zh-CN",
  "zh-hant": "zh-TW",
  "zh-mo": "zh-HK",
  zh: "zh-CN",
  sh: "sr-Latn",
};

/**
 * The language Orbit has for a tag the phone gives ("pt-BR", "es-MX", "zh-Hant-TW", "sr-Latn-RS", "iw"), or null when
 * Orbit does not speak it.
 */
export function languageFor(tag: string): Language | null {
  const parts = tag.trim().replace(/_/g, "-").split("-").filter(Boolean);
  if (!parts.length || !/^[a-z]{2,3}$/i.test(parts[0])) return null;
  const lang = parts[0].toLowerCase();
  const rest = parts.slice(1).map((p) => p.toLowerCase());
  const script = rest.find((p) => p.length === 4);
  const region = rest.find((p) => p.length === 2 || /^\d{3}$/.test(p));
  const pick = (code: string | undefined) => (code ? BY_CODE.get(code.toLowerCase()) ?? null : null);

  if (lang === "zh") {
    if (region === "hk" || region === "mo") return pick("zh-HK");
    if (script === "hant" || region === "tw") return pick("zh-TW");
    return pick("zh-CN");
  }
  if (lang === "sr" || lang === "sh") return pick(script === "latn" || lang === "sh" ? "sr-Latn" : "sr");
  if (lang === "pt") return pick(region && region !== "br" ? "pt-PT" : "pt-BR");
  // Spanish outside Spain (Mexico, the United States, 419 itself...) reads the Latin American wording.
  if (lang === "es") return pick(!region || region === "es" ? "es" : "es-419");
  if (lang === "fr") return pick(region === "ca" ? "fr-CA" : "fr");
  return pick(region ? `${lang}-${region}` : undefined) ?? pick(lang) ?? pick(ALIASES[lang]);
}
