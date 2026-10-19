/**
 * Starter templates: the Home page's "Templates" row (UI revamp, 2026-10-19,
 * after Buffer's home).
 *
 * A template is plain text with [placeholders] for the parts only the writer
 * knows. Picking one opens the composer at `/composer?template=<id>`; the
 * composer's loader resolves the id here on the server (`composer-data.ts`)
 * and the new post starts with the text in its shared part. An unknown id is
 * ignored, so a stale link just opens an empty post.
 *
 * Kept as data, free of React, so the server loader can import it. The cards'
 * icons live with the cards (`components/home/templates-row.tsx`), keyed by id.
 */

export interface PostTemplate {
  id: string;
  title: string;
  /** One line under the title on the card. */
  description: string;
  /** What the composer starts with. Lines become paragraphs. */
  text: string;
}

export const POST_TEMPLATES = [
  {
    id: 'behind-the-scenes',
    title: 'Show how the work gets made',
    description: 'A look behind the scenes at something you are working on.',
    text: [
      "Here's a look behind the scenes at [what you're working on].",
      '',
      "What most people don't see: [a step or detail people wouldn't expect].",
      '',
      'My favourite part: [the part you enjoy most].',
      '',
      '[A question for your audience]?',
    ].join('\n'),
  },
  {
    id: 'lesson-learned',
    title: 'Share a lesson learned the hard way',
    description: 'One mistake, what it taught you, and what you do now.',
    text: [
      'A lesson I learned the hard way: [the lesson].',
      '',
      'What happened: [the mistake, in a sentence or two].',
      '',
      'What I do differently now: [the change you made].',
      '',
      'Have you run into this too?',
    ].join('\n'),
  },
  {
    id: 'quick-tips',
    title: 'Three quick tips',
    description: 'A short numbered list your audience can use today.',
    text: [
      '3 quick tips for [your topic]:',
      '',
      '1. [First tip]',
      '2. [Second tip]',
      '3. [Third tip]',
      '',
      'Which one will you try first?',
    ].join('\n'),
  },
  {
    id: 'ask-your-audience',
    title: 'Ask your audience a question',
    description: 'Start a conversation with one open question.',
    text: [
      'A question for [your audience]:',
      '',
      '[Your question]?',
      '',
      "I'll go first: [your own answer].",
      '',
      'Reply with yours below.',
    ].join('\n'),
  },
] as const satisfies readonly PostTemplate[];

export type PostTemplateId = (typeof POST_TEMPLATES)[number]['id'];

/** The template with this id, or null for anything else (a stale or hand-typed link). */
export function findTemplate(id: string | null | undefined): PostTemplate | null {
  return POST_TEMPLATES.find((template) => template.id === id) ?? null;
}
