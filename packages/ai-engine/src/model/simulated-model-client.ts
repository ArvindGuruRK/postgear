/**
 * The simulated model client — a language model with no model in it.
 *
 * `AI_SIMULATION=true` is how PostGear is exercised locally and in CI: every
 * screen, credit rule, SSE stream and tool call is real, only the provider
 * is replaced. For that to be worth anything the stand-in has to behave like
 * the real thing where the rest of the system can tell: it must honour the
 * tone (I vs. we), the format (one post or a thread, short or long), the
 * character ceiling, the image-prompt request, and it must *decide* to call
 * tools so the copilot loop runs end to end. It does all of that by parsing
 * the labelled fields the prompts carry (see `prompts/fields.ts`) and
 * assembling copy from template pools.
 *
 * Deterministic on purpose: the PRNG is seeded from the prompt text, so the
 * same brief produces the same post, tests can assert on shape, and a demo
 * does not change under someone's hands. There is no artificial delay — a
 * simulation that pretends to be slow only slows the tests.
 */
import { z } from 'zod';
import { decodeToolResult } from '../prompts/copilot';
import { readBlock, readField } from '../prompts/fields';
import { type Pronouns, pronounsFor } from '../prompts/tone';
import {
  AI_CATEGORIES,
  type AiCategory,
  type ModelChunk,
  type ModelClient,
  type ModelMessage,
  type ModelToolCall,
  type ModelToolSpec,
  type PostFormat,
  type Tone,
} from '../types';
import { providerError, throwIfAborted } from './resilience';

export const SIMULATED_MODEL_NAME = 'simulation';

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

export function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** mulberry32: small, fast, good enough to pick templates. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class Picker {
  private readonly random: () => number;
  constructor(seed: number) {
    this.random = seededRandom(seed);
  }
  int(maxExclusive: number): number {
    return Math.floor(this.random() * maxExclusive);
  }
  one<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }
  shuffle<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = this.int(i + 1);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

const CATEGORY_RULES: ReadonlyArray<[RegExp, AiCategory]> = [
  [/\b(how to|step[- ]by[- ]step|walkthrough|tutorial|set ?up|guide)\b/i, 'Tutorial'],
  [/\b(tips?|tricks?|hacks?|mistakes?|checklist|lessons?)\b/i, 'Tips'],
  [
    /\b(launch(ing|ed)?|announc\w+|introducing|now available|new release|releas(e|ing)|shipp(ed|ing)|unveil)/i,
    'Announcement',
  ],
  [/\b(webinar|conference|meetup|workshop|summit|event|live session|join us)\b/i, 'Event'],
  [/\b(sale|discount|offer|pricing|deal|coupon|promo\w*|sign up|free trial|buy)\b/i, 'Promotional'],
  [/\b(customer|client|review|testimonial|case study|said about|feedback)\b/i, 'Testimonial'],
  [
    /\b(behind the scenes|our team|our office|how we built|our process|day in the life)\b/i,
    'Behind the scenes',
  ],
  [
    /\b(anniversary|milestone|celebrat\w+|thank you|thanks to|congrat\w+|birthday|hit \d)/i,
    'Celebration',
  ],
  [/\b(funny|joke|humou?r|lol|meme|relatable)\b/i, 'Humorous'],
  [/\b(trend\w*|future of|in 202\d|predictions?|next big|rise of)\b/i, 'Trend'],
  [/\b(news|report(ed)?|breaking|just in|headline|study finds|survey)\b/i, 'News'],
  [/\b(story|journey|my path|started|founded|failure|lesson learned)\b/i, 'Story'],
  [/\b(inspir\w+|motivat\w+|dream|believe|courage|keep going|never give up)\b/i, 'Inspirational'],
  [/\b(what do you think|poll|would you|which do you|curious|thoughts\?)\b|\?$/i, 'Question'],
  [/\b(learn|explain|why|what is|understand|basics|introduction to|definition)\b/i, 'Educational'],
];

export function classifyTopic(topic: string): AiCategory {
  for (const [pattern, category] of CATEGORY_RULES) {
    if (pattern.test(topic)) return category;
  }
  return 'Educational';
}

type Family = 'announce' | 'teach' | 'narrate' | 'engage';

const FAMILY_OF: Record<AiCategory, Family> = {
  Announcement: 'announce',
  News: 'announce',
  Event: 'announce',
  Celebration: 'announce',
  Promotional: 'announce',
  Educational: 'teach',
  Tips: 'teach',
  Tutorial: 'teach',
  Story: 'narrate',
  'Behind the scenes': 'narrate',
  Testimonial: 'narrate',
  Inspirational: 'narrate',
  Question: 'engage',
  Humorous: 'engage',
  Trend: 'engage',
};

