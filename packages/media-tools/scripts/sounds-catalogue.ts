/**
 * PostGear's own sounds (Module 14): every effect and loop as an FFmpeg
 * `lavfi` graph, made by `npm run clips:sounds:make` into the folder the
 * library's `own` source reads. Nothing here is a recording: tones, noise,
 * sweeps and simple loops written as maths, so they are ours (licence
 * `OWN`, CC0 by our choice) and the code is the source.
 *
 * The graphs are deterministic (`random()` in `aevalsrc` and `anoisesrc`
 * with a fixed seed start from the same state every run), so the same
 * catalogue makes the same files and the ingest's checksums dedupe a rerun.
 * Levels do not matter here: the ingest's `normaliseSound` levels every one.
 */

export type OwnSoundCategory =
  | 'alerts'
  | 'ambient'
  | 'reactions'
  | 'transitions'
  | 'gaming'
  | 'comedy'
  | 'impacts'
  | 'whooshes'
  | 'calm'
  | 'upbeat'
  | 'tense'
  | 'cinematic'
  | 'lofi'
  | 'epic';

export interface OwnSound {
  /** Stable id, also the file name: `whoosh-soft`. */
  id: string;
  name: string;
  category: OwnSoundCategory;
  kind: 'sfx' | 'music';
  tags: string[];
  /** The `lavfi` input graph; its output is the sound. */
  graph: string;
  seconds: number;
  /** Music only. */
  bpm?: number;
}

const SR = 48_000;

/** One `aevalsrc` of `seconds`, mono. */
function src(expr: string, seconds: number): string {
  return `aevalsrc=exprs='${expr}':s=${SR}:d=${seconds}`;
}

/** Noise from one of `aevalsrc`'s random states, -1 to 1. */
const noise = (state = 0) => `(2*random(${state})-1)`;

/** Notes as `[start seconds, frequency]`, each a sine with a decay (a chime or a bell line). */
function notes(list: ReadonlyArray<readonly [number, number]>, decay: number, level = 0.3): string {
  return list
    .map(
      ([at, f]) =>
        `${level}*gte(t,${at})*sin(2*PI*${f}*(t-${at}))*exp(-${decay}*(t-${at}))*min(1,(t-${at})*400)`,
    )
    .join('+');
}

/** The same with a soft square (rich, game-like). */
function squareNotes(
  list: ReadonlyArray<readonly [number, number, number]>,
  decay: number,
  level = 0.25,
): string {
  return list
    .map(
      ([at, f, len]) =>
        `${level}*between(t,${at},${at + len})*tanh(4*sin(2*PI*${f}*(t-${at})))*exp(-${decay}*(t-${at}))*min(1,(t-${at})*400)`,
    )
    .join('+');
}

/** A sine sweeping in a straight line from `f0` to `f1` Hz over `seconds`. */
function sweep(f0: number, f1: number, seconds: number): string {
  return `sin(2*PI*(${f0}*t+${(f1 - f0) / (2 * seconds)}*t*t))`;
}

/** A rise and fall over `seconds` (zero at both ends). */
const swell = (seconds: number) => `pow(sin(PI*t/${seconds}),2)`;

function sfx(
  id: string,
  name: string,
  category: OwnSoundCategory,
  tags: string[],
  seconds: number,
  graph: string,
): OwnSound {
  return { id, name, category, kind: 'sfx', tags, graph, seconds };
}

// --- Alerts And Notifications ---------------------------------------------------

const ALERTS: OwnSound[] = [
  sfx(
    'ding',
    'Ding',
    'alerts',
    ['ding', 'bell', 'notification'],
    1.5,
    src(`0.5*sin(2*PI*1318.5*t)*exp(-5*t)+0.2*sin(2*PI*2637*t)*exp(-8*t)`, 1.5),
  ),
  sfx(
    'double-ding',
    'Double Ding',
    'alerts',
    ['ding', 'notification', 'message'],
    1.5,
    src(
      notes(
        [
          [0, 1318.5],
          [0.18, 1760],
        ],
        6,
      ),
      1.5,
    ),
  ),
  sfx(
    'chime-up',
    'Chime Up',
    'alerts',
    ['chime', 'success', 'notification'],
    1.6,
    src(
      notes(
        [
          [0, 1046.5],
          [0.12, 1318.5],
          [0.24, 1568],
        ],
        5,
      ),
      1.6,
    ),
  ),
  sfx(
    'soft-bell',
    'Soft Bell',
    'alerts',
    ['bell', 'soft', 'notification'],
    2.5,
    src(
      `0.4*sin(2*PI*523.25*t)*exp(-2*t)+0.2*sin(2*PI*1444*t)*exp(-4*t)+0.1*sin(2*PI*2825*t)*exp(-7*t)`,
      2.5,
    ),
  ),
  sfx(
    'message-pop',
    'Message Pop',
    'alerts',
    ['message', 'pop', 'notification'],
    0.3,
    src(`0.6*${sweep(600, 1200, 0.06)}*exp(-25*t)`, 0.3),
  ),
  sfx(
    'error-buzz',
    'Error Buzz',
    'alerts',
    ['error', 'buzz', 'alert'],
    0.45,
    `${src(`0.3*tanh(4*sin(2*PI*110*t))*(lt(t,0.15)+between(t,0.22,0.37))`, 0.45)},lowpass=f=2000`,
  ),
  sfx(
    'success-tone',
    'Success Tone',
    'alerts',
    ['success', 'confirm', 'ding'],
    0.8,
    src(
      notes(
        [
          [0, 880],
          [0.12, 1320],
        ],
        7,
        0.4,
      ),
      0.8,
    ),
  ),
  sfx(
    'alarm-beeps',
    'Alarm Beeps',
    'alerts',
    ['alarm', 'beep', 'warning'],
    1,
    `${src(`0.3*tanh(3*sin(2*PI*1000*t))*lt(mod(t,0.25),0.12)`, 1)},lowpass=f=4000`,
  ),
  // Two ticks 120 ms apart: one tick alone dies away in 20 ms, under the 100 ms an effect needs.
  sfx(
    'tick',
    'Tick',
    'alerts',
    ['click', 'tick', 'tap'],
    0.3,
    src(
      `0.5*${noise()}*exp(-200*t)+0.4*sin(2*PI*3000*t)*exp(-150*t)` +
        `+gte(t,0.12)*(0.4*${noise(1)}*exp(-200*(t-0.12))+0.35*sin(2*PI*2400*t)*exp(-150*(t-0.12)))`,
      0.3,
    ),
  ),
  sfx(
    'reminder-chime',
    'Reminder Chime',
    'alerts',
    ['reminder', 'chime', 'bell'],
    1.8,
    src(
      notes(
        [
          [0, 1568],
          [0.15, 1318.5],
          [0.3, 1046.5],
        ],
        4,
      ),
      1.8,
    ),
  ),
];

