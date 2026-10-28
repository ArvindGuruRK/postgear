/**
 * Every template's sample content in real Chromium, opt-in like the other
 * browser specs: `SEO_BROWSER_TESTS=true npx jest presets.browser`.
 *
 * Two checks, both on the real faces in a real browser:
 *
 * - **Overflow.** Sprint 9's rule for templates: a preset renders in all its
 *   formats without overflow on its sample content. The engine's own preset
 *   test checks that with a width model (`approximateMeasure`), which reads a
 *   monospace or a heavy face as narrower than it is. This draws every slide
 *   of every preset in every format the way Export does and asks the fitter
 *   which slots it could not fit.
 * - **Contrast.** `themes.test.ts` proves every pairing a theme promises, ink
 *   on a flat ground. It cannot see background art, which sits between the
 *   two. This draws each slide, notes where every line of text sits and in
 *   which colour, hides the text, and photographs what is left behind it:
 *   the ground, the art and the decor. Every text slot must clear 4.5:1 (3:1
 *   for the large roles) against at least 95% of the pixels behind its lines.
 *
 * The whole library takes a while. `PRESET_IDS` narrows the presets and
 * `PRESET_CHECKS` the checks (`overflow`, `contrast`, or both, the default).
 */
import {
  applyTheme,
  buildExportPage,
  type DesignDocument,
  documentFonts,
  documentFromPreset,
  type FormatId,
  findLayout,
  formatSpec,
  PRESETS,
  presetFormats,
  SlideView,
  setArt,
  type TypeRole,
} from '@postgear/design-engine';
import { type BrowserPool, createBrowserPool } from '@postgear/seo-engine';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';
import { DesignExport } from './design-exporter';
import { inlineFonts } from './studio.fonts';

const enabled = process.env.SEO_BROWSER_TESTS === 'true';
const describeBrowser = enabled ? describe : describe.skip;

/**
 * The pool's page limit: this many designs draw at a time. Two keeps a
 * machine that is also running the app responsive; `PRESET_AT_ONCE` raises it
 * for a run of the whole library on an otherwise idle one.
 */
const AT_ONCE = Math.max(1, Number(process.env.PRESET_AT_ONCE) || 2);

/**
 * `PRESET_IDS=signature-*,tips-steps-ink` draws only those presets (an exact
 * id, or a prefix ending in `*`), so a change to a few templates is checked
 * in seconds instead of drawing the whole library. Unset draws everything.
 */
const ONLY = (process.env.PRESET_IDS ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

function wanted(presetId: string): boolean {
  if (ONLY.length === 0) return true;
  return ONLY.some((entry) =>
    entry.endsWith('*') ? presetId.startsWith(entry.slice(0, -1)) : presetId === entry,
  );
}

const CHOSEN = PRESETS.filter((preset) => wanted(preset.id));

const CHECKS = new Set(
  (process.env.PRESET_CHECKS ?? 'overflow,contrast')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean),
);
const itOverflow = CHECKS.has('overflow') ? it : it.skip;
const itContrast = CHECKS.has('contrast') ? it : it.skip;

interface Job {
  presetId: string;
  format: FormatId;
}

interface Findings {
  slides: number;
  problems: string[];
  failed: string[];
}

const JOBS: Job[] = CHOSEN.flatMap((preset) =>
  presetFormats(preset).map((format) => ({ presetId: preset.id, format })),
);

/** Runs the designs `AT_ONCE` at a time, each through `draw`. */
async function drawAll(
  pool: BrowserPool,
  draw: (pool: BrowserPool, job: Job, findings: Findings) => Promise<void>,
): Promise<Findings> {
  const findings: Findings = { slides: 0, problems: [], failed: [] };
  let next = 0;

  const worker = async () => {
    while (next < JOBS.length) {
      const job = JOBS[next];
      next += 1;
      await draw(pool, job, findings);
    }
  };

  await Promise.all(Array.from({ length: AT_ONCE }, worker));
  return findings;
}

// ---------------------------------------------------------------------------
// Overflow, through the exporter itself
// ---------------------------------------------------------------------------

/**
 * Draws one design's slides in order, the way an export does (the exporter
 * draws a slide at a time), noting each slot left too long and each slide
 * that would not draw.
 */
async function drawForOverflow(pool: BrowserPool, job: Job, findings: Findings): Promise<void> {
  const document = documentFromPreset({ presetId: job.presetId, format: job.format });
  const exporter = new DesignExport(document, { pool, loadPicture: async () => null });

  for (let index = 0; index < document.slides.length; index++) {
    const label = `${job.presetId}, ${job.format}, slide ${index + 1}`;
    findings.slides += 1;

    try {
      const { overflowing } = await exporter.renderSlide(index, new AbortController().signal);
      if (overflowing.length > 0) findings.problems.push(`${label}: ${overflowing.join(', ')}`);
    } catch (error) {
      const cause = (error as { cause?: unknown }).cause;
      findings.failed.push(`${label}: ${(error as Error).message} ${String(cause ?? '')}`.trim());
    }
  }
}

