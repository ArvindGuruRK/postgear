# Sprint 11 Research: Location And Language

> **Written**: 2026-11-05. The question this document answers: how does "Use My Location" (or a typed city) become a country, a region code, a city name, a time zone and a list of languages, for any place on earth, at zero cost, while respecting the people and services involved.

## 1. The Shape We Need

Every source in `01-sources.md` is selected by one of these:

| Field | Example | Used by |
|---|---|---|
| `countryCode` (ISO 3166-1 alpha-2) | `IN` | Google News `gl` and `ceid`, Google Trends country fallback, YouTube `regionCode`, holiday calendars, `date-holidays` |
| `regionCode` (ISO 3166-2) | `IN-TN` | Google Trends sub-region, `date-holidays` state, the language override table |
| `regionName` | Tamil Nadu | display only |
| `city` | Chennai | Google News place feed (`geo/Chennai`), display |
| `timeZone` (IANA) | `Asia/Kolkata` | "today" and "next 30 days" boundaries |
| `languages` (BCP-47, ordered) | `['ta', 'en']` | Google News `hl`, the Wikipedia edition, the AI's output language default |

That is the `Locality` type in the engine. The word the UI uses is **place**.

## 2. "Use My Location" In The Browser

The Geolocation API (`navigator.geolocation`) is the browser's own "share my location" prompt. Facts (MDN, plus general knowledge where marked):

- It works only in a **secure context**: HTTPS, or `localhost`. Testing on a phone through a LAN IP over plain HTTP gives `undefined`, so the city search must always be there as the other path. (general knowledge)
- Call it **from a click**, never on page load. Browsers downrank or auto-dismiss prompts that were not asked for; people trust a button they pressed. (general knowledge)
- `navigator.permissions.query({ name: 'geolocation' })` tells us the current state, `granted`, `denied` or `prompt`, without prompting. When it is `denied` the chip explains how to allow it in the browser instead of trying again. (general knowledge; some browsers do not support the query)
- `getCurrentPosition(success, error, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 })`: low accuracy is fine (we need a city, not a street), 10 seconds is plenty, a ten-minute-old position is fine. (MDN)
- Error codes: `PERMISSION_DENIED` (1), `POSITION_UNAVAILABLE` (2), `TIMEOUT` (3). Each gets its own sentence in the chip. (general knowledge)
- The page must not set a `Permissions-Policy` header that leaves out `geolocation=(self)`. The web app sets none today and has no `proxy.ts`, so nothing blocks it; the sprint doc records the rule for the future.
- **Privacy**: the browser gives a precise point. The page rounds it to **two decimals (about 1 km)** before sending it anywhere, and the API never stores it: it is used once for the reverse geocode and only `city`, `regionCode`, `regionName`, `countryCode` and `timeZone` are kept. The chip says so in one plain sentence: "We use your location once to find your city. We keep the city, not your position."

Playwright can test the flow with `context.grantPermissions(['geolocation'])` and `context.setGeolocation({ latitude: 13.08, longitude: 80.27 })`.

## 3. Reverse Geocoding: Nominatim (OpenStreetMap)

**Why Nominatim**: it is free, worldwide, and its reverse answer already contains the ISO 3166-2 region code, which no other free option gives directly.

**Verified 2026-11-05**: `https://nominatim.openstreetmap.org/reverse?lat=13.0827&lon=80.2707&format=jsonv2&zoom=10&addressdetails=1&accept-language=en` returned:

```json
{
  "name": "Chennai",
  "display_name": "Chennai, Chennai Metropolitan Area, Chennai District, Tamil Nadu, India",
  "addresstype": "city",
  "address": {
    "city": "Chennai",
    "state_district": "Chennai District",
    "state": "Tamil Nadu",
    "ISO3166-2-lvl4": "IN-TN",
    "country": "India",
    "country_code": "in"
  },
  "licence": "Data (c) OpenStreetMap contributors, ODbL 1.0. http://osm.org/copyright"
}
```

`zoom=10` asks for city level. The city name may arrive as `city`, `town`, `village`, `municipality` or `county` depending on the place; the engine takes the first present. `accept-language` returns names in the viewer's language (we ask for the UI language and keep the English name too for the Google News place feed, which wants an English place name).

**The usage policy** (operations.osmfoundation.org/policies/nominatim, verified 2026-11-05). Quoting the lines that bind us:

