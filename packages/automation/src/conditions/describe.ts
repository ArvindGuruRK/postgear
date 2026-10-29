/**
 * A condition as the sentence its step's summary shows: "Channel Name is
 * 'Instagram' and Post Text contains 'launch'".
 */
import { count } from '../catalog/fields';
import { fallbackLabel } from '../tokens/labels';
import { parseTemplate, singleToken } from '../tokens/parse';
import { OPERATORS } from './operators';
import type { ConditionGroup, ConditionRule } from './schema';

export interface DescribeConditionOptions {
  /** Plain words for a token path; `tokenLabeler(graph)` makes one. */
  tokenLabel?(path: string): string | undefined;
}

/** Rules spelled out before "and 2 more rules". */
const SHOWN_RULES = 3;

function side(template: string, quoted: boolean, options: DescribeConditionOptions): string {
  const segments = parseTemplate(template);
  const token = singleToken(segments);
  if (token) return options.tokenLabel?.(token.path) ?? fallbackLabel(token.path);
  const words = segments
    .map((segment) =>
      segment.kind === 'text'
        ? segment.value
        : (options.tokenLabel?.(segment.path) ?? fallbackLabel(segment.path)),
    )
    .join('')
    .trim();
  return quoted ? `'${words}'` : words;
}

/** One rule in words: "Post Text contains 'launch'". */
export function describeRule(rule: ConditionRule, options: DescribeConditionOptions = {}): string {
  const info = OPERATORS[rule.operator];
  const left = rule.left.trim() ? side(rule.left, false, options) : 'Something';
  if (!info.takesValue) return `${left} ${info.words}`;
  const right = rule.right?.trim() ?? '';
  if (info.valueIsCount) {
    const n = right ? side(right, false, options) : 'N';
    if (rule.operator === 'hasMoreThan')
      return `${left} has more than ${n === '1' ? '1 item' : `${n} items`}`;
    return `${left} ${info.words.replace('{n}', n)}`;
  }
  // Numbers read bare ("is greater than 10"); text is quoted ("is 'Instagram'").
  const value = right ? side(right, !/^-?\d+(\.\d+)?$/.test(right), options) : '...';
  return `${left} ${info.words} ${value}`;
}

/**
 * The whole group: rules joined with "and" (All Of) or "or" (Any Of), at
 * most three spelled out.
 */
export function describeCondition(
  group: ConditionGroup,
  options: DescribeConditionOptions = {},
): string {
  if (group.rules.length === 0) return 'No rules yet';
  const joiner = group.match === 'all' ? ' and ' : ' or ';
  const shown = group.rules.slice(0, SHOWN_RULES).map((rule) => describeRule(rule, options));
  const hidden = group.rules.length - shown.length;
  const sentence = shown.join(joiner);
  return hidden > 0 ? `${sentence}${joiner}${count(hidden, 'more rule')}` : sentence;
}
