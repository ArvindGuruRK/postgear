/**
 * On-page SEO (30% of the score): what the page says about itself in its
 * `<head>` and heading structure.
 *
 * The thresholds are the ones search engines document or that their result
 * pages enforce in practice: a title of 30–60 characters shows in full in
 * results, a meta description of 70–160 does the same, one `<h1>` names the
 * page, headings that skip levels read as broken outlines to assistive
 * technology and to crawlers, and the Open Graph trio is what a shared link
 * unfurls into. Graded checks (lengths, alt share, OG completeness) award
 * partial credit so a near miss is a nudge, not a failed check.
 *
 * Severity: a missing title or `<h1>` is critical (the page has no name),
 * lengths and alt text are warnings, the rest are information.
 */
import { type CategoryScore, type CrawlResult, SEO_CATEGORY_WEIGHTS } from '../types';
import { band, buildCategory, check, plural } from './checks';

export const TITLE_IDEAL: readonly [number, number] = [30, 60];
export const META_DESCRIPTION_IDEAL: readonly [number, number] = [70, 160];

/** Counts the places a heading's level jumps by more than one (h1 → h3). */
export function countSkippedHeadingLevels(levels: number[]): number {
  let previous = 0;
  let skipped = 0;
  for (const level of levels) {
    if (level > previous + 1) skipped += 1;
    previous = level;
  }
  return skipped;
}