// --- Ambient Sounds ---------------------------------------------------------------

const AMBIENT: OwnSound[] = [
  sfx(
    'rain',
    'Rain',
    'ambient',
    ['rain', 'weather', 'calm'],
    10,
    'anoisesrc=d=10:c=pink:a=0.4:seed=11,lowpass=f=5000,highpass=f=300',
  ),
  sfx(
    'wind',
    'Wind',
    'ambient',
    ['wind', 'breeze', 'outdoor'],
    10,
    'anoisesrc=d=10:c=brown:a=0.6:seed=12,bandpass=f=400:width_type=h:w=300,tremolo=f=0.5:d=0.7',
  ),
  sfx(
    'room-tone',
    'Room Tone',
    'ambient',
    ['room tone', 'quiet', 'background'],
    10,
    'anoisesrc=d=10:c=brown:a=0.2:seed=13,lowpass=f=400',
  ),
  sfx(
    'ocean-waves',
    'Ocean Waves',
    'ambient',
    ['ocean', 'waves', 'sea'],
    10,
    `${src(`${noise()}*(0.3+0.7*pow(sin(PI*t/5),2))`, 10)},lowpass=f=1200`,
  ),
  sfx(
    'crowd-murmur',
    'Crowd Murmur',
    'ambient',
    ['crowd', 'murmur', 'people'],
    10,
    'anoisesrc=d=10:c=pink:a=0.5:seed=15,bandpass=f=700:width_type=h:w=600,tremolo=f=3:d=0.4',
  ),
  sfx(
    'city-hum',
    'City Hum',
    'ambient',
    ['city', 'hum', 'traffic'],
    10,
    `${src(`0.2*sin(2*PI*60*t)+0.1*sin(2*PI*120*t)+0.15*${noise()}`, 10)},lowpass=f=900`,
  ),
  sfx(
    'fire-crackle',
    'Fire Crackle',
    'ambient',
    ['fire', 'crackle', 'warm'],
    10,
    `${src(`0.1*${noise(0)}+0.9*${noise(1)}*gt(random(2),0.9993)`, 10)},lowpass=f=4000`,
  ),
  sfx(
    'night-crickets',
    'Night Crickets',
    'ambient',
    ['night', 'crickets', 'outdoor'],
    10,
    src(`0.05*${noise()}+0.3*sin(2*PI*4500*t)*lt(mod(t,0.6),0.15)*pow(sin(PI*mod(t*40,1)),2)`, 10),
  ),
  sfx(
    'forest-birds',
    'Forest Birds',
    'ambient',
    ['forest', 'birds', 'nature'],
    10,
    src(
      `0.04*${noise()}+0.25*sin(2*PI*(2500*mod(t,1.3)+4000*mod(t,1.3)*mod(t,1.3)))*lt(mod(t,1.3),0.12)+0.2*sin(2*PI*(3200*mod(t+0.5,2.1)-3000*mod(t+0.5,2.1)*mod(t+0.5,2.1)))*lt(mod(t+0.5,2.1),0.1)`,
      10,
    ),
  ),
  sfx(
    'office-air',
    'Office Air',
    'ambient',
    ['office', 'air', 'background'],
    10,
    'anoisesrc=d=10:c=pink:a=0.3:seed=20,lowpass=f=1500,highpass=f=100',
  ),
];

// --- Reactions --------------------------------------------------------------------

const TADA_CHORD = [523.25, 659.25, 783.99].map((f) => `sin(2*PI*${f}*(t-0.15))`).join('+');

