/**
 * The template gallery.
 *
 * A preset is three things: a **shape** (which layouts, in which order), a
 * **theme** (colours and type) and **sample content**. Pairing fourteen shapes
 * with ten themes is what gets the library past a hundred without anyone
 * hand-drawing a hundred designs, and it is why the sprint's "40 at launch,
 * the next 60 are a content task" is true: adding one is a line in `PAIRS`.
 *
 * The sample content is real sentences, not "Lorem ipsum" and not a label
 * saying "Headline". A user who picks a template and changes two words should
 * have a publishable post, and copy that reads like copy is also the only way
 * to see whether a layout actually holds a sentence.
 *
 * The brand name, the handle and the slide numbers are not sample content:
 * they belong to the design (`bindings.ts`), so a preset never writes them.
 *
 * Nothing here is ever written to the database. A design stores the preset's
 * id and its own copy of the content (`document.ts`), so a preset can be
 * reworded in a later release without touching a design anybody made.
 */
import { latestLayout } from './layouts';
import { themeById } from './themes';
import type { FormatId, Preset, PresetCategory, PresetSlide, SlotId, ThemeStyle } from './types';

function slide(
  layoutId: string,
  text: Partial<Record<SlotId, string>> = {},
  items?: Partial<Record<SlotId, string[]>>,
): PresetSlide {
  return items ? { layoutId, text, items } : { layoutId, text };
}

// ---------------------------------------------------------------------------
// Shapes: the fourteen carousels the library is built from
// ---------------------------------------------------------------------------