// ---------------------------------------------------------------------------
// Subject extraction
// ---------------------------------------------------------------------------

const LEADING_REQUEST =
  /^(please\s+)?(can you\s+|could you\s+|i want you to\s+|i need\s+)?(write|generate|create|compose|draft|make)\s+(me\s+)?(a|an|the)?\s*(short|long|quick|new)?\s*(linkedin|x|twitter|instagram|facebook|threads|tiktok|youtube)?\s*(post|thread|article|update|caption)?\s*(about|on|for|covering)?\s*/i;

const SUBJECT_MAX_CHARS = 60;
const TRAILING_STOPWORD =
  /\s+(a|an|the|and|or|but|with|without|to|of|for|in|on|at|by|from|that|which|who|while|when|if|so|as|than|into|about)$/i;

/** A short noun phrase for the brief, so templates can say "…about {subject}". */
export function subjectOf(brief: string): string {
  let text = brief.replace(/\s+/g, ' ').trim().replace(LEADING_REQUEST, '');
  text = text.replace(/^(about|on)\s+/i, '');
  const clause = text.split(/(?<=[.!?])\s|[;:\n]| — | - /)[0] ?? text;
  let subject = clause.trim().replace(/[.!?,"']+$/g, '');
  if (subject.length > SUBJECT_MAX_CHARS) {
    const cut = subject.slice(0, SUBJECT_MAX_CHARS);
    const space = cut.lastIndexOf(' ');
    subject = (space > 24 ? cut.slice(0, space) : cut).trim();
  }
  // A phrase cut after "without" or "and" reads as broken; drop dangling function words.
  let trimmed = subject;
  while (true) {
    const next = trimmed.replace(TRAILING_STOPWORD, '').trim();
    if (next === trimmed || next.length === 0) break;
    trimmed = next;
  }
  if (trimmed.length > 0) subject = trimmed;
  if (/^[A-Z][a-z]/.test(subject) && !/^[A-Z][a-z]+\s+[A-Z]/.test(subject)) {
    subject = subject.charAt(0).toLowerCase() + subject.slice(1);
  }
  return subject.length > 0 ? subject : 'this';
}

// ---------------------------------------------------------------------------
// Template pools
// ---------------------------------------------------------------------------

interface Slots {
  subject: string;
  brand: string;
  pron: Pronouns;
  n: number;
  source?: { title: string; snippet: string };
}

function fill(template: string, slots: Slots): string {
  const { pron } = slots;
  return template
    .replace(/\{subject\}/g, slots.subject)
    .replace(/\{brand\}/g, slots.brand)
    .replace(/\{S\}/g, pron.Subject)
    .replace(/\{s\}/g, pron.subject)
    .replace(/\{o\}/g, pron.object)
    .replace(/\{p\}/g, pron.possessive)
    .replace(/\{P\}/g, capitalise(pron.possessive))
    .replace(/\{n\}/g, String(slots.n))
    .replace(/\{src\}/g, slots.source?.title ?? 'a recent report')
    .replace(/\{snippet\}/g, slots.source ? shorten(slots.source.snippet, 110) : '')
    .replace(/\s+([.,!?])/g, '$1')
    .replace(/…\./g, '…')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function shorten(text: string, max: number): string {
  const clean = text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?]+$/, '');
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > 20 ? cut.slice(0, space) : cut).trim()}…`;
}

const HOOKS: Record<Family, Record<Tone, readonly string[]>> = {
  announce: {
    personal: [
      'I have been sitting on this for weeks. Today I get to talk about {subject}.',
      'Something changed for me around {subject}, and I think it matters to you too.',
      'I rarely post announcements. This one about {subject} is the exception.',
      'Quick one from me: {subject} is happening, and here is what it means.',
    ],
    company: [
      'We have been quiet about {subject} for a reason. Today we can finally say it.',
      'Big day at {brand}: {subject} is here.',
      'We built this because you asked for it. Meet {subject}.',
      'A short note from the {brand} team on {subject}, and why it matters now.',
    ],
  },
  teach: {
    personal: [
      'I spent {n} months getting {subject} wrong. Here is the short version of what I learned.',
      'Nobody explained {subject} to me plainly, so I am doing it here.',
      'The thing about {subject} that took me far too long to understand.',
      'I keep getting asked about {subject}. Let me save you the research.',
    ],
    company: [
      'We get more questions about {subject} than anything else. Here is our honest answer.',
      'Our team has watched {n} people struggle with {subject}. The fix is simpler than it looks.',
      'Everything we have learned at {brand} about {subject}, in one post.',
      'Most advice on {subject} skips the part that matters. We will not.',
    ],
  },
  narrate: {
    personal: [
      'A year ago I would have laughed at the idea of {subject}. Now it is my week.',
      'Here is the part of {subject} nobody puts in the highlight reel.',
      'I almost did not share this story about {subject}. Then I remembered who needed it.',
      'The smallest decision I made about {subject} turned out to be the one that mattered.',
    ],
    company: [
      'Here is what {subject} actually looked like from inside {brand}.',
      'We made a mistake with {subject}. Then we made it the best thing we did this year.',
      'Nobody sees the {n} drafts behind {subject}. We thought you should.',
      'The story of {subject} started with a customer who would not take no for an answer.',
    ],
  },
  engage: {
    personal: [
      'Unpopular opinion about {subject}: the conventional wisdom is backwards.',
      'I have a theory about {subject}, and I want you to tell me where it breaks.',
      'Everyone is talking about {subject}. Here is what I think they are missing.',
      'A question I cannot stop thinking about: where does {subject} go next?',
    ],
    company: [
      'We asked {n} people about {subject}. Their answers surprised us.',
      'Hot take from the {brand} team: {subject} is about to look very different.',
      'What do you actually want from {subject}? We are listening.',
      'The {subject} conversation is louder than ever. Here is our read on it.',
    ],
  },
};

const BODY: Record<Family, readonly string[]> = {
  announce: [
    '{S} wanted {subject} to feel obvious the first time you use it, so most of the work went into what you never see.',
    'The short version: it does one thing well and gets out of {p} way.',
    'It took {n} rounds of feedback to get here, and every round made it simpler.',
    'If you have been waiting on this, {s} kept you in mind at every step.',
    'Nothing changes for anyone who is happy with what they have today.',
    '{S} will be sharing more over the coming weeks, including the parts that did not make the cut.',
    'Early access starts now, and {s} would rather hear the rough edges than the praise.',
    'What {s} are most proud of is not the feature but how little explaining it needs.',
  ],
  teach: [
    'Start with the problem, not the tool. Most trouble with {subject} comes from skipping that step.',
    'The mistake {s} see most often is treating {subject} as a one-time setup instead of a habit.',
    'Keep a single source of truth. The moment there are two, both are wrong.',
    'Write down what good looks like before you start, or you will move the goalposts without noticing.',
    'Small, boring, repeatable beats big and clever every time {s} have tested it.',
    'If it takes more than {n} minutes to explain, it is probably two things wearing one name.',
    'Measure one number. Pick it on purpose and stop watching the others for a month.',
    'The best part of {subject} is how quickly it compounds once the basics are in place.',
    'Review it on a schedule, not when something breaks, and it will break far less often.',
  ],
  narrate: [
    'It started small: one conversation, one awkward afternoon, and a note {s} almost threw away.',
    'For a while it looked like {subject} was not going to work, and {s} nearly stopped.',
    'The turning point was not a big decision. It was agreeing to show the unfinished version.',
    'People were kinder about the rough parts than {s} expected, and far more useful.',
    'What {s} would tell {p} past self: the thing you are embarrassed by is the thing worth sharing.',
    'Looking back, the slow months did more for {subject} than the fast ones.',
    'The credit belongs to the people who told {o} the truth when it was inconvenient.',
    'If any of this sounds familiar, you are further along than you think.',
  ],
  engage: [
    'Here is the pattern {s} keep noticing with {subject}: the loudest advice is the least tested.',
    'Everyone agrees it matters, almost nobody agrees on why, and that gap is where the opportunity is.',
    '{S} could be wrong about this, which is exactly why {s} am putting it in public.',
    'Two camps are forming, and {s} suspect both are describing the same thing from different sides.',
    'The honest answer is that it depends, but "it depends" is not a plan, so here is {p} take.',
    'Watch what people do with {subject} rather than what they say about it.',
    'The interesting question is not whether this lasts but what replaces it.',
    'If you have seen it play out differently, {s} genuinely want to know.',
  ],
};

/** Sentences any family can use, so long parts do not repeat the family pool. */
const GENERAL: readonly string[] = [
  'None of this needs a bigger budget. It needs a smaller list of things {s} actually do.',
  'The useful question is not "what is best" but "what will {s} still be doing in {n} weeks".',
  'Consistency is mostly a scheduling problem wearing a motivation costume.',
  'When something works, {s} write down why before {s} forget and call it luck.',
  'Most of the gains came from removing steps, not adding tools.',
  'The honest metric is whether it is easier this month than last month.',
  'Nobody notices the system when it works, which is the point of having one.',
  'Pick a cadence {s} can keep on a bad week, not the one {s} can keep on a good one.',
  'The draft that ships beats the perfect one that does not.',
  'If {s} had to start over, {s} would start smaller and sooner.',
  'A clear owner matters more than a clever process.',
  'Good enough, on time, every time, is a competitive advantage most teams ignore.',
];

const RESEARCH_LINES: readonly string[] = [
  'According to {src}, {snippet}.',
  '{src} puts it plainly: {snippet}.',
  'One detail from {src} stuck with {o}: {snippet}.',
  'The data backs this up. {src} notes that {snippet}.',
];

const TRANSITIONS: readonly string[] = [
  'Here is where it gets practical.',
  'The part most people skip is the setup.',
  'Now the piece that actually moves the needle.',
  'One more thing, and it is the one {s} would start with.',
  'A quick detour that turns out to matter.',
  'Then there is the question of timing.',
];

const CLOSERS: Record<Tone, readonly string[]> = {
  personal: [
    'What has worked for you? I read every reply.',
    'If this helped, tell me what I should dig into next.',
    'Disagree with any of it? I would love to hear why.',
    'Save this for the next time {subject} comes up. Future you will thank you.',
    'That is my take. What is yours?',
  ],
  company: [
    'Tell us what you would add. We read every reply.',
    'Want the longer version? Say the word and we will write it.',
    'If this helped, share it with someone who is wrestling with {subject} right now.',
    'We would love to hear how {subject} is going on your side.',
    'That is our take. What is yours?',
  ],
};

const IMAGE_PROMPTS: readonly string[] = [
  'A clean editorial illustration about {subject}: soft morning light, muted warm palette, simple geometric shapes, plenty of negative space, no text, no logos.',
  'A minimal flat-vector scene representing {subject}, two-tone palette with one accent colour, calm composition, no words or brand marks.',
  'A photographic still life suggesting {subject}, shallow depth of field, natural daylight, neutral tones, no text anywhere in the frame.',
  'An abstract paper-cut collage evoking {subject}, layered shapes with gentle shadows, pastel colours, no typography.',
];

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

interface ComposeSpec {
  brief: string;
  hook: string;
  tone: Tone;
  format: PostFormat;
  category: AiCategory;
  maxChars: number;
  minChars: number;
  minParts: number;
  maxParts: number;
  withImage: boolean;
  workspaceName: string | null;
  sources: Array<{ title: string; snippet: string }>;
}

class SentenceWell {
  private queue: string[];
  constructor(
    private readonly pool: readonly string[],
    private readonly picker: Picker,
  ) {
    this.queue = picker.shuffle(pool);
  }
  next(): string {
    if (this.queue.length === 0) this.queue = this.picker.shuffle(this.pool);
    const item = this.queue.shift();
    return item ?? this.pool[0];
  }
}

function composeParts(
  spec: ComposeSpec,
  picker: Picker,
): Array<{ text: string; imagePrompt: string | null }> {
  const pron = pronounsFor(spec.tone, spec.workspaceName ?? undefined);
  const family = FAMILY_OF[spec.category];
  const subject = subjectOf(spec.brief);
  const slots: Slots = {
    subject,
    brand: pron.speakerName === 'I' ? 'the team' : pron.speakerName,
    pron,
    n: 3 + picker.int(9),
  };

  const bodyPool: string[] = [...BODY[family], ...GENERAL];
  const researchPool: string[] = [];
  for (const source of spec.sources.slice(0, 4)) {
    researchPool.push(fill(picker.one(RESEARCH_LINES), { ...slots, source }));
  }
  const well = new SentenceWell(bodyPool, picker);
  const transitions = new SentenceWell(TRANSITIONS, picker);
  const research = picker.shuffle(researchPool);

  const partCount =
    spec.maxParts === 1 ? 1 : spec.minParts + picker.int(spec.maxParts - spec.minParts + 1);
  const target =
    spec.minChars > 0
      ? Math.min(
          spec.maxChars,
          Math.max(spec.minChars, Math.round((spec.minChars + spec.maxChars) / 2)),
        )
      : Math.round(spec.maxChars * (spec.maxParts > 1 && spec.maxChars > 400 ? 0.7 : 0.9));

  const parts: Array<{ text: string; imagePrompt: string | null }> = [];
  for (let index = 0; index < partCount; index += 1) {
    const lines: string[] = [];
    if (index === 0) lines.push(spec.hook.trim());
    else if (index < partCount - 1) lines.push(fill(transitions.next(), slots));

    const closer =
      index === partCount - 1
        ? fill(picker.one(CLOSERS[spec.tone]), { ...slots, n: slots.n })
        : null;
    const reserve = closer ? closer.length + 1 : 0;

    let text = lines.join('\n');
    const used = new Set<string>();
    const tryAdd = (sentence: string): void => {
      if (used.has(sentence)) return;
      used.add(sentence);
      const next = `${text}\n${sentence}`;
      if (next.length <= spec.maxChars - reserve) text = next;
    };

    const researchLine = research.shift();
    if (researchLine) tryAdd(researchLine);
    // Draw from the shared well only as far as this part needs, so the next
    // part continues through the pool instead of starting it over.
    for (let draws = 0; draws < bodyPool.length && text.length < target - reserve; draws += 1) {
      tryAdd(fill(well.next(), { ...slots, n: slots.n + draws }));
    }
    if (closer) {
      const next = `${text}\n${closer}`;
      if (next.length <= spec.maxChars) text = next;
    }
    if (text.length > spec.maxChars) text = text.slice(0, spec.maxChars).trim();

    parts.push({
      text,
      imagePrompt: spec.withImage && index === 0 ? fill(picker.one(IMAGE_PROMPTS), slots) : null,
    });
  }
  return parts;
}

function composeHook(
  brief: string,
  tone: Tone,
  category: AiCategory,
  workspaceName: string | null,
  picker: Picker,
): string {
  const pron = pronounsFor(tone, workspaceName ?? undefined);
  const slots: Slots = {
    subject: subjectOf(brief),
    brand: pron.speakerName === 'I' ? 'the team' : pron.speakerName,
    pron,
    n: 2 + picker.int(10),
  };
  const hook = fill(picker.one(HOOKS[FAMILY_OF[category]][tone]), slots);
  return hook.length > 200 ? shorten(hook, 199) : hook;
}

// ---------------------------------------------------------------------------
// Structured calls: which stage is asking, read from the prompt
// ---------------------------------------------------------------------------

function schemaKeys(schema: z.ZodTypeAny): string[] {
  const inner = schema instanceof z.ZodEffects ? schema.innerType() : schema;
  return inner instanceof z.ZodObject ? Object.keys(inner.shape) : [];
}

function readTone(user: string): Tone {
  return readField(user, 'Voice') === 'company' ? 'company' : 'personal';
}

function readFormat(user: string): PostFormat {
  const value = readField(user, 'Format');
  return value === 'one_long' || value === 'thread_short' || value === 'thread_long'
    ? value
    : 'one_short';
}

function readNumber(user: string, label: string, fallback: number): number {
  const value = Number(readField(user, label));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function readCategory(user: string, brief: string): AiCategory {
  const value = readField(user, 'Category');
  const known = AI_CATEGORIES.find((category) => category === value);
  return known ?? classifyTopic(brief);
}

function readSources(user: string): Array<{ title: string; snippet: string }> {
  const research = readBlock(user, 'Research');
  if (!research) return [];
  const sources: Array<{ title: string; snippet: string }> = [];
  for (const line of research.split('\n')) {
    const cells = line.trim().replace(/^-\s*/, '').split(' | ');
    if (cells.length < 2) continue;
    const title = cells[0].trim();
    const snippet = cells[cells.length - 1].trim();
    if (title.length > 0 && snippet.length > 0) sources.push({ title, snippet });
  }
  return sources;
}

function simulateStructured(schema: z.ZodTypeAny, user: string): unknown {
  const keys = schemaKeys(schema);
  const brief = readBlock(user, 'Brief') ?? user;
  const picker = new Picker(hashText(user));
  const workspaceName = readField(user, 'Workspace');

  if (keys.includes('category')) {
    return { category: classifyTopic(brief) };
  }
  if (keys.includes('hook')) {
    return {
      hook: composeHook(brief, readTone(user), readCategory(user, brief), workspaceName, picker),
    };
  }
  if (keys.includes('parts')) {
    const tone = readTone(user);
    const format = readFormat(user);
    const [minParts, maxParts] = (readField(user, 'Parts') ?? '1-1')
      .split('-')
      .map((part) => Number.parseInt(part, 10));
    const hook =
      readBlock(user, 'Hook') ??
      composeHook(brief, tone, readCategory(user, brief), workspaceName, picker);
    return {
      parts: composeParts(
        {
          brief,
          hook,
          tone,
          format,
          category: readCategory(user, brief),
          maxChars: readNumber(user, 'Max characters per part', 280),
          minChars: readNumber(user, 'Min characters', 0),
          minParts: Number.isFinite(minParts) && minParts > 0 ? minParts : 1,
          maxParts: Number.isFinite(maxParts) && maxParts > 0 ? maxParts : 1,
          withImage: readField(user, 'Image prompts') === 'yes',
          workspaceName,
          sources: readSources(user),
        },
        picker,
      ),
    };
  }
  throw providerError('bad_output', {
    message: `The simulation has no answer for a schema with keys [${keys.join(', ')}].`,
  });
}

// ---------------------------------------------------------------------------
// Chat: keyword-driven tool use and prose summaries of tool results
// ---------------------------------------------------------------------------

const FORMAT_LABEL: Record<PostFormat, string> = {
  one_short: 'short post',
  one_long: 'long post',
  thread_short: 'short thread',
  thread_long: 'long thread',
};

interface TurnResult {
  name: string;
  envelope: { ok: true; output: unknown } | { ok: false; error: string; issues?: string[] };
}

interface ChannelRow {
  id: string;
  name: string;
  platform?: string;
  health?: string;
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function channelsOf(output: unknown): ChannelRow[] {
  const rows = asObject(output).channels;
  if (!Array.isArray(rows)) return [];
  const channels: ChannelRow[] = [];
  for (const row of rows) {
    const item = asObject(row);
    if (typeof item.id === 'string' && typeof item.name === 'string') {
      channels.push({
        id: item.id,
        name: item.name,
        platform: typeof item.platform === 'string' ? item.platform : undefined,
        health: typeof item.health === 'string' ? item.health : undefined,
      });
    }
  }
  return channels;
}

function partsOf(output: unknown): string[] {
  const parts = asObject(output).parts;
  if (!Array.isArray(parts)) return [];
  const texts: string[] = [];
  for (const part of parts) {
    const text = asObject(part).text;
    if (typeof text === 'string') texts.push(text);
  }
  return texts;
}

function quotedText(message: string): string | null {
  const match = /["“]([^"”]{3,})["”]/.exec(message);
  return match ? match[1].trim() : null;
}

function summarise(result: TurnResult, workspace: string | null): string {
  const { name, envelope } = result;
  if (!envelope.ok) {
    const verb =
      name === 'list_channels'
        ? 'list your channels'
        : name === 'generate_post'
          ? 'write that post'
          : name === 'draft_post'
            ? 'save the draft'
            : name === 'generate_image'
              ? 'generate the image'
              : `run ${name}`;
    const issues =
      envelope.issues && envelope.issues.length > 0 ? ` (${envelope.issues.join('; ')})` : '';
    return `I couldn't ${verb}: ${envelope.error}${issues}`;
  }
  const output = envelope.output;
  switch (name) {
    case 'list_channels': {
      const channels = channelsOf(output);
      if (channels.length === 0) {
        return `${workspace ?? 'This workspace'} has no channels connected yet. Connect one from the Channels page and I can draft posts straight to it.`;
      }
      const list = channels
        .map((channel) => {
          const details = [channel.platform, channel.health].filter(Boolean).join(', ');
          return details ? `${channel.name} (${details})` : channel.name;
        })
        .join(', ');
      return `You have ${channels.length} ${channels.length === 1 ? 'channel' : 'channels'} connected: ${list}. Tell me which one you want to post to and I can draft something for it.`;
    }
    case 'generate_post': {
      const record = asObject(output);
      const format = typeof record.format === 'string' ? record.format : 'one_short';
      const label = FORMAT_LABEL[format as PostFormat] ?? 'post';
      const category = typeof record.category === 'string' ? ` (${record.category})` : '';
      const texts = partsOf(output);
      const sources = Array.isArray(record.sources) ? record.sources.length : 0;
      const research =
        sources > 0
          ? `\n\nBacked by ${sources} research ${sources === 1 ? 'source' : 'sources'}.`
          : '';
      return `Here's a ${label}${category}:\n\n${texts.join('\n\n')}${research}\n\nWant me to save it as a draft to one of your channels?`;
    }
    case 'draft_post': {
      const record = asObject(output);
      const names = Array.isArray(record.channelNames)
        ? record.channelNames.join(', ')
        : 'your channel';
      const parts = typeof record.parts === 'number' ? record.parts : 1;
      return `Drafted a ${parts === 1 ? 'post' : `${parts}-part post`} for ${names}. Open it in the composer to review, adjust and schedule it.`;
    }
    case 'generate_image': {
      const record = asObject(output);
      const prompt = typeof record.prompt === 'string' ? record.prompt : 'your request';
      return `Here's your image for "${prompt}". It's saved in your media library, so you can attach it to any post.`;
    }
    default:
      return `${name} finished: ${shorten(JSON.stringify(output), 200)}.`;
  }
}

