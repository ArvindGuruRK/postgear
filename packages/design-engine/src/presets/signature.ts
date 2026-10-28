/**
 * The Signature collection's pattern templates: CarouselClick's look, its ten
 * generated patterns on its ten palettes, worn by carousels written the way
 * CarouselClick writes them.
 *
 * CarouselClick's gallery is every palette with every pattern, a hundred
 * looks shown as one card per pattern with a row of palettes under it
 * (`TEMPLATES` in its `src/features/templates/templates.ts`). PostGear's
 * gallery shows a template as a whole design, words included, so here a look
 * is a row: one of fourteen shapes, one signature theme and one pattern. The
 * fifty rows never wear the same theme and pattern twice, so no two cards
 * share a look, and a pattern only wears the palettes its text still reads
 * on (`LOOKS` says which). Nightfall, Evergreen and Spruce are the hand-made
 * originals' grounds, and live in `originals.ts`.
 *
 * The shapes follow CarouselClick's story flows (`SLIDE_BLOCKS` in its
 * `src/features/editor/project.ts`): a cover, a problem or an insight, a
 * framework or a checklist, a number, sometimes a quote, and a closing slide
 * with one action. So do its writing rules: short, plain and practical, one
 * idea a slide, the punch kept for the cover. The footer line is the slide's
 * own (a takeaway, a source, a nudge to swipe); on the closing slide it is
 * the link, a short address that a brand kit's CTA defaults replace.
 *
 * Every number is the brand's own (its survey, its records, its scales) and
 * every quote is credited to a role, never a person, so a user who changes
 * two words is not quoting anybody or citing a study that does not exist.
 */
import { themeById } from '../themes';
import type { Preset } from '../types';
import { buildPresets, type PresetRow, type PresetShape, slide } from './build';

// ---------------------------------------------------------------------------
// Shapes: fourteen carousels, in the gallery's category order
// ---------------------------------------------------------------------------

