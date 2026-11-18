/**
 * PostGear's own sticker pack (Module 12): every piece, its name, its
 * category and its search words, drawn from `stickers-art.ts`. Names are
 * Title Case. Nothing here copies another product's stickers, and no
 * company, platform or product is named or drawn.
 */
import {
  type ArtFont,
  COLOURS,
  type ColourName,
  drop,
  heart,
  INK,
  ink,
  inked,
  inkedLine,
  inkStroke,
  MOTIONS,
  type Motion,
  type MotionName,
  moved,
  nudge,
  polygon,
  round,
  sparkle,
  starPoints,
  textShape,
  wordsBody,
} from './stickers-art';

export type OwnCategory = 'reactions' | 'arrows-shapes' | 'social' | 'gaming' | 'animated-emoji';

export interface OwnSticker {
  /** The file's path inside the pack, without its extension (`reactions/wow`). */
  slug: string;
  name: string;
  category: OwnCategory;
  tags: string[];
  /** Null for a still picture; otherwise the frames in one loop (drawn at 12 a second). */
  frames: number | null;
  /** The sticker at one moment of its loop, `t` from 0 up to 1 (a still one is drawn at 0). */
  draw: (t: number) => string;
}

export const OWN_FPS = 12;
const LOOP_FRAMES = 12;
const POP_FRAMES = 18;

const CATEGORY_TAGS: Record<OwnCategory, string[]> = {
  reactions: ['reaction'],
  'arrows-shapes': ['shape'],
  social: ['social'],
  gaming: ['gaming', 'game'],
  'animated-emoji': ['emoji', 'face'],
};

function kebab(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function tagsFor(name: string, category: OwnCategory, extra: readonly string[] = []): string[] {
  const words = name
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 1);
  return [...new Set([...words, ...extra, ...CATEGORY_TAGS[category]])];
}

/** Splits a phrase over two lines when one line would make its words too small. */
function fitLines(font: ArtFont, text: string, size: number, maxWidth: number): string[] {
  const words = text.split(' ');
  if (words.length < 2) return [text];
  const width = textShape(font, text, size).width;
  if (width <= maxWidth / 0.72) return [text];
  const half = Math.ceil(words.length / 2);
  return [words.slice(0, half).join(' '), words.slice(half).join(' ')];
}

function motionAt(name: MotionName | null, t: number): Motion | null {
  return name ? MOTIONS[name](t) : null;
}

// ---------------------------------------------------------------- pieces

/** Coloured words with a black outline and a hard shadow. */
function bareWords(
  text: string,
  fill: string,
  font: ArtFont = 'luckiest-guy',
  size = 150,
  skew = 0,
): string {
  const lines = fitLines(font, text, size, 440);
  const words = wordsBody(font, lines, { size, maxWidth: 440 });
  const body = skew ? `<g transform="skewX(${skew})">${words.body}</g>` : words.body;
  return inked(body, fill);
}

/** White words on a coloured starburst. */
function burstWords(text: string, fill: string): string {
  const words = wordsBody('luckiest-guy', [text], { size: 120, maxWidth: 300 });
  return (
    inked(polygon(starPoints(14, 235, 178)), fill) + inked(words.body, COLOURS.white, { shadow: 0 })
  );
}

/** The speech bubble outline, centred on (0, -15), its tail at the bottom left. */
const BUBBLE =
  'M-170 -145 H170 Q200 -145 200 -115 V55 Q200 85 170 85 H-40 L-125 160 L-100 85 H-170 Q-200 85 -200 55 V-115 Q-200 -145 -170 -145 Z';

function bubble(fill: string, inside = ''): string {
  return `${inked(`<path d="${BUBBLE}"/>`, fill)}<g transform="translate(0 -30)">${inside}</g>`;
}

function bubbleWords(text: string, fill: string): string {
  const words = wordsBody('titan-one', [text], { size: 110, maxWidth: 320 });
  return bubble(fill, ink(words.body));
}

/** White words on a coloured pill, like a button. */
function label(text: string, plate: string, extra = ''): string {
  const lines = fitLines('titan-one', text, 92, 400);
  const words = wordsBody('titan-one', lines, { size: 92, maxWidth: 400 });
  const lead = extra ? 64 : 0;
  const width = words.width + 96 + lead;
  const height = words.height + 80;
  const radius = Math.min(height / 2, 56);
  const plateBody = `<rect x="${round(-width / 2)}" y="${round(-height / 2)}" width="${round(width)}" height="${round(height)}" rx="${round(radius)}"/>`;
  const text_ = `<g transform="translate(${lead / 2} 0)">${inked(words.body, COLOURS.white, { outline: 12, shadow: 0 })}</g>`;
  const dot = extra ? `<g transform="translate(${round(-width / 2 + 58)} 0)">${extra}</g>` : '';
  return inked(plateBody, plate) + text_ + dot;
}

const ARROW = polygon([
  [-150, -34],
  [28, -34],
  [28, -86],
  [156, 0],
  [28, 86],
  [28, 34],
  [-150, 34],
]);

