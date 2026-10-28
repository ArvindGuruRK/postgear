/**
 * The Luxury collection: the premium themes and art, worn by the carousels a
 * jeweller, a five-star hotel, a fashion house or a fine restaurant posts.
 *
 * Fifteen shapes, one per occasion (a collection launch, a piece made to
 * order, a tasting menu, a fragrance, a spa ritual, a lookbook, a vintage, a
 * guest book, an interiors project, a house for sale, a membership, an
 * atelier, a private evening, a wedding, an apprenticeship), each worn by two
 * or three of the luxury themes over a luxury art style or none. Every theme
 * appears three or four times, every art style four times, and a handful of
 * rows carry no art at all, because pure type on a deep ground can be the
 * most luxurious slide in the set.
 *
 * ## How the copy is written
 *
 * Luxury is restraint, so every slot holds fewer words than its layout
 * allows: a headline of a few words, a sentence or two of body, a list of
 * four or five. The words are quiet and specific ("Forty hours each", "1,200
 * bottles, each one numbered by hand") rather than loud, every number is the
 * house's own, and every quote is credited to a role ("A client since
 * 2014"), never to a person, a house or a place anybody could look up.
 *
 * Headlines are either short enough to stand on one line (about seventeen
 * characters) or long enough to break into two even lines. The luxury serifs
 * are set large, so a headline of twenty-odd characters breaks one word
 * short and leaves it alone on the second line, which a fine house would
 * never print. Gilded Noir's Cinzel (all capitals) and Vow's Allura (a
 * script) want the shortest lines of all, so the shapes they wear keep to
 * the one-line kind.
 *
 * As in the rest of the library, the logo, the brand name, the handle and the
 * slide numbers belong to the design, not the sample. The Signature closing
 * slide's Link line is the one address written here, and it reads
 * "yourbrand.com" on purpose, the way the sample handle reads "@yourbrand":
 * something every user replaces on sight. Most shapes add a page to it
 * ("yourbrand.com/visit"); the three worn over Art Deco keep the bare
 * address, so the line ends before the sunburst's arcs begin.
 */
import type { Preset } from '../types';
import { buildPresets, type PresetShape, slide } from './build';

// ---------------------------------------------------------------------------
// Shapes: fifteen occasions, in the Signature frame or the classic layouts
// ---------------------------------------------------------------------------