const SHAPES: Record<string, PresetShape> = {
  'post-planning': {
    category: 'tips',
    tags: ['content plan', 'calendar', 'marketing', 'social media', 'batching', 'schedule'],
    slides: [
      slide('signature-cover', {
        eyebrow: 'Content planning',
        headline: 'Plan A Month Of Posts In One Afternoon',
        subheadline: 'A simple routine for small teams who post in between everything else.',
        footer: 'Swipe for the plan',
      }),
      slide('signature-content', {
        eyebrow: 'The problem',
        headline: 'Posting When You Remember Fails',
        body: 'Gaps of a week or two make every post feel like starting over. People forget you, and each new post has to win them back.',
        footer: 'Gaps cost you reach',
      }),
      slide(
        'signature-list',
        { headline: 'The Afternoon In Four Steps', footer: 'Two hours in total' },
        {
          list: [
            'Pick three themes you can talk about all month',
            'Write twelve headlines before any captions',
            'Shoot every photo in one session',
            'Schedule the lot, then close the laptop',
          ],
        },
      ),
      slide('signature-stat', {
        eyebrow: 'Why it pays off',
        stat: '3x',
        statLabel: 'more comments in weeks with three posts than in weeks with just one',
        footer: 'From our own posts last year',
      }),
      slide('signature-quote', {
        quote: '"We stopped asking what to post today. The month was already written."',
        attribution: 'Owner of a neighbourhood bakery, Leeds',
        footer: 'Shared with permission',
      }),
      slide('signature-closing', {
        headline: 'Try It On Friday Afternoon',
        body: 'Block out two hours, follow the four steps and feel the difference next month.',
        cta: 'Save this for Friday',
        footer: 'yourbrand.com/plan',
      }),
    ],
  },

  'money-check-in': {
    category: 'educational',
    tags: ['money', 'budget', 'finance', 'savings', 'personal finance', 'checklist'],
    slides: [
      slide('signature-cover', {
        eyebrow: 'Money basics',
        headline: 'The 20-Minute Money Check-In',
        subheadline:
          'One short sit-down a month stops small leaks from turning into big surprises.',
        footer: 'Swipe for the steps',
      }),
      slide('signature-content', {
        eyebrow: 'Why monthly',
        headline: 'Small Leaks Are Easy To Miss',
        body: 'A forgotten subscription or a creeping bill rarely hurts in a single month. Over a year, it quietly adds up to a weekend away.',
        footer: 'Look once a month',
      }),
      slide(
        'signature-list',
        { headline: 'What To Check Each Month', footer: 'Twenty minutes and a cup of tea' },
        {
          list: [
            'Money in against money out',
            'Subscriptions you no longer use',
            'Bills that went up without notice',
            'One amount to move into savings',
          ],
        },
      ),
      slide('signature-stat', {
        eyebrow: 'Worth the time',
        stat: '£240',
        statLabel: 'a year was the average our readers found in unused subscriptions',
        footer: 'From our reader survey this spring',
      }),
      slide('signature-closing', {
        headline: 'Book Your First Check-In Today',
        body: 'Pick a date at the start of next month and put it in your calendar now.',
        cta: 'Download the checklist',
        footer: 'yourbrand.com/money',
      }),
    ],
  },

  'spring-menu': {
    category: 'announcement',
    tags: ['menu', 'food', 'restaurant', 'cafe', 'launch', 'seasonal'],
    slides: [
      slide('signature-cover', {
        eyebrow: 'New this season',
        headline: 'Our Spring Menu Starts On Monday',
        subheadline: 'Six new dishes built around what local growers are picking this month.',
        footer: 'Swipe for a first look',
      }),
      slide('signature-content', {
        eyebrow: 'What is new',
        headline: 'Lighter Plates, Brighter Flavours',
        body: 'We swapped the winter stews for fresh greens, grilled fish and herbs from a farm twenty minutes down the road.',
        footer: 'Picked this week, cooked today',
      }),
      slide(
        'signature-list',
        { headline: 'Start With These Four Dishes', footer: 'Vegetarian options on every page' },
        {
          list: [
            'Charred spring greens with lemon and feta',
            'Grilled trout with new potatoes and herbs',
            'Pea and mint soup with warm sourdough',
            'Rhubarb crumble with vanilla custard',
          ],
        },
      ),
      slide('signature-stat', {
        eyebrow: 'Close to home',
        stat: '20 miles',
        statLabel: 'is as far as most of our spring produce travels before it reaches your plate',
        footer: 'From our suppliers',
      }),
      slide('signature-quote', {
        quote: '"The pea soup alone is worth the trip. We booked again before we left."',
        attribution: 'A guest at our spring tasting night',
        footer: 'Join a tasting night',
      }),
      slide('signature-closing', {
        headline: 'Book A Table For Opening Week',
        body: 'Tables go quickly in the first week, so reserve yours early.',
        cta: 'Book your table',
        footer: 'yourbrand.com/menu',
      }),
    ],
  },

  'app-update': {
    category: 'product',
    tags: ['product', 'update', 'release notes', 'software', 'app', 'features'],
    slides: [
      slide('signature-cover', {
        eyebrow: 'Product update',
        headline: 'Offline Mode, Faster Search And A Calmer Inbox',
        subheadline: 'Everything we shipped this month, and why each change matters for your day.',
        footer: 'Swipe for details',
      }),
      slide('signature-content', {
        eyebrow: 'New',
        headline: 'Work Without A Connection',
        body: 'Edit, comment and plan on a train or a plane. Everything syncs the moment you are back online.',
        footer: 'Nothing gets lost',
      }),
      slide('signature-content', {
        eyebrow: 'Improved',
        headline: 'Search That Finds It First Time',
        body: 'Results now match the words inside files and comments as well as titles, with the best match at the top.',
        footer: 'Type less, find more',
      }),
      slide(
        'signature-list',
        { headline: 'Also In This Release', footer: 'Update to try them' },
        {
          list: [
            'Quiet hours that hold alerts until morning',
            'Dark mode on every screen',
            'Shortcuts for the actions you use most',
            'Faster loading on older phones',
          ],
        },
      ),
      slide('signature-stat', {
        eyebrow: 'Faster',
        stat: '2x',
        statLabel:
          'quicker to open on the phones our customers use most, measured across our beta group',
        footer: 'From our beta group this month',
      }),
      slide('signature-closing', {
        headline: 'Update Today And Try Them All',
        body: 'The new version is rolling out now on every device.',
        cta: 'Read the release notes',
        footer: 'yourbrand.com/new',
      }),
    ],
  },

  'client-stories': {
    category: 'quote',
    tags: ['testimonial', 'coaching', 'clients', 'review', 'social proof', 'results'],
    slides: [
      slide('signature-cover', {
        eyebrow: 'Client stories',
        headline: 'What Six Weeks Of Coaching Changed For Them',
        subheadline: 'Three clients, three different goals, in their own words.',
        footer: 'Swipe to read them',
      }),
      slide('signature-quote', {
        quote: '"I stopped saying yes to everything. My week finally has room in it."',
        attribution: 'First-time team manager',
        footer: 'The goal was a calmer week',
      }),
      slide('signature-quote', {
        quote: '"I had the idea for years. Six weeks later, I had my first paying client."',
        attribution: 'Founder of a small design studio',
        footer: 'The goal was a paying client',
      }),
      slide('signature-quote', {
        quote: '"We used to argue about every decision. Now we have a way to decide."',
        attribution: 'Co-owners of a family restaurant',
        footer: 'The goal was one shared plan',
      }),
      slide('signature-stat', {
        eyebrow: 'Across our clients',
        stat: '9 in 10',
        statLabel: 'reached the goal they set in their first session within six weeks',
        footer: 'From our client reviews, 2025',
      }),
      slide('signature-closing', {
        headline: 'What Will You Change First?',
        body: 'Book a free 20-minute call and leave with one clear next step.',
        cta: 'Book a free call',
        footer: 'yourbrand.com/coaching',
      }),
    ],
  },

  'packing-list': {
    category: 'listicle',
    tags: ['travel', 'packing', 'carry-on', 'list', 'holiday', 'city break'],
    slides: [
      slide('signature-cover', {
        eyebrow: 'Travel light',
        headline: 'Pack A Whole Week In One Bag',
        subheadline: 'The list we use for city breaks, work trips and everything in between.',
        footer: 'Swipe for the list',
      }),
      slide('signature-content', {
        eyebrow: 'The problem',
        headline: 'We Pack Clothes We Never Wear',
        body: 'Outfits for every maybe add weight, slow you down at the airport and still leave you wearing the same three things.',
        footer: 'Pack for the plan you have',
      }),
      slide(
        'signature-list',
        { headline: 'The One-Bag Packing List', footer: 'Wear the bulky layers to travel' },
        {
          list: [
            'Three tops and two bottoms that all match',
            'One layer for rain and cool evenings',
            'Shoes you can walk in all day',
            'Toiletries in a single clear pouch',
          ],
        },
      ),
      slide('signature-content', {
        eyebrow: 'The trick',
        headline: 'Plan Every Outfit Before You Pack',
        body: 'Lay out each day before you pack. If a piece only goes with one other thing, it stays at home.',
        footer: 'Every piece earns its place',
      }),
      slide('signature-stat', {
        eyebrow: 'On the scales',
        stat: '7 kg',
        statLabel: 'is all the list weighs once packed, light enough for most cabin bag limits',
        footer: 'Weighed at the airport',
      }),
      slide('signature-closing', {
        headline: 'Travel Lighter On Your Next Trip',
        body: 'Tick it off the night before you go, and leave the extras at home.',
        cta: 'Save the list',
        footer: 'yourbrand.com/pack',
      }),
    ],
  },

  'waste-audit': {
    category: 'statistic',
    tags: ['sustainability', 'waste', 'data', 'numbers', 'cafe', 'environment'],
    slides: [
      slide('signature-cover', {
        eyebrow: 'Our waste audit',
        headline: 'We Weighed Every Bin For A Month',
        subheadline: 'Here is what we threw away, and the three changes that cut it by a third.',
        footer: 'Swipe for the data',
      }),
      slide('signature-stat', {
        eyebrow: 'Number one',
        stat: '42%',
        statLabel: 'of our food waste was bread and pastries still on the shelf at closing time',
        footer: 'Weighed every day',
      }),
      slide('signature-stat', {
        eyebrow: 'Number two',
        stat: '1 in 4',
        statLabel: 'customers brought a reusable cup once we offered a small discount',
        footer: 'Up from 1 in 20',
      }),
      slide(
        'signature-list',
        { headline: 'The Three Changes That Worked', footer: 'Small changes, every day' },
        {
          list: [
            'Baking smaller batches after 2pm',
            'Selling the last pastries at half price',
            'Giving what is left to a local food bank',
          ],
        },
      ),
      slide('signature-stat', {
        eyebrow: 'The result',
        stat: '33%',
        statLabel: 'less waste by weight in the second month, and lower ingredient bills too',
        footer: 'Measured over eight weeks',
      }),
      slide('signature-closing', {
        headline: 'Run Your Own Waste Audit',
        body: 'All you need is a kitchen scale, a notebook and one honest month of weighing.',
        cta: 'Get our audit sheet',
        footer: 'yourbrand.com/waste',
      }),
    ],
  },

  'shop-case-study': {
    category: 'case-study',
    tags: ['case study', 'retail', 'shop', 'results', 'online orders', 'small business'],
    slides: [
      slide('signature-cover', {
        eyebrow: 'Case study',
        headline: 'How A Small Gift Shop Doubled Its Online Orders',
        subheadline: 'Four changes over one season, made by a team of three.',
        footer: 'See what changed',
      }),
      slide('signature-content', {
        eyebrow: 'The problem',
        headline: 'A Busy Shop With A Quiet Website',
        body: 'Weekends in the shop were full, but the website sold almost nothing. Most visitors left without looking past the first page.',
        footer: 'Gone after page one',
      }),
      slide(
        'signature-list',
        { headline: 'What They Changed', footer: 'Done in one season' },
        {
          list: [
            'Real photos of every product, taken in store',
            'Prices and delivery dates on the first screen',
            'A gift note option at checkout',
            'One email a month with new arrivals',
          ],
        },
      ),
      slide('signature-stat', {
        eyebrow: 'The result',
        stat: '+112%',
        statLabel: 'online orders after three months, with the same team and the same stock',
        footer: 'Figures shared by the owner',
      }),
      slide('signature-quote', {
        quote: '"Customers already loved the shop. The website just had to look like it."',
        attribution: 'Owner of a gift shop, Bristol',
        footer: 'A client of ours',
      }),
      slide('signature-closing', {
        headline: 'Want The Same For Your Shop?',
        body: 'We share one real case study every month, with the numbers.',
        cta: 'Follow for the next one',
        footer: 'yourbrand.com/stories',
      }),
    ],
  },

  'fitness-offer': {
    category: 'promotion',
    tags: ['offer', 'fitness', 'gym', 'studio', 'membership', 'discount'],
    slides: [
      slide('signature-cover', {
        eyebrow: 'New members offer',
        headline: 'Your First Month Is Half Price',
        subheadline: 'Classes for every level, from first-timers to regulars, all month long.',
        footer: 'Offer ends 31 March',
      }),
      slide(
        'signature-list',
        { headline: 'What Your Month Includes', footer: 'Bring a friend free' },
        {
          list: [
            'Unlimited classes, seven days a week',
            'A one-to-one session to set your goals',
            'Towels, lockers and showers on site',
            'An app to book and track your classes',
          ],
        },
      ),
      slide('signature-content', {
        eyebrow: 'New to training?',
        headline: 'Start Where You Are Today',
        body: 'Every class has an easier and a harder option, and our coaches show both. Nobody expects you to keep up at first.',
        footer: 'All levels welcome',
      }),
      slide('signature-stat', {
        eyebrow: 'Why a month',
        stat: '4 weeks',
        statLabel: 'is how long most of our new members take to settle into a routine they keep',
        footer: 'From our records',
      }),
      slide('signature-quote', {
        quote: '"I came for the offer and stayed for the people. Two years on, I still go."',
        attribution: 'Member since our first year',
        footer: 'Our members, in their words',
      }),
      slide('signature-closing', {
        headline: 'Claim Your Half-Price First Month',
        body: 'Sign up online or at the front desk before the offer closes.',
        cta: 'Claim the offer',
        footer: 'yourbrand.com/join',
      }),
    ],
  },

  'learning-journey': {
    category: 'story',
    tags: ['learning', 'journey', 'habits', 'language', 'education', 'personal story'],
    slides: [
      slide('signature-cover', {
        eyebrow: 'One year on',
        headline: 'What Twenty Minutes A Day Taught Me',
        subheadline:
          'I wanted to learn a language without giving up my evenings. This is how the year went.',
        footer: 'Swipe for the story',
      }),
      slide('signature-content', {
        eyebrow: 'Month one',
        headline: 'I Almost Quit In The First Week',
        body: 'I planned an hour a night and missed four nights in a row. Twenty minutes felt too small to matter, so I tried it anyway.',
        footer: 'Small beats ambitious',
      }),
      slide('signature-content', {
        eyebrow: 'Month six',
        headline: 'The Daily Streak Did The Work',
        body: 'Some days it was ten tired minutes on the bus. Showing up every day kept the words fresh, and the minutes added up.',
        footer: 'Showing up wins',
      }),
      slide('signature-stat', {
        eyebrow: 'The total',
        stat: '7,300',
        statLabel: 'minutes of practice in one year, and not a single evening given up for it',
        footer: 'Twenty minutes, every day',
      }),
      slide('signature-quote', {
        quote: '"You do not need more time. You need a time that is already yours."',
        attribution: 'Advice from my first teacher',
        footer: 'Mine is the 8am bus',
      }),
      slide('signature-closing', {
        headline: 'Start Your Twenty Minutes Tomorrow',
        body: 'Pick the subject, pick the time of day, and keep the streak going for one week.',
        cta: 'Follow the journey',
        footer: 'yourbrand.com/learn',
      }),
    ],
  },

  'makers-market': {
    category: 'event',
    tags: ['event', 'market', 'community', 'invite', 'local', 'weekend'],
    slides: [
      slide('signature-cover', {
        eyebrow: 'You are invited',
        headline: 'The Makers Market Is Back This Saturday',
        subheadline: 'Forty local stalls, live music and hot food, from ten until four.',
        footer: 'Free entry, all day',
      }),
      slide(
        'signature-list',
        { headline: 'What To Look For', footer: 'Bring your own bag' },
        {
          list: [
            'Handmade ceramics, prints and jewellery',
            'Street food from six local kitchens',
            'A craft corner for children from 11am',
            'Live acoustic sets every hour',
          ],
        },
      ),
      slide('signature-content', {
        eyebrow: 'Getting there',
        headline: 'Walk, Cycle Or Take The Train',
        body: 'The market is a five-minute walk from the station, and there is secure bike parking by the main entrance.',
        footer: 'Bike racks on site',
      }),
      slide('signature-stat', {
        eyebrow: 'Last time',
        stat: '3,000',
        statLabel: 'visitors came to our last market, so arrive early for the best pick',
        footer: 'Counted at the gate last year',
      }),
      slide('signature-quote', {
        quote: '"Our busiest day of the year, and the friendliest crowd we sell to."',
        attribution: 'Potter, stallholder for five years',
        footer: 'Meet the makers',
      }),
      slide('signature-closing', {
        headline: 'See You On Saturday',
        body: 'Save the date, tell a friend and leave a little extra room in your bag.',
        cta: 'Add it to your calendar',
        footer: 'yourbrand.com/market',
      }),
    ],
  },

  'store-hiring': {
    category: 'hiring',
    tags: ['hiring', 'jobs', 'careers', 'retail', 'manager', 'we are hiring'],
    slides: [
      slide('signature-cover', {
        eyebrow: 'We are hiring',
        headline: 'Join Us As Our Next Store Manager',
        subheadline: 'A full-time role leading a friendly team of eight in our busiest shop.',
        footer: 'Applications close 30 June',
      }),
      slide('signature-content', {
        eyebrow: 'The role',
        headline: 'Lead A Team People Want To Join',
        body: 'You will plan the rota, coach new starters and keep the shop running smoothly on the busiest days of the year.',
        footer: 'Five days a week',
      }),
      slide(
        'signature-list',
        { headline: 'What We Are Looking For', footer: 'We teach the rest' },
        {
          list: [
            'Two years leading a team in retail',
            'Calm on the busiest Saturday of the year',
            'Clear, kind feedback that helps people grow',
            'A real interest in what we sell',
          ],
        },
      ),
      slide('signature-stat', {
        eyebrow: 'Why people stay',
        stat: '6 years',
        statLabel:
          'is how long our team stays with us on average, and most of our managers started on the shop floor',
        footer: 'From our records',
      }),
      slide('signature-quote', {
        quote: '"I started on the till. Now I run the shop and train every new starter."',
        attribution: 'Store manager, Manchester',
        footer: 'Promoted in-house',
      }),
      slide('signature-closing', {
        headline: 'Apply By 30 June',
        body: 'Send your CV and a short note about you. We reply to everyone within a week.',
        cta: 'Apply in two minutes',
        footer: 'yourbrand.com/jobs',
      }),
    ],
  },

  'sleep-habits': {
    category: 'tips',
    tags: ['sleep', 'wellness', 'habits', 'health', 'routine', 'evening'],
    slides: [
      slide('signature-cover', {
        eyebrow: 'Sleep better',
        headline: '4 Small Habits For Better Sleep',
        subheadline: 'Changes you can make this evening, without buying a thing.',
        footer: 'Swipe for all four',
      }),
      slide(
        'signature-list',
        { headline: 'Your Last Hour Of The Day', footer: 'Pick one for tonight' },
        {
          list: [
            'Dim the lights an hour before bed',
            'Charge your phone outside the bedroom',
            'Keep the room cool, dark and quiet',
            'Go to bed at the same time each night',
          ],
        },
      ),
      slide('signature-content', {
        eyebrow: 'Why it works',
        headline: 'Routine Helps You Wind Down',
        body: 'Going to bed at the same time each night teaches your body when to rest, so falling asleep takes less effort.',
        footer: 'Same time, nightly',
      }),
      slide('signature-stat', {
        eyebrow: 'What changed',
        stat: '8 in 10',
        statLabel:
          'of our members said they slept better within two weeks of keeping a set bedtime',
        footer: 'From our member check-in, May',
      }),
      slide('signature-closing', {
        headline: 'Which Habit Will You Try First?',
        body: 'Start with one this week, then add another once it feels easy.',
        cta: 'Save this for tonight',
        footer: 'yourbrand.com/sleep',
      }),
    ],
  },

  'viewing-checklist': {
    category: 'educational',
    tags: ['property', 'home buying', 'house viewing', 'checklist', 'real estate', 'first home'],
    slides: [
      slide('signature-cover', {
        eyebrow: 'Buying a home',
        headline: 'Before You Fall For That House',
        subheadline: 'Twenty minutes of looking past the furniture can save months of regret.',
        footer: 'See the checklist',
      }),
      slide('signature-content', {
        eyebrow: 'The trap',
        headline: 'Good Staging Hides Real Problems',
        body: 'Fresh paint, soft lighting and a bowl of lemons are there to make you feel at home. Look past all of it.',
        footer: 'Look up, look down, open things',
      }),
      slide(
        'signature-list',
        { headline: 'Check These At Every Viewing', footer: 'Take lots of photos' },
        {
          list: [
            'Damp patches on ceilings and in corners',
            'Water pressure in the shower and kitchen',
            'The age of the boiler and the windows',
            'Street noise at the busiest time of day',
          ],
        },
      ),
      slide('signature-stat', {
        eyebrow: 'Go back twice',
        stat: '1 in 3',
        statLabel:
          'of the buyers we helped last year spotted a problem on a second viewing that they missed on the first',
        footer: 'Once in daylight, once after dark',
      }),
      slide('signature-closing', {
        headline: 'Get The Full Checklist',
        body: 'Thirty points to tick off on your phone as you walk round.',
        cta: 'Save the checklist',
        footer: 'yourbrand.com/viewing',
      }),
    ],
  },
};