// ---------------------------------------------------------------------------
// Contrast, against what is really behind the text
// ---------------------------------------------------------------------------

/** Headline-sized roles read at 3:1, as WCAG's large text does; the rest need 4.5:1. */
const LARGE_ROLES: ReadonlySet<TypeRole> = new Set<TypeRole>(['headline', 'stat', 'quote', 'cta']);

/** The share of the pixels behind a slot's lines that must clear its contrast. */
const MIN_SHARE = 0.95;

/** Every second pixel each way: a line of text is far taller than that. */
const SAMPLE_STEP = 2;

/**
 * Runs in the page once the fitter is done, just before the screenshot: the
 * line boxes and colour of every run of text in a slot (a list's numbers and
 * items are separate runs), then every slot's text made transparent, so the
 * screenshot holds only what the text sits on. Layout does not change.
 */
const PROBE = `(() => {
  const runs = [];
  for (const slot of document.querySelectorAll('[data-slot]')) {
    const walker = document.createTreeWalker(slot, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent || !node.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = Array.from(range.getClientRects())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => [rect.left, rect.top, rect.width, rect.height]);
      runs.push({
        slot: slot.getAttribute('data-slot'),
        color: getComputedStyle(node.parentElement).color,
        rects,
      });
    }
  }
  const hide = document.createElement('style');
  hide.textContent =
    '[data-slot], [data-slot] * { color: transparent !important; text-shadow: none !important; }';
  document.head.appendChild(hide);
  return { fontsMissing: window.__pgFontsMissing || [], fitError: window.__pgFitError || null, runs };
})()`;

interface TextRun {
  slot: string;
  color: string;
  rects: Array<[x: number, y: number, width: number, height: number]>;
}

interface Probe {
  fontsMissing: string[];
  fitError: string | null;
  runs: TextRun[];
}

/** sRGB to linear light, by channel value, so the per-pixel loop is a lookup. */
const LINEAR = Array.from({ length: 256 }, (_, value) => {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
});

function luminance(red: number, green: number, blue: number): number {
  return 0.2126 * LINEAR[red] + 0.7152 * LINEAR[green] + 0.0722 * LINEAR[blue];
}

/** `rgb(1, 2, 3)` or `rgba(1, 2, 3, 0.5)` as the computed style gives it. */
function parseColor(css: string): { rgb: [number, number, number]; alpha: number } | null {
  const match = /rgba?\(([^)]+)\)/.exec(css);
  if (!match) return null;

  const parts = match[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .map(Number);
  if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return null;

  return { rgb: [parts[0], parts[1], parts[2]], alpha: parts.length > 3 ? parts[3] : 1 };
}

interface SlotTally {
  role: TypeRole;
  sampled: number;
  passing: number;
  worst: number;
}

/**
 * Tallies one slide: for each slot, how many of the pixels behind its lines
 * clear the slot's contrast with the ink drawn on them (a translucent ink is
 * blended with each pixel first, the way the browser draws it).
 */
function tally(
  probe: Probe,
  pixels: { data: Buffer; width: number; height: number; channels: number },
  roleOf: (slotId: string) => TypeRole,
): Map<string, SlotTally> {
  const slots = new Map<string, SlotTally>();

  for (const run of probe.runs) {
    const ink = parseColor(run.color);
    if (!ink || ink.alpha === 0) continue;

    const role = roleOf(run.slot);
    const needed = LARGE_ROLES.has(role) ? 3 : 4.5;
    const slot = slots.get(run.slot) ?? {
      role,
      sampled: 0,
      passing: 0,
      worst: Number.POSITIVE_INFINITY,
    };

    for (const [left, top, width, height] of run.rects) {
      const x0 = Math.max(0, Math.floor(left));
      const y0 = Math.max(0, Math.floor(top));
      const x1 = Math.min(pixels.width, Math.ceil(left + width));
      const y1 = Math.min(pixels.height, Math.ceil(top + height));

      for (let y = y0; y < y1; y += SAMPLE_STEP) {
        for (let x = x0; x < x1; x += SAMPLE_STEP) {
          const at = (y * pixels.width + x) * pixels.channels;
          const red = pixels.data[at];
          const green = pixels.data[at + 1];
          const blue = pixels.data[at + 2];

          const inkRed = Math.round(ink.rgb[0] * ink.alpha + red * (1 - ink.alpha));
          const inkGreen = Math.round(ink.rgb[1] * ink.alpha + green * (1 - ink.alpha));
          const inkBlue = Math.round(ink.rgb[2] * ink.alpha + blue * (1 - ink.alpha));

          const a = luminance(inkRed, inkGreen, inkBlue);
          const b = luminance(red, green, blue);
          const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

          slot.sampled += 1;
          if (ratio >= needed) slot.passing += 1;
          slot.worst = Math.min(slot.worst, ratio);
        }
      }
    }

    slots.set(run.slot, slot);
  }

  return slots;
}

