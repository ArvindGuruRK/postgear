/**
 * The copilot: a LangGraph agent loop over the API's tools.
 *
 * ```
 * START → agent ─┬─(tool calls, rounds left)─→ tools → agent …
 *                └─(no tool calls, or rounds exhausted)─→ END
 * ```
 *
 * `agent` streams one model reply, forwarding text as `token` events as it
 * arrives, and records any tool calls the model ended with. `tools` runs
 * those calls and appends their results, then the loop returns to `agent`
 * so the model can read them and either call more tools or answer.
 *
 * The loop is bounded by `maxToolRounds` (default 6). On the last round the
 * model is called with **no tools**, so it has to answer with what it has —
 * without that, a model that keeps "checking one more thing" never stops,
 * and every round is a paid call.
 *
 * Tools are the API's; the engine only knows name, description and Zod input
 * schema. Two rules keep a bad tool call from taking the conversation down:
 * input that fails the schema becomes an `ok: false` result with the issues
 * (the model sees them and retries with corrected arguments), and an
 * exception inside a tool becomes an `ok: false` result with the message
 * (the model tells the person what went wrong). Nothing a tool does can
 * throw out of the graph; only the model provider or an abort can.
 */
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { abortError, normaliseRunError, redactSecrets } from '../model/resilience';
import {
  buildCopilotSystemPrompt,
  encodeToolResult,
  type ToolResultEnvelope,
} from '../prompts/copilot';
import type {
  CopilotAgent,
  CopilotContext,
  CopilotEvent,
  CopilotMessage,
  CopilotRunOptions,
  CopilotRunResult,
  CopilotTool,
  ModelClient,
  ModelMessage,
  ModelToolCall,
  ModelToolSpec,
} from '../types';

export interface CopilotAgentDeps {
  model: ModelClient;
  tools: CopilotTool<never, unknown>[];
  context: CopilotContext;
  /** Tool rounds before the agent must answer. Default 6. */
  maxToolRounds?: number;
}

export const DEFAULT_MAX_TOOL_ROUNDS = 6;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const CopilotState = Annotation.Root({
  messages: Annotation<ModelMessage[]>({
    reducer: (current, update) => current.concat(update),
    default: () => [],
  }),
  /** Tool rounds completed so far. */
  rounds: Annotation<number>({ reducer: (_current, update) => update, default: () => 0 }),
  /** Tool calls executed so far (any outcome). */
  toolCalls: Annotation<number>({
    reducer: (current, update) => current + update,
    default: () => 0,
  }),
  /** The assistant's latest text. */
  answer: Annotation<string>({ reducer: (_current, update) => update, default: () => '' }),
  /** Whether the latest assistant turn asked for tools. */
  pendingCalls: Annotation<ModelToolCall[]>({
    reducer: (_current, update) => update,
    default: () => [],
  }),
});

type CopilotStateType = typeof CopilotState.State;

interface RunContext {
  emit: (event: CopilotEvent) => void;
}

const RunContextSchema = Annotation.Root({
  run: Annotation<RunContext>(),
});

type Runtime = { context?: { run?: RunContext }; signal?: AbortSignal };

function runOf(runtime: Runtime): { emit: (event: CopilotEvent) => void; signal?: AbortSignal } {
  return { emit: runtime.context?.run?.emit ?? (() => undefined), signal: runtime.signal };
}

// ---------------------------------------------------------------------------
// Tool execution
// ---------------------------------------------------------------------------

export interface ToolOutcome {
  envelope: ToolResultEnvelope;
  summary: string;
}

/** A one-line description of a tool's outcome for the UI, without knowing the API's tools. */
export function summariseToolOutcome(
  tool: CopilotTool<never, unknown> | undefined,
  name: string,
  envelope: ToolResultEnvelope,
): string {
  if (!envelope.ok) return `${humanName(name)} failed: ${envelope.error}`;
  if (tool?.summarize) {
    try {
      return tool.summarize(envelope.output);
    } catch {
      // A summariser that throws must not fail the tool that succeeded.
    }
  }
  const record = asRecord(envelope.output);
  switch (name) {
    case 'list_channels': {
      const count = Array.isArray(record.channels) ? record.channels.length : 0;
      return `Found ${count} ${count === 1 ? 'channel' : 'channels'}`;
    }
    case 'generate_post':
      return `Wrote a ${typeof record.format === 'string' ? record.format.replace('_', ' ') : ''} post`.replace(
        '  ',
        ' ',
      );
    case 'draft_post': {
      const names = Array.isArray(record.channelNames) ? record.channelNames.join(', ') : '';
      return names ? `Drafted a post for ${names}` : 'Drafted a post';
    }
    case 'generate_image':
      return 'Generated an image';
    default:
      return `Ran ${humanName(name)}`;
  }
}

