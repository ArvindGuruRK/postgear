/**
 * The Signature collection's hand-made art templates: CarouselClick's
 * original backgrounds (rebuilt as generators in `art/originals.ts`) under
 * the Signature layouts. Premium, because the art is: `buildPresets` works
 * that out from the art, so no row says it.
 *
 * ## Home first, then the range
 *
 * Every original but Ladder appears at least once on its home theme, the
 * ground it was drawn on: Cascade, Canopy, Tiers, Facets and Ray on
 * Nightfall, Shards and Slabs on Evergreen, Drift on Spruce, Bloom on Mint.
 * There `artColors` hands the art its `home` colours, so that row is the
 * CarouselClick look itself, drawing and inks alike. The other rows put an
 * original on another signature theme, where the same drawing is recoloured
 * from the theme's pinned art colours, to show the range a brand kit gets
 * from one drawing.
 *
 * Nocturne is never the other theme for a Nightfall original: its ground is
 * the same #05011A, so the art would draw in its home colours there and the
 * row would show no range at all.
 *
 * ## Text over the art
 *
 * Every row clears the pixel contrast check in `presets.browser.spec.ts`
 * (each line of text against what is really behind it, in every format).
 * Three things here are shaped by it:
 *
 * - **Ladder** has no home row. Its bright bars fill the slide in two
 *   columns, so on Nightfall no line of text can stay clear of them (the
 *   pale ink on its #08F967 bars is 1.4:1), whatever the shape. On Mint the
 *   bars recolour to pale mint and lime under dark ink, and there it reads,
 *   with a carousel that leaves out the small lines set in the primary
 *   colour (the eyebrow, the footer and the link).
 * - **Drift** lights the top-left corner, where the eyebrow sits, so its
 *   carousels open without one.
 * - On **Sky** and **Mint** the primary colour clears AA on the flat ground
 *   and on nothing darker, so a row there takes art that leaves the eyebrow
 *   and the footer on clean ground (Bloom) or a carousel without them
 *   (Ladder). That is why Slabs went to Paper rather than Sky.
 *
 * ## The shapes
 *
 * Their own, not Sprint 9's: CarouselClick's flows (a cover, the problem or
 * the insight, a framework or a checklist, a number, a quote, the close) on
 * topics that suit a bolder, crafted look. Each is written to the Signature
 * layouts' budgets (`layouts/signature.ts`) and then to the lines the real
 * faces break into: the footer is set at call-to-action size in a box under
 * two thirds of the band, so most footers are one short line (a takeaway, a
 * source, "Swipe for a tour"), and the words are chosen so that no headline,
 * quote, footer or paragraph ends on one short word alone, in any format. A
 * closing slide's footer is the link. The logo, the brand name, the handle
 * and the slide number belong to the design, so no shape writes them.
 *
 * Canopy draws nothing but its ground in landscape, so its row is the most
 * word-led carousel here: a founder's story that reads as well without the
 * art as with it.
 *
 * A shape can serve two rows, which is why an id names both the topic and
 * the art (`handmade-<topic>-<art>`): the same carousel on a second original
 * is a second template.
 */
import type { Preset } from '../types';
import { buildPresets, type PresetRow, type PresetShape, slide } from './build';

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

