/**
 * Content SEO (25% of the score): is there enough, readable, well-linked text.
 *
 * All of it is graded, because none of it has a cliff: 300 words is the
 * floor below which a page reads as thin, 800 is where more stops helping;
 * Flesch 50–70 is plain English (lower is academic, much higher is
 * childlike); a lead keyword at 0.5–3% is a topic, above that it is
 * stuffing; three internal links and one outbound link are the minimum for
 * a page to sit in a site rather than beside it. The thresholds come from
 * the same page the parser's heuristics are documented on
 * (`html.parser.ts`), so they can be read together.
 */
import { type CategoryScore, type CrawlResult, SEO_CATEGORY_WEIGHTS } from '../types';
import { band, buildCategory, check, plural, ramp } from './checks';

export const WORD_COUNT_MIN = 300;
export const WORD_COUNT_FULL = 800;
export const READABILITY_IDEAL: readonly [number, number] = [50, 70];
export const KEYWORD_DENSITY_IDEAL: readonly [number, number] = [0.5, 3];
export const WORDS_PER_HEADING = 300;

export function evaluateContent(crawl: CrawlResult): CategoryScore {
  const category = 'content' as const;
  const text = crawl.page.text;
  const words = text.wordCount;
  const readability = text.readability;
  const lead = text.topKeywords[0] ?? null;
  const internal = crawl.page.links.internal.length;
  const external = crawl.page.links.external.length;
  const ratioPercent = Math.round(text.textToHtmlRatio * 1000) / 10;
  const headingsNeeded = Math.max(1, Math.ceil(words / WORDS_PER_HEADING));
  const headingCount = crawl.page.headings.length;

  const checks = [
    check({
      id: 'word-count',
      category,
      label: 'Content length',
      weight: 0.2,
      severity: 'warning',
      passed: words >= WORD_COUNT_MIN,
      attainment: ramp(words, 0, WORD_COUNT_FULL),
      detail:
        words >= WORD_COUNT_FULL
          ? 'The page has substantial content.'
          : words >= WORD_COUNT_MIN
            ? `${words} words; ${WORD_COUNT_FULL} or more ranks better for most topics.`
            : `${words} words is thin; aim for at least ${WORD_COUNT_MIN}.`,
      value: plural(words, 'word'),
    }),
    check({
      id: 'readability',
      category,
      label: 'Readability',
      weight: 0.15,
      severity: 'info',
      passed:
        readability !== null &&
        readability >= READABILITY_IDEAL[0] &&
        readability <= READABILITY_IDEAL[1],
      attainment: readability === null ? 0 : band(readability, READABILITY_IDEAL, [10, 100]),
      detail:
        readability === null
          ? 'Too little text to measure readability.'
          : readability < READABILITY_IDEAL[0]
            ? `Flesch ${readability}: hard to read; shorter sentences and simpler words help.`
            : readability > READABILITY_IDEAL[1]
              ? `Flesch ${readability}: very easy; fine for most audiences.`
              : `Flesch ${readability}: plain English.`,
      value: readability === null ? null : `Flesch ${readability}`,
    }),
    check({
      id: 'keyword-density',
      category,
      label: 'Keyword focus',
      weight: 0.12,
      severity: 'info',
      passed:
        lead !== null &&
        lead.density >= KEYWORD_DENSITY_IDEAL[0] &&
        lead.density <= KEYWORD_DENSITY_IDEAL[1],
      attainment: lead === null ? 0 : band(lead.density, KEYWORD_DENSITY_IDEAL, [0, 6]),
      detail:
        lead === null
          ? 'No recurring keyword could be found.'
          : lead.density < KEYWORD_DENSITY_IDEAL[0]
            ? `The lead term "${lead.term}" appears in only ${lead.density}% of words.`
            : lead.density > KEYWORD_DENSITY_IDEAL[1]
              ? `The lead term "${lead.term}" is ${lead.density}% of words, which reads as stuffing.`
              : `The lead term "${lead.term}" is ${lead.density}% of words.`,
      value: lead === null ? null : `${lead.term} (${lead.density}%)`,
    }),
    check({
      id: 'internal-links',
      category,
      label: 'Internal links',
      weight: 0.13,
      severity: 'warning',
      passed: internal >= 3,
      attainment: ramp(internal, 0, 3),
      detail:
        internal >= 3
          ? `${plural(internal, 'internal link')}.`
          : `Only ${plural(internal, 'internal link')}; three or more connect the page to the site.`,
      value: String(internal),
    }),
    check({
      id: 'external-links',
      category,
      label: 'Outbound links',
      weight: 0.08,
      severity: 'info',
      passed: external >= 1,
      detail:
        external >= 1
          ? `${plural(external, 'outbound link')}.`
          : 'No outbound links; citing sources signals trust.',
      value: String(external),
    }),
    check({
      id: 'text-html-ratio',
      category,
      label: 'Text to HTML ratio',
      weight: 0.1,
      severity: 'info',
      passed: text.textToHtmlRatio >= 0.1,
      attainment: ramp(text.textToHtmlRatio, 0, 0.1),
      detail:
        text.textToHtmlRatio >= 0.1
          ? `${ratioPercent}% of the document is visible text.`
          : `Only ${ratioPercent}% of the document is visible text; the markup outweighs the content.`,
      value: `${ratioPercent}%`,
    }),
    check({
      id: 'paragraphs',
      category,
      label: 'Paragraphs',
      weight: 0.1,
      severity: 'info',
      passed: text.paragraphCount >= 3,
      attainment: ramp(text.paragraphCount, 0, 3),
      detail:
        text.paragraphCount >= 3
          ? `${plural(text.paragraphCount, 'paragraph')}.`
          : `${plural(text.paragraphCount, 'paragraph')}; prose is easier to read in several short ones.`,
      value: String(text.paragraphCount),
    }),
    check({
      id: 'heading-coverage',
      category,
      label: 'Heading coverage',
      weight: 0.12,
      severity: 'info',
      passed: headingCount >= headingsNeeded,
      attainment: ramp(headingCount, 0, headingsNeeded),
      detail:
        headingCount >= headingsNeeded
          ? `${plural(headingCount, 'heading')} for ${words} words.`
          : `${plural(headingCount, 'heading')} for ${words} words; one per ~${WORDS_PER_HEADING} words helps readers scan.`,
      value: `${headingCount}/${headingsNeeded}`,
    }),
  ];

  return buildCategory(category, SEO_CATEGORY_WEIGHTS.content, checks);
}