// ---------------------------------------------------------------------------
// Rows: one shape, one signature theme, one pattern
// ---------------------------------------------------------------------------

/** The second half of a card's name, by shape; the first is the theme's name. */
const TOPICS: Record<string, string> = {
  'post-planning': 'Post Planning',
  'money-check-in': 'Money Check-In',
  'spring-menu': 'Spring Menu',
  'app-update': 'App Update',
  'client-stories': 'Client Stories',
  'packing-list': 'Packing List',
  'waste-audit': 'Waste Audit',
  'shop-case-study': 'Shop Case Study',
  'fitness-offer': 'Fitness Offer',
  'learning-journey': 'Learning Journey',
  'makers-market': 'Makers Market',
  'store-hiring': 'Store Hiring',
  'sleep-habits': 'Sleep Habits',
  'viewing-checklist': 'Viewing Checklist',
};

/**
 * The gallery's looks: under each shape, the themes it wears and the pattern
 * under each. A theme wears a shape once and no theme and pattern pair
 * repeats, so the fifty cards are fifty different looks. A row's id is
 * `signature-<shape>-<theme>`, its name the theme's name and the topic.
 *
 * The spread is uneven on purpose. The patterns draw right where the text
 * sits, and `presets.browser.spec.ts` wants 95% of the pixels behind every
 * line, in every format, to clear AA, so a pattern wears only the grounds
 * its text reads on:
 *
 * - Waves runs its crest through the closing link and the square footers,
 *   and only Mint's pale ground keeps them legible: one row.
 * - Halftone's dots crowd the landscape body on every dark ground and on
 *   Paper: Mint and Sky only.
 * - Amethyst reads over arcs, prism, planes and the plain ground, nothing
 *   else, so it wears four rows and Graphite six.
 * - Aurora is too bright behind the eyebrow on Forest, Deep Sea, Amethyst,
 *   Mint and Sky (on the last two even at their 5:1 primary), beams fail on
 *   Forest, Nocturne, Deep Sea, Amethyst and Graphite, and glass on Forest
 *   and Amethyst; none of those pairs is here.
 */
