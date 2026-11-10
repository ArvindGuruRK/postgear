/**
 * Where the region, not the country, decides the language.
 *
 * CLDR's per-country list ranks by speakers, so for India it answers Hindi first
 * everywhere, which is wrong in Chennai. This table is hand-written and small on
 * purpose: India in full, plus the regions research 03 (section 5) calls out. A
 * key may be a region (`CA-QC`) or a whole country (`SG`); the region wins.
 *
 * `resolveLanguages` adds English when a row leaves it out, so a row only has to
 * say what is local.
 */

const HINDI_BELT = ['hi', 'en'] as const;
const NORTH_EAST = ['en', 'hi'] as const;
const TELUGU_URDU = ['te', 'en', 'ur'] as const;

export const REGION_LANGUAGES: Readonly<Record<string, readonly string[]>> = {
  // India. Several states go by two codes (the older ISO one is still common in
  // OpenStreetMap), so both spellings are listed.
  'IN-TN': ['ta', 'en'],
  'IN-KL': ['ml', 'en'],
  'IN-KA': ['kn', 'en'],
  'IN-AP': ['te', 'en'],
  'IN-TG': TELUGU_URDU,
  'IN-TS': TELUGU_URDU,
  'IN-MH': ['mr', 'hi', 'en'],
  'IN-GJ': ['gu', 'hi', 'en'],
  'IN-WB': ['bn', 'en', 'hi'],
  'IN-OR': ['or', 'en', 'hi'],
  'IN-OD': ['or', 'en', 'hi'],
  'IN-PB': ['pa', 'hi', 'en'],
  'IN-AS': ['as', 'bn', 'en'],
  'IN-DL': ['hi', 'en', 'pa', 'ur'],
  'IN-UP': HINDI_BELT,
  'IN-BR': HINDI_BELT,
  'IN-MP': HINDI_BELT,
  'IN-RJ': HINDI_BELT,
  'IN-HR': HINDI_BELT,
  'IN-HP': HINDI_BELT,
  'IN-UT': HINDI_BELT,
  'IN-UK': HINDI_BELT,
  'IN-CT': HINDI_BELT,
  'IN-CG': HINDI_BELT,
  'IN-JH': HINDI_BELT,
  'IN-JK': ['ur', 'hi', 'en'],
  'IN-GA': ['kok', 'en', 'mr'],
  'IN-PY': ['ta', 'en', 'fr'],
  'IN-TR': ['bn', 'en'],
  'IN-SK': ['ne', 'en'],
  'IN-MN': NORTH_EAST,
  'IN-ML': NORTH_EAST,
  'IN-MZ': NORTH_EAST,
  'IN-NL': NORTH_EAST,
  'IN-AR': NORTH_EAST,
  'IN-AN': HINDI_BELT,
  'IN-CH': HINDI_BELT,
  'IN-DH': HINDI_BELT,
  'IN-LA': HINDI_BELT,
  'IN-LD': ['ml', 'en'],

  'CA-QC': ['fr', 'en'],

  'CH-ZH': ['de'],
  'CH-GE': ['fr'],
  'CH-VD': ['fr'],
  'CH-TI': ['it'],

  'BE-BRU': ['fr', 'nl'],
  'BE-VLG': ['nl'],
  'BE-WAL': ['fr'],

  'ES-CT': ['ca', 'es'],

  'US-PR': ['es-419', 'en'],
  'GB-WLS': ['en', 'cy'],
  'IT-BZ': ['de', 'it'],
  'FI-01': ['sv', 'fi'],

  'ZA-GP': ['en', 'zu', 'af'],
  'ZA-KZN': ['en', 'zu'],
  'ZA-WC': ['en', 'af', 'xh'],
  'ZA-EC': ['en', 'xh', 'af'],

  'NG-LA': ['en', 'yo'],
  'NG-OY': ['en', 'yo'],
  'NG-KN': ['en', 'ha'],
  'NG-KD': ['en', 'ha'],
  'NG-EN': ['en', 'ig'],
  'NG-AN': ['en', 'ig'],

  'PK-PB': ['ur', 'en', 'pa'],
  'PK-SD': ['ur', 'en', 'sd'],
  'PK-KP': ['ur', 'en', 'ps'],
  'PK-BA': ['ur', 'en'],
  'PK-IS': ['ur', 'en'],

  // CLDR also lists Spanish and German for France, at 13 and 5 percent: real speakers,
  // but not the languages a Paris creator would expect first in this menu.
  FR: ['fr', 'en'],
  LK: ['si', 'ta', 'en'],
  MY: ['ms', 'en', 'zh'],
  SG: ['en', 'zh', 'ms', 'ta'],
};

/**
 * Display names for the regions a request can name by code alone. A place found
 * through the geocoder carries its own name; this is for a bare `region=IN-TN`,
 * where a heading should still read "Tamil Nadu" and not "IN-TN".
 */
export const REGION_NAMES: Readonly<Record<string, string>> = {
  'IN-AN': 'Andaman and Nicobar Islands',
  'IN-AP': 'Andhra Pradesh',
  'IN-AR': 'Arunachal Pradesh',
  'IN-AS': 'Assam',
  'IN-BR': 'Bihar',
  'IN-CH': 'Chandigarh',
  'IN-CT': 'Chhattisgarh',
  'IN-CG': 'Chhattisgarh',
  'IN-DH': 'Dadra and Nagar Haveli and Daman and Diu',
  'IN-DL': 'Delhi',
  'IN-GA': 'Goa',
  'IN-GJ': 'Gujarat',
  'IN-HP': 'Himachal Pradesh',
  'IN-HR': 'Haryana',
  'IN-JH': 'Jharkhand',
  'IN-JK': 'Jammu and Kashmir',
  'IN-KA': 'Karnataka',
  'IN-KL': 'Kerala',
  'IN-LA': 'Ladakh',
  'IN-LD': 'Lakshadweep',
  'IN-MH': 'Maharashtra',
  'IN-ML': 'Meghalaya',
  'IN-MN': 'Manipur',
  'IN-MP': 'Madhya Pradesh',
  'IN-MZ': 'Mizoram',
  'IN-NL': 'Nagaland',
  'IN-OR': 'Odisha',
  'IN-OD': 'Odisha',
  'IN-PB': 'Punjab',
  'IN-PY': 'Puducherry',
  'IN-RJ': 'Rajasthan',
  'IN-SK': 'Sikkim',
  'IN-TG': 'Telangana',
  'IN-TS': 'Telangana',
  'IN-TN': 'Tamil Nadu',
  'IN-TR': 'Tripura',
  'IN-UP': 'Uttar Pradesh',
  'IN-UT': 'Uttarakhand',
  'IN-UK': 'Uttarakhand',
  'IN-WB': 'West Bengal',
  'CA-QC': 'Quebec',
  'US-CA': 'California',
  'US-PR': 'Puerto Rico',
  'FR-IDF': 'Ile-de-France',
};