const SHAPES: Record<string, { category: PresetCategory; tags: string[]; slides: PresetSlide[] }> =
  {
    'tips-steps': {
      category: 'tips',
      tags: ['steps', 'how to', 'routine', 'beginner'],
      slides: [
        slide('cover-headline', {
          eyebrow: 'Start here',
          headline: '5 Simple Steps To A Better Morning',
          subheadline: 'Small changes you can keep, even on a busy week.',
        }),
        slide(
          'list-numbered',
          { headline: 'The Five Steps' },
          {
            list: [
              'Put your phone across the room tonight',
              'Drink a full glass of water first',
              'Move for ten minutes, however you like',
              'Write down the one thing that matters today',
              'Eat before you open your inbox',
            ],
          },
        ),
        slide('content-eyebrow', {
          eyebrow: 'Why it works',
          headline: 'Easy Beats Perfect',
          body: 'A routine you can do on your worst day is worth more than one you only manage when everything goes right. Start with the smallest version and keep it.',
        }),
        slide('stat-big', {
          eyebrow: 'What changes',
          stat: '21 days',
          statLabel: 'is all most people need before a small habit stops feeling like effort',
        }),
        slide('closing-cta', {
          headline: 'Which One Will You Try Tomorrow?',
          subheadline: 'Tell us in the comments, and save this for the morning.',
          cta: 'Follow for more',
        }),
      ],
    },

    'tips-mistakes': {
      category: 'tips',
      tags: ['mistakes', 'avoid', 'checklist'],
      slides: [
        slide('cover-block', {
          eyebrow: 'Stop doing this',
          headline: '4 Mistakes That Quietly Cost You Customers',
          subheadline: 'Every one of them is a ten-minute fix.',
        }),
        slide(
          'list-ticks',
          { eyebrow: 'The list', headline: 'Fix These First' },
          {
            list: [
              'No reply time anywhere on your page',
              'A contact form nobody tests',
              'Prices hidden behind "get in touch"',
              'The same photo on every post',
            ],
          },
        ),
        slide('split-panel', {
          eyebrow: 'The big one',
          headline: 'Silence Reads As "No"',
          body: 'People do not wait for an answer, they move on. A short reply today beats a thorough one next week.',
          subheadline: 'Answer within a day, even if the answer is "give me a day".',
        }),
        slide('closing-band', {
          headline: 'Pick One And Fix It Today',
          subheadline: 'Save this and come back when you have ten minutes.',
          cta: 'Follow for more',
        }),
      ],
    },

    'educational-explainer': {
      category: 'educational',
      tags: ['explainer', 'teach', 'guide', 'basics'],
      slides: [
        slide('cover-headline', {
          eyebrow: 'In plain words',
          headline: 'What Actually Happens When You Click "Publish"',
          subheadline: 'A short walk through the part nobody shows you.',
        }),
        slide('split-picture', {
          headline: 'It Goes In A Queue',
          body: 'Your post is written down first, then handed to a worker that talks to each platform on its own. That is why one failure never takes the others with it.',
        }),
        slide(
          'list-steps',
          { headline: 'Three Things Happen' },
          {
            list: [
              'The text and pictures are checked against each platform rule',
              'A job is scheduled for the exact minute you chose',
              'Each platform is called on its own and the result written back',
            ],
          },
        ),
        slide('content-eyebrow', {
          eyebrow: 'Remember',
          headline: 'Failures Are Retried, Not Lost',
          body: 'A platform that is briefly down does not lose your post. It is tried again, and you are told either way.',
        }),
        slide('closing-cta', {
          headline: 'Want The Rest Of The Series?',
          subheadline: 'We publish one of these every week.',
          cta: 'Follow for more',
        }),
      ],
    },

    'educational-myths': {
      category: 'educational',
      tags: ['myths', 'truth', 'misconceptions'],
      slides: [
        slide('cover-block', {
          eyebrow: 'Myth busting',
          headline: 'Three Things You Were Told That Are Not True',
        }),
        slide('quote-panel', {
          quote: '"Post every day or the algorithm forgets you."',
          attribution: 'Something everybody repeats',
        }),
        slide('content-eyebrow', {
          eyebrow: 'The truth',
          headline: 'Consistency Beats Frequency',
          body: 'Three good posts a week outperform seven rushed ones, because people decide whether to follow you on the quality of the one post they happen to see.',
        }),
        slide('stat-split', {
          stat: '3x',
          statLabel: 'more saves on posts people finish reading',
          headline: 'Finish Rate Is The Number To Watch',
          body: 'A carousel people swipe to the end of tells a platform far more than one they scroll past quickly.',
        }),
        slide('closing-band', {
          headline: 'What Else Have You Been Told?',
          subheadline: 'We will take the next one apart.',
          cta: 'Follow for more',
        }),
      ],
    },

    'announcement-launch': {
      category: 'announcement',
      tags: ['launch', 'news', 'release', 'update'],
      slides: [
        slide('cover-picture', {
          eyebrow: 'New',
          headline: 'It Is Here',
          subheadline: 'The thing you have been asking for, out today.',
        }),
        slide('content-eyebrow', {
          eyebrow: 'What is new',
          headline: 'Everything In One Place',
          body: 'Plan, write and publish without moving between three tools. The whole week is one screen.',
        }),
        slide(
          'list-ticks',
          { headline: 'What You Get' },
          {
            list: [
              'One calendar for every channel',
              'Drafts your team can comment on',
              'Results on the same page as the plan',
            ],
          },
        ),
        slide('closing-cta', {
          headline: 'Try It Free For 14 Days',
          subheadline: 'No card, no call, cancel whenever.',
          cta: 'Link in bio',
        }),
      ],
    },

    'product-update': {
      category: 'product',
      tags: ['product', 'feature', 'release notes'],
      slides: [
        slide('cover-block', {
          eyebrow: 'Product update',
          headline: 'Three Things We Shipped This Month',
        }),
        slide('split-picture', {
          headline: 'A Calendar You Can Drag',
          body: 'Move a post to a better hour by dragging it. The queue updates, and so does everyone else looking at it.',
        }),
        slide('split-panel', {
          eyebrow: 'Also new',
          headline: 'Comments On Drafts',
          body: 'Feedback lands next to the words it is about, not in a separate thread nobody can find later.',
          subheadline: '"Finally, the approvals live where the work is."',
        }),
        slide('stat-big', {
          eyebrow: 'Faster',
          stat: '40%',
          statLabel: 'less time from first draft to published, across our beta teams',
        }),
        slide('closing-cta', {
          headline: 'Read The Full Notes',
          subheadline: 'Everything we changed, in one page.',
          cta: 'Link in bio',
        }),
      ],
    },

    'quote-testimonial': {
      category: 'quote',
      tags: ['testimonial', 'customer', 'review', 'social proof'],
      slides: [
        slide('cover-headline', {
          eyebrow: 'In their words',
          headline: 'What Our Customers Actually Say',
        }),
        slide('quote-centre', {
          quote:
            '"We stopped arguing about the calendar. Everything is in one place and everyone can see it."',
          attribution: 'Meera, agency owner',
        }),
        slide('quote-panel', {
          quote: '"It took one afternoon to move eight clients across. Nothing broke."',
          attribution: 'Karthik, marketing manager',
        }),
        slide('closing-cta', {
          headline: 'Join Them',
          subheadline: 'Start free, bring your team when you are ready.',
          cta: 'Link in bio',
        }),
      ],
    },

    'listicle-tools': {
      category: 'listicle',
      tags: ['tools', 'list', 'resources', 'picks'],
      slides: [
        slide('cover-headline', {
          eyebrow: 'Saved you a search',
          headline: '6 Tools We Use Every Single Week',
          subheadline: 'No affiliate links, no sponsorships.',
        }),
        slide(
          'list-numbered',
          { headline: 'The Short List' },
          {
            list: [
              'A calendar everyone on the team can see',
              'One place for every photo and video',
              'Something that tells you when a link breaks',
              'A notebook you actually reopen',
              'A timer you cannot argue with',
              'A weekly half hour with nothing in it',
            ],
          },
        ),
        slide('content-eyebrow', {
          eyebrow: 'The rule',
          headline: 'Fewer Tools, Used Properly',
          body: 'Every tool you add is another place to look for something. We drop one whenever we add one.',
        }),
        slide('closing-band', {
          headline: 'What Is On Your List?',
          subheadline: 'Tell us the one you could not work without.',
          cta: 'Follow for more',
        }),
      ],
    },

    'statistic-report': {
      category: 'statistic',
      tags: ['data', 'report', 'numbers', 'research'],
      slides: [
        slide('cover-block', {
          eyebrow: 'The 2026 report',
          headline: 'What 1,200 Marketers Told Us',
          subheadline: 'Three numbers worth your afternoon.',
        }),
        slide('stat-big', {
          eyebrow: 'Number one',
          stat: '68%',
          statLabel: 'plan their week on a Monday, and change it by Wednesday',
          body: 'Plans are not the problem. Plans nobody can see are.',
        }),
        slide('stat-split', {
          stat: '2.4h',
          statLabel: 'a week, moving files between tools',
          headline: 'The Quiet Tax',
          body: 'Nobody budgets for it, everybody pays it. It is the single largest piece of admin our survey found.',
        }),
        slide('stat-big', {
          eyebrow: 'Number three',
          stat: '1 in 5',
          statLabel: 'posts goes out with the wrong picture at least once a quarter',
        }),
        slide('closing-cta', {
          headline: 'Get The Full Report',
          subheadline: 'Twelve pages, no email wall.',
          cta: 'Link in bio',
        }),
      ],
    },

    'case-study': {
      category: 'case-study',
      tags: ['case study', 'results', 'story', 'before after'],
      slides: [
        slide('cover-picture', {
          eyebrow: 'Case study',
          headline: 'How One Bakery Filled Its Quiet Tuesdays',
        }),
        slide('content-eyebrow', {
          eyebrow: 'The problem',
          headline: 'Great Weekends, Empty Weekdays',
          body: 'Saturday sold out by noon. Tuesday barely moved. The baking was the same; nobody knew what was in the case.',
        }),
        slide(
          'list-steps',
          { headline: 'What We Changed' },
          {
            list: [
              'One photo of the counter, posted every morning at seven',
              'A Tuesday-only pastry nobody could get at the weekend',
              'A reply to every comment before the shop opened',
            ],
          },
        ),
        slide('stat-big', {
          eyebrow: 'The result',
          stat: '+34%',
          statLabel: 'Tuesday takings, eight weeks later, with no extra spend',
        }),
        slide('quote-centre', {
          quote: '"We did not post more. We posted at the hour people decide what to have."',
          attribution: 'Nisha, owner',
        }),
        slide('closing-cta', {
          headline: 'Want The Same Walk-Through?',
          subheadline: 'We write one of these every month.',
          cta: 'Follow for more',
        }),
      ],
    },

    'promotion-offer': {
      category: 'promotion',
      tags: ['offer', 'sale', 'discount', 'promo'],
      slides: [
        slide('cover-block', {
          eyebrow: 'This week only',
          headline: 'Two Months Free On Every Yearly Plan',
          subheadline: 'Ends Sunday at midnight.',
        }),
        slide(
          'list-ticks',
          { headline: 'What Is Included' },
          {
            list: [
              'Every channel, no per-channel pricing',
              'Your whole team, no seat limits',
              'A year of history you can actually search',
            ],
          },
        ),
        slide('stat-split', {
          stat: '14 days',
          statLabel: 'to try everything, for free',
          headline: 'No Card To Start',
          body: 'Bring one channel across, see whether your week gets easier, then decide.',
        }),
        slide('closing-band', {
          headline: 'Claim It Before Sunday',
          subheadline: 'The code is in our bio.',
          cta: 'Link in bio',
        }),
      ],
    },

    'story-behind': {
      category: 'story',
      tags: ['story', 'founder', 'behind the scenes', 'journey'],
      slides: [
        slide('cover-picture', {
          eyebrow: 'Our story',
          headline: 'We Built This Because We Needed It',
        }),
        slide('content-eyebrow', {
          eyebrow: 'Year one',
          headline: 'A Spreadsheet And Four Tabs',
          body: 'Every Monday started by copying last week into a new sheet. By Thursday nobody trusted it.',
        }),
        slide('quote-panel', {
          quote: '"If we cannot see the week on one screen, we are guessing."',
          attribution: 'The note that started it',
        }),
        slide('split-picture', {
          headline: 'Now It Is One Screen',
          body: 'The plan, the drafts and the results, in the order a week actually happens.',
        }),
        slide('closing-cta', {
          headline: 'Thanks For Reading',
          subheadline: 'We post what we learn, every week.',
          cta: 'Follow for more',
        }),
      ],
    },

    'event-invite': {
      category: 'event',
      tags: ['event', 'webinar', 'invite', 'workshop'],
      slides: [
        slide('cover-block', {
          eyebrow: 'You are invited',
          headline: 'A Free Workshop On Planning A Quarter',
          subheadline: 'Thursday 14 May, 4pm, one hour.',
        }),
        slide(
          'list-numbered',
          { headline: 'What We Will Cover' },
          {
            list: [
              'Choosing three things instead of thirty',
              'Writing a month in one sitting',
              'What to do when the plan breaks in week two',
            ],
          },
        ),
        slide('split-panel', {
          eyebrow: 'Who it is for',
          headline: 'Anyone Who Owns The Calendar',
          body: 'Solo creators, small teams, and the one person at an agency who keeps everything moving.',
          subheadline: 'Bring a question. We answer every one.',
        }),
        slide('closing-cta', {
          headline: 'Save Your Seat',
          subheadline: 'Free, and recorded if you cannot make it.',
          cta: 'Link in bio',
        }),
      ],
    },

    'hiring-role': {
      category: 'hiring',
      tags: ['hiring', 'jobs', 'careers', 'we are hiring'],
      slides: [
        slide('cover-headline', {
          eyebrow: 'We are hiring',
          headline: 'Looking For A Content Designer',
          subheadline: 'Remote, with a team week together twice a year.',
        }),
        slide(
          'list-ticks',
          { headline: 'What You Would Do' },
          {
            list: [
              'Write the words in the product, not around it',
              'Sit with support once a week and read the hard tickets',
              'Decide what we stop saying',
            ],
          },
        ),
        slide('content-eyebrow', {
          eyebrow: 'What we offer',
          headline: 'Short Weeks, Real Ownership',
          body: 'Four-day week, a budget you do not have to justify twice, and a team small enough that your work ships the week you finish it.',
        }),
        slide('closing-band', {
          headline: 'Apply By 30 May',
          subheadline: 'A short form, no cover letter.',
          cta: 'Link in bio',
        }),
      ],
    },
  };