export function evaluateOnPage(crawl: CrawlResult): CategoryScore {
  const page = crawl.page;
  const category = 'onPage' as const;

  const title = page.title ?? '';
  const titleLength = title.length;
  const description = page.metaDescription ?? '';
  const descriptionLength = description.length;
  const h1s = page.headings.filter((heading) => heading.level === 1);
  const skipped = countSkippedHeadingLevels(page.headings.map((heading) => heading.level));
  const ogKeys = ['title', 'description', 'image'].filter((key) => Boolean(page.openGraph[key]));
  const twitter = page.twitterCard;
  const imagesWithAlt = page.images.count - page.images.missingAlt;

  const checks = [
    check({
      id: 'title-present',
      category,
      label: 'Title tag',
      weight: 0.15,
      severity: 'critical',
      passed: titleLength > 0,
      detail: titleLength > 0 ? 'The page has a title.' : 'The page has no <title>.',
      value: titleLength > 0 ? title : null,
    }),
    check({
      id: 'title-length',
      category,
      label: 'Title length',
      weight: 0.1,
      severity: 'warning',
      passed: titleLength >= TITLE_IDEAL[0] && titleLength <= TITLE_IDEAL[1],
      attainment: titleLength === 0 ? 0 : band(titleLength, TITLE_IDEAL, [5, 100]),
      detail:
        titleLength === 0
          ? 'No title to measure.'
          : titleLength < TITLE_IDEAL[0]
            ? `The title is short; ${TITLE_IDEAL[0]}–${TITLE_IDEAL[1]} characters is ideal.`
            : titleLength > TITLE_IDEAL[1]
              ? `The title will be cut off in results; ${TITLE_IDEAL[0]}–${TITLE_IDEAL[1]} characters is ideal.`
              : 'The title fits a search result.',
      value: `${titleLength} characters`,
    }),
    check({
      id: 'meta-description-present',
      category,
      label: 'Meta description',
      weight: 0.12,
      severity: 'warning',
      passed: descriptionLength > 0,
      detail: descriptionLength > 0 ? 'The page has a meta description.' : 'No meta description.',
    }),
    check({
      id: 'meta-description-length',
      category,
      label: 'Meta description length',
      weight: 0.08,
      severity: 'warning',
      passed:
        descriptionLength >= META_DESCRIPTION_IDEAL[0] &&
        descriptionLength <= META_DESCRIPTION_IDEAL[1],
      attainment:
        descriptionLength === 0 ? 0 : band(descriptionLength, META_DESCRIPTION_IDEAL, [10, 320]),
      detail:
        descriptionLength === 0
          ? 'No description to measure.'
          : descriptionLength < META_DESCRIPTION_IDEAL[0]
            ? `The description is short; ${META_DESCRIPTION_IDEAL[0]}–${META_DESCRIPTION_IDEAL[1]} characters is ideal.`
            : descriptionLength > META_DESCRIPTION_IDEAL[1]
              ? `The description will be truncated; ${META_DESCRIPTION_IDEAL[0]}–${META_DESCRIPTION_IDEAL[1]} characters is ideal.`
              : 'The description fits a search result.',
      value: `${descriptionLength} characters`,
    }),
    check({
      id: 'single-h1',
      category,
      label: 'Single H1',
      weight: 0.12,
      severity: h1s.length === 0 ? 'critical' : 'warning',
      passed: h1s.length === 1,
      attainment: h1s.length === 1 ? 1 : h1s.length === 0 ? 0 : 0.5,
      detail:
        h1s.length === 1
          ? 'Exactly one H1.'
          : h1s.length === 0
            ? 'The page has no H1.'
            : `The page has ${h1s.length} H1 headings; one is expected.`,
      value: plural(h1s.length, 'H1'),
    }),
    check({
      id: 'heading-hierarchy',
      category,
      label: 'Heading hierarchy',
      weight: 0.08,
      severity: 'info',
      passed: page.headings.length > 0 && skipped === 0,
      attainment: page.headings.length === 0 ? 0 : 1 - skipped / page.headings.length,
      detail:
        page.headings.length === 0
          ? 'The page has no headings.'
          : skipped === 0
            ? 'Heading levels never skip.'
            : `Heading levels skip ${plural(skipped, 'time')} (for example H1 to H3).`,
      value: plural(page.headings.length, 'heading'),
    }),
    check({
      id: 'image-alt',
      category,
      label: 'Image alt text',
      weight: 0.1,
      severity: 'warning',
      passed: page.images.missingAlt === 0,
      attainment: page.images.count === 0 ? 1 : imagesWithAlt / page.images.count,
      detail:
        page.images.count === 0
          ? 'No images on the page.'
          : page.images.missingAlt === 0
            ? 'Every image has alt text.'
            : `${page.images.missingAlt} of ${page.images.count} images have no alt text.`,
      value: page.images.count === 0 ? null : `${imagesWithAlt}/${page.images.count} with alt`,
    }),
    check({
      id: 'open-graph',
      category,
      label: 'Open Graph tags',
      weight: 0.08,
      severity: 'info',
      passed: ogKeys.length === 3,
      attainment: ogKeys.length / 3,
      detail:
        ogKeys.length === 3
          ? 'og:title, og:description and og:image are set.'
          : ogKeys.length === 0
            ? 'No Open Graph tags; shared links will not unfurl.'
            : `Missing ${['title', 'description', 'image']
                .filter((key) => !ogKeys.includes(key))
                .map((key) => `og:${key}`)
                .join(', ')}.`,
      value: `${ogKeys.length}/3`,
    }),
    check({
      id: 'canonical',
      category,
      label: 'Canonical URL',
      weight: 0.07,
      severity: 'info',
      passed: page.canonical !== null,
      detail: page.canonical ? 'A canonical URL is declared.' : 'No canonical link.',
      value: page.canonical,
    }),
    check({
      id: 'lang-attribute',
      category,
      label: 'Language attribute',
      weight: 0.05,
      severity: 'info',
      passed: page.lang !== null,
      detail: page.lang
        ? 'The <html> element declares its language.'
        : 'No lang attribute on <html>.',
      value: page.lang,
    }),
    check({
      id: 'twitter-card',
      category,
      label: 'Twitter card',
      weight: 0.05,
      severity: 'info',
      passed: Boolean(twitter.card),
      attainment: twitter.card ? 1 : twitter.title || twitter.description ? 0.5 : 0,
      detail: twitter.card
        ? `twitter:card is "${twitter.card}".`
        : 'No twitter:card meta tag; X will fall back to Open Graph or nothing.',
      value: twitter.card ?? null,
    }),
  ];

  return buildCategory(category, SEO_CATEGORY_WEIGHTS.onPage, checks);
}
