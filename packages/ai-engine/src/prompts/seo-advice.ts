/**
 * SEO advice: the one prompt behind the analyzer's "what to fix first".
 *
 * The evaluators in `@postgear/seo-engine` already know what is wrong with a
 * page; what they cannot do is rank it, explain it in a sentence a marketer
 * acts on, or notice that three findings share one cause. That is what the
 * model is for, and the prompt is built so it cannot do more than that: every
 * finding is handed over as a line it may rewrite and reorder, the audit
 * digest is the only source of facts, and the schema refuses a severity,
 * category or impact outside the fixed vocabulary. A `checkId` the model
 * returns is only ever one it was shown: the agent nulls anything else.
 *
 * The finding lines are written and read here, in one file, for the reason
 * `fields.ts` gives: the simulated model client parses them back to answer
 * without a model, so the writer and the reader must never drift apart.
 */
import { z } from 'zod';
import {
  SEO_ADVICE_CATEGORIES,
  SEO_ADVICE_IMPACTS,
  SEO_ADVICE_SEVERITIES,
  type SeoAdviceCategory,
  type SeoAdviceFinding,
  type SeoAdviceImpact,
  type SeoAdviceRequest,
  type SeoAdviceSeverity,
} from '../types';
import { block, field } from './fields';

export const SEO_ADVICE_MAX_SUMMARY_CHARS = 600;
export const SEO_ADVICE_MAX_RECOMMENDATIONS = 15;
export const SEO_ADVICE_MAX_TITLE_CHARS = 120;
export const SEO_ADVICE_MAX_ISSUE_CHARS = 600;
export const SEO_ADVICE_MAX_FIX_CHARS = 800;
export const SEO_ADVICE_MAX_ID_CHARS = 80;
export const SEO_ADVICE_MAX_URL_CHARS = 500;

/** Only a public web page is a citation; anything else (javascript:, data:, a path) is refused. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

const SEVERITY_VALUES = SEO_ADVICE_SEVERITIES as readonly [
  SeoAdviceSeverity,
  ...SeoAdviceSeverity[],
];
const CATEGORY_VALUES = SEO_ADVICE_CATEGORIES as readonly [
  SeoAdviceCategory,
  ...SeoAdviceCategory[],
];
const IMPACT_VALUES = SEO_ADVICE_IMPACTS as readonly [SeoAdviceImpact, ...SeoAdviceImpact[]];

export const seoRecommendationSchema = z.object({
  id: z
    .string()
    .min(1)
    .max(SEO_ADVICE_MAX_ID_CHARS)
    .describe(
      'A short kebab-case id, unique within the answer (reuse the finding id when acting on one).',
    ),
  severity: z.enum(SEVERITY_VALUES),
  category: z.enum(CATEGORY_VALUES),
  title: z.string().min(1).max(SEO_ADVICE_MAX_TITLE_CHARS).describe('A short imperative headline.'),
  issue: z
    .string()
    .min(1)
    .max(SEO_ADVICE_MAX_ISSUE_CHARS)
    .describe('What is wrong and why it matters for ranking, in one or two sentences.'),
  fix: z
    .string()
    .min(1)
    .max(SEO_ADVICE_MAX_FIX_CHARS)
    .describe('What to change, concretely enough to act on today.'),
  impact: z.enum(IMPACT_VALUES),
  checkId: z
    .string()
    .max(SEO_ADVICE_MAX_ID_CHARS)
    .nullable()
    .describe('The checkId of the finding this acts on, or null.'),
  docsUrl: z
    .string()
    .max(SEO_ADVICE_MAX_URL_CHARS)
    .nullable()
    .refine((value) => value === null || isHttpUrl(value), 'docsUrl must be an http(s) URL or null')
    .describe('A reputable public documentation URL (Google Search Central preferred), or null.'),
});

export const seoAdviceSchema = z.object({
  summary: z
    .string()
    .min(1)
    .max(SEO_ADVICE_MAX_SUMMARY_CHARS)
    .describe('One paragraph: the overall verdict and the single most important thing to fix.'),
  recommendations: z.array(seoRecommendationSchema).min(1).max(SEO_ADVICE_MAX_RECOMMENDATIONS),
});

export type SeoAdviceSchemaOutput = z.infer<typeof seoAdviceSchema>;

// ---------------------------------------------------------------------------
// Finding lines: written for the model, read back by the simulation
// ---------------------------------------------------------------------------

const CELL_SEPARATOR = ' | ';
const NONE = '(none)';

/** Free text in a cell must not contain the separator or a line break, or the line cannot be read back. */
function cell(value: string): string {
  const clean = value
    .replace(/\s+/g, ' ')
    .replace(/\s*\|\s*/g, ' / ')
    .trim();
  return clean.length > 0 ? clean : NONE;
}

