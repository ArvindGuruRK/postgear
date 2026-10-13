/**
 * Copilot — the system prompt and the tool-result encoding.
 *
 * The copilot is stateless; everything it may know about the workspace is in
 * {@link CopilotContext} and goes into this prompt on every turn. Tools are
 * described by the model client (name, description, schema) — the prompt only
 * explains *when* to reach for them and how to talk about the outcome, which
 * is the part a schema cannot say.
 *
 * Tool results travel back to the model as a JSON envelope
 * (`{ ok, output }` or `{ ok: false, error }`). The envelope is defined here
 * because two readers must agree on it: a real model, which reads it as
 * text, and the simulated client, which parses it to write its summary.
 */
import type { CopilotContext, CopilotToolContext } from '../types';
import { field } from './fields';

export interface ToolDescription {
  name: string;
  description: string;
  readOnly: boolean;
}

export function buildCopilotSystemPrompt(
  context: CopilotContext,
  tools: ToolDescription[],
): string {
  const lines = [
    `You are PostGear's AI copilot inside the ${context.workspaceName} workspace: a social media assistant that helps plan, write and schedule posts.`,
    field('Today', context.today),
    field('Workspace', context.workspaceName),
    'Connected channels:',
    context.channelSummary.trim().length > 0 ? context.channelSummary.trim() : '(none connected)',
    '',
    'How to work:',
    '- Answer directly when you can. Use a tool when the person asks for something a tool does.',
    '- Before drafting to a channel, know its id: call list_channels unless the ids are already in this conversation.',
    '- After a tool runs, tell the person what happened in one or two plain sentences; do not paste raw JSON.',
    '- When a tool fails, say so and what they can do about it. Never pretend it succeeded.',
    '- Keep replies short. No markdown headings, no bullet walls; plain sentences, line breaks where they help.',
    '- Never invent channels, posts or results you were not given.',
  ];
  if (tools.length > 0) {
    lines.push('', 'Tools available:');
    for (const tool of tools) {
      lines.push(`- ${tool.name}${tool.readOnly ? ' (read-only)' : ''}: ${tool.description}`);
    }
  } else {
    lines.push('', 'No tools are available for this reply; answer with what you already know.');
  }
  return lines.join('\n');
}

export type ToolResultEnvelope =
  | { ok: true; output: unknown }
  | { ok: false; error: string; issues?: string[] };

export function encodeToolResult(envelope: ToolResultEnvelope): string {
  return JSON.stringify(envelope);
}

export function decodeToolResult(content: string): ToolResultEnvelope | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null || !('ok' in parsed)) return null;
    return parsed as ToolResultEnvelope;
  } catch {
    return null;
  }
}

/** Re-exported so tool authors import one module for the copilot's contract. */
export type { CopilotToolContext };
