/**
 * Design Studio demo content (Sprint 9).
 *
 * One brand kit and two designs for the demo workspace, so a fresh clone
 * opens Studio on something to click rather than on an empty state. One
 * design is a five-slide carousel left as a draft; the other is a single
 * landscape post, which is the shape the format filter needs a second value
 * for.
 *
 * The documents are written by hand against
 * `packages/design-engine/src/types.ts`, for the same reason the SEO seed
 * hand-writes its report JSON: `packages/db` does not depend on an engine
 * package. They are not trusted for that, though. Before anything is written
 * they are parsed with the engine's own schema, loaded at run time, so a
 * renamed layout or a changed shape stops the seed loudly instead of reaching
 * a user as a design the editor refuses to open.
 *
 * Idempotent by fixed id and `upsert`, like the rest of the seeds.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  BrandKitSource,
  DesignFormat,
  DesignStatus,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';

const BRAND_KIT_ID = 'seed-brand-kit-lotus';
const CAROUSEL_ID = 'seed-design-carousel';
const SINGLE_ID = 'seed-design-single';

/** The kit's `updatedAt`, fixed so re-seeding never offers Update From Kit against itself. */
const KIT_VERSION = '2026-10-27T09:00:00.000Z';

const BRAND_COLORS = {
  primary: '#0F766E',
  secondary: '#115E59',
  accent: '#C2410C',
  background: '#FFFFFF',
  text: '#0F1A19',
};

function brand() {
  return {
    kitId: BRAND_KIT_ID,
    colors: BRAND_COLORS,
    logoMediaId: null,
    // The brand name and the handle belong to the design, not to a slide:
    // every brand-name and handle slot shows these (`bindings.ts`).
    name: 'Lotus Flow Yoga',
    kitVersion: KIT_VERSION,
    // The kit sets no fonts of its own, so the theme's stay (schema version 2).
    fonts: null,
  };
}

/**
 * Built on `tips-steps-ink`, whose five slides are cover, numbered list,
 * content, statistic and closing. `origin` is each slide's index in that
 * preset, which is what Reset Slide restores; the fourth was switched from
 * the statistic layout to a quote, as a user might.
 */
const CAROUSEL_DOCUMENT = {
  schemaVersion: 2,
  format: 'portrait',
  presetId: 'tips-steps-ink',
  themeId: 'ink',
  art: null,
  fonts: null,
  brand: brand(),
  handle: '@lotusflowyoga',
  caption:
    'Five stretches that take ten minutes and make the rest of the day easier. Save this one for tomorrow morning.',
  slides: [
    {
      id: 'seed-slide-1',
      layoutId: 'cover-headline@1',
      background: { kind: 'role', role: 'background' },
      elements: {
        eyebrow: { text: 'Start here' },
        headline: { text: '5 Morning Stretches For Beginners' },
        subheadline: { text: 'Ten minutes, no mat needed, nothing you have to be flexible for.' },
      },
      origin: 0,
    },
    {
      id: 'seed-slide-2',
      layoutId: 'list-numbered@1',
      background: { kind: 'role', role: 'background' },
      elements: {
        headline: { text: 'The Five Stretches' },
        list: {
          items: [
            'Neck rolls, slowly, five each way',
            'Shoulder openers against a door frame',
            'Standing forward fold, knees soft',
            'Low lunge, thirty seconds a side',
            'Seated twist, breathing out as you turn',
          ],
        },
      },
      origin: 1,
    },
    {
      id: 'seed-slide-3',
      layoutId: 'content-eyebrow@1',
      background: { kind: 'role', role: 'background' },
      elements: {
        eyebrow: { text: 'Why it works' },
        headline: { text: 'Easy Beats Perfect' },
        body: {
          text: 'A routine you can do on a bad day is worth more than one you only manage when everything goes right. Start with the shortest version and keep it.',
        },
      },
      origin: 2,
    },
    {
      id: 'seed-slide-4',
      layoutId: 'quote-centre@1',
      background: { kind: 'role', role: 'surface' },
      elements: {
        quote: {
          text: '"I stopped waking up stiff within a fortnight, and I only do five minutes."',
        },
        attribution: { text: 'Asha, Tuesday class' },
      },
      origin: 3,
    },
    {
      id: 'seed-slide-5',
      layoutId: 'closing-cta@1',
      background: { kind: 'role', role: 'background' },
      elements: {
        headline: { text: 'Which One Will You Try Tomorrow?' },
        subheadline: { text: 'Tell us in the comments, and save this for the morning.' },
        cta: { text: 'Follow for more' },
      },
      origin: 4,
    },
  ],
};