function humanName(name: string): string {
  return name.replace(/_/g, ' ');
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

export async function executeTool(
  tool: CopilotTool<never, unknown> | undefined,
  call: ModelToolCall,
  signal: AbortSignal | undefined,
): Promise<ToolOutcome> {
  if (!tool) {
    const envelope: ToolResultEnvelope = { ok: false, error: `Unknown tool "${call.name}".` };
    return { envelope, summary: summariseToolOutcome(undefined, call.name, envelope) };
  }
  const parsed = tool.inputSchema.safeParse(call.input);
  if (!parsed.success) {
    const envelope: ToolResultEnvelope = {
      ok: false,
      error: 'Invalid input. Fix the arguments and call the tool again.',
      issues: parsed.error.issues.map((issue) => {
        const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
        return `${path}: ${issue.message}`;
      }),
    };
    return { envelope, summary: summariseToolOutcome(tool, call.name, envelope) };
  }
  try {
    const output = await tool.execute(parsed.data as never, { signal });
    const envelope: ToolResultEnvelope = { ok: true, output };
    return { envelope, summary: summariseToolOutcome(tool, call.name, envelope) };
  } catch (error) {
    if (signal?.aborted) throw abortError(signal.reason);
    const message = error instanceof Error ? error.message : String(error);
    const envelope: ToolResultEnvelope = { ok: false, error: redactSecrets(message) };
    return { envelope, summary: summariseToolOutcome(tool, call.name, envelope) };
  }
}

// ---------------------------------------------------------------------------
// The graph
// ---------------------------------------------------------------------------

export function toModelMessages(
  context: CopilotContext,
  tools: CopilotTool<never, unknown>[],
  history: CopilotMessage[],
): ModelMessage[] {
  const system: ModelMessage = {
    role: 'system',
    content: buildCopilotSystemPrompt(
      context,
      tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        readOnly: tool.readOnly,
      })),
    ),
  };
  return [system, ...history.map((message) => ({ role: message.role, content: message.content }))];
}

export function createCopilotAgent(deps: CopilotAgentDeps): CopilotAgent {
  const maxToolRounds = Math.max(0, deps.maxToolRounds ?? DEFAULT_MAX_TOOL_ROUNDS);
  const toolsByName = new Map(deps.tools.map((tool) => [tool.name, tool]));
  const specs: ModelToolSpec[] = deps.tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));

  const agent = async (state: CopilotStateType, runtime: Runtime) => {
    const { emit, signal } = runOf(runtime);
    const tools = state.rounds < maxToolRounds ? specs : [];
    let text = '';
    let calls: ModelToolCall[] = [];
    for await (const chunk of deps.model.chat({ messages: state.messages, tools, signal })) {
      if (chunk.type === 'text') {
        if (chunk.text.length === 0) continue;
        text += chunk.text;
        emit({ type: 'token', text: chunk.text });
      } else if (tools.length > 0) {
        calls = chunk.calls;
      }
    }
    const message: ModelMessage =
      calls.length > 0
        ? { role: 'assistant', content: text, toolCalls: calls }
        : { role: 'assistant', content: text };
    return { messages: [message], answer: text, pendingCalls: calls };
  };

  const tools = async (state: CopilotStateType, runtime: Runtime) => {
    const { emit, signal } = runOf(runtime);
    const results: ModelMessage[] = [];
    for (const call of state.pendingCalls) {
      if (signal?.aborted) throw abortError(signal.reason);
      emit({ type: 'tool_call', id: call.id, name: call.name, input: call.input });
      const { envelope, summary } = await executeTool(toolsByName.get(call.name), call, signal);
      emit({
        type: 'tool_result',
        id: call.id,
        name: call.name,
        ok: envelope.ok,
        output: envelope.ok
          ? envelope.output
          : { error: envelope.error, issues: envelope.issues ?? [] },
        summary,
      });
      results.push({
        role: 'tool',
        content: encodeToolResult(envelope),
        toolCallId: call.id,
        name: call.name,
      });
    }
    return {
      messages: results,
      rounds: state.rounds + 1,
      toolCalls: state.pendingCalls.length,
      pendingCalls: [],
    };
  };

  const route = (state: CopilotStateType): 'tools' | typeof END =>
    state.pendingCalls.length > 0 && state.rounds < maxToolRounds ? 'tools' : END;

  const graph = new StateGraph(CopilotState, RunContextSchema)
    .addNode('agent', agent)
    .addNode('tools', tools)
    .addEdge(START, 'agent')
    .addConditionalEdges('agent', route, { tools: 'tools', [END]: END })
    .addEdge('tools', 'agent')
    .compile();

  return {
    async run(
      messages: CopilotMessage[],
      options: CopilotRunOptions = {},
    ): Promise<CopilotRunResult> {
      const emit = options.onEvent ?? (() => undefined);
      if (options.signal?.aborted) throw abortError(options.signal.reason);

      let final: CopilotStateType;
      try {
        final = await graph.invoke(
          { messages: toModelMessages(deps.context, deps.tools, messages) },
          {
            context: { run: { emit } },
            signal: options.signal,
            // Each round is two graph steps; leave headroom for START/END bookkeeping.
            recursionLimit: Math.max(10, maxToolRounds * 2 + 4),
          },
        );
      } catch (error) {
        throw normaliseRunError(error, options.signal);
      }

      const result: CopilotRunResult = { message: final.answer, toolCalls: final.toolCalls };
      emit({ type: 'done', message: result.message, toolCalls: result.toolCalls });
      return result;
    },
  };
}