/**
 * The prose for a turn's tool results. A generation followed by a draft is
 * one story ("here is the post I drafted"), not three summaries that each
 * offer the next step the person already took.
 */
function composeSummary(results: TurnResult[], workspace: string | null): string {
  const okOf = (name: string) =>
    results.find((result) => result.name === name && result.envelope.ok);
  const generated = okOf('generate_post');
  const drafted = okOf('draft_post');
  if (generated?.envelope.ok && drafted?.envelope.ok) {
    const draft = asObject(drafted.envelope.output);
    const names = Array.isArray(draft.channelNames)
      ? draft.channelNames.join(', ')
      : 'your channel';
    const texts = partsOf(generated.envelope.output);
    const failures = results.filter((result) => !result.envelope.ok);
    return [
      `Here's the post I drafted for ${names}:`,
      texts.join('\n\n'),
      'Open it in the composer to review, adjust and schedule it.',
      ...failures.map((result) => summarise(result, workspace)),
    ].join('\n\n');
  }
  return results.map((result) => summarise(result, workspace)).join('\n\n');
}

interface ChatDecision {
  text: string;
  calls: ModelToolCall[];
}

function collectTurn(messages: ModelMessage[]): {
  lastUser: ModelMessage | null;
  results: TurnResult[];
} {
  let lastUserIndex = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'user') {
      lastUserIndex = i;
      break;
    }
  }
  const results: TurnResult[] = [];
  const names = new Map<string, string>();
  for (const message of messages.slice(lastUserIndex + 1)) {
    if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? []) names.set(call.id, call.name);
    } else if (message.role === 'tool') {
      const envelope = decodeToolResult(message.content);
      const name = message.name ?? names.get(message.toolCallId ?? '') ?? 'tool';
      results.push({
        name,
        envelope: envelope ?? { ok: true, output: message.content },
      });
    }
  }
  return { lastUser: lastUserIndex >= 0 ? messages[lastUserIndex] : null, results };
}

