/**
 * Helpers shared by the model clients.
 *
 * The engine speaks {@link ModelMessage} — a small, provider-neutral shape —
 * so the agents, the simulated client and the tests never import LangChain
 * message classes. The OpenAI client is the one place that shape is turned
 * into LangChain's, and {@link toLangChainMessages} is that translation.
 *
 * {@link structuredWithRepair} is the structured-output policy from contract
 * §2: ask once; if the answer does not satisfy the Zod schema, ask once more
 * with the validation errors quoted back; then give up as `bad_output`. One
 * repair, not a loop — a model that fails twice with the errors in front of
 * it is not going to pass on the third try, and every attempt costs money.
 */
import {
  AIMessage,
  type BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages';
import type { z } from 'zod';
import type { ModelMessage, ModelToolCall } from '../types';
import { providerError, throwIfAborted } from './resilience';

export function toLangChainMessages(messages: ModelMessage[]): BaseMessage[] {
  return messages.map((message) => {
    switch (message.role) {
      case 'system':
        return new SystemMessage(message.content);
      case 'user':
        return new HumanMessage(message.content);
      case 'assistant':
        return new AIMessage({
          content: message.content,
          tool_calls: (message.toolCalls ?? []).map((call) => ({
            id: call.id,
            name: call.name,
            args: asRecord(call.input),
            type: 'tool_call' as const,
          })),
        });
      case 'tool':
        return new ToolMessage({
          content: message.content,
          tool_call_id: message.toolCallId ?? '',
          name: message.name,
        });
      default:
        throw new Error(`@postgear/ai-engine: unknown message role ${String(message.role)}`);
    }
  });
}

/** Tool arguments must be an object for the providers; anything else is wrapped. */
export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value };
}

/** The visible text of a LangChain message, whatever content shape it used. */
export function textOfContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  let text = '';
  for (const part of content) {
    if (typeof part === 'string') {
      text += part;
    } else if (
      typeof part === 'object' &&
      part !== null &&
      'type' in part &&
      (part as { type: unknown }).type === 'text' &&
      'text' in part &&
      typeof (part as { text: unknown }).text === 'string'
    ) {
      text += (part as { text: string }).text;
    }
  }
  return text;
}

let callCounter = 0;

/** An id for a tool call the provider did not name; unique within the process. */
export function nextToolCallId(prefix = 'call'): string {
  callCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${callCounter}`;
}

export function toModelToolCalls(
  calls: ReadonlyArray<{ id?: string; name: string; args: unknown }> | undefined,
): ModelToolCall[] {
  return (calls ?? []).map((call) => ({
    id: call.id && call.id.length > 0 ? call.id : nextToolCallId(),
    name: call.name,
    input: call.args,
  }));
}

export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return `${path}: ${issue.message}`;
    })
    .join('; ');
}

export interface StructuredAsk {
  system: string;
  user: string;
}

/**
 * Runs `ask` and validates the raw answer; on failure re-asks once with the
 * errors appended to the user prompt, then throws `bad_output`.
 *
 * `ask` may itself throw a parse error (LangChain's structured output does
 * when the model's JSON is unusable); that counts as a failed attempt too.
 */
export async function structuredWithRepair<T>(params: {
  schema: z.ZodType<T>;
  system: string;
  user: string;
  signal?: AbortSignal;
  ask: (prompt: StructuredAsk) => Promise<unknown>;
}): Promise<T> {
  throwIfAborted(params.signal);
  const first = await attempt(params.schema, params.ask, {
    system: params.system,
    user: params.user,
  });
  if (first.ok) return first.value;

  throwIfAborted(params.signal);
  const repair = [
    params.user,
    '',
    '<<<Repair',
    'Your previous answer was rejected for these reasons:',
    first.problem,
    'Answer again and match the requested structure exactly.',
    '>>>',
  ].join('\n');
  const second = await attempt(params.schema, params.ask, { system: params.system, user: repair });
  if (second.ok) return second.value;

  throw providerError('bad_output', { message: second.problem, cause: second.cause });
}

type Attempt<T> = { ok: true; value: T } | { ok: false; problem: string; cause?: unknown };

async function attempt<T>(
  schema: z.ZodType<T>,
  ask: (prompt: StructuredAsk) => Promise<unknown>,
  prompt: StructuredAsk,
): Promise<Attempt<T>> {
  let raw: unknown;
  try {
    raw = await ask(prompt);
  } catch (error) {
    if (isParseFailure(error)) {
      return { ok: false, problem: messageOf(error), cause: error };
    }
    throw error;
  }
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, value: parsed.data };
  return { ok: false, problem: formatZodIssues(parsed.error), cause: parsed.error };
}

function isParseFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return (
    name === 'ZodError' ||
    name === 'OutputParserException' ||
    name === 'SyntaxError' ||
    Array.isArray((error as { issues?: unknown }).issues)
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
