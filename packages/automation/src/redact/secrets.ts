/**
 * "Secrets never live in graph JSON", checked at the door: the API refuses
 * to save a graph with any of these, and the web app warns before saving.
 *
 * A finding is text typed into a field whose name says secret (`password`,
 * an `Authorization` header), or text shaped like a secret anywhere (a
 * bearer token, a Slack webhook link, an `sk-` key, a link with a secret
 * in its query string), in step settings, step names and notes. Data
 * chips are not secrets: `{{ trigger.inputs.code }}` in a `password`
 * field is fine, only typed text counts.
 */
import type { AutomationGraph } from '../graph/schema';
import { parseTemplate } from '../tokens/parse';
import { isSecretKey, secretShapeIn } from './patterns';

export const SECRET_REFUSED_MESSAGE =
  'Secrets cannot be saved in a step. Add them as a connection instead.';

export interface SecretFinding {
  nodeKey?: string;
  noteId?: string;
  /** The config path (`headers.0.value`), or `name`, `notes`, `text`. */
  field: string;
  /** Plain words: "a Slack webhook link", "a field named 'password'". */
  reason: string;
}

/** The typed text in a field once its data chips are taken out. */
function typedText(value: string): string {
  return parseTemplate(value)
    .map((segment) => (segment.kind === 'text' ? segment.value : ''))
    .join('')
    .trim();
}

/** `"password": "hunter2"` typed inside a JSON body. */
const JSON_PAIR = /"([^"\\]{1,60})"\s*:\s*"([^"\\]*)"/g;

function secretInJson(text: string): string | undefined {
  for (const [, key, value] of text.matchAll(JSON_PAIR)) {
    if (isSecretKey(key) && typedText(value) !== '') return key;
  }
  return undefined;
}

function scan(
  value: unknown,
  path: string,
  add: (field: string, reason: string) => void,
  depth = 0,
): void {
  if (depth > 20) return;
  if (typeof value === 'string') {
    const shape = secretShapeIn(value);
    const jsonKey = shape ? undefined : secretInJson(value);
    if (shape) add(path, shape);
    else if (jsonKey) add(path, `a field named '${jsonKey}'`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, i) => {
      scan(item, path ? `${path}.${i}` : String(i), add, depth + 1);
    });
    return;
  }
  if (typeof value !== 'object' || value === null) return;
  const record = value as Record<string, unknown>;
  const pairName =
    typeof record.name === 'string'
      ? record.name
      : typeof record.header === 'string'
        ? record.header
        : undefined;
  for (const [key, item] of Object.entries(record)) {
    const field = path ? `${path}.${key}` : key;
    const named = isSecretKey(key)
      ? key
      : key === 'value' && pairName && isSecretKey(pairName)
        ? pairName
        : undefined;
    if (named && typeof item === 'string' && typedText(item) !== '') {
      add(field, `a field named '${named}'`);
      continue;
    }
    scan(item, field, add, depth + 1);
  }
}

/** Every secret-looking value in a graph. Empty means it is safe to save. */
export function findSecretLikeValues(graph: AutomationGraph): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const node of graph.nodes) {
    const add = (field: string, reason: string) =>
      findings.push({ nodeKey: node.key, field, reason });
    scan(node.config, '', add);
    scan(node.name, 'name', add);
    if (node.notes) scan(node.notes, 'notes', add);
  }
  for (const note of graph.notes) {
    scan(note.text, 'text', (field, reason) => findings.push({ noteId: note.id, field, reason }));
  }
  return findings;
}