const SHAPES: Record<string, PresetShape> = {
  'collection-launch': {
    category: 'announcement',
    tags: ['collection', 'launch', 'fashion', 'new season', 'atelier', 'luxury'],
    slides: [
      slide('signature-cover', {
        eyebrow: 'The autumn collection',
        headline: 'Made To Last',
        subheadline: 'Twelve pieces, each one cut, sewn and signed in our own atelier.',
        footer: 'From 1 October',
      }),
      slide('signature-content', {
        eyebrow: 'The idea',
        headline: 'Fewer, Finer',
        body: 'A wardrobe to keep for decades, not a season. Every piece is cut from cloth woven for us in one small mill.',
        footer: 'Twelve pieces only',
      }),
      slide(
        'signature-list',
        { headline: 'Why It Lasts', footer: 'Sewn by hand' },
        {
          list: [
            'Wool and silk woven to our own weight',
            'Horn buttons, sewn on by hand',
            'Seams finished inside as well as out',
            'Each piece signed inside the collar',
          ],
        },
      ),
      slide('signature-quote', {
        quote: '“The first collection I would wear every day.”',
        attribution: 'A client since 2014',
        footer: 'By appointment',
      }),
      slide('signature-closing', {
        headline: 'See It In Person',
        body: 'The collection is shown by appointment, one client at a time, with tea and no hurry.',
        cta: 'Book a private viewing',
        footer: 'yourbrand.com/visit',
      }),
    ],
  },

  'jewellery-release': {
    category: 'product',
    tags: ['jewellery', 'jeweller', 'ring', 'gold', 'new piece', 'made to order'],
    slides: [
      slide('cover-headline', {
        eyebrow: 'New from the atelier',
        headline: 'Engraved By Hand',
        subheadline:
          'A signet ring in recycled gold, cast in our workshop and engraved to your initials.',
      }),
      slide('content-eyebrow', {
        eyebrow: 'The craft',
        headline: 'Forty Hours Each',
        body: 'Every ring is carved in wax, cast, then engraved by one hand from first cut to last polish. No two are ever quite alike.',
      }),
      slide(
        'list-ticks',
        { eyebrow: 'The details', headline: 'Worn Every Day' },
        {
          list: [
            'Recycled 18 carat gold, hallmarked',
            'Up to three initials, engraved by hand',
            'Sized to your hand at a private fitting',
            'Polished again, free, for life',
          ],
        },
      ),
      slide('stat-big', {
        eyebrow: 'One at a time',
        stat: '6 weeks',
        statLabel: 'from your fitting to the finished ring',
        body: 'Each one is made to order. Nothing waits in a drawer.',
      }),
      slide('closing-cta', {
        headline: 'Made For You Alone',
        subheadline: 'Fittings are held at the atelier, by appointment.',
        cta: 'Book a fitting',
      }),
    ],
  },

  'tasting-menu': {
    category: 'product',
    tags: ['restaurant', 'tasting menu', 'fine dining', 'chef', 'menu', 'dinner'],
    slides: [
      slide('cover-headline', {
        eyebrow: 'The autumn menu',
        headline: 'Seven Courses',
        subheadline:
          'Our new tasting menu, served at one seating a night from the first of October.',
      }),
      slide(
        'list-numbered',
        { headline: 'From The Menu' },
        {
          list: [
            'Oyster, green apple and dill',
            'Scallop, brown butter and hazelnut',
            'Wild mushroom tea, three days in the making',
            'Lamb, smoked over vine cuttings',
            'Pear, honey and a little thyme',
          ],
        },
      ),
      slide('quote-centre', {
        quote: '“We cook only what grows within an hour of here.”',
        attribution: 'Our head chef',
      }),
      slide('stat-split', {
        stat: '22',
        statLabel: 'seats, one sitting',
        headline: 'Never Rushed',
        body: 'Everyone is seated at eight and served together, so nobody is hurried and nothing waits.',
      }),
      slide('closing-band', {
        headline: 'Reserve Your Table',
        subheadline: 'Bookings open on the first of each month, for the month ahead.',
        cta: 'Reserve a table',
      }),
    ],
  },

  'fragrance-notes': {
    category: 'educational',
    tags: ['fragrance', 'perfume', 'scent', 'notes', 'perfumer', 'how to'],
    slides: [
      slide('signature-cover', {
        eyebrow: 'Reading a fragrance',
        headline: 'Notes On Scent',
        subheadline: 'Every fragrance is written in three movements. Here is how to hear each one.',
        footer: 'Top, heart and base',
      }),
      slide('signature-content', {
        eyebrow: 'The top notes',
        headline: 'The Opening',
        body: 'Citrus, herbs and light spice. Bright and quick to fade, they are the greeting, not the conversation.',
        footer: 'Bergamot, neroli',
      }),
      slide('signature-content', {
        eyebrow: 'The heart',
        headline: 'All Day Long',
        body: 'Flowers, woods and resins open as the top notes lift. This is the fragrance itself, and it lasts for hours.',
        footer: 'Iris, rose, cedar',
      }),
      slide('signature-content', {
        eyebrow: 'The base',
        headline: 'The Last To Leave',
        body: 'Musk, amber and vetiver settle last and stay longest, often until the next morning.',
        footer: 'Vetiver, musk',
      }),
      slide(
        'signature-list',
        { headline: 'How To Wear It', footer: 'From our perfumers' },
        {
          list: [
            'On the skin, never on the clothes',
            'Wrist, neck and the inside of the elbow',
            'Do not rub; let it settle on its own',
            'Keep the bottle out of light and heat',
          ],
        },
      ),
      slide('signature-closing', {
        headline: 'Find Yours',
        body: 'Our perfumers will guide you through the collection, one scent at a time.',
        cta: 'Book a scent consultation',
        footer: 'yourbrand.com/scent',
      }),
    ],
  },

  'spa-ritual': {
    category: 'tips',
    tags: ['spa', 'ritual', 'wellness', 'self care', 'evening', 'routine'],
    slides: [
      slide('cover-headline', {
        eyebrow: 'The evening ritual',
        headline: 'A Slower Evening',
        subheadline: 'Five steps from our spa, made for the bathroom at home.',
      }),
      slide(
        'list-steps',
        { headline: 'The Ritual' },
        {
          list: [
            'Dim the lights and warm the room',
            'Bathe for twenty minutes with a handful of salts',
            'Massage in oil while the skin is still warm',
            'Wrap up and drink a tall glass of water',
            'Sleep within the hour, phone in another room',
          ],
        },
      ),
      slide('content-eyebrow', {
        eyebrow: 'Why it works',
        headline: 'Warmth Tells The Body To Rest',
        body: 'As the body cools after a warm bath, it reads the change as evening. Sleep comes more easily, and stays longer.',
      }),
      slide('quote-centre', {
        quote: '“The one hour of the week that belongs only to me.”',
        attribution: 'A guest of the spa',
      }),
      slide('closing-cta', {
        headline: 'Leave It To Us',
        subheadline:
          'The full ritual takes ninety minutes at our spa, with tea in the garden after.',
        cta: 'Book the ritual',
      }),
    ],
  },

  lookbook: {
    category: 'listicle',
    tags: ['lookbook', 'fashion', 'style', 'edit', 'wardrobe', 'season'],
    slides: [
      slide('cover-headline', {
        eyebrow: 'The lookbook',
        headline: 'Six Pieces For The Season',
        subheadline:
          'Chosen to work together, from the first cold morning to the last party of the year.',
      }),
      slide(
        'list-numbered',
        { headline: 'The Edit' },
        {
          list: [
            'A long coat in undyed camel hair',
            'A cashmere roll-neck in ivory',
            'Wide trousers in charcoal flannel',
            'A silk shirt that goes under everything',
            'Loafers in dark brown suede',
            'One good bag, in black leather',
          ],
        },
      ),
      slide('content-eyebrow', {
        eyebrow: 'How to wear it',
        headline: 'Start With The Coat',
        body: 'Everything else in the edit was chosen to sit beneath it. Buy the coat first, then add a piece each season.',
      }),
      slide('split-panel', {
        eyebrow: 'Our promise',
        headline: 'For Life',
        body: 'Bring back any piece from the edit and our tailors will repair it, for as long as you own it.',
        subheadline: 'Repairs are free, always.',
      }),
      slide('closing-band', {
        headline: 'Try The Edit In Store',
        subheadline: 'Our stylists will set the six pieces aside in your size.',
        cta: 'Book a styling hour',
      }),
    ],
  },

  'vintage-release': {
    category: 'statistic',
    tags: ['wine', 'vintage', 'winery', 'release', 'harvest', 'cellar'],
    slides: [
      slide('signature-cover', {
        eyebrow: 'The 2019 vintage',
        headline: 'Worth The Wait',
        subheadline: 'Five years in the cellar, released this autumn in a single bottling.',
        footer: 'From 1 November',
      }),
      slide('signature-stat', {
        eyebrow: 'The harvest',
        stat: '9 days',
        statLabel: 'to pick every row by hand, at first light, as each bunch came ready',
        footer: 'Picked by hand',
      }),
      slide('signature-stat', {
        eyebrow: 'The cellar',
        stat: '28',
        statLabel: 'months in old oak, so the wood shapes the wine without flavouring it',
        footer: 'Aged in old oak',
      }),
      slide('signature-stat', {
        eyebrow: 'The release',
        stat: '1,200',
        statLabel: 'bottles, each one numbered by hand, and not one more',
        footer: 'Numbered by hand',
      }),
      slide('signature-closing', {
        headline: 'Reserve Your Case',
        body: 'Members are offered the vintage first, a case at a time, from 1 November.',
        cta: 'Request an allocation',
        footer: 'yourbrand.com',
      }),
    ],
  },

  'hotel-guests': {
    category: 'quote',
    tags: ['hotel', 'guests', 'testimonial', 'reviews', 'hospitality', 'stay'],
    slides: [
      slide('signature-cover', {
        eyebrow: 'From the guest book',
        headline: 'Kind Words',
        subheadline: 'A few lines left at the front desk this summer, shared with permission.',
        footer: 'Twelve rooms only',
      }),
      slide('signature-quote', {
        quote: '“We came for two nights and stayed for six.”',
        attribution: 'A first visit, in June',
        footer: 'The garden suite',
      }),
      slide('signature-quote', {
        quote: '“We slept late. We ate well. We will be back.”',
        attribution: 'A returning guest',
        footer: 'The tower room',
      }),
      slide('signature-quote', {
        quote: '“Every wish was met. We never once had to ask.”',
        attribution: 'A couple on honeymoon',
        footer: 'The library suite',
      }),
      slide('signature-closing', {
        headline: 'Stay With Us',
        body: 'Twelve rooms, a walled garden and a kitchen that cooks to the season.',
        cta: 'Reserve a room',
        footer: 'yourbrand.com/stay',
      }),
    ],
  },

  'interior-portfolio': {
    category: 'case-study',
    tags: ['interiors', 'interior design', 'portfolio', 'restoration', 'project', 'home'],
    slides: [
      slide('cover-headline', {
        eyebrow: 'From the portfolio',
        headline: 'A Townhouse, Restored',
        subheadline: 'Five storeys, two years and every original detail kept.',
      }),
      slide('content-eyebrow', {
        eyebrow: 'The brief',
        headline: 'Keep The Bones',
        body: 'The house still had its cornices, its shutters and its staircase. It had lost its warmth. We were asked to bring it back without hiding a thing.',
      }),
      slide(
        'list-steps',
        { headline: 'What We Did' },
        {
          list: [
            'Restored the plasterwork, room by room',
            'Laid oak floors from a single forest',
            'Lit every room from three heights',
            'Commissioned furniture from four local makers',
          ],
        },
      ),
      slide('stat-split', {
        stat: '214',
        statLabel: 'lengths of cornice',
        headline: 'Nothing Wasted',
        body: 'Where a cornice had cracked, we cast a new length from the old one, so each room reads as it always did.',
      }),
      slide('quote-centre', {
        quote: '“It feels like the house it always was, only kinder to live in.”',
        attribution: 'The owners',
      }),
      slide('closing-cta', {
        headline: 'Begin Your Project',
        subheadline: 'We take on four homes a year, so each has our full attention.',
        cta: 'Arrange a consultation',
      }),
    ],
  },

  'property-listing': {
    category: 'promotion',
    tags: ['property', 'real estate', 'listing', 'house', 'for sale', 'estate agent'],
    slides: [
      slide('signature-cover', {
        eyebrow: 'New to the market',
        headline: 'Above The Bay',
        subheadline:
          'A house of five bedrooms and a walled garden, with the sea from every bedroom window.',
        footer: 'By appointment',
      }),
      slide('signature-stat', {
        eyebrow: 'The house',
        stat: '4,200',
        statLabel:
          'square feet over three floors, with half an acre of garden running down to the shore',
        footer: 'Freehold',
      }),
      slide(
        'signature-list',
        { headline: 'Inside', footer: 'Built in 1908' },
        {
          list: [
            'A drawing room with three tall windows',
            'A kitchen that opens onto the terrace',
            'A principal suite with its own balcony',
            'A cellar, a study and a boot room',
          ],
        },
      ),
      slide('signature-content', {
        eyebrow: 'The setting',
        headline: 'By The Harbour',
        body: 'A quiet lane, ten minutes on foot from the village and the shore, with a view that changes with every tide.',
        footer: 'Private and gated',
      }),
      slide('signature-closing', {
        headline: 'Arrange A Viewing',
        body: 'Viewings are by appointment only, with one of our partners.',
        cta: 'Request a viewing',
        footer: 'yourbrand.com/view',
      }),
    ],
  },

  membership: {
    category: 'promotion',
    tags: ['membership', 'members club', 'private club', 'invitation', 'exclusive'],
    slides: [
      slide('cover-headline', {
        eyebrow: 'Membership',
        headline: 'A House For Members',
        subheadline: 'Rooms to work, dine and stay, kept for a small circle.',
      }),
      slide(
        'list-ticks',
        { eyebrow: 'What it brings', headline: 'Yours From Day One' },
        {
          list: [
            'The library and dining room, all day',
            'Bedrooms upstairs, kept for members',
            'A table held for you on any night',
            'Talks, tastings and private screenings',
          ],
        },
      ),
      slide('stat-big', {
        eyebrow: 'Kept small',
        stat: '300',
        statLabel: 'members, and never more',
        body: 'The list closes when it is full, so the rooms stay quiet and the staff know every name.',
      }),
      slide('quote-centre', {
        quote: '“The one place in the city where I can hear myself think.”',
        attribution: 'A member since 2016',
      }),
      slide('closing-band', {
        headline: 'Join The House',
        subheadline: 'Applications are read twice a year, with a short conversation after.',
        cta: 'Make an enquiry',
      }),
    ],
  },

  'atelier-story': {
    category: 'story',
    tags: ['atelier', 'craft', 'heritage', 'handmade', 'workshop', 'our story'],
    slides: [
      slide('signature-cover', {
        eyebrow: 'Inside the atelier',
        headline: 'The Slow Way',
        subheadline: 'Three generations, one workshop and the same bench since 1962.',
        footer: 'Our story',
      }),
      slide('signature-content', {
        eyebrow: 'Since 1962',
        headline: 'Where It Began',
        body: 'Our founder set up a single bench in a back room and took one commission at a time. We still work that way.',
        footer: 'The same bench',
      }),
      slide('signature-stat', {
        eyebrow: 'The time it takes',
        stat: '40',
        statLabel: 'hours of handwork in every piece, from the first sketch to the last polish',
        footer: 'Every single piece',
      }),
      slide('signature-quote', {
        quote: '“We never rush a piece. It tells us when it is ready.”',
        attribution: 'Our master craftsman',
        footer: 'Three generations',
      }),
      slide('signature-closing', {
        headline: 'Come And See',
        body: 'Once a month we open the atelier to clients, to watch the work as it happens.',
        cta: 'Join an atelier morning',
        footer: 'yourbrand.com',
      }),
    ],
  },

  'private-evening': {
    category: 'event',
    tags: ['event', 'invitation', 'private view', 'evening', 'gallery', 'reception'],
    slides: [
      slide('cover-headline', {
        eyebrow: 'By invitation',
        headline: 'A Private View',
        subheadline:
          'An evening in the gallery with the new work, Thursday 14 November, from seven.',
      }),
      slide('content-eyebrow', {
        eyebrow: 'The evening',
        headline: 'One Night Only',
        body: 'Twelve new pieces are shown for a single night before they travel. Their makers will be there to talk you through each one.',
      }),
      slide(
        'list-steps',
        { headline: 'The Programme' },
        {
          list: [
            'Seven, the doors open and champagne is poured',
            'Eight, a short talk from the makers',
            'Nine, supper in the courtyard',
            'Late, the gallery stays open',
          ],
        },
      ),
      slide('quote-centre', {
        quote: '“The loveliest evening, and the best company.”',
        attribution: 'A guest last year',
      }),
      slide('closing-cta', {
        headline: 'Will You Join Us?',
        subheadline: 'Kindly reply by 1 November. Each invitation admits two.',
        cta: 'Accept the invitation',
      }),
    ],
  },

  wedding: {
    category: 'event',
    tags: ['wedding', 'bridal', 'venue', 'ceremony', 'celebration', 'engagement'],
    slides: [
      slide('signature-cover', {
        eyebrow: 'Weddings at the house',
        headline: 'The Day Is Yours',
        subheadline: 'One wedding a day, so the whole house belongs to you and your guests.',
        footer: 'May to October',
      }),
      slide('signature-content', {
        eyebrow: 'The ceremony',
        headline: 'Beneath The Cedar',
        body: 'Marry on the lawn in its shade, with room for a hundred and twenty and a quartet playing by the roses.',
        footer: 'Up to 120 guests',
      }),
      slide(
        'signature-list',
        { headline: 'Every Detail, Kept', footer: 'All included' },
        {
          list: [
            'A planner from first visit to last dance',
            'Flowers grown in our walled garden',
            'A menu tasted with you, months ahead',
            'The bridal suite for two nights',
          ],
        },
      ),
      slide('signature-quote', {
        quote: '“It felt like marrying at home, only far lovelier.”',
        attribution: 'A bride, last June',
        footer: 'Real weddings',
      }),
      slide('signature-closing', {
        headline: 'Visit The House',
        body: 'Private tours are held on weekday mornings, with tea in the garden.',
        cta: 'Book a private tour',
        footer: 'yourbrand.com',
      }),
    ],
  },

  apprentice: {
    category: 'hiring',
    tags: ['hiring', 'apprentice', 'careers', 'craft', 'jobs', 'we are hiring'],
    slides: [
      slide('cover-headline', {
        eyebrow: 'We are hiring',
        headline: 'Join The Atelier',
        subheadline:
          'We are looking for an apprentice: two years at the bench beside our master goldsmith, fully paid.',
      }),
      slide(
        'list-ticks',
        { eyebrow: 'Who we are looking for', headline: 'Patience Matters Most' },
        {
          list: [
            'Steady hands and a good eye for detail',
            'Some drawing, carving or making, at any level',
            'Happy to repeat one task until it is right',
            'No jewellery experience needed',
          ],
        },
      ),
      slide('content-eyebrow', {
        eyebrow: 'What you will learn',
        headline: 'A Craft For Life',
        body: 'Casting, setting, engraving and polishing, taught one at a time, the way our founder learned them.',
      }),
      slide('closing-band', {
        headline: 'Apply By 30 November',
        subheadline: 'Send us three things you have made, with a short note about each.',
        cta: 'Send your application',
      }),
    ],
  },
};

