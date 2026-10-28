/**
 * PDF Download's helpers (Sprint 9b): the file's name, the page size read off
 * the exported slides (1x and 2x alike), and the headers it goes out with.
 * The print itself is `BrowserPool.printImages`, covered in the pool's own
 * tests and, in real Chromium, in `design-exporter.browser.spec.ts`.
 */
import { FORMAT_IDS, formatSpec } from '@postgear/design-engine';
import type { Response } from 'express';
import { pdfFileName, pdfPageSize, sendPdf } from './design-pdf';

describe('pdfFileName', () => {
  it('names the PDF after the design, safely', () => {
    expect(pdfFileName('Spring Sale')).toBe('Spring Sale.pdf');
    expect(pdfFileName('Q3: Plans / Wins')).toBe('Q3 Plans Wins.pdf');
    expect(pdfFileName('  /// ')).toBe('Design.pdf');
  });
});

describe('pdfPageSize', () => {
  it.each(FORMAT_IDS)('prints a %s slide on a page of its own size, at 1x or 2x', (format) => {
    const { width, height } = formatSpec(format);

    expect(pdfPageSize(width, height)).toEqual({ width, height });
    expect(pdfPageSize(width * 2, height * 2)).toEqual({ width, height });
  });

  it('keeps the size of a picture that matches no format', () => {
    expect(pdfPageSize(800, 600)).toEqual({ width: 800, height: 600 });
  });
});

describe('sendPdf', () => {
  it('sends the file whole, as a download that is never cached', () => {
    const headers: Record<string, string> = {};
    const response = {
      statusCode: 0,
      body: null as Buffer | null,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      setHeader(name: string, value: string) {
        headers[name] = value;
      },
      end(body: Buffer) {
        this.body = body;
      },
    };
    const bytes = Buffer.from('%PDF-1.4 a few pages');

    sendPdf({ fileName: 'Spring Sale.pdf', bytes }, response as unknown as Response);

    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(bytes);
    expect(headers).toEqual({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="Spring Sale.pdf"; filename*=UTF-8''Spring%20Sale.pdf`,
      'Content-Length': String(bytes.length),
      'Cache-Control': 'no-store',
    });
  });
});
