# Bleep Bad Words: Default Word Lists

These lists feed `findBleepWords` (`../bleeps.ts`, Sprint 13 Module 09).

| File | Language | Where it comes from |
|---|---|---|
| `en.ts` | English | Written for PostGear by its developers (2026-11-27). Not copied from any list. |
| `hi.ts` | Hindi, in Devanagari and common romanised spellings | Written for PostGear by its developers (2026-11-27). Not copied from any list. |
| `ta.ts` | Tamil | Empty until someone who speaks Tamil picks the words. |

What the lists hold:

- Strong swear words only. Mild words ("damn", "hell", "crap", "saala") are left to each
  workspace's own list (My Words), which is matched on top of these.
- No slurs.
- English words are base forms: the matcher adds -s, -es, -ing and -ed. Hindi forms are all
  listed, since no endings are added for Hindi.
- Words with a common innocent meaning are left out, so an ordinary clip is never bleeped.

## Replacing them later

Research 02 names the LDNOOBW lists ("List of Dirty, Naughty, Obscene, and Otherwise Bad
Words", CC BY 4.0) as a fuller source. They were not fetched: fetching needs the network,
which this build does not use. They can replace or extend these files later, once someone
fetches them with Arvind's OK. CC BY 4.0 then requires credit: name the list, link its
licence, say what was changed, and record it in this file and in the Sprint 13 Decision Log.