// ---------------------------------------------------------------------------
// Rows: each shape in two or three themes, over a luxury art or none
// ---------------------------------------------------------------------------

/**
 * Each row pairs an art with a theme it flatters: gold linework and silk on
 * the deep grounds, marble veins on the pale stone ones, the arch where a
 * doorway or a window belongs to the story. Three art styles are placed with
 * care. Art Deco's sunburst rises from the bottom centre, where the classic
 * closing slide prints the handle, so it only goes under shapes that close
 * on the Signature closing or the closing band. Gilded Frame draws its rule
 * close to the edges, so it only goes under the Signature frame, never under
 * a band or a panel that would cover part of it. Guilloche engraves the top
 * right corner, so it goes under the classic layouts, whose headlines start
 * below it, or under a Signature shape with short headlines and no quote
 * slide, never one whose lines run into the rings. No shape repeats a theme
 * or an art, so its two or three cards in the gallery look like different
 * designs.
 */
const ROWS: Array<[shape: string, theme: string, art: string | null, name: string]> = [
  ['collection-launch', 'gilded-noir', 'gilded-frame', 'Gilded Frame Collection Launch'],
  ['collection-launch', 'obsidian', 'pinstripe', 'Obsidian Pinstripe Collection'],
  ['collection-launch', 'champagne', 'spotlight', 'Champagne Collection Launch'],

  ['jewellery-release', 'ivory-gilt', 'guilloche', 'Engraved Ivory Jewellery Release'],
  ['jewellery-release', 'emerald-champagne', 'lattice', 'Emerald Lattice Jewellery Release'],
  ['jewellery-release', 'onyx-blush', 'spotlight', 'Onyx Blush Jewellery Release'],

  ['tasting-menu', 'gilded-noir', 'art-deco', 'Gilded Deco Tasting Menu'],
  ['tasting-menu', 'carrara', 'marble', 'Marble Tasting Menu'],
  ['tasting-menu', 'bordeaux-rose', 'silk', 'Bordeaux Silk Tasting Menu'],

  ['fragrance-notes', 'onyx-blush', 'silk', 'Onyx Silk Fragrance Notes'],
  ['fragrance-notes', 'vow', 'marble', 'Blush Marble Fragrance Notes'],
  ['fragrance-notes', 'bordeaux-rose', 'gilded-frame', 'Bordeaux Framed Fragrance Notes'],

  ['spa-ritual', 'pearl', 'marble', 'Pearl Marble Spa Ritual'],
  ['spa-ritual', 'vow', 'silk', 'Blush Silk Spa Ritual'],
  ['spa-ritual', 'emerald-champagne', 'arch', 'Emerald Arch Spa Ritual'],

  ['lookbook', 'sapphire-silver', 'pinstripe', 'Sapphire Pinstripe Lookbook'],
  ['lookbook', 'onyx-blush', 'lattice', 'Onyx Lattice Lookbook'],
  ['lookbook', 'carrara', null, 'Carrara Lookbook'],

  ['vintage-release', 'bordeaux-rose', 'guilloche', 'Bordeaux Vintage Release'],
  ['vintage-release', 'emerald-champagne', 'art-deco', 'Emerald Deco Vintage Release'],

  ['hotel-guests', 'champagne', 'arch', 'Champagne Arch Guest Book'],
  ['hotel-guests', 'ivory-gilt', 'gilded-frame', 'Gilt Framed Guest Book'],
  ['hotel-guests', 'sapphire-silver', 'spotlight', 'Sapphire Guest Book'],

  ['interior-portfolio', 'carrara', 'marble', 'Carrara Interiors Portfolio'],
  ['interior-portfolio', 'pearl', 'arch', 'Pearl Arch Interiors Portfolio'],
  ['interior-portfolio', 'obsidian', null, 'Obsidian Interiors Portfolio'],

  ['property-listing', 'sapphire-silver', 'guilloche', 'Sapphire Property Listing'],
  ['property-listing', 'ivory-gilt', null, 'Ivory Property Listing'],
  ['property-listing', 'emerald-champagne', 'pinstripe', 'Emerald Pinstripe Property Listing'],

  ['membership', 'gilded-noir', 'guilloche', 'Engraved Noir Membership'],
  ['membership', 'bordeaux-rose', 'spotlight', 'Bordeaux Spotlight Membership'],

  ['atelier-story', 'gilded-noir', 'lattice', 'Gilded Lattice Atelier Story'],
  ['atelier-story', 'ivory-gilt', 'art-deco', 'Ivory Deco Atelier Story'],
  ['atelier-story', 'champagne', null, 'Champagne Atelier Story'],

  ['private-evening', 'obsidian', 'silk', 'Obsidian Silk Private Evening'],
  ['private-evening', 'onyx-blush', null, 'Onyx Blush Private Evening'],
  ['private-evening', 'champagne', 'lattice', 'Champagne Lattice Private Evening'],

  ['wedding', 'vow', 'arch', 'Blush Arch Wedding'],
  ['wedding', 'pearl', 'gilded-frame', 'Pearl Framed Wedding'],
  ['wedding', 'obsidian', 'art-deco', 'Black Tie Deco Wedding'],

  ['apprentice', 'carrara', 'pinstripe', 'Carrara Atelier Apprentice'],
  ['apprentice', 'sapphire-silver', null, 'Sapphire Atelier Apprentice'],
];

/** Premium, every one: `buildPresets` marks the whole collection so. */
export const LUXURY_PRESETS: Preset[] = buildPresets(
  'luxury',
  SHAPES,
  ROWS.map(([shape, theme, art, name]) => ({
    id: `luxury-${shape}-${theme}`,
    name,
    shape,
    theme,
    ...(art ? { art } : {}),
  })),
);