function postRequestFrom(message: string): Record<string, unknown> {
  const lower = message.toLowerCase();
  // "…about X and save it as a draft" — the drafting clause is an instruction, not the topic.
  const request = message
    .replace(/[,;]?\s*\b(and|then)?\s*(save|draft)\b.*$/i, '')
    .replace(/[,;]?\s*\bas a draft\b.*$/i, '')
    .trim();
  const subject = subjectOf(request.length >= 3 ? request : message);
  const input: Record<string, unknown> = {
    topic: subject === 'this' ? message.trim() : subject,
  };
  if (/\b(company|brand|our voice|as (a|the) (company|brand|team))\b/.test(lower))
    input.tone = 'company';
  if (/\bthread\b/.test(lower))
    input.format = /\blong\b/.test(lower) ? 'thread_long' : 'thread_short';
  else if (/\b(long|detailed|in[- ]depth)\b/.test(lower)) input.format = 'one_long';
  if (/\b(with|and|include)\b.*\b(an? )?(image|picture|photo)\b/.test(lower))
    input.withImage = true;
  return input;
}

function imageRequestFrom(message: string): Record<string, unknown> {
  const prompt = message
    .replace(
      /^(please\s+)?(can you\s+|could you\s+)?(generate|create|make|draw|render)\s+(me\s+)?(an?\s+)?(image|picture|photo|illustration)\s+(of|showing|about|for)?\s*/i,
      '',
    )
    .replace(/[.!?]+$/, '')
    .trim();
  return { prompt: prompt.length >= 3 ? prompt : message.trim() };
}