const LOOKS: Record<string, ReadonlyArray<readonly [theme: string, art: string]>> = {
  'post-planning': [
    ['sky', 'halftone'],
    ['lagoon', 'horizon'],
    ['forest', 'arcs'],
  ],
  'money-check-in': [
    ['ember', 'minimal'],
    ['deep-sea', 'arcs'],
    ['nocturne', 'glass'],
  ],
  'spring-menu': [
    ['ember', 'arcs'],
    ['forest', 'minimal'],
    ['graphite', 'planes'],
    ['mint', 'horizon'],
  ],
  'app-update': [
    ['nocturne', 'minimal'],
    ['deep-sea', 'glass'],
    ['sky', 'planes'],
    ['graphite', 'aurora'],
  ],
  'client-stories': [
    ['paper', 'prism'],
    ['deep-sea', 'horizon'],
    ['mint', 'beams'],
    ['amethyst', 'planes'],
  ],
  'packing-list': [
    ['lagoon', 'prism'],
    ['ember', 'horizon'],
    ['sky', 'beams'],
    ['deep-sea', 'minimal'],
  ],
  'waste-audit': [
    ['forest', 'planes'],
    ['lagoon', 'glass'],
    ['mint', 'halftone'],
    ['paper', 'beams'],
  ],
  'shop-case-study': [
    ['ember', 'prism'],
    ['paper', 'minimal'],
    ['mint', 'glass'],
    ['forest', 'horizon'],
  ],
  'fitness-offer': [
    ['ember', 'beams'],
    ['lagoon', 'arcs'],
    ['graphite', 'horizon'],
    ['mint', 'waves'],
  ],
  'learning-journey': [
    ['amethyst', 'arcs'],
    ['forest', 'prism'],
    ['deep-sea', 'planes'],
    ['paper', 'horizon'],
  ],
  'makers-market': [
    ['sky', 'prism'],
    ['nocturne', 'arcs'],
    ['amethyst', 'minimal'],
    ['graphite', 'glass'],
  ],
  'store-hiring': [
    ['lagoon', 'planes'],
    ['graphite', 'prism'],
    ['nocturne', 'aurora'],
    ['sky', 'glass'],
  ],
  'sleep-habits': [
    ['nocturne', 'horizon'],
    ['amethyst', 'prism'],
  ],
  'viewing-checklist': [
    ['paper', 'planes'],
    ['graphite', 'minimal'],
  ],
};

const ROWS: PresetRow[] = Object.entries(LOOKS).flatMap(([shape, looks]) =>
  looks.map(([theme, art]) => ({
    id: `signature-${shape}-${theme}`,
    name: `${themeById(theme).name} ${TOPICS[shape]}`,
    shape,
    theme,
    art,
  })),
);

export const SIGNATURE_PRESETS: Preset[] = ROWS.flatMap((row) =>
  buildPresets('signature', SHAPES, [row]),
);