const REACTIONS: OwnSound[] = [
  sfx(
    'ta-da',
    'Ta Da',
    'reactions',
    ['tada', 'celebration', 'success'],
    2,
    src(`0.25*gte(t,0.15)*(${TADA_CHORD})*exp(-1.5*(t-0.15))+0.3*lt(t,0.15)*sin(2*PI*392*t)`, 2),
  ),
  sfx(
    'sparkle',
    'Sparkle',
    'reactions',
    ['sparkle', 'magic', 'shine'],
    1,
    src(
      notes(
        [
          [0, 2093],
          [0.05, 2637],
          [0.1, 3136],
          [0.15, 4186],
        ],
        8,
        0.25,
      ),
      1,
    ),
  ),
  sfx(
    'drum-roll',
    'Drum Roll',
    'reactions',
    ['drum roll', 'suspense', 'build'],
    3,
    `${src(`${noise()}*(0.5+0.5*sin(2*PI*25*t))*min(1,t/2)`, 3)},bandpass=f=250:width_type=h:w=300`,
  ),
  sfx(
    'applause',
    'Applause',
    'reactions',
    ['applause', 'clap', 'cheer'],
    3,
    `${src(
      `${noise()}*(exp(-60*mod(t,0.11))+exp(-60*mod(t+0.03,0.13))+exp(-60*mod(t+0.05,0.17))+exp(-60*mod(t+0.07,0.19)))*0.3*min(1,(3-t)*2)`,
      3,
    )},bandpass=f=1500:width_type=h:w=2000`,
  ),
  sfx(
    'heartbeat',
    'Heartbeat',
    'reactions',
    ['heartbeat', 'pulse', 'tension'],
    3.6,
    src(
      `sin(2*PI*55*t)*(exp(-20*mod(t,0.9))+0.7*exp(-20*(mod(t,0.9)-0.25))*gte(mod(t,0.9),0.25))`,
      3.6,
    ),
  ),
  sfx(
    'wow-rise',
    'Wow Rise',
    'reactions',
    ['wow', 'rise', 'surprise'],
    1.2,
    src(`0.5*${sweep(300, 1200, 1.2)}*${swell(1.2)}`, 1.2),
  ),
  sfx(
    'wrong-answer',
    'Wrong Answer',
    'reactions',
    ['wrong', 'fail', 'answer'],
    0.6,
    `${src(
      squareNotes(
        [
          [0, 311, 0.25],
          [0.27, 233, 0.33],
        ],
        2,
        0.3,
      ),
      0.6,
    )},lowpass=f=1500`,
  ),
  sfx(
    'correct-answer',
    'Correct Answer',
    'reactions',
    ['correct', 'right', 'answer'],
    0.7,
    src(
      notes(
        [
          [0, 1046.5],
          [0.1, 1568],
        ],
        6,
        0.4,
      ),
      0.7,
    ),
  ),
  sfx(
    'cymbal-swell',
    'Cymbal Swell',
    'reactions',
    ['cymbal', 'swell', 'crescendo'],
    2,
    `${src(`${noise()}*pow(t/2,2)`, 2)},highpass=f=5000`,
  ),
  sfx(
    'dramatic-sting',
    'Dramatic Sting',
    'reactions',
    ['dramatic', 'sting', 'tension'],
    3,
    src(`0.3*(sin(2*PI*73.4*t)+sin(2*PI*87.3*t)+sin(2*PI*110*t))*exp(-1.2*t)`, 3),
  ),
];

// --- Transitions ------------------------------------------------------------------

const TRANSITIONS: OwnSound[] = [
  sfx(
    'riser',
    'Riser',
    'transitions',
    ['riser', 'build', 'transition'],
    3,
    `${src(`(0.6*${noise()}+0.4*${sweep(200, 2000, 3)})*pow(t/3,2)`, 3)},highpass=f=200`,
  ),
  sfx(
    'downlifter',
    'Downlifter',
    'transitions',
    ['downlifter', 'drop', 'transition'],
    2.5,
    src(`0.5*${sweep(1500, 100, 2.5)}*exp(-1.2*t)`, 2.5),
  ),
  sfx(
    'swipe',
    'Swipe',
    'transitions',
    ['swipe', 'transition', 'fast'],
    0.3,
    `${src(`${noise()}*${swell(0.3)}`, 0.3)},bandpass=f=3000:width_type=h:w=2500`,
  ),
  sfx(
    'glitch',
    'Glitch',
    'transitions',
    ['glitch', 'stutter', 'digital'],
    0.6,
    src(`0.3*tanh(4*sin(2*PI*(300*(1+mod(floor(t*30),5)))*t))*lt(mod(t,0.1),0.06)`, 0.6),
  ),
  sfx(
    'reverse-cymbal',
    'Reverse Cymbal',
    'transitions',
    ['reverse', 'cymbal', 'transition'],
    2,
    `${src(`${noise()}*pow(t/2,3)`, 2)},highpass=f=4000`,
  ),
  sfx(
    'tape-stop',
    'Tape Stop',
    'transitions',
    ['tape stop', 'slow down', 'transition'],
    0.8,
    src(`0.4*(sin(2*PI*440*(t-t*t/1.6))+0.3*sin(4*PI*440*(t-t*t/1.6)))*min(1,(0.8-t)*20)`, 0.8),
  ),
  sfx(
    'sweep-up',
    'Sweep Up',
    'transitions',
    ['sweep', 'up', 'transition'],
    1,
    src(`0.5*${sweep(200, 3000, 1)}*${swell(1)}`, 1),
  ),
  sfx(
    'sweep-down',
    'Sweep Down',
    'transitions',
    ['sweep', 'down', 'transition'],
    1,
    src(`0.5*${sweep(3000, 200, 1)}*${swell(1)}`, 1),
  ),
  sfx(
    'stutter',
    'Stutter',
    'transitions',
    ['stutter', 'chop', 'transition'],
    0.8,
    src(`0.5*sin(2*PI*880*t)*lt(mod(t,0.0625),0.035)*exp(-2*t)`, 0.8),
  ),
  sfx(
    'shimmer',
    'Shimmer',
    'transitions',
    ['shimmer', 'magic', 'transition'],
    2,
    src(
      `0.2*(sin(2*PI*1568*t)+sin(2*PI*2093*t)+sin(2*PI*2637*t))*(0.6+0.4*sin(2*PI*12*t))*pow(t/2,1.5)*min(1,(2-t)*10)`,
      2,
    ),
  ),
];