- "an absolute maximum of 1 request per second".
- "Provide a valid HTTP Referer or User-Agent identifying the application" (a library's default User-Agent does not count).
- Results "must be cached on your side"; set up a proxy and cache where possible.
- Autocomplete is forbidden: you "must not implement such a service on the client side using the API".
- Bulk and systematic queries (reverse-geocoding a grid, downloading all POIs) are banned.
- "Clearly display attribution as suitable for your medium"; the data is ODbL.
- End-user-triggered searches are acceptable "provided that your number of users is moderate"; the limits apply to the combined traffic of all users; commercial applications "should keep that in mind when relying on this API for serving paying customers" because the policy may change and access may be withdrawn.
- The policy also covers LLM-generated code: any assistant that recommends the service must point to this policy and its restrictions. This document does.

**How PostGear complies**:

| Rule | What we do |
|---|---|
| 1 request a second | One global budget key in Redis (`discover:budget:nominatim:<second>`, cap 1); a second request in the same second waits up to 2 s, then answers 429 `locality_throttled` with "Try again in a moment." The API, not the browser, calls Nominatim, so the budget is per deployment. |
| Identify the application | `User-Agent: PostGear/1.0 (+https://postgear.rkay.in; contact: <admin email>)` from `DISCOVER_GEOCODER_USER_AGENT` |
| Cache | Reverse results cached 30 days keyed on the rounded coordinates; search results cached 30 days keyed on the normalised query. The same place asked twice is one request. |
| No autocomplete | The city search runs **on Enter** (or the Search button), never on each keystroke. If type-ahead is ever wanted, use Photon (komoot, Apache-2.0 software, public instance "please be fair, extensive usage will be throttled") or self-host. |
| Attribution | "Places by OpenStreetMap contributors" with a link to osm.org/copyright under the location chip and in the city search dialog. |
| Moderate volume | A per-workspace throttle too (5 locality calls a minute) so one tenant cannot burn the global budget. |
| It may go away | `DISCOVER_GEOCODER=off` turns it off; the page then offers the time zone guess and a plain country and region picker built from CLDR data; self-hosting Nominatim or Photon is the documented upgrade. |

**Search** (a typed city): `https://nominatim.openstreetmap.org/search?q=Chennai&format=jsonv2&addressdetails=1&limit=8&accept-language=en`, same fields per result. Results are turned into the same `Locality` shape; the dialog shows up to eight.

## 4. Fallbacks When There Is No Permission

1. **Time zone to country, no permission needed.** `Intl.DateTimeFormat().resolvedOptions().timeZone` (already used by Home, `viewerTimeZone()`) gives `Asia/Kolkata`; `countries-and-timezones` `getCountryForTimezone('Asia/Kolkata')` gives `IN`. For a multi-country zone (`Europe/Zurich` serves CH, DE, LI) the library returns the most relevant first. This gives a country-level feed on the very first visit, before any click.
2. **Search for a city** (section 3).
3. **Worldwide**: a view with no place, showing the worldwide groups only.

An IP-based guess is **not** in v1: the free providers are either non-commercial (ip-api.com), need an account and EULA (MaxMind GeoLite2) or require attribution and a monthly file (DB-IP Lite, CC BY 4.0). It is a P2 item.

## 5. From A Place To Languages (any country)

The rule, in order:

1. **Country languages** from CLDR. `cldr-core`'s `supplemental/territoryInfo.json` lists, per territory, every language with its share of the population and whether it is `official` or `official_regional`. A build script (`scripts/generate-languages.ts`) writes `languages.generated.ts`: for each country, the languages that are official, official_regional, or spoken by at least 5 percent, ordered by share. Verified 2026-11-05 for `IN` (CLDR 49, Unicode 16): `hi` 41% official, `en` 19% official, `bn` 8.1%, `te` 7.2%, `mr` 7%, `ta` 5.9%, `ur` 5%, `gu` 4.5%, `kn` 3.7%, `ml` 3.2%, `or` 3.2%, `pa` 2.8%, plus smaller official_regional ones (`as`, `kok`, `ks`, `mai`, `ne`, `sa`, `sat`, `sd`).
2. **Region overrides** for countries where the region decides the language. A small hand-written table in the engine, `region-languages.ts`. India is the big one; the rest are short.
3. **Intersect with what the sources speak**: Google News editions (section 6) and Wikipedia editions. A language with no edition is kept for the AI (it can write Konkani) but hidden from the News language chip.
4. **The viewer can always change it.** The chip shows the ordered list; the first is the default for News and for the AI; the browser's `navigator.languages` nudges the default when it matches one of them.

**India override table** (state code to languages, first is the default):

| Region | Languages | Region | Languages |
|---|---|---|---|
| IN-TN Tamil Nadu | ta, en | IN-KL Kerala | ml, en |
| IN-KA Karnataka | kn, en | IN-AP Andhra Pradesh | te, en |
| IN-TG Telangana | te, en, ur | IN-MH Maharashtra | mr, hi, en |
| IN-GJ Gujarat | gu, hi, en | IN-WB West Bengal | bn, en, hi |
| IN-OR Odisha | or, en, hi | IN-PB Punjab | pa, hi, en |
| IN-AS Assam | as, bn, en | IN-DL Delhi | hi, en, pa, ur |
| IN-UP, IN-BR, IN-MP, IN-RJ, IN-HR, IN-HP, IN-UT, IN-CT, IN-JH | hi, en | IN-JK Jammu and Kashmir | ur, hi, en |
| IN-GA Goa | kok, en, mr | IN-PY Puducherry | ta, en, fr |
| IN-TR Tripura | bn, en | IN-SK Sikkim | ne, en |
| IN-MN, IN-ML, IN-MZ, IN-NL, IN-AR | en, hi | IN-AN, IN-LD, IN-CH, IN-DH, IN-LA | hi, en (LD: ml, en) |

After the edition intersection, IN-GA shows News in English and Marathi (no Konkani edition) while the AI may still write Konkani.

**Three non-India examples**:

| Place | Country languages (CLDR) | Override | Result |
|---|---|---|---|
| Montreal, CA-QC | en, fr | CA-QC: fr, en | News in French first, English second |
| Zurich, CH-ZH | de, fr, it, (rm) | CH-ZH de; CH-GE, CH-VD fr; CH-TI it | German; a user in Geneva gets French |
| Barcelona, ES-CT | es, ca | ES-CT: ca, es | Google News has no Catalan edition, so News is Spanish; the AI may write Catalan |

Other overrides worth shipping on day one: BE (BRU fr, nl; VLG nl; WAL fr), US-PR (es-419, en), GB-WLS (en, cy), IT-BZ (de, it), FI-01 (sv, fi), ZA provinces (en plus zu, xh, af by province), NG regions (en plus ha, yo, ig), PK provinces (ur, en plus pa, sd, ps), LK (si, ta, en), MY (ms, en, zh), SG (en, zh, ms, ta).

## 6. Google News Editions And Google Trends Codes

**Editions**: the engine ships `editions.ts`, a table of `{ country, language, hl, ceid }` seeded from the GNews project's lists (reported) and confirmed by the fixture script. India: `IN:en` (`hl=en-IN`), `IN:hi`, `IN:ta`, `IN:te`, `IN:ml`, `IN:kn`, `IN:mr`, `IN:bn`, `IN:gu`, `IN:pa`. Other seeds: `US:en`, `US:es-419`, `GB:en`, `CA:en`, `CA:fr`, `FR:fr`, `DE:de`, `AT:de`, `CH:de`, `CH:fr`, `ES:es`, `IT:it`, `PT:pt-150`, `BR:pt-419`, `MX:es-419`, `AR:es-419`, `CL:es-419`, `CO:es-419`, `PE:es-419`, `NL:nl`, `BE:fr`, `BE:nl`, `SE:sv`, `NO:no`, `PL:pl`, `CZ:cs`, `HU:hu`, `RO:ro`, `GR:el`, `BG:bg`, `RS:sr`, `SK:sk`, `SI:sl`, `LT:lt`, `LV:lv`, `UA:uk`, `RU:ru`, `TR:tr`, `IL:he`, `AE:ar`, `SA:sa`, `EG:ar`, `LB:ar`, `MA:fr`, `SN:fr`, `ZA:en`, `NG:en`, `KE:en`, `GH:en`, `UG:en`, `TZ:en`, `ET:en`, `BW:en`, `NA:en`, `ZW:en`, `PK:en`, `BD:bn`, `LK:en`, `SG:en`, `MY:en`, `PH:en`, `ID:id`, `VN:vi`, `TH:th`, `JP:ja`, `KR:ko`, `CN:zh-Hans`, `TW:zh-Hant`, `HK:zh-Hant`, `AU:en`, `NZ:en`, `IE:en`. A country with no edition falls back to `US:en` world news plus its own place feed (the place feed works for any place name in any edition).

**Trends geo codes**: country code, or `COUNTRY-REGION` in ISO 3166-2 (`IN-TN`, `US-CA`, `DE-BY`, `CA-ON`). The searchapi.io geo list (reported) notes exceptions (`AT-1`, `CN-34` numeric). The engine tries the region first and falls back to the country when the feed is empty or errors, and logs which worked so the fixture script can grow a known-good list.

## 7. Days And Time Zones

"Today", "this week" and "in 12 days" are computed in the **place's** time zone (`timeZone` from the viewer's browser, or the country's first zone from `countries-and-timezones` when a saved workspace place has none), never the server's. Wikipedia days are UTC. Holiday dates are calendar dates with no time; "days to go" counts from today in the place's zone.

## 8. Fonts And Direction

Sora, PostGear's one font, has no Tamil, Devanagari, Bengali, Arabic or CJK glyphs. Item text in those scripts falls back to the system font through the normal font stack, which looks right on every OS. Item text elements carry `dir="auto"` so Arabic, Hebrew and Urdu headlines read right to left. This is recorded as the one accepted exception to the one-font rule; headings, buttons and chips stay in Sora.
