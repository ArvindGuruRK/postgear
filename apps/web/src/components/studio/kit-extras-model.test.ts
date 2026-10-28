import type { BrandKitView } from '@/types/studio';
import {
  CTA_URL_ERROR,
  ctaUrlProblem,
  extrasBody,
  extrasDraft,
  MAX_CTA_TEXT_LENGTH,
  MAX_CTA_URL_LENGTH,
} from './kit-extras-model';

const KIT: BrandKitView = {
  id: 'kit-1',
  name: 'Acme',
  description: null,
  websiteUrl: null,
  logoMediaId: null,
  logoUrl: null,
  colors: {
    primary: '#2563EB',
    secondary: '#546283',
    accent: '#C43312',
    background: '#F2F5FD',
    text: '#121C30',
  },
  headingFont: null,
  bodyFont: null,
  lockLook: false,
  ctaText: null,
  ctaUrl: null,
  source: 'MANUAL',
  createdAt: '2026-10-28T09:00:00.000Z',
  updatedAt: '2026-10-28T09:00:00.000Z',
};

describe('extrasDraft', () => {
  it('starts a new kit with the theme fonts, unlocked and with no call to action', () => {
    expect(extrasDraft(null)).toEqual({
      headingFont: null,
      bodyFont: null,
      lockLook: false,
      ctaText: '',
      ctaUrl: '',
    });
  });

  it('reads a saved kit', () => {
    const kit: BrandKitView = {
      ...KIT,
      headingFont: 'poppins',
      bodyFont: 'inter',
      lockLook: true,
      ctaText: 'Book a call',
      ctaUrl: 'acme.com/call',
    };

    expect(extrasDraft(kit)).toEqual({
      headingFont: 'poppins',
      bodyFont: 'inter',
      lockLook: true,
      ctaText: 'Book a call',
      ctaUrl: 'acme.com/call',
    });
  });

  it('reads a kit with none of them set as a new one would start', () => {
    expect(extrasDraft(KIT)).toEqual(extrasDraft(null));
  });

  it('drops a font the library no longer has, so the theme font shows instead', () => {
    const kit = { ...KIT, headingFont: 'retired-face' } as unknown as BrandKitView;
    expect(extrasDraft(kit).headingFont).toBeNull();
  });
});

describe('extrasBody', () => {
  const draft = extrasDraft(null);

  it('saves empty fields as null', () => {
    expect(extrasBody({ ...draft, ctaText: '   ', ctaUrl: ' ' })).toEqual({
      headingFont: null,
      bodyFont: null,
      lockLook: false,
      ctaText: null,
      ctaUrl: null,
    });
  });

  it('keeps the call to action on one line, trimmed, within the limits', () => {
    const body = extrasBody({
      ...draft,
      lockLook: true,
      headingFont: 'poppins',
      ctaText: '  Book   a\ncall  ',
      ctaUrl: ` ${'x'.repeat(MAX_CTA_URL_LENGTH + 5)} `,
    });

    expect(body.ctaText).toBe('Book a call');
    expect(body.ctaUrl).toHaveLength(MAX_CTA_URL_LENGTH);
    expect(body.lockLook).toBe(true);
    expect(body.headingFont).toBe('poppins');
    expect(extrasBody({ ...draft, ctaText: 'y'.repeat(99) }).ctaText).toHaveLength(
      MAX_CTA_TEXT_LENGTH,
    );
  });
});

describe('ctaUrlProblem', () => {
  it('takes a link as one word, with or without the scheme, or nothing at all', () => {
    expect(ctaUrlProblem('')).toBeNull();
    expect(ctaUrlProblem('  acme.com/offer ')).toBeNull();
    expect(ctaUrlProblem('https://acme.com/offer')).toBeNull();
  });

  it("refuses a link with spaces, in the API's own words", () => {
    expect(ctaUrlProblem('acme .com')).toBe(CTA_URL_ERROR);
    expect(CTA_URL_ERROR).toBe('Enter the link without spaces, like yourbrand.com/offer.');
  });
});