const SHAPES: Record<string, PresetShape> = {
  'app-launch': {
    category: 'announcement',
    tags: ['launch', 'app', 'new', 'product launch'],
    slides: [
      slide('signature-cover', {
        eyebrow: 'Launching today',
        headline: 'The App That Plans Your Week',
        subheadline:
          'Two years of building, testing and listening, now in one simple app that turns a busy week into a clear plan.',
        footer: 'Swipe for a tour',
      }),
      slide('signature-content', {
        eyebrow: 'The problem',
        headline: 'Your Week Lives In Six Places',
        body: 'Tasks in one app, meetings in another, ideas on sticky notes. By Wednesday nobody knows what matters, and the real work waits until Friday.',
        footer: 'Sound familiar?',
      }),
      slide(
        'signature-list',
        { headline: 'What It Does', footer: 'Ready in minutes' },
        {
          list: [
            'Gathers every task in one view',
            'Picks the three things to do first',
            'Blocks quiet time before meetings fill it',
            'Sends a short recap every Friday',
          ],
        },
      ),
      slide('signature-stat', {
        eyebrow: 'From our beta',
        stat: '6 hours',
        statLabel:
          'saved each week by our average beta tester, mostly time they once spent looking for things',
        footer: 'From 400 testers',
      }),
      slide('signature-quote', {
        quote: '"The first planner I open every morning."',
        attribution: 'Beta tester and studio owner',
        footer: 'An early review',
      }),
      slide('signature-closing', {
        headline: 'Free For Your First 30 Days',
        body: 'No card needed. Bring your tasks across in one click, and keep them if you ever leave.',
        cta: 'Download the app today',
        footer: 'yourbrand.com/app',
      }),
    ],
  },

  'founder-lesson': {
    category: 'story',
    tags: ['founder', 'lesson', 'story', 'growth', 'focus'],
    slides: [
      slide('signature-cover', {
        eyebrow: "A founder's note",
        headline: 'The Lesson That Almost Sank Us',
        subheadline:
          'In year one we said yes to every client. Here is what that taught us about growth, focus and saying no.',
        footer: 'Two-minute read',
      }),
      slide('signature-content', {
        eyebrow: 'Where it went wrong',
        headline: 'We Said Yes To Every Client',
        body: 'Every new client felt like a win, so we took them all. By month nine we were working weekends, the best work was rushed and our favourite clients felt it.',
        footer: 'Busy is not the same as growing',
      }),
      slide('signature-content', {
        eyebrow: 'What we learned',
        headline: 'A Clear No Protects The Yes',
        body: 'Turning down work that does not fit gives the right clients your full attention. Our best year began the day we wrote down who we do not work with.',
        footer: 'Try it tonight',
      }),
      slide('signature-quote', {
        quote: '"The clients we turned away sent us more work than the ones we took."',
        attribution: 'Our co-founder, looking back',
        footer: 'Lesson learned',
      }),
      slide('signature-stat', {
        eyebrow: 'One year later',
        stat: '2x',
        statLabel: 'the revenue with half as many clients, and every weekend back where it belongs',
        footer: 'Our own figures',
      }),
      slide('signature-closing', {
        headline: 'What Would You Say No To?',
        body: 'Tell us in the comments. We read every one and share the best answers in our next post.',
        cta: 'Follow for more notes',
        footer: 'yourbrand.com/notes',
      }),
    ],
  },

  'studio-process': {
    category: 'educational',
    tags: ['process', 'studio', 'how we work', 'design', 'agency'],
    slides: [
      slide('signature-cover', {
        eyebrow: 'Inside the studio',
        headline: 'Sketch To Launch, Our Way',
        subheadline:
          'The same four stages for every project, whether it is a logo or a whole website.',
        footer: 'Swipe through all four stages',
      }),
      slide(
        'signature-list',
        {
          headline: 'No Surprises, Just Four Stages',
          footer: 'Every stage ends with your sign-off',
        },
        {
          list: [
            'Listen: one workshop, one goal',
            'Sketch: rough ideas, early',
            'Shape: one direction, refined',
            'Ship: launch and handover',
          ],
        },
      ),
      slide('signature-content', {
        eyebrow: 'Why it works',
        headline: 'Rough Work First, Every Time',
        body: 'A change to a pencil sketch takes minutes. The same change to a finished design takes days, so you see our rough sketches before anything gets polished.',
        footer: 'Messy by design',
      }),
      slide('signature-stat', {
        eyebrow: 'The result',
        stat: '92%',
        statLabel: 'of our projects launch on the date we agreed in the very first workshop',
        footer: 'From our own project records',
      }),
      slide('signature-quote', {
        quote: '"We always knew what came next, and nothing was ever a surprise."',
        attribution: 'Marketing lead, a recent client',
        footer: 'A recent review',
      }),
      slide('signature-closing', {
        headline: 'Start Your Project With Us',
        body: 'Fill in a short form and we will reply within two working days with the next steps.',
        cta: 'Book a discovery call',
        footer: 'yourbrand.com/start',
      }),
    ],
  },

  'tech-release': {
    category: 'product',
    tags: ['release', 'update', 'version', 'software', 'tech'],
    slides: [
      slide('signature-cover', {
        eyebrow: 'Version 3.0 is out',
        headline: 'Faster, Calmer, Built For Teams',
        subheadline:
          'Our biggest release yet, shaped by a whole year of your feedback and quite a few late nights.',
        footer: 'What is new',
      }),
      slide('signature-content', {
        eyebrow: 'Speed',
        headline: 'Everything Opens In Under A Second',
        body: 'We rebuilt the engine from the ground up. Search, boards and reports now open before you have finished clicking.',
        footer: 'Even at scale',
      }),
      slide(
        'signature-list',
        { headline: 'Also New In 3.0', footer: 'More on our blog' },
        {
          list: [
            'Shared spaces for every team',
            'An automatic dark mode',
            'Offline drafts that sync when you are back',
            'Keyboard shortcuts for everything',
          ],
        },
      ),
      slide('signature-stat', {
        eyebrow: 'Under the hood',
        stat: '3x',
        statLabel: 'faster on our own test of the twenty screens people open most',
        footer: 'Our own tests',
      }),
      slide('signature-quote', {
        quote: '"It feels brand new, yet everything I need is where it was."',
        attribution: 'Engineering manager, early access',
        footer: 'From our early access group',
      }),
      slide('signature-closing', {
        headline: 'Free For Everyone, Starting Today',
        body: 'It is rolling out now. Restart the app to get it, or download it fresh.',
        cta: 'Read the release notes',
        footer: 'yourbrand.com/v3',
      }),
    ],
  },

  'demo-night': {
    category: 'event',
    tags: ['event', 'meetup', 'demo night', 'community', 'makers'],
    slides: [
      slide('signature-cover', {
        eyebrow: 'Thursday 10 June, 7pm',
        headline: 'Summer Demo Night Is Back',
        subheadline:
          'Six local makers, five minutes each, and one room full of people who love seeing how things are built.',
        footer: 'Free to attend',
      }),
      slide('signature-content', {
        eyebrow: 'What to expect',
        headline: 'Real Work, Shown As It Is',
        body: 'No sales pitches and no polished decks. Each maker shows something they built, what went wrong and what they would do differently.',
        footer: 'Bring questions',
      }),
      slide(
        'signature-list',
        { headline: 'On The Night', footer: 'Done by 9.30pm' },
        {
          list: [
            '7pm: doors open and drinks',
            '7.30pm: six five-minute demos',
            '8.30pm: your questions',
            '9pm: pizza and conversation',
          ],
        },
      ),
      slide('signature-stat', {
        eyebrow: 'Last season',
        stat: '240',
        statLabel:
          'people came along over four nights, and a third of them came back to demo their own work',
        footer: 'Our guest list',
      }),
      slide('signature-quote', {
        quote: '"I came along to watch and left with a co-founder."',
        attribution: 'A regular since the first night',
        footer: 'Our favourite review so far',
      }),
      slide('signature-closing', {
        headline: 'Save Your Seat',
        body: 'Seats are free but limited to eighty. Register for your ticket and a reminder on the day.',
        cta: 'Register for free',
        footer: 'yourbrand.com/demo',
      }),
    ],
  },

  // Ladder's bars fill the slide in two columns, so no line of text can stay
  // clear of them. They read only where the ink is dark and the bars pale,
  // and even there the primary colour falls short of 4.5:1 on a bar, so this
  // carousel has no eyebrow, footer or link: the numbers and their sentences
  // carry it. (The closing call to action is primary too, but large enough
  // to need only 3:1.)
  'year-in-numbers': {
    category: 'statistic',
    tags: ['year in review', 'numbers', 'growth', 'milestones', 'report'],
    slides: [
      slide(
        'signature-cover',
        {
          headline: 'Four Numbers From Our Year',
          subheadline: 'A big year for a small team. Here are the numbers we are proudest of.',
        },
        undefined,
        ['eyebrow', 'footer'],
      ),
      slide(
        'signature-stat',
        {
          stat: '12,400',
          statLabel: 'people now use our app every week, up from 3,100 a year ago',
        },
        undefined,
        ['eyebrow', 'footer'],
      ),
      slide(
        'signature-stat',
        {
          stat: '4 min',
          statLabel: 'to our first reply on average, day or night, and always from a real person',
        },
        undefined,
        ['eyebrow', 'footer'],
      ),
      slide(
        'signature-stat',
        {
          stat: '18',
          statLabel: 'people on the team, up from seven in January, and we are still hiring',
        },
        undefined,
        ['eyebrow', 'footer'],
      ),
      slide(
        'signature-stat',
        {
          stat: '1,000',
          statLabel:
            'trees planted this year, one for every new customer, as we promised on day one',
        },
        undefined,
        ['eyebrow', 'footer'],
      ),
      slide(
        'signature-closing',
        {
          headline: 'Thank You For A Great Year',
          body: 'None of it happens without you. Here is to the next one.',
          cta: 'Follow along next year',
        },
        undefined,
        ['footer'],
      ),
    ],
  },

  'creative-brief': {
    category: 'tips',
    tags: ['creative brief', 'brief', 'design', 'agency', 'how to'],
    slides: [
      slide('signature-cover', {
        eyebrow: 'Hiring a designer?',
        headline: 'Write A Creative Brief In One Page',
        subheadline:
          'A good brief saves weeks of back and forth. This is the one-page format we ask every client to fill in.',
        footer: 'Save this for your next project',
      }),
      slide('signature-content', {
        eyebrow: 'The problem',
        headline: 'Vague Briefs Get Vague Work',
        body: 'Asking for something that pops is not a brief. When the goal is unclear, designers guess, and every guess costs you another round of changes.',
        footer: 'Clarity is the cheapest fix',
      }),
      slide(
        'signature-list',
        { headline: 'Answer Four Questions First', footer: 'Keep it short' },
        {
          list: [
            'Who is this for, in one sentence?',
            'What should they do after seeing it?',
            'What must it include, or avoid?',
            'What is the budget and timing?',
          ],
        },
      ),
      slide('signature-content', {
        eyebrow: 'The secret',
        headline: 'Share What You Do Not Like',
        body: 'Three examples you dislike tell a designer more than ten you love, and rule out whole directions before the first sketch.',
        footer: 'Use screenshots',
      }),
      slide('signature-quote', {
        quote: '"The best brief we ever had fitted on a single sticky note."',
        attribution: 'Our creative director',
        footer: 'Short beats long, every time',
      }),
      slide('signature-closing', {
        headline: 'Our Template, Free To Use',
        body: 'The one-page template we use with every client, ready to download with no sign-up.',
        cta: 'Get the free template',
        footer: 'yourbrand.com/brief',
      }),
    ],
  },

  'four-day-week': {
    category: 'case-study',
    tags: ['four-day week', 'team', 'culture', 'wellbeing', 'results'],
    slides: [
      slide('signature-cover', {
        eyebrow: 'Six months in',
        headline: 'What Happened When We Tried A Four-Day Week',
        subheadline:
          'Same pay, same clients, one day less. Here is what changed for the work, the team and the business.',
        footer: 'Honest results',
      }),
      slide('signature-content', {
        eyebrow: 'Why we tried it',
        headline: 'Tired Teams Do Average Work',
        body: 'We were busy all week and still finishing things on Sunday nights. Something had to give, and we decided it would be the fifth day.',
        footer: 'Burnout was the real cost',
      }),
      slide(
        'signature-list',
        { headline: 'We Started With Four Rules', footer: 'Small rules, big difference' },
        {
          list: [
            'Meetings capped at 30 minutes',
            'No internal email on Wednesdays',
            "One shared list of the week's priorities",
            'Fridays off, with a rota for anything urgent',
          ],
        },
      ),
      slide('signature-stat', {
        eyebrow: 'The result',
        stat: '+18%',
        statLabel: 'more client work delivered on time than in the six months before',
        footer: 'From our own project tracker',
      }),
      slide('signature-quote', {
        quote: '"I do better work in four days than I ever managed in five."',
        attribution: 'Senior designer, on the team',
        footer: 'No going back',
      }),
      slide('signature-closing', {
        headline: 'Could Your Team Try It?',
        body: 'We wrote up everything we learned, mistakes included, in a free guide for small teams.',
        cta: 'Read the full guide',
        footer: 'yourbrand.com/4days',
      }),
    ],
  },

  // Drift's glow lights the top-left corner, where the eyebrow sits, so its
  // carousels open without one (CarouselClick's own inner slides have none).
  'pottery-course': {
    category: 'event',
    tags: ['course', 'workshop', 'class', 'beginners', 'weekend'],
    slides: [
      slide(
        'signature-cover',
        {
          headline: 'Learn To Make Your First Bowl',
          subheadline:
            'A weekend at the wheel with a patient teacher, a small group and all the clay you can use.',
          footer: 'Beginners only',
        },
        undefined,
        ['eyebrow'],
      ),
      slide(
        'signature-content',
        {
          headline: 'For Beginners Who Want To Slow Down',
          body: 'You do not need to be creative or good with your hands. You need a free weekend and the patience to get a little messy.',
          footer: 'Aprons provided',
        },
        undefined,
        ['eyebrow'],
      ),
      slide(
        'signature-list',
        { headline: 'Over Two Days', footer: 'Fired for you' },
        {
          list: [
            'Centre clay on the wheel',
            'Throw a bowl, cup and plate',
            'Trim and decorate them',
            'Choose a glaze for each piece',
          ],
        },
      ),
      slide(
        'signature-stat',
        {
          stat: '6',
          statLabel:
            'people at most on each course, so the teacher can help everyone at every step',
          footer: 'Lunch included',
        },
        undefined,
        ['eyebrow'],
      ),
      slide('signature-quote', {
        quote: '"The calmest weekend I have had all year, and I made six bowls."',
        attribution: 'Spring course, first-time potter',
        footer: 'Most come back',
      }),
      slide('signature-closing', {
        headline: 'Book Your Place',
        body: 'Courses run on the first weekend of every month. Places often go three weeks ahead, so book early.',
        cta: 'See the dates and book',
        footer: 'yourbrand.com/course',
      }),
    ],
  },

  // Written for Drift too, so it opens without an eyebrow.
  'autumn-blend': {
    category: 'product',
    tags: ['coffee', 'seasonal', 'new product', 'small batch', 'shop'],
    slides: [
      slide(
        'signature-cover',
        {
          headline: 'Our Autumn Blend Is Back',
          subheadline:
            'Roasted in small batches every Monday, with notes of dark chocolate and plum.',
          footer: 'Here for eight weeks only',
        },
        undefined,
        ['eyebrow'],
      ),
      slide(
        'signature-content',
        {
          headline: 'Why We Roast It A Little Darker',
          body: 'Colder mornings want a deeper cup. A slower, darker roast brings out the chocolate and keeps the fruit, so it holds up well with milk.',
          footer: 'Black or white',
        },
        undefined,
        ['eyebrow'],
      ),
      slide(
        'signature-list',
        { headline: 'In Every Bag', footer: 'Beans or ground' },
        {
          list: [
            'Beans from two farms we visit every year',
            'Roasted Monday, sent Tuesday',
            'A brew card with our own recipe',
            'A bag you can compost at home',
          ],
        },
      ),
      slide(
        'signature-stat',
        {
          stat: '4 days',
          statLabel: 'from our roaster to your door, so every bag arrives at its best',
          footer: 'Always fresh',
        },
        undefined,
        ['eyebrow'],
      ),
      slide('signature-quote', {
        quote: '"The only coffee I have ordered twice in a week."',
        attribution: 'A regular since our first batch',
        footer: 'From our reviews',
      }),
      slide('signature-closing', {
        headline: 'Grab A Bag While You Can',
        body: "Order by Sunday for Tuesday's roast. Subscribers get the first bags and delivery for free.",
        cta: 'Order your first bag',
        footer: 'yourbrand.com/autumn',
      }),
    ],
  },

  rebrand: {
    category: 'announcement',
    tags: ['rebranding', 'new look', 'brand', 'identity', 'news'],
    slides: [
      slide('signature-cover', {
        eyebrow: 'Something looks different',
        headline: 'Same Team, Fresh New Look',
        subheadline:
          'After ten years we have refreshed our logo, colours and website. Here is why, and what stays as it is.',
        footer: 'The story inside',
      }),
      slide('signature-content', {
        eyebrow: 'Why now',
        headline: 'We Grew Up, Our Look Did Not',
        body: 'We started as two people in a spare room. Today we are a team of twenty, and our old look still belonged to that spare room.',
        footer: 'Ten years on',
      }),
      slide(
        'signature-list',
        { headline: 'What Changes', footer: 'Live by summer' },
        {
          list: [
            'A simpler logo for any size',
            'Brighter colours everywhere',
            'A quicker, clearer website',
            'Fully recyclable packaging',
          ],
        },
      ),
      slide('signature-content', {
        eyebrow: 'What stays the same',
        headline: 'Everything You Actually Love',
        body: 'The same people, the same prices and the same promise: if something is not right, we fix it. Only the outside has changed.',
        footer: 'Your account works as before',
      }),
      slide('signature-quote', {
        quote: '"It finally looks like who we are today."',
        attribution: 'Our founder, on the new look',
        footer: 'Made with you',
      }),
      slide('signature-closing', {
        headline: 'Tell Us What You Make Of It',
        body: 'We would love your honest first impression. Every comment is read by someone on the team.',
        cta: 'See the new website',
        footer: 'yourbrand.com',
      }),
    ],
  },

  'designer-hiring': {
    category: 'hiring',
    tags: ['hiring', 'jobs', 'careers', 'designer', 'we are hiring'],
    slides: [
      slide('signature-cover', {
        eyebrow: 'Now hiring a product designer',
        headline: 'Come And Design With Us',
        subheadline:
          'A small team, real ownership and work that thousands of people rely on every single week.',
        footer: 'Applications close 30 June',
      }),
      slide('signature-content', {
        eyebrow: 'The role',
        headline: 'Design Things People Use Daily',
        body: 'You will own the design of our app end to end, from the first sketch to the release, side by side with two engineers and a product lead.',
        footer: 'Full time, four days a week',
      }),
      slide(
        'signature-list',
        { headline: 'You Might Be A Fit If', footer: 'Degree optional' },
        {
          list: [
            'You have shipped at least one real product',
            'You sketch on paper first',
            'You like talking to the people you design for',
            'You can explain a decision in plain words',
          ],
        },
      ),
      slide('signature-quote', {
        quote: '"I shipped my first feature in week two. Nobody waits for permission here."',
        attribution: 'Designer, joined last spring',
        footer: 'Ask us anything',
      }),
      slide('signature-closing', {
        headline: 'Sound Like You?',
        body: 'Send three pieces of work you are proud of, with a few lines on why. We never ask for a cover letter.',
        cta: 'Apply in ten minutes',
        footer: 'yourbrand.com/jobs',
      }),
    ],
  },

  'founding-offer': {
    category: 'promotion',
    tags: ['offer', 'pricing', 'founding member', 'membership', 'launch offer'],
    slides: [
      slide('signature-cover', {
        eyebrow: 'Founding members only',
        headline: 'Half Price For Life, If You Join This Month',
        subheadline:
          'We are opening our doors to the first two hundred members, at a price that never goes up.',
        footer: 'Ends 31 July',
      }),
      slide(
        'signature-list',
        { headline: 'What Founding Members Get', footer: 'Cancel anytime' },
        {
          list: [
            'Every feature, old and new',
            'A direct line to the team that builds it',
            'A vote on what we build next',
            'Your name on our founders wall',
          ],
        },
      ),
      slide('signature-stat', {
        eyebrow: 'Places in total',
        stat: '200',
        statLabel: 'founding places, and when they are gone, this price is gone for good',
        footer: 'We will not run this offer again',
      }),
      slide('signature-quote', {
        quote: '"Easily the best thing I pay for each month."',
        attribution: 'Founding member, joined in week one',
        footer: 'Member reviews',
      }),
      slide('signature-closing', {
        headline: 'Claim Your Founding Place',
        body: 'Join in two minutes. Your price is locked in from the first payment, for as long as you stay with us.',
        cta: 'Become a founding member',
        footer: 'yourbrand.com/join',
      }),
    ],
  },
};

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/**
 * Each original on its home theme first (the CarouselClick look, exactly),
 * then recoloured on another signature theme. A name describes the design
 * the row makes, as the gallery shows it, and carries the art's name, which
 * keeps it apart from the pattern templates' theme-and-topic names.
 */