/**
 * A single post on the plain layout, recoloured to the Slate theme. It was
 * started from `announcement-launch-ink`; the slide was added in the editor,
 * so it has no `origin` and Reset Slide gives it the layout's sample words.
 */
const SINGLE_DOCUMENT = {
  schemaVersion: 2,
  format: 'landscape',
  presetId: 'announcement-launch-ink',
  themeId: 'slate',
  art: null,
  fonts: null,
  brand: brand(),
  handle: '@lotusflowyoga',
  caption: 'Saturday mornings are back, 8am, all levels. Booking link in our bio.',
  slides: [
    {
      id: 'seed-slide-single',
      layoutId: 'plain@1',
      background: { kind: 'role', role: 'background' },
      elements: {
        headline: { text: 'Saturday Classes Are Back' },
        body: {
          text: '8am every Saturday from the 9th, all levels welcome. Book through the link in our bio.',
        },
      },
    },
  ],
};

type SafeParse = (
  value: unknown,
) => { ok: true; document: unknown } | { ok: false; error: { message: string } };

/**
 * Parses each document with the design engine's schema and throws, naming the
 * design, if one would be refused.
 *
 * Loaded with `require` at run time, so the engine is not a dependency of
 * this package or part of its typecheck. In this monorepo the engine is
 * always there; the check is skipped only in a checkout without it.
 */
function assertDocumentsValid(documents: Record<string, unknown>): void {
  const schemaFile = join(__dirname, '../../../design-engine/src/schema.ts');
  if (!existsSync(schemaFile)) return;

  const { safeParseDesignDocument } = require(schemaFile) as {
    safeParseDesignDocument: SafeParse;
  };

  for (const [title, document] of Object.entries(documents)) {
    const result = safeParseDesignDocument(document);

    if (!result.ok) {
      throw new Error(
        `prisma/seeds/studio.seed.ts is stale: the design engine refuses "${title}": ${result.error.message}`,
      );
    }
  }
}

export async function seedStudio(
  prisma: PrismaClient,
  organizationId: string,
  createdById: string,
) {
  const designs = [
    {
      id: CAROUSEL_ID,
      title: '5 Morning Stretches',
      format: DesignFormat.PORTRAIT,
      presetId: CAROUSEL_DOCUMENT.presetId,
      document: CAROUSEL_DOCUMENT,
      daysAgo: 1,
    },
    {
      id: SINGLE_ID,
      title: 'Saturday Classes Are Back',
      format: DesignFormat.LANDSCAPE,
      presetId: SINGLE_DOCUMENT.presetId,
      document: SINGLE_DOCUMENT,
      daysAgo: 4,
    },
  ];

  assertDocumentsValid(
    Object.fromEntries(designs.map((design) => [design.title, design.document])),
  );

  await prisma.brandKit.upsert({
    where: { id: BRAND_KIT_ID },
    create: {
      id: BRAND_KIT_ID,
      organizationId,
      name: 'Lotus Flow Yoga',
      description: 'A small studio in Fort Kochi. Teal and warm white, friendly and plain.',
      websiteUrl: 'https://example.com/',
      colors: BRAND_COLORS as Prisma.InputJsonValue,
      source: BrandKitSource.MANUAL,
      createdById,
      updatedAt: new Date(KIT_VERSION),
    },
    update: {
      name: 'Lotus Flow Yoga',
      colors: BRAND_COLORS as Prisma.InputJsonValue,
      logoMediaId: null,
      deletedAt: null,
      updatedAt: new Date(KIT_VERSION),
    },
  });

  for (const design of designs) {
    const updatedAt = new Date(Date.now() - design.daysAgo * 24 * 60 * 60 * 1000);
    const row = {
      organizationId,
      title: design.title,
      format: design.format,
      presetId: design.presetId,
      brandKitId: BRAND_KIT_ID,
      document: design.document as unknown as Prisma.InputJsonValue,
      status: DesignStatus.DRAFT,
      exportedMediaIds: [],
      lastExportedRevision: null,
      lastSlideIndex: 0,
      deletedAt: null,
      createdById,
      updatedAt,
    };

    await prisma.design.upsert({
      where: { id: design.id },
      create: { id: design.id, ...row },
      // A re-seed replaces the document, so the revision moves on: an editor
      // still open on the old one gets a conflict on its next save instead of
      // quietly writing the old document back over this one.
      update: { ...row, revision: { increment: 1 } },
    });
  }

  return { brandKits: 1, designs: designs.length };
}