// --- Gaming -----------------------------------------------------------------------

const GAMING: OwnSound[] = [
  sfx(
    'coin',
    'Coin',
    'gaming',
    ['coin', 'collect', 'pickup'],
    0.5,
    `${src(
      squareNotes(
        [
          [0, 988, 0.08],
          [0.08, 1319, 0.4],
        ],
        6,
      ),
      0.5,
    )},lowpass=f=6000`,
  ),
  sfx(
    'jump',
    'Jump',
    'gaming',
    ['jump', 'bounce', 'retro'],
    0.3,
    `${src(`0.3*tanh(4*${sweep(300, 900, 0.25)})*exp(-6*t)`, 0.3)},lowpass=f=5000`,
  ),
  sfx(
    'power-up',
    'Power Up',
    'gaming',
    ['power up', 'upgrade', 'retro'],
    0.7,
    `${src(
      squareNotes(
        [523, 659, 784, 1047, 1319, 1568, 2093, 2637].map((f, k) => [k * 0.06, f, 0.08] as const),
        3,
        0.22,
      ),
      0.7,
    )},lowpass=f=6000`,
  ),
  sfx(
    'laser',
    'Laser',
    'gaming',
    ['laser', 'zap', 'space'],
    0.3,
    src(`0.5*${sweep(1800, 200, 0.25)}*exp(-8*t)`, 0.3),
  ),
  sfx(
    'retro-explosion',
    'Retro Explosion',
    'gaming',
    ['explosion', 'blast', 'retro'],
    1.5,
    `${src(`${noise()}*exp(-3*t)`, 1.5)},lowpass=f=800`,
  ),
  sfx(
    'game-over',
    'Game Over',
    'gaming',
    ['game over', 'lose', 'retro'],
    1.4,
    `${src(
      squareNotes(
        [
          [0, 523, 0.25],
          [0.25, 415, 0.25],
          [0.5, 349, 0.25],
          [0.75, 262, 0.6],
        ],
        1.5,
      ),
      1.4,
    )},lowpass=f=3000`,
  ),
  sfx(
    'extra-life',
    'Extra Life',
    'gaming',
    ['bonus', 'extra life', 'retro'],
    0.8,
    src(
      notes(
        [
          [0, 1319],
          [0.08, 1568],
          [0.16, 2637],
          [0.24, 2093],
          [0.32, 2349],
          [0.4, 3136],
        ],
        6,
        0.25,
      ),
      0.8,
    ),
  ),
  sfx(
    'hit-hurt',
    'Hit Hurt',
    'gaming',
    ['hit', 'hurt', 'damage'],
    0.25,
    src(`0.4*tanh(4*${sweep(220, 80, 0.2)})*exp(-12*t)+0.3*${noise()}*exp(-40*t)`, 0.25),
  ),
  sfx(
    'menu-select',
    'Menu Select',
    'gaming',
    ['menu', 'select', 'blip'],
    0.15,
    src(
      squareNotes(
        [
          [0, 1200, 0.05],
          [0.05, 1600, 0.06],
        ],
        4,
      ),
      0.15,
    ),
  ),
  sfx(
    'shield-charge',
    'Shield Charge',
    'gaming',
    ['shield', 'charge', 'energy'],
    1.5,
    src(
      `0.3*(${sweep(200, 800, 1.5)}+${sweep(203, 806, 1.5)})*(0.7+0.3*sin(2*PI*16*t))*min(1,t*4)*min(1,(1.5-t)*8)`,
      1.5,
    ),
  ),
];

// --- Comedy -----------------------------------------------------------------------

const TROMBONE = (f: number, at: number, len: number) =>
  `between(t,${at},${at + len})*(sin(2*PI*${f}*(t-${at}))+0.5*sin(4*PI*${f}*(t-${at}))+0.3*sin(6*PI*${f}*(t-${at})))*min(1,(t-${at})*30)*min(1,(${at + len}-t)*30)`;

