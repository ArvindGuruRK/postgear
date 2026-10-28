/**
 * What Studio accepts from a browser: the format mapping is total both ways,
 * every body is strict, text is cleaned before it is measured, and each
 * refusal a person can cause carries the sentence the form shows.
 */

import { DesignFormat } from '@postgear/db';
import {
  documentFromPreset,
  FONT_IDS,
  FORMAT_IDS,
  MAX_CAPTION_LENGTH,
} from '@postgear/design-engine';
import { STUDIO_MESSAGES } from '../studio.messages';
import {
  brandKitBodySchema,
  COLUMN_TO_FORMAT,
  createDesignSchema,
  createShareSchema,
  DEFAULT_SHARE_DAYS,
  downloadQuerySchema,
  duplicateDesignSchema,
  exportDesignSchema,
  extractBrandSchema,
  FORMAT_TO_COLUMN,
  favouriteSchema,
  listDesignsQuerySchema,
  MAX_CTA_TEXT_LENGTH,
  MAX_CTA_URL_LENGTH,
  MAX_TITLE_LENGTH,
  sendDesignSchema,
  updateBrandKitSchema,
  updateDesignSchema,
} from './studio.schema';

const COLORS = {
  primary: '#FF5A1F',
  secondary: '#1F6FFF',
  accent: '#00AA55',
  background: '#FFFDF8',
  text: '#1A1A1A',
};

/** The sentences a failed parse would show. */
function messages(result: { success: boolean; error?: { issues: Array<{ message: string }> } }) {
  return result.success ? [] : (result.error?.issues.map((issue) => issue.message) ?? []);
}

describe('format mapping', () => {
  it('maps every engine format to a column and back', () => {
    for (const format of FORMAT_IDS) {
      expect(COLUMN_TO_FORMAT[FORMAT_TO_COLUMN[format]]).toBe(format);
    }
  });

  it('maps every column to an engine format and back', () => {
    for (const column of Object.values(DesignFormat)) {
      expect(FORMAT_TO_COLUMN[COLUMN_TO_FORMAT[column]]).toBe(column);
    }
  });
});

