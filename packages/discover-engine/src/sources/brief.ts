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

function capped(text: string): string {
  const points = Array.from(text);
  return points.length <= BRIEF_MAX_CHARS
    ? text
    : points.slice(0, BRIEF_MAX_CHARS).join('').trimEnd();
}

export function buildBrief(item: ComposedItem, locality: Locality, language: string): string {
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
    default:
      lines.push(`Trending in ${place}: "${title}" (${stripHtml(item.source.name)}).`);
  }

  const related = relatedLine(item);
  if (related) lines.push(related);

  return capped(lines.map(cleanText).join('\n'));
}