const COMEDY: OwnSound[] = [
  sfx(
    'boing',
    'Boing',
    'comedy',
    ['boing', 'spring', 'bounce'],
    1.2,
    src(`0.5*sin(2*PI*200*t+8*sin(2*PI*12*t)*exp(-3*t))*exp(-3*t)`, 1.2),
  ),
  sfx(
    'slide-whistle-up',
    'Slide Whistle Up',
    'comedy',
    ['slide whistle', 'up', 'silly'],
    1,
    src(`0.4*sin(2*PI*(600*t+600*t*t)+2*sin(2*PI*6*t))*${swell(1)}`, 1),
  ),
  sfx(
    'slide-whistle-down',
    'Slide Whistle Down',
    'comedy',
    ['slide whistle', 'down', 'silly'],
    1,
    src(`0.4*sin(2*PI*(1800*t-600*t*t)+2*sin(2*PI*6*t))*${swell(1)}`, 1),
  ),
  sfx(
    'honk',
    'Honk',
    'comedy',
    ['honk', 'horn', 'clown'],
    0.7,
    `${src(`0.4*tanh(5*sin(2*PI*330*t))*(between(t,0,0.25)+between(t,0.35,0.65))`, 0.7)},lowpass=f=1200`,
  ),
  sfx(
    'sad-trombone',
    'Sad Trombone',
    'comedy',
    ['sad trombone', 'fail', 'wah wah'],
    2.6,
    `${src(
      `0.2*(${TROMBONE(293.7, 0, 0.45)}+${TROMBONE(277.2, 0.5, 0.45)}+${TROMBONE(261.6, 1, 0.45)})+0.2*between(t,1.5,2.6)*(sin(2*PI*246.9*(t-1.5)+3*sin(2*PI*5*(t-1.5))))*min(1,(2.6-t)*5)`,
      2.6,
    )},lowpass=f=2500`,
  ),
  sfx(
    'cartoon-pop',
    'Cartoon Pop',
    'comedy',
    ['pop', 'cartoon', 'bubble'],
    0.25,
    src(`0.5*${sweep(400, 1600, 0.05)}*exp(-20*t)`, 0.25),
  ),
  sfx(
    'wobble',
    'Wobble',
    'comedy',
    ['wobble', 'wiggle', 'silly'],
    1.5,
    src(`0.4*sin(2*PI*150*t+3*sin(2*PI*8*t))*(0.5+0.5*sin(2*PI*6*t))*min(1,(1.5-t)*6)`, 1.5),
  ),
  sfx(
    'squeak',
    'Squeak',
    'comedy',
    ['squeak', 'toy', 'cute'],
    0.3,
    src(`0.4*${sweep(2000, 2600, 0.3)}*${swell(0.3)}`, 0.3),
  ),
  sfx(
    'bonk',
    'Bonk',
    'comedy',
    ['bonk', 'knock', 'head'],
    0.3,
    `${src(`0.5*sin(2*PI*700*t)*exp(-40*t)+0.3*${noise()}*exp(-80*t)`, 0.3)},lowpass=f=3000`,
  ),
  sfx(
    'cuckoo',
    'Cuckoo',
    'comedy',
    ['cuckoo', 'clock', 'silly'],
    0.9,
    src(
      notes(
        [
          [0, 659.25],
          [0.35, 523.25],
        ],
        5,
        0.4,
      ),
      0.9,
    ),
  ),
];

// --- Impacts ----------------------------------------------------------------------

const IMPACTS: OwnSound[] = [
  sfx(
    'thud',
    'Thud',
    'impacts',
    ['thud', 'heavy', 'hit'],
    0.6,
    `${src(`sin(2*PI*60*t)*exp(-12*t)+0.4*${noise()}*exp(-30*t)`, 0.6)},lowpass=f=800`,
  ),
  sfx(
    'punch',
    'Punch',
    'impacts',
    ['punch', 'hit', 'fight'],
    0.4,
    `${src(`0.6*${noise()}*exp(-25*t)+0.6*sin(2*PI*90*t)*exp(-15*t)`, 0.4)},lowpass=f=1500`,
  ),
  sfx(
    'slam',
    'Slam',
    'impacts',
    ['slam', 'door', 'hit'],
    1,
    `${src(`0.6*${noise()}*exp(-10*t)+0.5*sin(2*PI*50*t)*exp(-6*t)`, 1)},lowpass=f=2500`,
  ),
  sfx(
    'boom',
    'Boom',
    'impacts',
    ['boom', 'deep', 'explosion'],
    3,
    `${src(`0.5*${noise()}*exp(-2*t)+0.6*${sweep(60, 30, 3)}*exp(-1.5*t)`, 3)},lowpass=f=300`,
  ),
  sfx(
    'metal-hit',
    'Metal Hit',
    'impacts',
    ['metal', 'clang', 'hit'],
    2.5,
    src(
      `0.3*sin(2*PI*520*t)*exp(-2*t)+0.25*sin(2*PI*1187*t)*exp(-3*t)+0.2*sin(2*PI*2140*t)*exp(-4*t)+0.15*sin(2*PI*3011*t)*exp(-6*t)+0.3*${noise()}*exp(-60*t)`,
      2.5,
    ),
  ),
  sfx(
    'wood-knock',
    'Wood Knock',
    'impacts',
    ['wood', 'knock', 'tap'],
    0.5,
    src(
      `(gte(t,0)*exp(-50*t)+gte(t,0.2)*exp(-50*(t-0.2)))*(0.5*sin(2*PI*900*t)+0.25*sin(2*PI*1800*t))`,
      0.5,
    ),
  ),
  sfx(
    'glass-ting',
    'Glass Ting',
    'impacts',
    ['glass', 'ting', 'clink'],
    1.5,
    src(
      `0.3*sin(2*PI*2600*t)*exp(-3*t)+0.2*sin(2*PI*4100*t)*exp(-5*t)+0.1*sin(2*PI*6200*t)*exp(-8*t)`,
      1.5,
    ),
  ),
  sfx(
    'sub-drop',
    'Sub Drop',
    'impacts',
    ['sub drop', 'bass', 'impact'],
    2,
    src(`0.8*${sweep(120, 30, 2)}*exp(-1.5*t)*min(1,t*200)`, 2),
  ),
  sfx(
    'hard-hit',
    'Hard Hit',
    'impacts',
    ['smash', 'hit', 'impact'],
    0.5,
    `${src(`0.7*${noise()}*exp(-18*t)+0.5*sin(2*PI*70*t)*exp(-10*t)`, 0.5)},lowpass=f=5000`,
  ),
  sfx(
    'kick-drum',
    'Kick Drum',
    'impacts',
    ['kick', 'drum', 'beat'],
    0.5,
    src(`0.9*sin(2*PI*(45*t+2*(1-exp(-30*t))))*exp(-9*t)`, 0.5),
  ),
];