describe('createDesignSchema', () => {
  it('accepts a template, a format, a kit and a cleaned title', () => {
    expect(
      createDesignSchema.parse({
        presetId: 'tips-steps-ink',
        format: 'square',
        brandKitId: null,
        title: '  Spring\tSale \u0007 Week  ',
      }),
    ).toEqual({
      presetId: 'tips-steps-ink',
      format: 'square',
      brandKitId: null,
      title: 'Spring Sale Week',
    });
  });

  it('refuses a document on create: the server builds it from the template', () => {
    const document = documentFromPreset({ presetId: 'tips-steps-ink', format: 'square' });

    expect(
      createDesignSchema.safeParse({ presetId: 'tips-steps-ink', format: 'square', document })
        .success,
    ).toBe(false);
  });

  it('asks for a name when the title is blank, and refuses one too long', () => {
    expect(
      messages(createDesignSchema.safeParse({ presetId: 'blank', format: 'story', title: '   ' })),
    ).toEqual([STUDIO_MESSAGES.TITLE_REQUIRED]);
    expect(
      createDesignSchema.safeParse({
        presetId: 'blank',
        format: 'story',
        title: 'a'.repeat(MAX_TITLE_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it.each([
    ['an unknown format', { presetId: 'blank', format: 'banner' }],
    ['a template id with a path in it', { presetId: '../etc/passwd', format: 'square' }],
    ['a kit id with a quote in it', { presetId: 'blank', format: 'square', brandKitId: 'a"b' }],
  ])('refuses %s', (_label, body) => {
    expect(createDesignSchema.safeParse(body).success).toBe(false);
  });
});

describe('updateDesignSchema', () => {
  const document = documentFromPreset({ presetId: 'tips-steps-ink', format: 'square' });

  it('accepts a document the engine built', () => {
    expect(updateDesignSchema.safeParse({ revision: 3, document }).success).toBe(true);
  });

  it('brings a document from an editor opened before the last release up to date', () => {
    const { art: _art, fonts: _fonts, ...older } = document;
    const versionOne = {
      ...older,
      schemaVersion: 1,
      brand: { ...document.brand, fonts: undefined },
    };
    delete (versionOne.brand as { fonts?: unknown }).fonts;

    const result = updateDesignSchema.safeParse({ revision: 3, document: versionOne });

    expect(result.success).toBe(true);
    expect(result.data?.document).toEqual({ ...document, art: null, fonts: null });
  });

  it('refuses a document from a newer release than this one', () => {
    const newer = { ...document, schemaVersion: document.schemaVersion + 1 };
    expect(updateDesignSchema.safeParse({ revision: 3, document: newer }).success).toBe(false);
  });

  it('says there is nothing to save when only the revision came', () => {
    expect(messages(updateDesignSchema.safeParse({ revision: 3 }))).toEqual([
      STUDIO_MESSAGES.NOTHING_TO_SAVE,
    ]);
  });

  it.each([
    ['a revision of zero', { revision: 0, title: 'A' }],
    ['a slide index past the last possible slide', { revision: 1, lastSlideIndex: 20 }],
    [
      'a document with an element the renderer never draws',
      { revision: 1, document: { ...document, extra: true } },
    ],
    ['an unknown key', { revision: 1, title: 'A', status: 'SENT' }],
  ])('refuses %s', (_label, body) => {
    expect(updateDesignSchema.safeParse(body).success).toBe(false);
  });
});

describe('listDesignsQuerySchema', () => {
  it('reads the page from the query string and cleans the search', () => {
    expect(
      listDesignsQuerySchema.parse({ page: '2', search: '  spring \n sale ', format: 'square' }),
    ).toEqual({ page: 2, search: 'spring sale', format: 'square' });
    expect(listDesignsQuerySchema.parse({}).page).toBe(1);
  });

  it('refuses an unknown filter', () => {
    expect(listDesignsQuerySchema.safeParse({ owner: 'me' }).success).toBe(false);
  });
});

describe('sendDesignSchema', () => {
  it('defaults to JPEG and keeps the caption as typed, line breaks and all', () => {
    expect(
      sendDesignSchema.parse({ channelIds: ['c1'], caption: ' Line one\r\nLine two ' }),
    ).toEqual({
      channelIds: ['c1'],
      caption: 'Line one\nLine two',
      imageFormat: 'jpeg',
    });
  });

  it.each([
    ['no channel', { channelIds: [] }],
    ['the same channel twice', { channelIds: ['c1', 'c1'] }],
    ['a caption too long', { channelIds: ['c1'], caption: 'a'.repeat(MAX_CAPTION_LENGTH + 1) }],
    ['a format the library does not export', { channelIds: ['c1'], imageFormat: 'gif' }],
  ])('refuses %s', (_label, body) => {
    expect(sendDesignSchema.safeParse(body).success).toBe(false);
  });
});

describe('brandKitBodySchema', () => {
  it('accepts a kit, normalising its colours', () => {
    expect(
      brandKitBodySchema.parse({
        name: ' Acme ',
        websiteUrl: ' acme.example ',
        colors: { ...COLORS, primary: 'ff5a1f', text: '#111' },
      }),
    ).toEqual({
      name: 'Acme',
      websiteUrl: 'acme.example',
      colors: { ...COLORS, primary: '#FF5A1F', text: '#111111' },
    });
  });

  it('asks for a name, and for a colour it can read', () => {
    expect(messages(brandKitBodySchema.safeParse({ name: '', colors: COLORS }))).toEqual([
      STUDIO_MESSAGES.BRAND_KIT_NAME_REQUIRED,
    ]);
    expect(
      messages(
        brandKitBodySchema.safeParse({ name: 'Acme', colors: { ...COLORS, accent: 'red' } }),
      ),
    ).toEqual(['Enter a colour like #1A2B3C.']);
  });

  it('refuses colours with a role missing or added', () => {
    const { text: _text, ...four } = COLORS;

    expect(brandKitBodySchema.safeParse({ name: 'Acme', colors: four }).success).toBe(false);
    expect(
      brandKitBodySchema.safeParse({ name: 'Acme', colors: { ...COLORS, extra: '#000000' } })
        .success,
    ).toBe(false);
  });
});

describe('brand kit fonts, lock and call to action (Sprint 9b)', () => {
  const [heading, body] = FONT_IDS;

  it('accepts faces from the library, the lock, and a cleaned call to action', () => {
    expect(
      brandKitBodySchema.parse({
        name: 'Acme',
        colors: COLORS,
        headingFont: heading,
        bodyFont: null,
        lockLook: true,
        ctaText: '  Book a\n call  ',
        ctaUrl: ' acme.com/book ',
      }),
    ).toMatchObject({
      headingFont: heading,
      bodyFont: null,
      lockLook: true,
      ctaText: 'Book a call',
      ctaUrl: 'acme.com/book',
    });
    expect(updateBrandKitSchema.parse({ bodyFont: body })).toEqual({ bodyFont: body });
  });

  it.each([
    ['a face the library does not have', { headingFont: 'comic-sans' }],
    ['a lock that is not a yes or no', { lockLook: 'yes' }],
    [
      'a call to action longer than one line can hold',
      { ctaText: 'a'.repeat(MAX_CTA_TEXT_LENGTH + 1) },
    ],
    ['a link longer than one line can hold', { ctaUrl: 'a'.repeat(MAX_CTA_URL_LENGTH + 1) }],
  ])('refuses %s', (_label, fields) => {
    expect(brandKitBodySchema.safeParse({ name: 'Acme', colors: COLORS, ...fields }).success).toBe(
      false,
    );
  });

  it('keeps a link with a space for the service to answer with a sentence', () => {
    // "Invalid input" would not say what is wrong; the service says it.
    expect(
      brandKitBodySchema.parse({ name: 'Acme', colors: COLORS, ctaUrl: 'acme.com/spring sale' })
        .ctaUrl,
    ).toBe('acme.com/spring sale');
  });
});

describe('updateBrandKitSchema', () => {
  it('accepts one field, and says there is nothing to save for none', () => {
    expect(updateBrandKitSchema.parse({ logoMediaId: null })).toEqual({ logoMediaId: null });
    expect(messages(updateBrandKitSchema.safeParse({}))).toEqual([STUDIO_MESSAGES.NOTHING_TO_SAVE]);
  });
});

describe('exportDesignSchema (Sprint 9b)', () => {
  it('exports at 1x JPEG unless told otherwise, and takes 2x', () => {
    expect(exportDesignSchema.parse({})).toEqual({ imageFormat: 'jpeg', scale: 1 });
    expect(exportDesignSchema.parse({ imageFormat: 'png', scale: 2 })).toEqual({
      imageFormat: 'png',
      scale: 2,
    });
  });

  it.each([[3], [1.5], ['2'], [0]])('refuses a scale of %p', (scale) => {
    expect(exportDesignSchema.safeParse({ scale }).success).toBe(false);
  });
});

describe('duplicateDesignSchema (Sprint 9b)', () => {
  it('reads no body, or an empty one, as a plain copy', () => {
    expect(duplicateDesignSchema.parse(undefined)).toEqual({});
    expect(duplicateDesignSchema.parse(null)).toEqual({});
    expect(duplicateDesignSchema.parse({})).toEqual({});
  });

  it('takes a format the engine knows, and nothing else', () => {
    expect(duplicateDesignSchema.parse({ format: 'story' })).toEqual({ format: 'story' });
    expect(duplicateDesignSchema.safeParse({ format: 'banner' }).success).toBe(false);
    expect(duplicateDesignSchema.safeParse({ format: 'story', title: 'Mine' }).success).toBe(false);
  });
});

describe('downloadQuerySchema (Sprint 9b)', () => {
  it('downloads the zip unless the PDF is asked for', () => {
    expect(downloadQuerySchema.parse({})).toEqual({ format: 'zip' });
    expect(downloadQuerySchema.parse({ format: 'pdf' })).toEqual({ format: 'pdf' });
    expect(downloadQuerySchema.safeParse({ format: 'docx' }).success).toBe(false);
    expect(downloadQuerySchema.safeParse({ format: 'pdf', page: '2' }).success).toBe(false);
  });
});

describe('extractBrandSchema', () => {
  it('asks for an address when none came', () => {
    expect(messages(extractBrandSchema.safeParse({ url: '  ' }))).toEqual([
      STUDIO_MESSAGES.WEBSITE_INVALID,
    ]);
    expect(extractBrandSchema.parse({ url: ' acme.example ' })).toEqual({ url: 'acme.example' });
  });
});

describe('shares and favourites', () => {
  it('lasts a week unless told otherwise, between one day and thirty', () => {
    expect(createShareSchema.parse({})).toEqual({ expiresInDays: DEFAULT_SHARE_DAYS });
    expect(createShareSchema.safeParse({ expiresInDays: 0 }).success).toBe(false);
    expect(createShareSchema.safeParse({ expiresInDays: 31 }).success).toBe(false);
    expect(createShareSchema.safeParse({ expiresInDays: 2.5 }).success).toBe(false);
  });

  it('takes a template id in the library shape only', () => {
    expect(favouriteSchema.safeParse({ presetId: 'tips-steps-ink' }).success).toBe(true);
    expect(favouriteSchema.safeParse({ presetId: 'Tips Steps' }).success).toBe(false);
  });
});
