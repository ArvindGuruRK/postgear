/**
 * The SEO reducer, against the event sequence the API streams.
 *
 * These pin what would be silent if wrong: the tracker follows the stage
 * events, a mid-stream error keeps the crawl and the scores, a stop marks
 * the running stage as stopped rather than failed, a refusal's status maps
 * to the right kind and the right place, and a loaded audit lands in the
 * same fields a stream fills.
 */
import type { AiCredits } from '@/types/ai';
import type {
  SeoAuditDetail,
  SeoAuditSummary,
  SeoCategoryScore,
  SeoCrawlSummary,
  SeoStreamEvent,
} from '@/types/seo';
import {
  hasPartialResult,
  initialSeoState,
  kindForStatus,
  type SeoState,
  seoReducer,
} from './seo-state';

const credits: AiCredits = {
  allowance: 100,
  used: 23,
  remaining: 77,
  resetsAt: '2026-11-01T00:00:00.000Z',
  tier: 'STANDARD',
  low: false,
  costs: {
    generate_post: 5,
    generate_image: 10,
    copilot_message: 1,
    seo_advice: 3,
    generate_snippet: 2,
  },
};

const URL = 'https://example.com/';

const summary: SeoAuditSummary = {
  id: 'audit-1',
  targetUrl: URL,
  finalUrl: URL,
  status: 'crawling',
  grade: null,
  overallScore: null,
  scores: null,
  crawlMode: 'html',
  durationMs: null,
  failureReason: null,
  createdAt: '2026-10-15T10:00:00.000Z',
  completedAt: null,
};

const crawl: SeoCrawlSummary = {
  requestedUrl: URL,
  finalUrl: URL,
  statusCode: 200,
  mode: 'html',
  responseTimeMs: 312,
  htmlBytes: 1256,
  https: true,
  certificateValid: true,
  redirects: [],
  title: 'Example Domain',
  titleLength: 14,
  metaDescription: null,
  metaDescriptionLength: 0,
  canonical: null,
  robotsMeta: null,
  noindex: false,
  viewport: null,
  lang: null,
  charset: 'utf-8',
  headings: [{ level: 1, text: 'Example Domain' }],
  h1Count: 1,
  openGraph: {},
  twitterCard: {},
  images: { count: 0, missingAlt: 0 },
  links: { internal: 0, external: 1, nofollow: 0 },
  brokenLinks: { checked: 1, broken: 0, sample: [] },
  structuredData: { count: 0, types: [], invalid: 0 },
  text: {
    wordCount: 28,
    sentenceCount: 2,
    paragraphCount: 2,
    readability: 60,
    textToHtmlRatio: 0.2,
    topKeywords: [{ term: 'example', count: 3, density: 10 }],
  },
  robotsTxt: 'missing',
  sitemap: 'missing',
  hreflang: 0,
  favicon: false,
  compressed: true,
  authority: { source: 'heuristic', domainAuthority: 40, pageRank: null },
};

const categories: SeoCategoryScore[] = [
  { category: 'onPage', score: 70, weight: 0.3, checks: [], estimated: false },
  { category: 'technical', score: 80, weight: 0.3, checks: [], estimated: false },
  { category: 'content', score: 50, weight: 0.25, checks: [], estimated: false },
  { category: 'backlink', score: 40, weight: 0.15, checks: [], estimated: true },
];

const scoresEvent: SeoStreamEvent = {
  type: 'scores',
  overallScore: 64,
  grade: 'D',
  scores: { onPage: 70, technical: 80, content: 50, backlink: 40 },
  categories,
};

const detail: SeoAuditDetail = {
  ...summary,
  status: 'done',
  grade: 'D',
  overallScore: 64,
  scores: { onPage: 70, technical: 80, content: 50, backlink: 40 },
  durationMs: 4200,
  completedAt: '2026-10-15T10:00:04.200Z',
  crawl,
  categories,
  advice: {
    source: 'ai',
    model: 'simulation',
    summary: 'Add a meta description.',
    recommendations: [
      {
        id: 'r1',
        severity: 'critical',
        category: 'onPage',
        title: 'Missing meta description',
        issue: 'There is none.',
        fix: 'Write one.',
        impact: 'high',
        checkId: 'meta-description',
        docsUrl: null,
      },
    ],
  },
  previous: { id: 'audit-0', overallScore: 58, grade: 'F', createdAt: '2026-10-01T10:00:00.000Z' },
};