// --- Whooshes ---------------------------------------------------------------------

function whoosh(seconds: number, filter: string): string {
  return `${src(`${noise()}*pow(sin(PI*pow(t/${seconds},0.7)),2)`, seconds)},${filter}`;
}

const WHOOSHES: OwnSound[] = [
  sfx(
    'whoosh-soft',
    'Whoosh Soft',
    'whooshes',
    ['whoosh', 'soft', 'air'],
    0.8,
    whoosh(0.8, 'bandpass=f=800:width_type=h:w=900'),
  ),
  sfx(
    'whoosh-fast',
    'Whoosh Fast',
    'whooshes',
    ['whoosh', 'fast', 'swoosh'],
    0.35,
    whoosh(0.35, 'bandpass=f=1500:width_type=h:w=1500'),
  ),
  sfx(
    'whoosh-deep',
    'Whoosh Deep',
    'whooshes',
    ['whoosh', 'deep', 'low'],
    1.2,
    whoosh(1.2, 'lowpass=f=600'),
  ),
  sfx(
    'swoosh-high',
    'Swoosh High',
    'whooshes',
    ['swoosh', 'high', 'air'],
    0.5,
    whoosh(0.5, 'highpass=f=2000'),
  ),
  sfx(
    'air-pass',
    'Air Pass',
    'whooshes',
    ['whoosh', 'pass', 'air'],
    1,
    `${src(`${noise(0)}*pow(sin(PI*min(1,t/0.7)),2)`, 1)},lowpass=f=700[a];` +
      `${src(`${noise(1)}*pow(sin(PI*max(0,(t-0.3)/0.7)),2)`, 1)},highpass=f=1500[b];` +
      '[a][b]amix=inputs=2:normalize=0[out0]',
  ),
  sfx(
    'double-whoosh',
    'Double Whoosh',
    'whooshes',
    ['whoosh', 'double', 'swoosh'],
    0.9,
    `${src(`${noise()}*(pow(sin(PI*min(1,t/0.4)),2)*lt(t,0.4)+pow(sin(PI*min(1,max(0,t-0.45)/0.4)),2)*gte(t,0.45))`, 0.9)},bandpass=f=1200:width_type=h:w=1200`,
  ),
  sfx(
    'whoosh-reverse',
    'Whoosh Reverse',
    'whooshes',
    ['whoosh', 'reverse', 'rise'],
    1,
    `${src(`${noise()}*pow(t,3)*min(1,(1-t)*40)`, 1)},bandpass=f=1000:width_type=h:w=1200`,
  ),
  sfx(
    'swish',
    'Swish',
    'whooshes',
    ['swish', 'fast', 'swoosh'],
    0.2,
    whoosh(0.2, 'bandpass=f=3000:width_type=h:w=2500'),
  ),
  sfx(
    'wind-gust',
    'Wind Gust',
    'whooshes',
    ['wind', 'gust', 'whoosh'],
    2,
    whoosh(2, 'bandpass=f=500:width_type=h:w=400'),
  ),
  sfx(
    'swoosh-long',
    'Swoosh Long',
    'whooshes',
    ['swoosh', 'long', 'whoosh'],
    2,
    `${src(`${noise()}*pow(sin(PI*t/2),2)*(0.7+0.3*sin(2*PI*4*t))`, 2)},bandpass=f=900:width_type=h:w=1000`,
  ),
];

// --- Music loops ------------------------------------------------------------------

interface LoopSpec {
  id: string;
  name: string;
  category: Extract<OwnSoundCategory, 'calm' | 'upbeat' | 'tense' | 'cinematic' | 'lofi' | 'epic'>;
  tags: string[];
  bpm: number;
  bars: number;
  /** The key's root in Hz. */
  root: number;
  /** One chord a bar, as semitones from the root, with its third (3 minor, 4 major). */
  chords: ReadonlyArray<readonly [number, 3 | 4]>;
  pad: number;
  arp: {
    level: number;
    wave: 'sine' | 'square' | 'triangle';
    down?: boolean;
    perBeat: 2 | 4;
  } | null;
  bass: number;
  kick: 'four' | 'half' | null;
  hat: number;
  crackle: boolean;
  lowpass?: number;
  echo?: boolean;
}

function wave(kind: 'sine' | 'square' | 'triangle', phase: string): string {
  if (kind === 'square') return `tanh(3*sin(2*PI*${phase}))`;
  if (kind === 'triangle') return `(asin(sin(2*PI*${phase}))*2/PI)`;
  return `sin(2*PI*${phase})`;
}

/** A nested `if` that picks `values[k]` for the index held in variable 0. */
function pick(values: readonly number[]): string {
  return values
    .slice(0, -1)
    .reduceRight(
      (rest, value, k) => `if(eq(ld(0),${k}),${value},${rest})`,
      String(values[values.length - 1]),
    );
}