/**
 * One finding as one line:
 * `id | severity | category | title | issue | fix | impact | checkId | docsUrl`.
 * The free-text cells sit in the middle so a reader can rely on the count.
 */
export function formatFindingLine(finding: SeoAdviceFinding): string {
  return [
    cell(finding.id),
    finding.severity,
    finding.category,
    cell(finding.title),
    cell(finding.issue),
    cell(finding.fix),
    finding.impact,
    finding.checkId === null ? NONE : cell(finding.checkId),
    finding.docsUrl === null ? NONE : cell(finding.docsUrl),
  ].join(CELL_SEPARATOR);
}

function enumOf<T extends string>(values: readonly T[], value: string, fallback: T): T {
  return values.find((candidate) => candidate === value) ?? fallback;
}

/** The inverse of {@link formatFindingLine}; null for a line that is not a finding. */
export function parseFindingLine(line: string): SeoAdviceFinding | null {
  const cells = line
    .trim()
    .replace(/^-\s*/, '')
    .split(CELL_SEPARATOR)
    .map((value) => value.trim());
  if (cells.length < 9) return null;
  const [id, severity, category, title, issue, fix, impact, checkId, docsUrl] = cells;
  if (id.length === 0 || id === NONE || title.length === 0) return null;
  const optional = (value: string) => (value === NONE || value.length === 0 ? null : value);
  const docs = optional(docsUrl);
  return {
    id,
    severity: enumOf(SEO_ADVICE_SEVERITIES, severity, 'info'),
    category: enumOf(SEO_ADVICE_CATEGORIES, category, 'technical'),
    title,
    issue: issue === NONE ? '' : issue,
    fix: fix === NONE ? '' : fix,
    impact: enumOf(SEO_ADVICE_IMPACTS, impact, 'low'),
    checkId: optional(checkId),
    docsUrl: docs !== null && isHttpUrl(docs) ? docs : null,
  };
}

// ---------------------------------------------------------------------------
// The prompt
// ---------------------------------------------------------------------------

export function buildSeoAdvicePrompt(request: SeoAdviceRequest): { system: string; user: string } {
  const system = [
    'You are an expert technical-SEO consultant reviewing one audit of one web page.',
    'Turn the findings into a prioritised, actionable plan for the person who runs the site.',
    'Rules:',
    '- Prioritise by ranking impact. Critical = blocks indexing or ranking outright; Warning = a measurable loss; Info = polish.',
    '- Be concrete: name the element, the value found and the value to aim for. "Improve the title" is not advice.',
    "- Every recommendation that acts on a finding keeps that finding's checkId; otherwise checkId is null.",
    '- Do not invent facts that are not in the audit. If the audit does not say it, you do not know it.',
    '- Merge findings that share one cause into one recommendation rather than repeating them.',
    `- Return between 1 and ${SEO_ADVICE_MAX_RECOMMENDATIONS} recommendations, most important first.`,
    '- Cite a reputable public documentation URL (Google Search Central where one exists) in docsUrl; otherwise null. Never invent a URL.',
    '- The summary is one paragraph: the verdict, and the single most important thing to fix first.',
    '- Plain English, no markdown, no emoji.',
    'Each finding line reads: id | severity | category | title | issue | fix | impact | checkId | docsUrl.',
  ].join('\n');

  const user = [
    field('URL', request.url),
    field('Score', `${request.overall}/100`),
    field('Grade', request.grade),
    field('Findings', request.findings.length),
    block('Audit', request.digest),
    block('Findings', request.findings.map(formatFindingLine).join('\n')),
  ].join('\n');

  return { system, user };
}