function blockArrow(angle: number, fill: string): string {
  return inked(`<g transform="rotate(${angle})">${ARROW}</g>`, fill);
}

/** A curved arrow as one outline: a bent band along a quadratic curve, with a head on its end. */
function curvedArrow(
  fill: string,
  flip: boolean,
  curve: readonly [
    readonly [number, number],
    readonly [number, number],
    readonly [number, number],
  ] = [
    [-160, 110],
    [-60, -170],
    [110, -50],
  ],
): string {
  const [p0, p1, p2] = curve;
  const half = 28;
  const at = (t: number): [number, number] => [
    (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
    (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1],
  ];
  const tangent = (t: number): [number, number] => {
    const x = 2 * (1 - t) * (p1[0] - p0[0]) + 2 * t * (p2[0] - p1[0]);
    const y = 2 * (1 - t) * (p1[1] - p0[1]) + 2 * t * (p2[1] - p1[1]);
    const length = Math.hypot(x, y);
    return [x / length, y / length];
  };
  const left: Array<[number, number]> = [];
  const right: Array<[number, number]> = [];
  const steps = 24;
  for (let k = 0; k <= steps; k += 1) {
    const t = k / steps;
    const [x, y] = at(t);
    const [tx, ty] = tangent(t);
    left.push([x - ty * half, y + tx * half]);
    right.push([x + ty * half, y - tx * half]);
  }
  const [ex, ey] = at(1);
  const [tx, ty] = tangent(1);
  const head: Array<[number, number]> = [
    [ex - ty * 74, ey + tx * 74],
    [ex + tx * 104, ey + ty * 104],
    [ex + ty * 74, ey - tx * 74],
  ];
  const outline = polygon([...left, ...head, ...right.reverse()]);
  return inked(flip ? `<g transform="scale(-1 1)">${outline}</g>` : outline, fill);
}

function ring(colour: string): string {
  return inkedLine('M-200 0 A200 135 0 1 0 200 0 A200 135 0 1 0 -200 0', colour, 30);
}

function box(colour: string): string {
  return inkedLine('M-190 -130 H190 V130 H-190 Z', colour, 26);
}

function underline(colour: string): string {
  return inkedLine('M-200 30 Q-20 -40 200 -10', colour, 36);
}

function check(colour: string): string {
  return inkedLine('M-140 10 L-45 105 L150 -110', colour, 60);
}

function cross(colour: string): string {
  return inkedLine('M-120 -120 L120 120 M120 -120 L-120 120', colour, 60);
}

function glyph(text: string, fill: string): string {
  return inked(wordsBody('luckiest-guy', [text], { size: 380, maxWidth: 400 }).body, fill);
}

const LIGHTNING = polygon([
  [-30, -215],
  [110, -215],
  [30, -45],
  [125, -45],
  [-85, 220],
  [-20, 25],
  [-115, 25],
]);

function sparkles(fill: string, t = 0): string {
  const twinkle = (phase: number) => 0.75 + 0.25 * Math.cos(2 * Math.PI * (t + phase));
  return inked(
    sparkle(-40, 10, 150 * twinkle(0)) +
      sparkle(135, -130, 64 * twinkle(0.33)) +
      sparkle(125, 135, 48 * twinkle(0.66)),
    fill,
  );
}

function bell(fill: string): string {
  return inked(
    '<circle cx="0" cy="-170" r="24"/><circle cx="0" cy="128" r="38"/>' +
      '<path d="M-120 70 Q-110 -10 -100 -60 Q-80 -160 0 -160 Q80 -160 100 -60 Q110 -10 120 70 Z"/>' +
      '<rect x="-150" y="58" width="300" height="44" rx="22"/>',
    fill,
  );
}

function playButton(): string {
  return (
    inked('<circle r="190"/>', COLOURS.blue) +
    inked(
      polygon([
        [-55, -95],
        [110, 0],
        [-55, 95],
      ]),
      COLOURS.white,
      { outline: 12, shadow: 0 },
    )
  );
}

function crosshair(colour: string): string {
  const ticks = 'M0 -230 V-95 M0 230 V95 M-230 0 H-95 M230 0 H95';
  return (
    inkedLine('M-150 0 A150 150 0 1 0 150 0 A150 150 0 1 0 -150 0', colour, 26) +
    inkedLine(ticks, colour, 26) +
    inked('<circle r="24"/>', colour)
  );
}

function coin(t = 0): string {
  const move = MOTIONS.flip(t);
  return moved(
    inked('<circle r="180"/>', COLOURS.yellow) +
      inkStroke('M-135 0 A135 135 0 1 0 135 0 A135 135 0 1 0 -135 0', 10) +
      inked(polygon(starPoints(5, 82, 34)), COLOURS.orange, { outline: 12, shadow: 0 }),
    move,
  );
}

function trophy(): string {
  return (
    inkedLine('M-118 -130 Q-205 -132 -192 -62 Q-180 2 -108 8', COLOURS.yellow, 26) +
    inkedLine('M118 -130 Q205 -132 192 -62 Q180 2 108 8', COLOURS.yellow, 26) +
    inked(
      '<rect x="-26" y="70" width="52" height="70" rx="6"/><rect x="-115" y="132" width="230" height="56" rx="12"/>' +
        '<path d="M-122 -175 H122 V-60 Q122 62 0 86 Q-122 62 -122 -60 Z"/>',
      COLOURS.yellow,
    ) +
    inked(
      polygon(starPoints(5, 52, 22)).replace('<path', '<path transform="translate(0 -60)"'),
      COLOURS.white,
      {
        outline: 10,
        shadow: 0,
      },
    )
  );
}

function crown(): string {
  return (
    inked(
      polygon([
        [-175, 115],
        [-175, -75],
        [-88, 8],
        [0, -135],
        [88, 8],
        [175, -75],
        [175, 115],
      ]),
      COLOURS.yellow,
    ) +
    inked('<circle cx="-95" cy="65" r="22"/><circle cx="95" cy="65" r="22"/>', COLOURS.blue, {
      outline: 10,
      shadow: 0,
    }) +
    inked('<circle cx="0" cy="58" r="28"/>', COLOURS.red, { outline: 10, shadow: 0 })
  );
}

function hearts(): string {
  return [-175, 0, 175]
    .map(
      (x) =>
        `<g transform="translate(${x} 0)">${inked(heart(150), COLOURS.red, { outline: 12, shadow: 8 })}</g>`,
    )
    .join('');
}

// ---------------------------------------------------------------- faces

type FaceKind =
  | 'happy'
  | 'grin'
  | 'laughing'
  | 'wow'
  | 'sad'
  | 'love'
  | 'cool'
  | 'angry'
  | 'wink'
  | 'sleepy'
  | 'star-struck'
  | 'shocked'
  | 'silly'
  | 'nervous'
  | 'crying'
  | 'party';

const EYES =
  '<ellipse cx="-70" cy="-40" rx="20" ry="30"/><ellipse cx="70" cy="-40" rx="20" ry="30"/>';
const SMILE = inkStroke('M-95 50 Q0 140 95 50');
const OPEN_MOUTH = '<path d="M-100 30 L100 30 Q95 150 0 156 Q-95 150 -100 30 Z"/>';
const TONGUE = `<path fill="${COLOURS.red}" d="M-52 122 Q0 86 52 122 Q40 152 0 155 Q-40 152 -52 122 Z"/>`;

function faceFeatures(kind: FaceKind, t: number): string {
  const wave = Math.sin(2 * Math.PI * t);
  switch (kind) {
    case 'happy':
      return ink(EYES) + SMILE;
    case 'grin':
      return (
        ink(EYES + OPEN_MOUTH) +
        `<path fill="${COLOURS.white}" d="M-88 40 H88 Q84 64 76 72 H-76 Q-84 64 -88 40 Z"/>`
      );
    case 'laughing':
      return (
        inkStroke('M-108 -30 L-72 -66 L-36 -30', 20) +
        inkStroke('M36 -30 L72 -66 L108 -30', 20) +
        ink(OPEN_MOUTH) +
        TONGUE +
        inked(
          drop(-150, 10 + 8 * Math.abs(wave), 54) + drop(150, 10 + 8 * Math.abs(wave), 54),
          COLOURS.sky,
          {
            outline: 10,
            shadow: 0,
          },
        )
      );
    case 'wow':
      return (
        ink(
          '<circle cx="-70" cy="-40" r="30"/><circle cx="70" cy="-40" r="30"/><ellipse cx="0" cy="88" rx="42" ry="56"/>',
        ) +
        inkStroke('M-110 -110 Q-70 -135 -30 -110', 16) +
        inkStroke('M30 -110 Q70 -135 110 -110', 16)
      );
    case 'sad':
      return (
        ink(EYES) +
        inkStroke('M-80 110 Q0 45 80 110') +
        inked(drop(-70, 40 + 30 * t, 46), COLOURS.sky, { outline: 10, shadow: 0 })
      );
    case 'love': {
      const beat = 0.34 + 0.05 * wave;
      const eye = (x: number) =>
        `<g transform="translate(${x} -40) scale(${round(beat)})">${inked(heart(300), COLOURS.red, { outline: 30, shadow: 0 })}</g>`;
      return eye(-70) + eye(70) + SMILE;
    }
    case 'cool':
      return (
        ink(
          '<path d="M-165 -78 H-15 V-36 Q-15 22 -88 22 Q-165 22 -165 -36 Z"/>' +
            '<path d="M15 -78 H165 V-36 Q165 22 88 22 Q15 22 15 -36 Z"/>' +
            '<rect x="-22" y="-78" width="44" height="18"/>',
        ) +
        `<path d="M-140 -58 L-110 -58" stroke="${COLOURS.white}" stroke-width="10" stroke-linecap="round"/>` +
        `<path d="M40 -58 L70 -58" stroke="${COLOURS.white}" stroke-width="10" stroke-linecap="round"/>` +
        inkStroke('M-60 85 Q30 125 92 62')
      );
    case 'angry':
      return (
        ink(
          '<ellipse cx="-70" cy="-30" rx="18" ry="24"/><ellipse cx="70" cy="-30" rx="18" ry="24"/>',
        ) +
        inkStroke('M-125 -105 L-35 -72', 20) +
        inkStroke('M125 -105 L35 -72', 20) +
        inkStroke('M-80 110 Q0 55 80 110')
      );
    case 'wink':
      return (
        ink('<ellipse cx="-70" cy="-40" rx="20" ry="30"/>') +
        inkStroke('M40 -38 Q70 -68 100 -38', 20) +
        SMILE
      );
    case 'sleepy': {
      const rise = (t * 120) % 120;
      const z = (x: number, y: number, size: number, opacity: number) =>
        `<g transform="translate(${x} ${round(y)})" opacity="${round(opacity)}">${inked(
          wordsBody('luckiest-guy', ['Z'], { size, maxWidth: 200 }).body,
          COLOURS.white,
          { outline: 10, shadow: 0 },
        )}</g>`;
      return (
        inkStroke('M-105 -40 Q-70 -15 -35 -40', 18) +
        inkStroke('M35 -40 Q70 -15 105 -40', 18) +
        ink('<ellipse cx="0" cy="88" rx="22" ry="26"/>') +
        z(150, -120 - rise * 0.7, 64, 1 - rise / 140) +
        z(200, -175 - rise * 0.5, 46, 0.9 - rise / 180)
      );
    }
    case 'star-struck': {
      const spin = 20 * wave;
      const star = (x: number) =>
        `<g transform="translate(${x} -40) rotate(${round(spin)})">${inked(polygon(starPoints(5, 52, 22)), COLOURS.orange, { outline: 10, shadow: 0 })}</g>`;
      return star(-70) + star(70) + ink(OPEN_MOUTH) + TONGUE;
    }
    case 'shocked':
      return (
        inked(
          '<circle cx="-70" cy="-45" r="44"/><circle cx="70" cy="-45" r="44"/>',
          COLOURS.white,
          {
            outline: 12,
            shadow: 0,
          },
        ) +
        ink(
          '<circle cx="-70" cy="-45" r="13"/><circle cx="70" cy="-45" r="13"/><rect x="-46" y="60" width="92" height="72" rx="30"/>',
        )
      );
    case 'silly':
      return (
        ink('<ellipse cx="-70" cy="-40" rx="20" ry="30"/>') +
        inkStroke('M45 -65 L95 -40 L45 -15', 18) +
        inked(
          `<path transform="rotate(${round(6 * wave)} 0 70)" d="M-32 68 V118 A32 32 0 0 0 32 118 V68 Z"/>`,
          COLOURS.pink,
          {
            outline: 12,
            shadow: 0,
          },
        ) +
        inkStroke('M-95 55 Q0 110 95 55')
      );
    case 'nervous':
      return (
        ink(EYES) +
        inkStroke('M-100 90 q25 -25 50 0 t50 0 t50 0 t50 0', 18) +
        inked(drop(150, -120 + 10 * Math.abs(wave), 60), COLOURS.sky, { outline: 10, shadow: 0 })
      );
    case 'crying': {
      const flow = (t * 60) % 60;
      const stream = (x: number) =>
        `<rect x="${x - 16}" y="${round(-15 + flow / 3)}" width="32" height="${round(150 + flow)}" rx="16"/>`;
      return (
        inked(stream(-75) + stream(75), COLOURS.sky, { outline: 10, shadow: 0 }) +
        inkStroke('M-108 -48 Q-72 -22 -36 -48', 18) +
        inkStroke('M36 -48 Q72 -22 108 -48', 18) +
        ink('<path d="M-75 130 Q0 50 75 130 Z"/>')
      );
    }
    case 'party': {
      const confetti = [
        [-210, -120, COLOURS.pink],
        [210, -60, COLOURS.blue],
        [-200, 120, COLOURS.green],
        [190, 150, COLOURS.violet],
      ] as const;
      const bits = confetti
        .map(
          ([x, y, colour], k) =>
            `<rect transform="translate(${x} ${round(y + ((t * 80 + k * 20) % 80))}) rotate(${round(t * 360 + k * 45)})" x="-12" y="-7" width="24" height="14" fill="${colour}" stroke="${INK}" stroke-width="6"/>`,
        )
        .join('');
      return (
        ink(EYES) +
        SMILE +
        `<g transform="translate(-95 -175) rotate(-22)">${inked(
          polygon([
            [0, -120],
            [70, 40],
            [-70, 40],
          ]),
          COLOURS.violet,
          { outline: 14, shadow: 6 },
        )}${inked('<circle cx="0" cy="-122" r="22"/>', COLOURS.yellow, { outline: 10, shadow: 0 })}</g>` +
        bits
      );
    }
  }
}

function face(kind: FaceKind, t: number): string {
  const skin = kind === 'angry' ? COLOURS.orange : COLOURS.yellow;
  const drawn = inked('<circle r="200"/>', skin) + faceFeatures(kind, t);
  // The party hat stands above the face, so that face is drawn smaller to keep its bounce on the canvas.
  return kind === 'party' ? `<g transform="translate(0 30) scale(0.82)">${drawn}</g>` : drawn;
}

// ---------------------------------------------------------------- the pack

const out: OwnSticker[] = [];

function add(
  category: OwnCategory,
  name: string,
  draw: (t: number) => string,
  options: { frames?: number | null; slug?: string; tags?: readonly string[] } = {},
): void {
  const frames = options.frames ?? null;
  const slug = `${category}/${options.slug ?? kebab(name)}${frames ? '-moving' : ''}`;
  if (out.some((sticker) => sticker.slug === slug))
    throw new Error(`Two stickers are called ${slug}`);
  out.push({ slug, name, category, tags: tagsFor(name, category, options.tags), frames, draw });
}

const CYCLE: ColourName[] = ['yellow', 'pink', 'blue', 'green', 'orange', 'violet', 'sky', 'red'];
const colourAt = (k: number) => COLOURS[CYCLE[k % CYCLE.length] as ColourName];

// Reactions: words, words on a burst, words in a bubble, and moving pops.
const REACTION_WORDS: Array<[string, string, string[]]> = [
  ['Wow', 'Wow!', ['amazing', 'surprise']],
  ['Omg', 'Omg!', ['shock', 'surprise']],
  ['Lol', 'Lol', ['laugh', 'funny']],
  ['No Way', 'No Way!', ['shock', 'disbelief']],
  ['Yes', 'Yes!', ['agree', 'win']],
  ['Nope', 'Nope', ['no', 'disagree']],
  ['Oops', 'Oops!', ['mistake', 'fail']],
  ['Whoa', 'Whoa!', ['surprise', 'wow']],
  ['Yay', 'Yay!', ['happy', 'celebrate']],
  ['Ouch', 'Ouch!', ['pain', 'hurt']],
  ['Hmm', 'Hmm...', ['thinking', 'doubt']],
  ['Ha Ha', 'Ha Ha!', ['laugh', 'funny']],
  ['Boom', 'Boom!', ['explosion', 'impact']],
  ['Bam', 'Bam!', ['impact', 'comic']],
  ['Pow', 'Pow!', ['impact', 'comic']],
  ['Zap', 'Zap!', ['electric', 'comic']],
  ['Nice', 'Nice!', ['good', 'approve']],
  ['Cool', 'Cool', ['good', 'chill']],
  ['Love It', 'Love It!', ['love', 'like']],
  ['So Good', 'So Good!', ['great', 'tasty']],
  ['Wait What', 'Wait What?', ['confused', 'surprise']],
  ['Big Mood', 'Big Mood', ['relatable', 'mood']],
  ['Same', 'Same', ['relatable', 'agree']],
  ['Facts', 'Facts', ['true', 'agree']],
  ['Mind Blown', 'Mind Blown', ['amazing', 'shock']],
  ['Too Funny', 'Too Funny', ['laugh', 'funny']],
  ["Let's Go", "Let's Go!", ['hype', 'excited']],
  ['Fire', 'Fire!', ['hot', 'great']],
  ['Iconic', 'Iconic', ['legend', 'great']],
  ['Legend', 'Legend', ['great', 'hero']],
  ['Wild', 'Wild!', ['crazy', 'surprise']],
  ['Help', 'Help!', ['panic', 'scared']],
];
REACTION_WORDS.forEach(([name, text, tags], k) => {
  add('reactions', name, () => bareWords(text, colourAt(k)), { tags });
});

const BURSTS: Array<[string, ColourName]> = [
  ['Boom', 'orange'],
  ['Pow', 'yellow'],
  ['Bam', 'pink'],
  ['Zap', 'sky'],
  ['Wow', 'violet'],
  ['Omg', 'red'],
  ['Yes', 'green'],
  ['Win', 'blue'],
  ['Epic', 'orange'],
  ['Hype', 'pink'],
];
for (const [word, colour] of BURSTS) {
  add('reactions', `${word} Burst`, () => burstWords(`${word}!`, COLOURS[colour]), {
    tags: [word.toLowerCase(), 'comic'],
  });
}

const BUBBLES: Array<[string, string, ColourName]> = [
  ['Hi', 'Hi!', 'white'],
  ['Wait', 'Wait...', 'yellow'],
  ['Me', 'Me?', 'white'],
  ['Why', 'Why?', 'sky'],
  ['Ok', 'Ok', 'white'],
  ['Same Bubble', 'Same', 'pink'],
];
for (const [name, text, colour] of BUBBLES) {
  add('reactions', name, () => bubbleWords(text, COLOURS[colour]), {
    tags: ['speech', 'bubble', 'talk'],
  });
}

const POPS = [
  'Wow',
  'Omg',
  'No Way',
  'Yes',
  'Boom',
  'Lol',
  "Let's Go",
  'Nice',
  'Oops',
  'Whoa',
  'Fire',
  'Yay',
];
POPS.forEach((name, k) => {
  const entry = REACTION_WORDS.find(([word]) => word === name);
  if (!entry) throw new Error(`No reaction word ${name}`);
  add('reactions', name, (t) => moved(bareWords(entry[1], colourAt(k + 3)), MOTIONS.pop(t)), {
    frames: POP_FRAMES,
    tags: [...entry[2], 'pop'],
  });
});

// Arrows And Shapes.
const DIRECTIONS: Array<[string, number]> = [
  ['Right', 0],
  ['Down Right', 45],
  ['Down', 90],
  ['Down Left', 135],
  ['Left', 180],
  ['Up Left', 225],
  ['Up', 270],
  ['Up Right', 315],
];
for (const colour of ['yellow', 'pink'] as const) {
  for (const [direction, angle] of DIRECTIONS) {
    add(
      'arrows-shapes',
      `${title(colour)} Arrow ${direction}`,
      () => blockArrow(angle, COLOURS[colour]),
      {
        tags: ['arrow', 'point', 'pointer', colour],
      },
    );
  }
}
for (const colour of ['blue', 'green'] as const) {
  add(
    'arrows-shapes',
    `${title(colour)} Curved Arrow Right`,
    () => curvedArrow(COLOURS[colour], false),
    {
      tags: ['arrow', 'curve', 'point', colour],
    },
  );
  add(
    'arrows-shapes',
    `${title(colour)} Curved Arrow Left`,
    () => curvedArrow(COLOURS[colour], true),
    {
      tags: ['arrow', 'curve', 'point', colour],
    },
  );
}

function title(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

const SHAPES: Array<[string, (fill: string) => string, ColourName[], string[]]> = [
  ['Circle', ring, ['red', 'yellow', 'blue'], ['ring', 'highlight', 'circle']],
  ['Box', box, ['red', 'yellow'], ['frame', 'highlight', 'square']],
  ['Underline', underline, ['yellow', 'pink'], ['line', 'highlight', 'swoosh']],
  [
    'Star',
    (fill) => inked(polygon(starPoints(5, 205, 86)), fill),
    ['yellow', 'pink', 'blue'],
    ['star', 'favourite'],
  ],
  [
    'Burst',
    (fill) => inked(polygon(starPoints(14, 215, 162)), fill),
    ['yellow', 'orange', 'pink'],
    ['explosion', 'comic', 'badge'],
  ],
  ['Heart', (fill) => inked(heart(390), fill), ['red', 'pink', 'violet'], ['love', 'like']],
  ['Check', check, ['green', 'blue'], ['tick', 'yes', 'done', 'correct']],
  ['Cross', cross, ['red', 'orange'], ['no', 'wrong', 'x']],
  [
    'Exclamation Mark',
    (fill) => glyph('!', fill),
    ['red', 'yellow'],
    ['alert', 'warning', 'important'],
  ],
  [
    'Question Mark',
    (fill) => glyph('?', fill),
    ['blue', 'violet'],
    ['question', 'confused', 'ask'],
  ],
  ['Speech Bubble', (fill) => bubble(fill), ['white', 'yellow'], ['talk', 'say', 'chat']],
  [
    'Lightning',
    (fill) => inked(LIGHTNING, fill),
    ['yellow', 'sky'],
    ['bolt', 'electric', 'fast', 'energy'],
  ],
  ['Sparkles', (fill) => sparkles(fill), ['yellow', 'sky'], ['shine', 'magic', 'new', 'glitter']],
];
for (const [name, draw, colours, tags] of SHAPES) {
  for (const colour of colours) {
    add('arrows-shapes', `${title(colour)} ${name}`, () => draw(COLOURS[colour]), {
      tags: [...tags, colour],
    });
  }
}

for (const [direction, angle] of DIRECTIONS.filter(([, angle]) => angle % 90 === 0)) {
  add(
    'arrows-shapes',
    `Pink Arrow ${direction}`,
    (t) => moved(blockArrow(angle, COLOURS.pink), nudge(angle, t)),
    {
      frames: LOOP_FRAMES,
      tags: ['arrow', 'point', 'pointer', 'pink'],
    },
  );
}
add('arrows-shapes', 'Red Heart', (t) => moved(inked(heart(390), COLOURS.red), MOTIONS.pulse(t)), {
  frames: LOOP_FRAMES,
  tags: ['love', 'like', 'heartbeat'],
});
add(
  'arrows-shapes',
  'Yellow Star',
  (t) => moved(inked(polygon(starPoints(5, 205, 86)), COLOURS.yellow), MOTIONS.wiggle(t)),
  {
    frames: LOOP_FRAMES,
    tags: ['star', 'favourite'],
  },
);
add('arrows-shapes', 'Yellow Sparkles', (t) => sparkles(COLOURS.yellow, t), {
  frames: LOOP_FRAMES,
  tags: ['shine', 'magic', 'new', 'glitter'],
});
add('arrows-shapes', 'Red Circle', (t) => moved(ring(COLOURS.red), MOTIONS.pulse(t)), {
  frames: LOOP_FRAMES,
  tags: ['ring', 'highlight', 'circle'],
});
add(
  'arrows-shapes',
  'Orange Burst',
  (t) => moved(inked(polygon(starPoints(14, 215, 162)), COLOURS.orange), MOTIONS.pulse(t)),
  {
    frames: LOOP_FRAMES,
    tags: ['explosion', 'comic', 'badge'],
  },
);

// Social: button-like labels and a few icons, none of them a platform's.
const LABELS: Array<[string, ColourName, string[]]> = [
  ['Follow', 'blue', ['follow', 'join']],
  ['Subscribe', 'red', ['subscribe', 'join']],
  ['Like', 'pink', ['like', 'love']],
  ['Share', 'green', ['share', 'send']],
  ['Comment', 'violet', ['comment', 'reply']],
  ['Link In Bio', 'orange', ['link', 'bio']],
  ['New Video', 'blue', ['new', 'video', 'upload']],
  ['Live Now', 'red', ['live', 'stream', 'now']],
  ['Watch Till The End', 'violet', ['watch', 'end', 'wait']],
  ['Save This', 'green', ['save', 'bookmark']],
  ['Part 2', 'orange', ['part', 'next', 'series']],
  ['Tag A Friend', 'pink', ['tag', 'friend', 'share']],
  ['Click Here', 'blue', ['click', 'tap', 'here']],
  ['Turn On Alerts', 'red', ['alerts', 'notifications', 'bell']],
  ['New Post', 'green', ['new', 'post']],
  ['Swipe Up', 'violet', ['swipe', 'up', 'more']],
];
const LIVE_DOT = (opacity = 1) =>
  `<g opacity="${round(opacity)}">${inked('<circle r="22"/>', COLOURS.white, { outline: 10, shadow: 0 })}</g>`;
for (const [name, colour, tags] of LABELS) {
  add('social', name, () => label(name, COLOURS[colour], name === 'Live Now' ? LIVE_DOT() : ''), {
    tags,
  });
}
add('social', 'Bell', () => bell(COLOURS.yellow), { tags: ['notification', 'alert', 'ring'] });
add('social', 'Play Button', () => playButton(), { tags: ['play', 'video', 'watch'] });
add(
  'social',
  'Comment Bubble',
  () =>
    bubble(COLOURS.white, ink('<circle cx="-80" r="26"/><circle r="26"/><circle cx="80" r="26"/>')),
  {
    tags: ['comment', 'chat', 'typing'],
  },
);
add(
  'social',
  'Share Arrow',
  () =>
    curvedArrow(COLOURS.green, false, [
      [-170, 150],
      [-150, -120],
      [100, -110],
    ]),
  {
    tags: ['share', 'send', 'forward'],
  },
);
add(
  'social',
  'Like Bubble',
  () =>
    bubble(
      COLOURS.white,
      `<g transform="scale(0.5)">${inked(heart(300), COLOURS.pink, { outline: 28, shadow: 0 })}</g>`,
    ),
  { tags: ['like', 'love', 'notification'] },
);

add('social', 'Follow', (t) => moved(label('Follow', COLOURS.blue), MOTIONS.pulse(t)), {
  frames: LOOP_FRAMES,
  tags: ['follow', 'join'],
});
add('social', 'Subscribe', (t) => moved(label('Subscribe', COLOURS.red), MOTIONS.pulse(t)), {
  frames: LOOP_FRAMES,
  tags: ['subscribe', 'join'],
});
add('social', 'Bell', (t) => moved(bell(COLOURS.yellow), MOTIONS.swing(t)), {
  frames: LOOP_FRAMES,
  tags: ['notification', 'ring'],
});
add(
  'social',
  'Like Bubble',
  (t) =>
    bubble(
      COLOURS.white,
      `<g transform="scale(${round(0.5 + 0.06 * Math.sin(2 * Math.PI * t))})">${inked(heart(300), COLOURS.pink, { outline: 28, shadow: 0 })}</g>`,
    ),
  { frames: LOOP_FRAMES, tags: ['like', 'love', 'notification'] },
);
add('social', 'Live Now', (t) => label('Live Now', COLOURS.red, LIVE_DOT(t < 0.5 ? 1 : 0.15)), {
  frames: LOOP_FRAMES,
  tags: ['live', 'stream', 'now'],
});
add('social', 'New Video', (t) => moved(label('New Video', COLOURS.blue), MOTIONS.pop(t)), {
  frames: POP_FRAMES,
  tags: ['new', 'video', 'upload'],
});

// Gaming: comic words and a few icons.
const GAMING_WORDS: Array<[string, string[]]> = [
  ['Good Game', ['gg', 'win', 'respect']],
  ['Victory', ['win', 'winner']],
  ['Game Over', ['lose', 'end']],
  ['Level Up', ['progress', 'win']],
  ['Boss Fight', ['boss', 'battle']],
  ['Combo', ['hit', 'streak']],
  ['Headshot', ['aim', 'shot']],
  ['Respawn', ['again', 'retry']],
  ['Rage Quit', ['angry', 'quit']],
  ['Clutch', ['win', 'pressure']],
  ['Pro Move', ['skill', 'pro']],
  ['New Record', ['record', 'best']],
  ['Critical Hit', ['crit', 'hit', 'damage']],
  ['Press Start', ['start', 'play']],
  ['Player One', ['player', 'p1']],
  ['Final Round', ['final', 'round']],
  ['Win', ['winner', 'victory']],
  ['Ace', ['skill', 'pro']],
  ['Respect', ['honour', 'gg']],
  ['Speedrun', ['fast', 'record']],
];
const GAMING_FILLS: ColourName[] = [
  'yellow',
  'orange',
  'green',
  'sky',
  'pink',
  'violet',
  'red',
  'blue',
];
const gamingFill = (k: number) => COLOURS[GAMING_FILLS[k % GAMING_FILLS.length] as ColourName];
GAMING_WORDS.forEach(([name, tags], k) => {
  add('gaming', name, () => bareWords(name, gamingFill(k), 'bangers', 175, -6), { tags });
});
add('gaming', 'Crosshair', () => crosshair(COLOURS.red), { tags: ['aim', 'target', 'shooter'] });
add('gaming', 'Coin', () => coin(), { tags: ['coin', 'money', 'points', 'score'] });
add('gaming', 'Trophy', () => trophy(), { tags: ['win', 'winner', 'prize', 'cup'] });
add('gaming', 'Crown', () => crown(), { tags: ['king', 'queen', 'winner', 'best'] });
add('gaming', 'Health Hearts', () => hearts(), { tags: ['health', 'lives', 'hearts'] });

const gamingWord = (name: string) => {
  const k = GAMING_WORDS.findIndex(([word]) => word === name);
  return bareWords(name, gamingFill(k), 'bangers', 175, -6);
};
add('gaming', 'Level Up', (t) => moved(gamingWord('Level Up'), MOTIONS.rise(t)), {
  frames: LOOP_FRAMES,
  tags: ['progress', 'win'],
});
add('gaming', 'Coin', (t) => coin(t), {
  frames: LOOP_FRAMES,
  tags: ['coin', 'money', 'points', 'score'],
});
add('gaming', 'Victory', (t) => moved(gamingWord('Victory'), MOTIONS.pop(t)), {
  frames: POP_FRAMES,
  tags: ['win', 'winner'],
});
add('gaming', 'Game Over', (t) => moved(gamingWord('Game Over'), MOTIONS.shake(t)), {
  frames: LOOP_FRAMES,
  tags: ['lose', 'end'],
});
add('gaming', 'Combo', (t) => moved(gamingWord('Combo'), MOTIONS.pulse(t)), {
  frames: LOOP_FRAMES,
  tags: ['hit', 'streak'],
});
add('gaming', 'Crown', (t) => moved(crown(), MOTIONS.bounce(t)), {
  frames: LOOP_FRAMES,
  tags: ['king', 'queen', 'winner'],
});

// Animated Emoji: our own faces, each with its own small movement.
const FACES: Array<[FaceKind, string, MotionName | null, string[]]> = [
  ['happy', 'Happy Face', 'bounce', ['happy', 'smile', 'joy']],
  ['grin', 'Grinning Face', 'pulse', ['grin', 'smile', 'happy']],
  ['laughing', 'Laughing Face', 'shake', ['laugh', 'lol', 'funny', 'tears']],
  ['wow', 'Surprised Face', 'pulse', ['wow', 'surprise', 'shock']],
  ['sad', 'Sad Face', 'sway', ['sad', 'unhappy', 'tear']],
  ['love', 'Heart Eyes Face', null, ['love', 'heart', 'crush']],
  ['cool', 'Cool Face', 'bounce', ['cool', 'sunglasses', 'chill']],
  ['angry', 'Angry Face', 'shake', ['angry', 'mad', 'rage']],
  ['wink', 'Winking Face', 'wiggle', ['wink', 'flirt', 'joke']],
  ['sleepy', 'Sleepy Face', null, ['sleep', 'tired', 'bored', 'zzz']],
  ['star-struck', 'Star Struck Face', 'pulse', ['star', 'amazed', 'wow']],
  ['shocked', 'Shocked Face', 'shake', ['shock', 'scared', 'omg']],
  ['silly', 'Silly Face', 'wiggle', ['silly', 'tongue', 'crazy']],
  ['nervous', 'Nervous Face', 'sway', ['nervous', 'sweat', 'awkward']],
  ['crying', 'Crying Face', null, ['cry', 'sad', 'tears']],
  ['party', 'Party Face', 'bounce', ['party', 'celebrate', 'birthday']],
];
for (const [kind, name, motion, tags] of FACES) {
  add('animated-emoji', name, (t) => moved(face(kind, t), motionAt(motion, t)), {
    frames: LOOP_FRAMES,
    tags,
  });
}

export const OWN_STICKERS: readonly OwnSticker[] = out;