function loopGraph(spec: LoopSpec): { graph: string; seconds: number } {
  const beat = 60 / spec.bpm;
  const bar = beat * 4;
  const seconds = Math.round(bar * spec.bars * 1000) / 1000;
  const count = spec.chords.length;
  const parts: string[] = [
    // 0: the chord, 1: its root in semitones, 2: its third, 3: time in the bar, 4: the bar's gate.
    `st(0,mod(floor(t/${bar}),${count}))`,
    `st(1,${pick(spec.chords.map(([semis]) => semis))})`,
    `st(2,${pick(spec.chords.map(([, third]) => third))})`,
    `st(3,mod(t,${bar}))`,
    `st(4,min(1,ld(3)/0.03)*min(1,(${bar}-ld(3))/0.03))`,
  ];
  const sum: string[] = [];
  if (spec.pad > 0) {
    const tone = (semis: string) => `sin(2*PI*${spec.root}*pow(2,(${semis})/12)*t)`;
    sum.push(`${spec.pad}*ld(4)*(${tone('ld(1)')}+${tone('ld(1)+ld(2)')}+${tone('ld(1)+7')})/3`);
  }
  if (spec.arp) {
    const step = beat / spec.arp.perBeat;
    const order = spec.arp.down ? ['12', '7', 'ld(2)', '0'] : ['0', 'ld(2)', '7', '12'];
    parts.push(
      `st(5,mod(floor(t/${step}),4))`,
      `st(6,mod(t,${step}))`,
      `st(7,if(eq(ld(5),0),${order[0]},if(eq(ld(5),1),${order[1]},if(eq(ld(5),2),${order[2]},${order[3]}))))`,
    );
    const phase = `${spec.root * 2}*pow(2,(ld(1)+ld(7))/12)*t`;
    sum.push(`${spec.arp.level}*min(1,ld(6)*200)*exp(-ld(6)*6)*${wave(spec.arp.wave, phase)}`);
  }
  if (spec.bass > 0 || spec.kick) parts.push(`st(8,mod(t,${beat}))`);
  if (spec.bass > 0) {
    const phase = `${spec.root / 2}*pow(2,ld(1)/12)*t`;
    sum.push(
      `${spec.bass}*min(1,ld(8)*200)*exp(-ld(8)*4)*(sin(2*PI*${phase})+0.3*sin(4*PI*${phase}))`,
    );
  }
  if (spec.kick) {
    const period = spec.kick === 'four' ? beat : beat * 2;
    parts.push(`st(9,mod(t,${period}))`);
    sum.push(`0.8*sin(2*PI*(45*ld(9)+2*(1-exp(-30*ld(9)))))*exp(-ld(9)*9)`);
  }
  const main = `${parts.join(';')};${sum.join('+')}`;
  const filters: string[] = [];
  if (spec.lowpass) filters.push(`lowpass=f=${spec.lowpass}`);
  if (spec.echo) filters.push('aecho=0.8:0.6:300:0.35');
  let graph = `${src(main, seconds)}${filters.length > 0 ? `,${filters.join(',')}` : ''}`;
  const layers: string[] = [];
  if (spec.hat > 0) {
    layers.push(
      `${src(`${spec.hat}*${noise(0)}*exp(-mod(t+${beat / 2},${beat})*60)`, seconds)},highpass=f=6000`,
    );
  }
  if (spec.crackle) {
    layers.push(
      `${src(`0.02*${noise(0)}+0.4*${noise(1)}*gt(random(2),0.9996)`, seconds)},lowpass=f=3000`,
    );
  }
  if (layers.length > 0) {
    const labels = ['[m]', ...layers.map((_, k) => `[l${k}]`)];
    graph = `${graph}[m];${layers.map((layer, k) => `${layer}[l${k}]`).join(';')};${labels.join('')}amix=inputs=${labels.length}:normalize=0[out0]`;
  }
  return { graph, seconds };
}

function music(spec: LoopSpec): OwnSound {
  const { graph, seconds } = loopGraph(spec);
  return {
    id: spec.id,
    name: spec.name,
    category: spec.category,
    kind: 'music',
    tags: spec.tags,
    graph,
    seconds,
    bpm: spec.bpm,
  };
}

const BASE = { pad: 0, arp: null, bass: 0, kick: null, hat: 0, crackle: false } as const;