/**
 * The handle a design made from a preset starts with, so the footer reads
 * like a footer in the gallery. It is the design's own from then on: typed
 * once, shown on every slide.
 */
export const SAMPLE_HANDLE = '@yourbrand';

/**
 * The gallery, as pairs of a shape and a theme.
 *
 * Each row's name describes the design the pair makes, not the shape, because
 * that is what the user is choosing between in the gallery: the same five
 * steps in Bold and in Editorial are two different-looking templates.
 */
const PAIRS: Array<[shape: string, themeId: string, id: string, name: string]> = [
  ['tips-steps', 'ink', 'tips-steps-ink', '5 Simple Steps'],
  ['tips-steps', 'sunrise', 'tips-steps-sunrise', 'Warm Morning Steps'],
  ['tips-steps', 'midnight', 'tips-steps-midnight', 'Night Mode Steps'],
  ['tips-steps', 'blossom', 'tips-steps-blossom', 'Soft Steps'],
  ['tips-mistakes', 'bold', 'tips-mistakes-bold', 'Loud Mistakes'],
  ['tips-mistakes', 'slate', 'tips-mistakes-slate', 'Quiet Mistakes'],
  ['tips-mistakes', 'ocean', 'tips-mistakes-ocean', 'Deep Dive Mistakes'],

  ['educational-explainer', 'slate', 'educational-explainer-slate', 'Plain Explainer'],
  ['educational-explainer', 'editorial', 'educational-explainer-editorial', 'Long Read Explainer'],
  ['educational-explainer', 'terminal', 'educational-explainer-terminal', 'Developer Explainer'],
  ['educational-myths', 'ink', 'educational-myths-ink', 'Myth Versus Fact'],
  ['educational-myths', 'violet', 'educational-myths-violet', 'Bright Myth Buster'],
  ['educational-myths', 'midnight', 'educational-myths-midnight', 'Dark Myth Buster'],

  ['announcement-launch', 'bold', 'announcement-launch-bold', 'Big Launch'],
  ['announcement-launch', 'ocean', 'announcement-launch-ocean', 'Calm Launch'],
  ['announcement-launch', 'sunrise', 'announcement-launch-sunrise', 'Sunrise Launch'],
  ['announcement-launch', 'ink', 'announcement-launch-ink', 'Clean Launch'],

  ['product-update', 'slate', 'product-update-slate', 'Product Update'],
  ['product-update', 'midnight', 'product-update-midnight', 'Dark Product Update'],
  ['product-update', 'violet', 'product-update-violet', 'Release Highlights'],
  ['product-update', 'terminal', 'product-update-terminal', 'Changelog'],

  ['quote-testimonial', 'editorial', 'quote-testimonial-editorial', 'Editorial Testimonials'],
  ['quote-testimonial', 'blossom', 'quote-testimonial-blossom', 'Soft Testimonials'],
  ['quote-testimonial', 'ink', 'quote-testimonial-ink', 'Plain Testimonials'],
  ['quote-testimonial', 'ocean', 'quote-testimonial-ocean', 'Deep Testimonials'],

  ['listicle-tools', 'ink', 'listicle-tools-ink', 'Tool Round-Up'],
  ['listicle-tools', 'bold', 'listicle-tools-bold', 'Bold Round-Up'],
  ['listicle-tools', 'sunrise', 'listicle-tools-sunrise', 'Warm Round-Up'],

  ['statistic-report', 'slate', 'statistic-report-slate', 'Annual Report'],
  ['statistic-report', 'midnight', 'statistic-report-midnight', 'Dark Data'],
  ['statistic-report', 'violet', 'statistic-report-violet', 'Bright Data'],
  ['statistic-report', 'terminal', 'statistic-report-terminal', 'Raw Numbers'],

  ['case-study', 'editorial', 'case-study-editorial', 'Editorial Case Study'],
  ['case-study', 'ink', 'case-study-ink', 'Before And After'],
  ['case-study', 'ocean', 'case-study-ocean', 'Deep Case Study'],

  ['promotion-offer', 'bold', 'promotion-offer-bold', 'Loud Offer'],
  ['promotion-offer', 'sunrise', 'promotion-offer-sunrise', 'Warm Offer'],
  ['promotion-offer', 'violet', 'promotion-offer-violet', 'Bright Offer'],

  ['story-behind', 'editorial', 'story-behind-editorial', 'Founder Story'],
  ['story-behind', 'blossom', 'story-behind-blossom', 'Soft Story'],
  ['story-behind', 'midnight', 'story-behind-midnight', 'Night Story'],

  ['event-invite', 'violet', 'event-invite-violet', 'Workshop Invite'],
  ['event-invite', 'ink', 'event-invite-ink', 'Plain Invite'],
  ['event-invite', 'ocean', 'event-invite-ocean', 'Calm Invite'],

  ['hiring-role', 'slate', 'hiring-role-slate', 'We Are Hiring'],
  ['hiring-role', 'bold', 'hiring-role-bold', 'Loud Hiring'],
  ['hiring-role', 'blossom', 'hiring-role-blossom', 'Friendly Hiring'],
];

