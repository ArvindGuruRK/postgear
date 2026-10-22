'use client';

/**
 * Builds the analytics PDF in the browser and downloads it (2026-10-22, in
 * place of the CSV button; `GET /analytics/export` still serves the CSV).
 *
 * Everything heavy loads only when someone presses Export PDF: the renderer
 * (`@react-pdf/renderer`) and the document are imported here on demand, so
 * the page never carries them. The report is built from the overview already
 * on screen, so it shows exactly the range and channel being looked at.
 *
 * The PDF embeds Sora from `public/fonts/sora` (the WOFF files; the renderer
 * cannot read the WOFF2 the page uses). Platform logos are SVGs, which the
 * renderer cannot place as images, so each is drawn onto a canvas once and
 * handed over as a PNG; one that fails to load becomes a coloured dot rather
 * than failing the export.
 */
import { platformLogoSrc } from '@/components/platforms/platform-icon';
import type { AnalyticsOverview } from '@/types/analytics';
import { buildReport, type ReportContext } from './report-model';
import { PDF_FONT, PDF_FONT_FILES } from './report-theme';

let fontsRegistered = false;

/** A logo SVG drawn onto a canvas at `size` pixels, as a PNG data URL; null if it would not load. */
async function rasterize(src: string, size = 96): Promise<string | null> {
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = src;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) return null;
    context.drawImage(image, 0, 0, size, size);
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

async function logosFor(platforms: string[]): Promise<Record<string, string>> {
  const entries = await Promise.all(
    platforms.map(async (platform) => {
      // The report is dark, so X gets its white tile.
      const src = platformLogoSrc(platform, 'dark');
      return [platform, src ? await rasterize(src) : null] as const;
    }),
  );
  return Object.fromEntries(
    entries.filter((entry): entry is readonly [string, string] => entry[1] !== null),
  );
}

/** Builds the PDF for what is on screen and saves it; throws if the renderer fails. */
export async function exportAnalyticsPdf(
  overview: AnalyticsOverview,
  context: Omit<ReportContext, 'generatedAt'>,
): Promise<void> {
  const [{ Font, pdf }, { ReportDocument }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('./report-document'),
  ]);

  if (!fontsRegistered) {
    Font.register({
      family: PDF_FONT,
      fonts: PDF_FONT_FILES.map((file) => ({
        src: new URL(file.src, window.location.origin).href,
        fontWeight: file.weight,
      })),
    });
    // Names and numbers are never split across lines with a hyphen.
    Font.registerHyphenationCallback((word) => [word]);
    fontsRegistered = true;
  }

  const report = buildReport(overview, { ...context, generatedAt: new Date() });
  const logos = await logosFor(report.platforms);
  const blob = await pdf(<ReportDocument report={report} logos={logos} />).toBlob();

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = report.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Long enough for the browser to start the download before the URL goes.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