const MUSIC: OwnSound[] = [
  music({
    ...BASE,
    id: 'calm-morning',
    name: 'Calm Morning',
    category: 'calm',
    tags: ['calm', 'gentle', 'loop'],
    bpm: 70,
    bars: 4,
    root: 261.63,
    chords: [
      [0, 4],
      [5, 4],
      [-3, 3],
      [7, 4],
    ],
    pad: 0.5,
    arp: { level: 0.15, wave: 'sine', perBeat: 2 },
    lowpass: 3000,
  }),
  music({
    ...BASE,
    id: 'soft-focus',
    name: 'Soft Focus',
    category: 'calm',
    tags: ['calm', 'focus', 'loop'],
    bpm: 80,
    bars: 4,
    root: 293.66,
    chords: [
      [0, 4],
      [-3, 3],
      [5, 4],
      [7, 4],
    ],
    pad: 0.4,
    arp: { level: 0.2, wave: 'triangle', perBeat: 2 },
    lowpass: 2500,
  }),
  music({
    ...BASE,
    id: 'bright-steps',
    name: 'Bright Steps',
    category: 'upbeat',
    tags: ['upbeat', 'happy', 'loop'],
    bpm: 120,
    bars: 8,
    root: 261.63,
    chords: [
      [0, 4],
      [-3, 3],
      [5, 4],
      [7, 4],
    ],
    pad: 0.25,
    arp: { level: 0.25, wave: 'square', perBeat: 2 },
    bass: 0.4,
    kick: 'four',
    hat: 0.15,
    lowpass: 6000,
  }),
  music({
    ...BASE,
    id: 'sunny-bounce',
    name: 'Sunny Bounce',
    category: 'upbeat',
    tags: ['upbeat', 'bouncy', 'loop'],
    bpm: 128,
    bars: 8,
    root: 293.66,
    chords: [
      [0, 4],
      [7, 4],
      [-3, 3],
      [5, 4],
    ],
    pad: 0.2,
    arp: { level: 0.25, wave: 'triangle', perBeat: 4 },
    bass: 0.4,
    kick: 'four',
    hat: 0.15,
  }),
  music({
    ...BASE,
    id: 'low-pulse',
    name: 'Low Pulse',
    category: 'tense',
    tags: ['tense', 'dark', 'loop'],
    bpm: 90,
    bars: 4,
    root: 110,
    chords: [
      [0, 3],
      [0, 3],
      [1, 4],
      [0, 3],
    ],
    pad: 0.5,
    bass: 0.5,
    kick: 'half',
    lowpass: 1800,
  }),
  music({
    ...BASE,
    id: 'ticking',
    name: 'Ticking',
    category: 'tense',
    tags: ['tense', 'suspense', 'loop'],
    bpm: 100,
    bars: 4,
    root: 220,
    chords: [
      [0, 3],
      [-2, 4],
      [0, 3],
      [1, 4],
    ],
    pad: 0.3,
    arp: { level: 0.2, wave: 'square', perBeat: 4 },
    hat: 0.2,
    lowpass: 1500,
  }),
  music({
    ...BASE,
    id: 'wide-horizon',
    name: 'Wide Horizon',
    category: 'cinematic',
    tags: ['cinematic', 'wide', 'loop'],
    bpm: 60,
    bars: 4,
    root: 196,
    chords: [
      [0, 4],
      [-4, 4],
      [5, 4],
      [7, 4],
    ],
    pad: 0.6,
    echo: true,
    lowpass: 4000,
  }),
  music({
    ...BASE,
    id: 'rising-light',
    name: 'Rising Light',
    category: 'cinematic',
    tags: ['cinematic', 'hopeful', 'loop'],
    bpm: 72,
    bars: 4,
    root: 220,
    chords: [
      [0, 3],
      [-4, 4],
      [-2, 4],
      [3, 4],
    ],
    pad: 0.5,
    arp: { level: 0.12, wave: 'sine', perBeat: 2 },
    kick: 'half',
    echo: true,
  }),
  music({
    ...BASE,
    id: 'late-study',
    name: 'Late Study',
    category: 'lofi',
    tags: ['lofi', 'study', 'chill'],
    bpm: 80,
    bars: 4,
    root: 233.08,
    chords: [
      [2, 3],
      [7, 4],
      [0, 4],
      [-3, 3],
    ],
    pad: 0.4,
    arp: { level: 0.15, wave: 'triangle', perBeat: 2 },
    kick: 'half',
    hat: 0.1,
    crackle: true,
    lowpass: 2200,
  }),
  music({
    ...BASE,
    id: 'rainy-window',
    name: 'Rainy Window',
    category: 'lofi',
    tags: ['lofi', 'rainy', 'chill'],
    bpm: 75,
    bars: 4,
    root: 207.65,
    chords: [
      [0, 4],
      [-3, 3],
      [5, 4],
      [7, 4],
    ],
    pad: 0.45,
    bass: 0.3,
    kick: 'half',
    hat: 0.08,
    crackle: true,
    lowpass: 1800,
  }),
  music({
    ...BASE,
    id: 'brave-march',
    name: 'Brave March',
    category: 'epic',
    tags: ['epic', 'march', 'loop'],
    bpm: 110,
    bars: 8,
    root: 220,
    chords: [
      [0, 3],
      [-4, 4],
      [-2, 4],
      [-5, 3],
    ],
    pad: 0.4,
    arp: { level: 0.2, wave: 'square', perBeat: 2 },
    bass: 0.5,
    kick: 'four',
    echo: true,
    lowpass: 5000,
  }),
  music({
    ...BASE,
    id: 'final-stand',
    name: 'Final Stand',
    category: 'epic',
    tags: ['epic', 'powerful', 'loop'],
    bpm: 130,
    bars: 8,
    root: 196,
    chords: [
      [0, 3],
      [-4, 4],
      [-2, 4],
      [-2, 4],
    ],
    pad: 0.35,
    arp: { level: 0.25, wave: 'square', down: true, perBeat: 4 },
    bass: 0.5,
    kick: 'four',
    hat: 0.15,
  }),
];

export const OWN_SOUNDS: readonly OwnSound[] = [
  ...ALERTS,
  ...AMBIENT,
  ...REACTIONS,
  ...TRANSITIONS,
  ...GAMING,
  ...COMEDY,
  ...IMPACTS,
  ...WHOOSHES,
  ...MUSIC,
];