export const PRESETS: Preset[] = PAIRS.map(([shapeId, themeId, id, name]) => {
  const shape = SHAPES[shapeId];

  return {
    id,
    name,
    category: shape.category,
    themeId,
    tags: [...shape.tags, shapeId],
    slides: shape.slides,
  };
});

const BY_ID: ReadonlyMap<string, Preset> = new Map(PRESETS.map((preset) => [preset.id, preset]));

export function presetById(id: string): Preset | null {
  return BY_ID.get(id) ?? null;
}

export function presetsByCategory(category: PresetCategory): Preset[] {
  return PRESETS.filter((preset) => preset.category === category);
}

/**
 * The formats every slide of a preset can be drawn in. Every layout takes all
 * four today; this is what keeps a future single-format layout out of the
 * wrong gallery rather than producing a design the schema refuses.
 */
export function presetFormats(preset: Preset): FormatId[] {
  let formats: FormatId[] | null = null;

  for (const entry of preset.slides) {
    const layout = latestLayout(entry.layoutId);
    if (!layout) return [];

    formats =
      formats === null
        ? [...layout.formats]
        : formats.filter((format) => layout.formats.includes(format));
  }

  return formats ?? [];
}

/** Light, dark or colourful: the gallery's style filter. */
export function presetStyle(preset: Preset): ThemeStyle {
  return themeById(preset.themeId).style;
}

/**
 * Whether a preset matches what was typed in the gallery's search: every word
 * has to appear in its name, its category or its tags.
 */
export function matchesPresetQuery(preset: Preset, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;

  const haystack = [preset.name, preset.category, ...preset.tags].join(' ').toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** The three the empty state offers as inspiration (DS-1.2). */
export const FEATURED_PRESET_IDS: readonly string[] = [
  'tips-steps-ink',
  'product-update-slate',
  'quote-testimonial-editorial',
];
