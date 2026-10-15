/**
 * User-facing strings for the SEO analyzer.
 *
 * Specific, for the reason `ai.messages.ts` gives: the caller is a member of
 * the workspace analysing a site they chose, so every refusal names what to
 * change. What never reaches a response is the page's own text or a
 * provider's error body — a crawled page can say anything, and an error body
 * from the authority provider or the model can quote the request. Every
 * failure is mapped to one of these strings by its *kind* (`seo.errors.ts`),
 * and the original goes to the server log.
 *
 * The one exception is the URL guard's own message: it is written by
 * `@postgear/seo-engine`, names the rule that refused the address, and
 * contains nothing from the network, so it is forwarded as the 422 body.
 */
import type { CrawlErrorKind } from '@postgear/seo-engine';

export const SEO_MESSAGES = {
  INVALID_URL: 'Enter a full web address, such as https://example.com/pricing.',
  BUSY: 'The analyzer is busy: another analysis is running in this workspace, or every slot is taken. Wait for it to finish and try again.',
  NOT_FOUND: 'Audit not found',
  DELETED: 'Audit deleted',
  UNREACHABLE: 'The site could not be reached. Check the address and try again.',
  TIMEOUT: 'The site took too long to answer. Try again in a minute, or try a lighter page.',
  BLOCKED:
    'The site refused the crawler. Its robots.txt or a bot wall blocks automated visits, so there is nothing to analyse.',
  BAD_STATUS:
    'The page answered with an error status, so there was nothing to analyse. Check the address.',
  NOT_HTML: 'That address is not a web page. Enter the address of an HTML page.',
  TOO_LARGE: 'The page is too large to analyse.',
  BROWSER_UNAVAILABLE:
    'No headless browser is available on this PostGear instance. Set SEO_BROWSER="auto" to fall back to a plain fetch.',
  ABORTED: 'Stopped.',
  STOPPED_BEFORE_FINISH: 'Stopped before the crawl finished.',
  ADVICE_NOT_CONFIGURED: 'AI advice is not configured; showing rule-based findings',
  ADVICE_FAILED:
    'AI advice could not be produced; showing rule-based findings. The advice credits were returned.',
  UNEXPECTED: 'Something went wrong while analysing. Please try again.',
} as const;

/** The copy shown for a crawl failure, chosen by its kind — never by its text. */
export function messageForCrawlKind(kind: CrawlErrorKind): string {
  switch (kind) {
    case 'unsafe_url':
      return SEO_MESSAGES.INVALID_URL;
    case 'unreachable':
      return SEO_MESSAGES.UNREACHABLE;
    case 'timeout':
      return SEO_MESSAGES.TIMEOUT;
    case 'blocked':
      return SEO_MESSAGES.BLOCKED;
    case 'bad_status':
      return SEO_MESSAGES.BAD_STATUS;
    case 'not_html':
      return SEO_MESSAGES.NOT_HTML;
    case 'too_large':
      return SEO_MESSAGES.TOO_LARGE;
    case 'browser_unavailable':
      return SEO_MESSAGES.BROWSER_UNAVAILABLE;
    case 'aborted':
      return SEO_MESSAGES.ABORTED;
  }
}
