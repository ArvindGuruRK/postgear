/**
 * Every template's sample content in real Chromium, opt-in like the other
 * browser specs: `SEO_BROWSER_TESTS=true npx jest presets.browser`.
 *
 * Sprint 9's rule for templates: a preset renders in all its formats without
 * overflow on its sample content. The engine's own preset test checks that
 * with a width model (`approximateMeasure`), which reads a monospace or a
 * heavy face as narrower than it is. Only the real faces in a real browser
 * can say it for sure, so this draws every slide of every preset in every
 * format the way Export does and asks the fitter which slots it could not
 * fit. It takes two to three minutes.
 */
import { documentFromPreset, type FormatId, PRESETS, presetFormats } from '@postgear/design-engine';
import { type BrowserPool, createBrowserPool } from '@postgear/seo-engine';
import { DesignExport } from './design-exporter';

const enabled = process.env.SEO_BROWSER_TESTS === 'true';
const describeBrowser = enabled ? describe : describe.skip;

/** The pool's page limit: this many designs draw at a time. */
const AT_ONCE = 2;

interface Job {
  presetId: string;
  format: FormatId;
}

interface Findings {
  slides: number;
  overflow: string[];
  failed: string[];
}

/**
 * Draws one design's slides in order, the way an export does (the exporter
 * draws a slide at a time), noting each slot left too long and each slide
 * that would not draw.
 */
async function drawDesign(pool: BrowserPool, job: Job, findings: Findings): Promise<void> {
  const document = documentFromPreset({ presetId: job.presetId, format: job.format });
  const exporter = new DesignExport(document, { pool, loadPicture: async () => null });

  for (let index = 0; index < document.slides.length; index++) {
    const label = `${job.presetId}, ${job.format}, slide ${index + 1}`;
    findings.slides += 1;

    try {
      const { overflowing } = await exporter.renderSlide(index, new AbortController().signal);
      if (overflowing.length > 0) findings.overflow.push(`${label}: ${overflowing.join(', ')}`);
    } catch (error) {
      const cause = (error as { cause?: unknown }).cause;
      findings.failed.push(`${label}: ${(error as Error).message} ${String(cause ?? '')}`.trim());
    }
  }
}

/** Runs the designs `AT_ONCE` at a time. */
async function drawAll(pool: BrowserPool, jobs: Job[]): Promise<Findings> {
  const findings: Findings = { slides: 0, overflow: [], failed: [] };
  let next = 0;

  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next];
      next += 1;
      await drawDesign(pool, job, findings);
    }
  };

  await Promise.all(Array.from({ length: AT_ONCE }, worker));
  return findings;
}

describeBrowser('every template in real Chromium', () => {
  let pool: BrowserPool;

  beforeAll(() => {
    pool = createBrowserPool({ launchTimeoutMs: 60_000, maxPages: AT_ONCE });
  });

  afterAll(async () => {
    await pool.close();
  });

  it('fits its sample content in every format it offers', async () => {
    const jobs: Job[] = PRESETS.flatMap((preset) =>
      presetFormats(preset).map((format) => ({ presetId: preset.id, format })),
    );

    // Every preset in at least one format, so a broken registry cannot pass empty.
    expect(new Set(jobs.map((job) => job.presetId)).size).toBe(PRESETS.length);

    const { slides, overflow, failed } = await drawAll(pool, jobs);

    expect(failed).toEqual([]);
    expect(overflow).toEqual([]);
    expect(slides).toBeGreaterThanOrEqual(jobs.length);
  }, 900_000);
});
