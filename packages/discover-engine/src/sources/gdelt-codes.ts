/**
 * How GDELT names a country and a language, which is not how the rest of the
 * engine does.
 *
 * ## Countries are FIPS 10-4, not ISO
 *
 * The DOC 2.0 API's `sourcecountry:` takes a country's name with its spaces
 * taken out (`unitedarabemirates`) or its two-letter FIPS 10-4 code. FIPS looks
 * like ISO 3166 and is not: Germany is `GM`, the United Kingdom `UK`, and some
 * codes mean another country in each (`AU` is Australia in ISO and Austria in
 * FIPS, `SG` is Singapore in ISO and Senegal in FIPS). So an ISO code is never
 * passed through as it is, and a country missing from {@link ISO_TO_FIPS} is
 * asked about with no country filter at all.
 *
 * The table was built on 2026-11-11 from GDELT's own list
 * (`https://data.gdeltproject.org/api/v2/guides/LOOKUP-COUNTRIES.TXT`): its
 * names were matched with the English names `Intl` gives the ISO codes, and the
 * 31 that did not match by name were paired by hand, each checked to be a code
 * on that list and used once. Left out on purpose:
 *
 * - Guinea (`GN`): its FIPS code `GV` is labelled "Equatorial Guinea" in GDELT's
 *   list, which has Equatorial Guinea under `EK` as well, so which one GDELT
 *   files Guinea's outlets under cannot be told from the list.
 * - Palestine (`PS`): GDELT splits it into Gaza Strip (`GZ`) and West Bank
 *   (`WE`), and one filter can name only one.
 * - Places FIPS has no code of its own for (Aland, Curacao, Sint Maarten, the
 *   Caribbean Netherlands, Sark, the United States Minor Outlying Islands).
 *
 * Slovakia is `LO`, which is right for FIPS even though GDELT's list still
 * labels that code "Czechoslovakia".
 *
 * ## Languages are names
 *
 * `sourcelang:` takes the language's English name (`sourcelang:spanish`) or a
 * three-letter code GDELT picks itself (it writes `axe` for Azerbaijani). The
 * name is what the documentation shows and what the answers carry in their
 * `language` field, so names are used both ways. The list is the 64 languages
 * GDELT translates (`LOOKUP-LANGUAGES.TXT`), plus English, which it reads as is.
 */

/** ISO 3166-1 alpha-2, then a colon, then the FIPS 10-4 code GDELT files that country under. */
const ISO_FIPS_PAIRS = `
  AD:AN AE:AE AF:AF AG:AC AI:AV AL:AL AM:AM AO:AO AQ:AY AR:AR AS:AQ AT:AU
  AU:AS AW:AA AZ:AJ BA:BK BB:BB BD:BG BE:BE BF:UV BG:BU BH:BA BI:BY BJ:BN
  BL:TB BM:BD BN:BX BO:BL BR:BR BS:BF BT:BT BV:BV BW:BC BY:BO BZ:BH CA:CA
  CC:CK CD:CG CF:CT CG:CF CH:SZ CI:IV CK:CW CL:CI CM:CM CN:CH CO:CO CP:IP
  CR:CS CU:CU CV:CV CX:KT CY:CY CZ:EZ DE:GM DJ:DJ DK:DA DM:DO DO:DR DZ:AG
  EC:EC EE:EN EG:EG EH:WI ER:ER ES:SP ET:ET FI:FI FJ:FJ FK:FK FM:FM FO:FO
  FR:FR GA:GB GB:UK GD:GJ GE:GG GF:FG GG:GK GH:GH GI:GI GL:GL GM:GA GP:GP
  GQ:EK GR:GR GS:SX GT:GT GU:GQ GW:PU GY:GY HK:HK HM:HM HN:HO HR:HR HT:HA
  HU:HU ID:ID IE:EI IL:IS IM:IM IN:IN IO:IO IQ:IZ IR:IR IS:IC IT:IT JE:JE
  JM:JM JO:JO JP:JA KE:KE KG:KG KH:CB KI:KR KM:CN KN:SC KP:KN KR:KS KW:KU
  KY:CJ KZ:KZ LA:LA LB:LE LC:ST LI:LS LK:CE LR:LI LS:LT LT:LH LU:LU LV:LG
  LY:LY MA:MO MC:MN MD:MD ME:MJ MF:RN MG:MA MH:RM MK:MK ML:ML MM:BM MN:MG
  MO:MC MP:CQ MQ:MB MR:MR MS:MH MT:MT MU:MP MV:MV MW:MI MX:MX MY:MY MZ:MZ
  NA:WA NC:NC NE:NG NF:NF NG:NI NI:NU NL:NL NO:NO NP:NP NR:NR NU:NE NZ:NZ
  OM:MU PA:PM PE:PE PF:FP PG:PP PH:RP PK:PK PL:PL PM:SB PN:PC PR:RQ PT:PO
  PW:PS PY:PA QA:QA RE:RE RO:RO RS:RI RU:RS RW:RW SA:SA SB:BP SC:SE SD:SU
  SE:SW SG:SN SH:SH SI:SI SJ:SV SK:LO SL:SL SM:SM SN:SG SO:SO SR:NS SS:OD
  ST:TP SV:ES SY:SY SZ:WZ TC:TK TD:CD TF:FS TG:TO TH:TH TJ:TI TK:TL TL:TT
  TM:TX TN:TS TO:TN TR:TU TT:TD TV:TV TW:TW TZ:TZ UA:UP UG:UG US:US UY:UY
  UZ:UZ VA:VT VC:VC VE:VE VG:VI VI:VQ VN:VM VU:NH WF:WF WS:WS XK:KV YE:YM
  YT:MF ZA:SF ZM:ZA ZW:ZI
`;