const ROWS: PresetRow[] = [
  // At home.
  {
    id: 'handmade-app-launch-cascade',
    name: 'Cascade App Launch',
    shape: 'app-launch',
    theme: 'nightfall',
    art: 'cascade',
  },
  {
    id: 'handmade-founder-lesson-canopy',
    name: 'Canopy Founder Notes',
    shape: 'founder-lesson',
    theme: 'nightfall',
    art: 'canopy',
  },
  {
    id: 'handmade-studio-process-tiers',
    name: 'Tiers Studio Process',
    shape: 'studio-process',
    theme: 'nightfall',
    art: 'tiers',
  },
  {
    id: 'handmade-tech-release-layered-depth',
    name: 'Facets Release Notes',
    shape: 'tech-release',
    theme: 'nightfall',
    art: 'layered-depth',
  },
  {
    id: 'handmade-demo-night-ray',
    name: 'Ray Demo Night',
    shape: 'demo-night',
    theme: 'nightfall',
    art: 'ray',
  },
  {
    id: 'handmade-creative-brief-shards',
    name: 'Shards Creative Brief',
    shape: 'creative-brief',
    theme: 'evergreen',
    art: 'shards',
  },
  {
    id: 'handmade-four-day-week-slabs',
    name: 'Slabs Four-Day Week',
    shape: 'four-day-week',
    theme: 'evergreen',
    art: 'slabs',
  },
  {
    id: 'handmade-pottery-course-drift',
    name: 'Drift Pottery Weekend',
    shape: 'pottery-course',
    theme: 'spruce',
    art: 'drift',
  },
  {
    id: 'handmade-rebrand-bloom',
    name: 'Bloom Fresh Rebrand',
    shape: 'rebrand',
    theme: 'mint',
    art: 'bloom',
  },

  // Recoloured on another signature theme. Ladder's only row is one: see the
  // file's note on why it has none at home.
  {
    id: 'handmade-year-in-numbers-ladder',
    name: 'Mint Ladder Year In Numbers',
    shape: 'year-in-numbers',
    theme: 'mint',
    art: 'ladder',
  },
  {
    id: 'handmade-designer-hiring-cascade',
    name: 'Deep Sea Cascade Hiring',
    shape: 'designer-hiring',
    theme: 'deep-sea',
    art: 'cascade',
  },
  {
    id: 'handmade-founding-offer-tiers',
    name: 'Amethyst Tiers Founding Offer',
    shape: 'founding-offer',
    theme: 'amethyst',
    art: 'tiers',
  },
  {
    id: 'handmade-autumn-blend-drift',
    name: 'Ember Drift Autumn Blend',
    shape: 'autumn-blend',
    theme: 'ember',
    art: 'drift',
  },
  {
    id: 'handmade-creative-brief-bloom',
    name: 'Sky Bloom Creative Brief',
    shape: 'creative-brief',
    theme: 'sky',
    art: 'bloom',
  },
  {
    id: 'handmade-tech-release-shards',
    name: 'Graphite Shards Release',
    shape: 'tech-release',
    theme: 'graphite',
    art: 'shards',
  },
  {
    id: 'handmade-studio-process-slabs',
    name: 'Paper Slabs Studio Process',
    shape: 'studio-process',
    theme: 'paper',
    art: 'slabs',
  },
];

export const ORIGINAL_PRESETS: Preset[] = buildPresets('signature', SHAPES, ROWS);
