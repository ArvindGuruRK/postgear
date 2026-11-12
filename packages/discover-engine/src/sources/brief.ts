/**
 * What Create Post sends to the AI as the topic.
 *
 * Feed text is data, and this is where it stops being able to be anything else:
 * plain text only, so a headline that says "ignore your instructions" reaches the
 * content prompt's labelled topic block as an odd headline and nothing more. It
 * is built per request and never cached, because it names the viewer's place.
 *
 * Capped well under `POST /ai/generate`'s 2,000 character topic. The cap walks by
 * code point, so it cannot leave half a Tamil or emoji character at the end.
 */
import type { ComposedItem, Locality } from '../types';
import { cleanText, stripHtml } from './html-text';

export const BRIEF_MAX_CHARS = 1_800;
const RELATED_IN_BRIEF = 3;

/** The city and region as we have them; a country we can name in the viewer's own language. */
export function placeLabel(locality: Locality, language: string): string {
  if (locality.city) {
    return locality.regionName ? `${locality.city}, ${locality.regionName}` : locality.city;
  }
  if (locality.regionName) return locality.regionName;
  if (!locality.countryCode) return 'the world';

  try {
    const name = new Intl.DisplayNames([language], { type: 'region' }).of(locality.countryCode);
    if (name) return name;
  } catch {
    // A language tag Intl cannot read: the English name below will do.
  }
  return locality.countryName ?? locality.countryCode;
}

function relatedLine(item: ComposedItem): string | null {
  const headlines = (item.related ?? [])
    .slice(0, RELATED_IN_BRIEF)
    .map((related) => {
      const title = stripHtml(related.title);
      const source = stripHtml(related.source);
      return source ? `${title} (${source})` : title;
    })
    .filter((line) => line !== '');

  return headlines.length > 0 ? `Related: ${headlines.join('; ')}.` : null;
}

/** "Tamil" for `ta`. A tag Intl cannot read, or has no name for, stays as it is. */
function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/** The item's count in brackets, " (1,627 reads)", or nothing when it has none. */
function signalNote(item: ComposedItem): string {
  const label = stripHtml(item.signal?.label ?? '');
  return label ? ` (${label})` : '';
}

/** A summary often ends its own sentence, and must not end it twice. */
function asSentence(text: string): string {
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

const LONG_DATE = new Intl.DateTimeFormat('en-GB', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

/**
 * "Sunday 8 November 2026" from `2026-11-08`. A festival's date is a square on
 * the calendar, not a moment, so it is built and read in UTC from end to end and
 * never meets the machine's own zone, which could move it a day. The words are
 * joined from parts because the commas between them change with the ICU version.
 * Null for anything that is not a real date.
 */
function longDate(date: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return null;

  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const at = new Date(Date.UTC(year, month - 1, day));
  // 31 February rolls over into March, which is not a date anyone meant.
  const isReal =
    at.getUTCFullYear() === year && at.getUTCMonth() === month - 1 && at.getUTCDate() === day;
  if (!isReal) return null;

  const parts = new Map(LONG_DATE.formatToParts(at).map((part) => [part.type, part.value]));
  const words = (['weekday', 'day', 'month', 'year'] as const).map((type) => parts.get(type));
  return words.every(Boolean) ? words.join(' ') : null;
}

function capped(text: string): string {
  const points = Array.from(text);
  return points.length <= BRIEF_MAX_CHARS
    ? text
    : points.slice(0, BRIEF_MAX_CHARS).join('').trimEnd();
}

/** What a brief needs that the item and the place do not carry. */
export interface BriefContext {
  /** Whose item this is, for a competitor's row: the name the workspace gave them. */
  competitor?: string;
}

const OUR_OWN_TAKE = 'Write our own take on this topic for our audience, not a summary of theirs.';

/**
 * A competitor's row: what they did, in their own title, and the one instruction
 * that matters, which is that the draft is ours. A story about them names its
 * publisher instead of claiming they wrote it.
 */
function competitorLine(item: ComposedItem, title: string, context: BriefContext): string {
  const name = stripHtml(context.competitor ?? '') || 'A competitor';

  switch (item.source.id) {
    // The keyed news providers (Module 10) stand in for Google News, row for row.
    case 'google-news':
    case 'serpapi':
    case 'newsdata':
      return `News about ${name}: '${title}' (${stripHtml(item.source.name)}). ${OUR_OWN_TAKE}`;
    case 'youtube':
      return `${name} published a video: '${title}'. ${OUR_OWN_TAKE}`;
    case 'bluesky':
    case 'mastodon':
    case 'instagram':
      return `${name} posted on ${stripHtml(item.source.name)}: '${title}'. ${OUR_OWN_TAKE}`;
    default:
      return `${name} published: '${title}'. ${OUR_OWN_TAKE}`;
  }
}

export function buildBrief(
  item: ComposedItem,
  locality: Locality,
  language: string,
  context: BriefContext = {},
): string {
  const title = stripHtml(item.title);
  const place = placeLabel(locality, language);
  const lines: string[] = [];

  switch (item.kind) {
    case 'trend': {
      const volume = item.signal?.label ? ` (${item.signal.label})` : '';
      lines.push(`Rising search in ${place}: "${title}"${volume}.`);
      break;
    }
    case 'news':
      lines.push(`News story in ${place}: "${title}" (${stripHtml(item.source.name)}).`);
      break;
    case 'wiki': {
      // An edition is a language's readers everywhere, so the line names it and not the place.
      const edition = item.language ? `${stripHtml(languageName(item.language))} ` : '';
      lines.push(`Widely read on ${edition}Wikipedia: "${title}"${signalNote(item)}.`);
      break;
    }
    case 'social': {
      const network = stripHtml(item.source.name);
      lines.push(`Trending worldwide on ${network}: "${title}"${signalNote(item)}.`);
      const about = stripHtml(item.summary ?? '');
      if (about) lines.push(`About: ${asSentence(about)}`);
      break;
    }
    case 'video': {
      // On a video the summary is the channel, which YouTube's terms ask us to name.
      const channel = stripHtml(item.summary ?? '');
      const by = channel ? ` by ${channel}` : '';
      lines.push(`Trending video in ${place}: "${title}"${by}${signalNote(item)}.`);
      break;
    }
    case 'festival': {
      const day = item.date ? longDate(item.date) : null;
      const on = day ? ` on ${day}` : '';
      const badge =
        item.observance === undefined
          ? ''
          : ` (${item.observance ? 'observance' : 'public holiday'})`;
      lines.push(`Festival in ${place}: "${title}"${on}${badge}.`);
      break;
    }
    case 'competitor':
      lines.push(competitorLine(item, title, context));
      break;
    default:
      lines.push(`Trending in ${place}: "${title}" (${stripHtml(item.source.name)}).`);
  }

  const related = relatedLine(item);
  if (related) lines.push(related);

  return capped(lines.map(cleanText).join('\n'));
}