function decide(messages: ModelMessage[], tools: ModelToolSpec[], seed: number): ChatDecision {
  const available = new Set(tools.map((tool) => tool.name));
  const system = messages.find((message) => message.role === 'system')?.content ?? '';
  const workspace = readField(system, 'Workspace');
  const { lastUser, results } = collectTurn(messages);
  const asked = lastUser?.content ?? '';
  const lower = asked.toLowerCase();
  const call = (name: string, input: unknown): ModelToolCall => ({
    id: `sim-${name}-${(seed + results.length).toString(36)}`,
    name,
    input,
  });

  const wantsChannels = /\b(channels?|connected|accounts?|profiles?)\b/.test(lower);
  const wantsImage = /\b(image|picture|photo|illustration)\b/.test(lower);
  const wantsDraft = /\b(draft|save)\b/.test(lower);
  const wantsPost =
    /\b(write|generate|compose|create)\b.*\b(post|thread|caption|update)\b|\bpost about\b/.test(
      lower,
    );

  if (results.length > 0) {
    const byName = (name: string) => results.filter((result) => result.name === name);
    const generated = byName('generate_post').find((result) => result.envelope.ok);
    const listed = byName('list_channels').find((result) => result.envelope.ok);
    const drafted = byName('draft_post').length > 0;

    if (wantsDraft && !drafted && available.has('draft_post')) {
      const channels = listed ? channelsOf(listed.envelope.ok ? listed.envelope.output : null) : [];
      const parts = generated
        ? partsOf(generated.envelope.ok ? generated.envelope.output : null)
        : [];
      const text =
        parts.length > 0 ? parts : quotedText(asked) ? [quotedText(asked) as string] : [];
      if (!listed && available.has('list_channels') && text.length > 0) {
        return {
          text: 'Let me find the right channel for that draft.',
          calls: [call('list_channels', {})],
        };
      }
      if (channels.length > 0 && text.length > 0) {
        const named = channels.find((channel) => lower.includes(channel.name.toLowerCase()));
        const target = named ?? channels[0];
        return {
          text: `Saving it as a draft for ${target.name}.`,
          calls: [call('draft_post', { channelIds: [target.id], parts: text })],
        };
      }
    }

    return { text: composeSummary(results, workspace), calls: [] };
  }

  if (wantsImage && available.has('generate_image')) {
    return {
      text: 'Generating that image now.',
      calls: [call('generate_image', imageRequestFrom(asked))],
    };
  }
  if (wantsPost && available.has('generate_post')) {
    return {
      text: 'On it. Writing that post for you.',
      calls: [call('generate_post', postRequestFrom(asked))],
    };
  }
  if (wantsDraft && available.has('draft_post')) {
    if (available.has('list_channels')) {
      return {
        text: 'Let me check which channels I can draft to.',
        calls: [call('list_channels', {})],
      };
    }
  }
  if (wantsChannels && available.has('list_channels')) {
    return { text: 'Checking your connected channels.', calls: [call('list_channels', {})] };
  }

  const brand = workspace ?? 'your workspace';
  if (/^(hi|hello|hey|good (morning|afternoon|evening))\b/.test(lower)) {
    return {
      text: `Hi! I'm the ${brand} copilot. I can check which channels are connected, write a post on any topic, save it as a draft, or generate an image for it. What are we working on?`,
      calls: [],
    };
  }
  if (/\b(schedule|publish|when)\b/.test(lower)) {
    return {
      text: 'I can write a post and save it as a draft; scheduling and publishing happen in the composer, where you pick the time and channels. Tell me the topic and I will get the draft ready.',
      calls: [],
    };
  }
  return {
    text: `Here is how I can help in ${brand}: ask me what channels are connected, ask me to write a post about a topic (short or long, single post or thread), ask me to save it as a draft, or ask for an image. For example: "Write a LinkedIn post about our new release".`,
    calls: [],
  };
}