export const ISO_TO_FIPS: ReadonlyMap<string, string> = new Map(
  ISO_FIPS_PAIRS.trim()
    .split(/\s+/)
    .map((pair) => pair.split(':') as [string, string]),
);

/**
 * BCP-47 primary subtag to the name GDELT gives the language. Norwegian is
 * listed under its three tags (`no` and Bokmal's `nb` are one in GDELT), and
 * Hebrew under its old tag too, which some browsers still send.
 */
export const GDELT_LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  af: 'Afrikaans',
  ar: 'Arabic',
  az: 'Azerbaijani',
  bg: 'Bulgarian',
  bn: 'Bengali',
  bo: 'Tibetan',
  bs: 'Bosnian',
  ca: 'Catalan',
  cs: 'Czech',
  da: 'Danish',
  de: 'German',
  el: 'Greek',
  en: 'English',
  es: 'Spanish',
  et: 'Estonian',
  fa: 'Persian',
  fi: 'Finnish',
  fr: 'French',
  gl: 'Galician',
  gu: 'Gujarati',
  he: 'Hebrew',
  hi: 'Hindi',
  hr: 'Croatian',
  hu: 'Hungarian',
  hy: 'Armenian',
  id: 'Indonesian',
  is: 'Icelandic',
  it: 'Italian',
  iw: 'Hebrew',
  ja: 'Japanese',
  ka: 'Georgian',
  kk: 'Kazakh',
  kn: 'Kannada',
  ko: 'Korean',
  lt: 'Lithuanian',
  lv: 'Latvian',
  mk: 'Macedonian',
  ml: 'Malayalam',
  mn: 'Mongolian',
  mr: 'Marathi',
  ms: 'Malay',
  nb: 'Norwegian',
  ne: 'Nepali',
  nl: 'Dutch',
  nn: 'NorwegianNynorsk',
  no: 'Norwegian',
  pa: 'Punjabi',
  pl: 'Polish',
  pt: 'Portuguese',
  ro: 'Romanian',
  ru: 'Russian',
  si: 'Sinhalese',
  sk: 'Slovak',
  sl: 'Slovenian',
  so: 'Somali',
  sq: 'Albanian',
  sr: 'Serbian',
  sv: 'Swedish',
  sw: 'Swahili',
  ta: 'Tamil',
  te: 'Telugu',
  th: 'Thai',
  tr: 'Turkish',
  uk: 'Ukrainian',
  ur: 'Urdu',
  vi: 'Vietnamese',
  zh: 'Chinese',
};

/**
 * The other way, from the `language` an answer carries to a tag. Built from the
 * table above, so the first tag listed for a name wins (`Hebrew` reads `he`,
 * `Norwegian` reads `nb`), and compared without case or spaces, since the
 * answers write "Norwegian Nynorsk" where the lookup list writes it as one word.
 */
const TAG_BY_NAME: ReadonlyMap<string, string> = new Map(
  Object.entries(GDELT_LANGUAGE_NAMES)
    .reverse()
    .map(([tag, name]) => [nameKey(name), tag]),
);

function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

/** `IN` to `IN`, `DE` to `GM`, and null for a country GDELT's list cannot be trusted for. */
export function gdeltCountry(countryCode: string | null | undefined): string | null {
  return countryCode ? (ISO_TO_FIPS.get(countryCode.toUpperCase()) ?? null) : null;
}

/** `ta-IN` to `tamil`, as `sourcelang:` wants it; null for a language GDELT does not read. */
export function gdeltLanguage(language: string): string | null {
  const primary = language.toLowerCase().split('-')[0];
  const name = Object.hasOwn(GDELT_LANGUAGE_NAMES, primary) ? GDELT_LANGUAGE_NAMES[primary] : null;
  return name ? nameKey(name) : null;
}

/** `Tamil` to `ta`. Undefined for a name the table does not know. */
export function languageTagOf(gdeltName: unknown): string | undefined {
  return typeof gdeltName === 'string' ? TAG_BY_NAME.get(nameKey(gdeltName)) : undefined;
}