function run(state: SeoState, ...events: SeoStreamEvent[]): SeoState {
  return events.reduce((current, event) => seoReducer(current, { type: 'event', event }), state);
}

function started(): SeoState {
  return seoReducer(initialSeoState(credits), { type: 'start', url: URL });
}

describe('seoReducer', () => {
  it('starts a live run with every stage pending and the credits kept', () => {
    const state = started();

    expect(state.phase).toBe('running');
    expect(state.live).toBe(true);
    expect(state.url).toBe(URL);
    expect(state.stages.validate.status).toBe('pending');
    expect(state.stages.advise.status).toBe('pending');
    expect(state.credits).toBe(credits);
    expect(hasPartialResult(state)).toBe(false);
  });

  it('follows the stage events and keeps the API detail over the derived one', () => {
    const state = run(
      started(),
      { type: 'stage', stage: 'validate', status: 'done' },
      { type: 'stage', stage: 'crawl', status: 'started', detail: 'Checking robots.txt' },
    );

    expect(state.stages.validate.status).toBe('done');
    expect(state.stages.crawl).toEqual({ status: 'active', detail: 'Checking robots.txt' });
  });

  it('derives a crawl detail from the crawl summary when the API sends none', () => {
    const state = run(
      started(),
      { type: 'audit', audit: summary },
      { type: 'crawl', crawl },
      { type: 'stage', stage: 'crawl', status: 'done' },
    );

    expect(state.audit).toBe(summary);
    expect(state.crawl).toBe(crawl);
    expect(state.stages.crawl.detail).toBe('200, HTML, 312 ms');
    expect(hasPartialResult(state)).toBe(true);
  });

  it('collects the scores, the categories and the advice as they stream', () => {
    const state = run(
      started(),
      scoresEvent,
      { type: 'stage', stage: 'score', status: 'done' },
      { type: 'stage', stage: 'advise', status: 'skipped' },
    );

    expect(state.scores).toEqual({
      overallScore: 64,
      grade: 'D',
      scores: { onPage: 70, technical: 80, content: 50, backlink: 40 },
    });
    expect(state.categories).toBe(categories);
    expect(state.stages.score.detail).toBe('64, grade D');
    expect(state.stages.advise).toEqual({ status: 'skipped', detail: 'Rule-based advice' });
  });

  it('on done takes the detail, the previous run, the credits, and closes stages that never ran', () => {
    const state = run(
      started(),
      { type: 'stage', stage: 'advise', status: 'started' },
      { type: 'done', audit: detail, credits: { ...credits, used: 26, remaining: 74 } },
    );

    expect(state.phase).toBe('done');
    expect(state.detail).toBe(detail);
    expect(state.crawl).toBe(crawl);
    expect(state.advice).toBe(detail.advice);
    expect(state.previous?.overallScore).toBe(58);
    expect(state.credits?.used).toBe(26);
    expect(state.stages.advise.status).toBe('done');
    expect(state.stages.validate.status).toBe('skipped');
  });

  it('keeps the balance it had when done carries no credits (AI off)', () => {
    const state = run(started(), { type: 'done', audit: detail, credits: null });

    expect(state.credits).toBe(credits);
  });

  it('keeps the crawl and the scores on a mid-stream error and fails the running stage', () => {
    const state = run(
      started(),
      { type: 'crawl', crawl },
      scoresEvent,
      { type: 'stage', stage: 'advise', status: 'started' },
      {
        type: 'error',
        kind: 'unexpected',
        message: 'The advice model is busy.',
        retryable: true,
        audit: { ...summary, status: 'failed', failureReason: 'The advice model is busy.' },
        credits: { ...credits, remaining: 74 },
      },
    );

    expect(state.phase).toBe('error');
    expect(state.error).toEqual({
      kind: 'unexpected',
      message: 'The advice model is busy.',
      retryable: true,
      beforeStream: false,
      onField: false,
    });
    expect(state.crawl).toBe(crawl);
    expect(state.scores?.overallScore).toBe(64);
    expect(state.audit?.status).toBe('failed');
    expect(state.stages.advise.status).toBe('failed');
    expect(state.credits?.remaining).toBe(74);
  });

  it('marks the running stage as stopped on abort, and ignores later events', () => {
    const aborted = seoReducer(
      run(started(), { type: 'stage', stage: 'crawl', status: 'started' }),
      {
        type: 'abort',
      },
    );

    expect(aborted.phase).toBe('aborted');
    expect(aborted.stages.crawl).toEqual({ status: 'skipped', detail: 'Stopped' });

    const after = run(aborted, { type: 'crawl', crawl });
    expect(after).toBe(aborted);
    expect(seoReducer(aborted, { type: 'abort' })).toBe(aborted);
  });

  it('records a refused request before the stream, on the field for 400 and 422', () => {
    const unsafe = seoReducer(started(), {
      type: 'fail',
      message: 'Private and internal addresses are refused.',
      status: 422,
    });

    expect(unsafe.phase).toBe('error');
    expect(unsafe.error).toEqual({
      kind: 'unsafe_url',
      message: 'Private and internal addresses are refused.',
      retryable: false,
      beforeStream: true,
      onField: true,
    });

    const invalid = seoReducer(started(), { type: 'fail', message: 'Bad URL.', status: 400 });
    expect(invalid.error).toMatchObject({ kind: 'unexpected', onField: true, retryable: false });

    const busy = seoReducer(started(), { type: 'fail', message: 'Busy.', status: 429 });
    expect(busy.error).toMatchObject({ kind: 'busy', onField: false, retryable: true });

    const broke = seoReducer(started(), { type: 'fail', message: 'No credits.', status: 402 });
    expect(broke.error).toMatchObject({ kind: 'out_of_credits', retryable: false });

    const down = seoReducer(started(), { type: 'fail', message: 'Down.', status: 503 });
    expect(down.error).toMatchObject({ kind: 'unexpected', retryable: false });

    const network = seoReducer(started(), { type: 'fail', message: 'Offline.' });
    expect(network.error).toMatchObject({ kind: 'unexpected', retryable: true, onField: false });
  });

  it('loads a finished audit into the same fields a stream fills, not live', () => {
    const state = seoReducer(initialSeoState(credits), { type: 'load', audit: detail });

    expect(state.phase).toBe('done');
    expect(state.live).toBe(false);
    expect(state.url).toBe(URL);
    expect(state.detail).toBe(detail);
    expect(state.scores?.grade).toBe('D');
    expect(state.categories).toBe(categories);
    expect(state.advice).toBe(detail.advice);
    expect(state.previous?.id).toBe('audit-0');
    expect(state.error).toBeNull();
    expect(state.credits).toBe(credits);
  });

  it('loads a failed audit as an error with its reason and whatever it kept', () => {
    const state = seoReducer(initialSeoState(credits), {
      type: 'load',
      audit: {
        ...detail,
        status: 'failed',
        grade: null,
        overallScore: null,
        scores: null,
        categories: [],
        advice: null,
        failureReason: 'The site did not answer within 30 seconds.',
      },
    });

    expect(state.phase).toBe('error');
    expect(state.error).toMatchObject({
      message: 'The site did not answer within 30 seconds.',
      retryable: true,
      beforeStream: false,
    });
    expect(state.scores).toBeNull();
    expect(state.categories).toBeNull();
    expect(state.crawl).toBe(crawl);
  });

  it('reset clears everything but the credits', () => {
    const state = seoReducer(run(started(), { type: 'crawl', crawl }), { type: 'reset' });

    expect(state.phase).toBe('idle');
    expect(state.crawl).toBeNull();
    expect(state.credits).toBe(credits);
  });

  it('delete clears the shown audit and leaves any other alone', () => {
    const shown = seoReducer(initialSeoState(credits), { type: 'load', audit: detail });

    expect(seoReducer(shown, { type: 'delete', id: 'audit-other' })).toBe(shown);

    const cleared = seoReducer(shown, { type: 'delete', id: 'audit-1' });
    expect(cleared.phase).toBe('idle');
    expect(cleared.detail).toBeNull();
    expect(cleared.credits).toBe(credits);
  });
});

describe('kindForStatus', () => {
  it('maps the refusal statuses the API uses', () => {
    expect(kindForStatus(422)).toBe('unsafe_url');
    expect(kindForStatus(429)).toBe('busy');
    expect(kindForStatus(402)).toBe('out_of_credits');
    expect(kindForStatus(503)).toBe('unexpected');
    expect(kindForStatus(400)).toBe('unexpected');
    expect(kindForStatus(undefined)).toBe('unexpected');
  });
});