async function* streamWords(text: string, signal?: AbortSignal): AsyncGenerator<ModelChunk> {
  const tokens = text.match(/\S+\s*|\s+/g) ?? [];
  for (const token of tokens) {
    throwIfAborted(signal);
    yield { type: 'text', text: token };
  }
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

export function createSimulatedModelClient(): ModelClient {
  return {
    name: SIMULATED_MODEL_NAME,

    async structured<T>(params: {
      schema: z.ZodType<T>;
      system: string;
      user: string;
      signal?: AbortSignal;
    }): Promise<T> {
      throwIfAborted(params.signal);
      const raw = simulateStructured(params.schema as unknown as z.ZodTypeAny, params.user);
      const parsed = params.schema.safeParse(raw);
      if (!parsed.success) {
        throw providerError('bad_output', {
          message: parsed.error.issues.map((issue) => issue.message).join('; '),
          cause: parsed.error,
        });
      }
      return parsed.data;
    },

    async *chat(params: {
      messages: ModelMessage[];
      tools: ModelToolSpec[];
      signal?: AbortSignal;
    }): AsyncIterable<ModelChunk> {
      throwIfAborted(params.signal);
      const seed = hashText(params.messages.map((message) => message.content).join('\n'));
      const decision = decide(params.messages, params.tools, seed);
      // A line that precedes a tool call ends with a newline, so a UI that
      // joins every token of the turn does not run it into the summary.
      const text = decision.calls.length > 0 ? `${decision.text.trimEnd()}\n` : decision.text;
      yield* streamWords(text, params.signal);
      if (decision.calls.length > 0) {
        throwIfAborted(params.signal);
        yield { type: 'tool_calls', calls: decision.calls };
      }
    },
  };
}
