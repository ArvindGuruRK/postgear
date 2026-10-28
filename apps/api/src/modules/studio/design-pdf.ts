/**
 * PDF Download (Sprint 9b): the last export's slides as one PDF, a page per
 * slide at the slide's own size. (Portrait is the one exception, by 2px: a
 * 1350px page cannot be printed exactly, so the pool prints it 1352px tall
 * with the slide filling it rather than leave a hairline of paper showing;
 * `printLength` in the pool has the arithmetic.)
 *
 * The PDF is printed by the shared browser (`BrowserPool.printImages`, in the
 * same offline context an export renders in), from the slides already in the
 * library rather than from the design. So it shows exactly what Download All
 * would, needs an export just as Download All does, and costs no second
 * render of every slide.
 *
 * Unlike the zip it is not streamed: Chromium hands the finished file back in
 * one piece. That has one good side, which `StudioService.printPdf` and the
 * controller lean on: everything, the print included, happens before the
 * first byte is written, so even a failed print is an ordinary JSON error
 * the export dialog can show.
 */
import { FORMATS } from '@postgear/design-engine';
import type { Response } from 'express';
import { contentDisposition, safeFileName } from '../../common/attachment';

export interface DesignPdfFile {
  fileName: string;
  bytes: Buffer;
}

/** The PDF's own name: "Spring Sale.pdf". */
export function pdfFileName(title: string): string {
  return `${safeFileName(title, 'Design')}.pdf`;
}

/**
 * A page's size, in CSS pixels, for slides of `width` x `height` pixels.
 *
 * A slide exported at 2x is the same slide with twice the pixels, so its page
 * is the format's own size, the picture just sharper on it: a 2160 x 2700
 * slide prints on a 1080 x 1350 page, like its 1x twin. The slides of one
 * export all share a size, and the format they were drawn in may since have
 * changed, which is why the size is read off the pictures and not the design.
 * A picture that matches no format at either scale keeps its own size.
 */
export function pdfPageSize(width: number, height: number): { width: number; height: number } {
  for (const format of Object.values(FORMATS)) {
    for (const scale of [1, 2]) {
      if (format.width * scale === width && format.height * scale === height) {
        return { width: format.width, height: format.height };
      }
    }
  }

  return { width, height };
}

/** Sends a finished PDF as a download. */
export function sendPdf(file: DesignPdfFile, response: Response): void {
  response.status(200);
  response.setHeader('Content-Type', 'application/pdf');
  response.setHeader('Content-Disposition', contentDisposition(file.fileName));
  response.setHeader('Content-Length', String(file.bytes.length));
  response.setHeader('Cache-Control', 'no-store');
  response.end(file.bytes);
}