const fontCache = new Map<string, ReturnType<typeof inlineFonts>>();

/**
 * Draws one design's slides with the exporter's own building blocks (the
 * markup, the inlined faces, the export page, the fitter's done flag) and
 * checks every text slot's contrast against what the screenshot shows
 * behind it.
 */
async function drawForContrast(pool: BrowserPool, job: Job, findings: Findings): Promise<void> {
  const document = documentFromPreset({ presetId: job.presetId, format: job.format });
  await checkContrast(pool, document, `${job.presetId}, ${job.format}`, findings);
}

async function checkContrast(
  pool: BrowserPool,
  document: DesignDocument,
  name: string,
  findings: Findings,
): Promise<void> {
  const spec = formatSpec(document.format);
  const fontKey = documentFonts(document).join(',');
  if (!fontCache.has(fontKey)) fontCache.set(fontKey, inlineFonts(documentFonts(document)));
  const fonts = await (fontCache.get(fontKey) as ReturnType<typeof inlineFonts>);

  for (let index = 0; index < document.slides.length; index++) {
    const label = `${name}, slide ${index + 1}`;
    findings.slides += 1;

    try {
      const markup = renderToStaticMarkup(
        createElement(SlideView, {
          design: document,
          index,
          mode: 'export',
          resolveMedia: () => null,
        }),
      );
      const html = buildExportPage({ markup, width: spec.width, height: spec.height, fonts });

      const result = await pool.render({
        html,
        width: spec.width,
        height: spec.height,
        type: 'png',
        waitForFunction: 'window.__pgFitDone === true',
        collect: PROBE,
        timeoutMs: 60_000,
      });

      const probe = result.value as Probe;
      if (probe.fontsMissing.length > 0 || probe.fitError) {
        findings.failed.push(
          `${label}: faces missing ${probe.fontsMissing.join(', ')}; fitter ${probe.fitError ?? 'ok'}`,
        );
        continue;
      }

      const { data, info } = await sharp(result.image)
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      const layout = findLayout(document.slides[index].layoutId);
      const roleOf = (slotId: string): TypeRole =>
        layout?.slots.find((slot) => slot.id === slotId)?.type ?? 'body';

      const slots = tally(
        probe,
        { data, width: info.width, height: info.height, channels: info.channels },
        roleOf,
      );

      for (const [slotId, slot] of slots) {
        if (slot.sampled === 0) continue;
        const share = slot.passing / slot.sampled;
        if (share < MIN_SHARE) {
          const needed = LARGE_ROLES.has(slot.role) ? 3 : 4.5;
          findings.problems.push(
            `${label}: ${slotId} clears ${needed}:1 on ${(share * 100).toFixed(1)}% of its ground (worst ${slot.worst.toFixed(2)}:1)`,
          );
        }
      }
    } catch (error) {
      findings.failed.push(`${label}: ${(error as Error).message}`);
    }
  }
}

describeBrowser('every template in real Chromium', () => {
  let pool: BrowserPool;

  beforeAll(() => {
    pool = createBrowserPool({ launchTimeoutMs: 60_000, maxPages: AT_ONCE });
  });

  afterAll(async () => {
    await pool.close();
  });

  it('draws at least one preset, so a broken registry or a mistyped PRESET_IDS cannot pass empty', () => {
    expect(CHOSEN.length).toBeGreaterThan(0);
    expect(new Set(JOBS.map((job) => job.presetId)).size).toBe(CHOSEN.length);
  });

  itOverflow(
    'fits its sample content in every format it offers',
    async () => {
      const { slides, problems, failed } = await drawAll(pool, drawForOverflow);

      expect(failed).toEqual([]);
      expect(problems).toEqual([]);
      expect(slides).toBeGreaterThanOrEqual(JOBS.length);
    },
    3_600_000,
  );

  itContrast(
    'catches light text over bright art, so a pass means something',
    async () => {
      // Ladder's full-strength bars under the night theme's pale ink: unreadable
      // by design, and invisible to every flat-colour check.
      const base = applyTheme(
        documentFromPreset({ presetId: 'tips-steps-ink', format: 'square' }),
        'nightfall',
      );
      const findings: Findings = { slides: 0, problems: [], failed: [] };

      await checkContrast(pool, setArt(base, 'ladder'), 'ladder self-test', findings);

      expect(findings.failed).toEqual([]);
      expect(findings.problems.length).toBeGreaterThan(0);
    },
    120_000,
  );

  itContrast(
    'keeps every text slot readable on what is behind it, art included',
    async () => {
      const { slides, problems, failed } = await drawAll(pool, drawForContrast);

      expect(failed).toEqual([]);
      expect(problems).toEqual([]);
      expect(slides).toBeGreaterThanOrEqual(JOBS.length);
    },
    3_600_000,
  );
});
