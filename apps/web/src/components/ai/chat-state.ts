/**
 * The copilot conversation, as a pure reducer over the stream's events.
 *
 * ## The client holds the history
 *
 * The API is stateless: each request carries the conversation so far and
 * streams one reply. This module owns that conversation — the entries, the
 * reply being streamed into, and the tool rows under it — and
 * `historyFor` turns it back into what the API accepts (the last twenty
 * messages, ending with the user's).
 *
 * ## A reply is one entry from its first token
 *
 * `send` appends the user's message *and* an empty assistant entry, so the
 * typing indicator, the tool rows and the text all have one place to land
 * as events arrive. A reply that produced nothing before an error or a stop
 * is removed again rather than left as an empty bubble.
 *
 * ## Why this survives a reload
 *
 * The conversation is kept in `sessionStorage` per workspace, so a reload
 * (or a wander to the composer from a "Drafted a post" row) does not lose it.
 * Session, not local: the copilot is a working session, not a record, and a
 * tab closed is a conversation ended. `parseHistory` is defensive because
 * that storage is writable by anything in the origin.
 */
import type {
  AiCredits,
  AiErrorKind,
  CopilotMessage,
  CopilotStreamEvent,
  CopilotToolName,
  DraftPostToolOutput,
  GenerateImageToolOutput,
} from '@/types/ai';

export interface ToolActivity {
  id: string;
  name: CopilotToolName;
  input: unknown;
  status: 'running' | 'ok' | 'failed';
  output: unknown;
  summary: string | null;
}

export interface UserEntry {
  id: string;
  role: 'user';
  content: string;
}

export interface AssistantEntry {
  id: string;
  role: 'assistant';
  content: string;
  tools: ToolActivity[];
  streaming: boolean;
}

export type ChatEntry = UserEntry | AssistantEntry;

export interface ChatError {
  kind: AiErrorKind;
  message: string;
  retryable: boolean;
}

export interface ChatState {
  entries: ChatEntry[];
  streaming: boolean;
  /** The last reply was stopped by the person; cleared on the next send. */
  stopped: boolean;
  error: ChatError | null;
  credits: AiCredits | null;
  /**
   * The session's stored conversation has been read (whether or not it held
   * anything). Persisting is gated on this, and it can only become true
   * through a dispatch — so the render that mounts the chat can never write
   * its empty initial state over what the session holds. An effect-order
   * guard (a ref flipped in the restore effect) is not enough: the persist
   * effect of that same commit still sees the pre-restore entries, and React's
   * development StrictMode re-runs it before the restore has rendered.
   */
  hydrated: boolean;
}

export type ChatAction =
  | { type: 'send'; id: string; content: string; replyId: string }
  /** Ask again after a failed reply: the user's message is already the last entry. */
  | { type: 'retry'; replyId: string }
  | { type: 'event'; event: CopilotStreamEvent }
  | { type: 'abort' }
  | { type: 'fail'; message: string; status?: number }
  | { type: 'clear' }
  /** Null means the session held nothing: the state stays as it is, but is now hydrated. */
  | { type: 'restore'; entries: ChatEntry[] | null };

/** How much of the conversation goes back to the API with each message. */
export const HISTORY_LIMIT = 20;

export const SUGGESTIONS: readonly string[] = [
  'What channels do I have connected?',
  'Write a LinkedIn post about our new release',
  'Generate an image of a sunrise over a city skyline',
];

export function initialChatState(credits: AiCredits | null = null): ChatState {
  return { entries: [], streaming: false, stopped: false, error: null, credits, hydrated: false };
}

let idCounter = 0;

/**
 * Unique within the origin's session, not globally — a restore brings back
 * ids from an earlier page, so the time prefix keeps them apart from the
 * counter's.
 */
export function newChatId(): string {
  idCounter += 1;
  return `${Date.now().toString(36)}-${idCounter}`;
}

function isEmptyReply(entry: ChatEntry): boolean {
  return entry.role === 'assistant' && entry.content.length === 0 && entry.tools.length === 0;
}

/** Applies `update` to the reply being streamed, if there is one. */
function updateReply(
  state: ChatState,
  update: (entry: AssistantEntry) => AssistantEntry,
): ChatState {
  const index = state.entries.findIndex((entry) => entry.role === 'assistant' && entry.streaming);

  if (index === -1) {
    return state;
  }

  const entry = state.entries[index] as AssistantEntry;
  const entries = [...state.entries];
  entries[index] = update(entry);
  return { ...state, entries };
}

/** Ends the streaming reply, dropping it if it has nothing to show. */
function settleReply(state: ChatState): ChatState {
  const settled = updateReply(state, (entry) => ({ ...entry, streaming: false }));
  return {
    ...settled,
    streaming: false,
    entries: settled.entries.filter((entry) => !isEmptyReply(entry)),
  };
}

function kindForStatus(status: number | undefined): AiErrorKind {
  switch (status) {
    case 402:
      return 'out_of_credits';
    case 503:
      return 'not_configured';
    default:
      return 'unexpected';
  }
}

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'send':
      if (state.streaming) {
        return state;
      }
      return {
        ...state,
        streaming: true,
        stopped: false,
        error: null,
        entries: [
          ...state.entries,
          { id: action.id, role: 'user', content: action.content },
          { id: action.replyId, role: 'assistant', content: '', tools: [], streaming: true },
        ],
      };

    case 'retry':
      if (state.streaming || state.entries.at(-1)?.role !== 'user') {
        return state;
      }
      return {
        ...state,
        streaming: true,
        stopped: false,
        error: null,
        entries: [
          ...state.entries,
          { id: action.replyId, role: 'assistant', content: '', tools: [], streaming: true },
        ],
      };

    case 'event':
      return state.streaming ? applyEvent(state, action.event) : state;

    case 'abort':
      return state.streaming ? { ...settleReply(state), stopped: true } : state;

    case 'fail':
      return {
        ...settleReply(state),
        error: {
          kind: kindForStatus(action.status),
          message: action.message,
          retryable: action.status !== 402 && action.status !== 503,
        },
      };

    case 'clear':
      return state.streaming ? state : { ...state, entries: [], error: null, stopped: false };

    case 'restore':
      return state.streaming
        ? state
        : { ...state, hydrated: true, entries: action.entries ?? state.entries };
  }
}

function applyEvent(state: ChatState, event: CopilotStreamEvent): ChatState {
  switch (event.type) {
    case 'token':
      return updateReply(state, (entry) => ({ ...entry, content: entry.content + event.text }));

    case 'tool_call':
      return updateReply(state, (entry) => ({
        ...entry,
        tools: [
          ...entry.tools,
          {
            id: event.id,
            name: event.name,
            input: event.input,
            status: 'running',
            output: null,
            summary: null,
          },
        ],
      }));

    case 'tool_result':
      return updateReply(state, (entry) => ({
        ...entry,
        tools: entry.tools.map((tool) =>
          tool.id === event.id
            ? {
                ...tool,
                status: event.ok ? 'ok' : 'failed',
                output: event.output,
                summary: event.summary,
              }
            : tool,
        ),
      }));

    case 'done': {
      // The streamed tokens are what the person watched arrive; the message
      // on `done` is the same text and only fills in when none streamed.
      const filled = updateReply(state, (entry) => ({
        ...entry,
        content: entry.content.length > 0 ? entry.content : event.message,
      }));
      return { ...settleReply(filled), credits: event.credits };
    }

    case 'error':
      return {
        ...settleReply(state),
        credits: event.credits,
        error: { kind: event.kind, message: event.message, retryable: event.retryable },
      };
  }
}

/**
 * The conversation as the API wants it: role and text only, replies that
 * produced text, the last `limit` of them. The streaming reply is empty and
 * so is left out, which keeps the user's message last.
 */
export function historyFor(entries: readonly ChatEntry[], limit = HISTORY_LIMIT): CopilotMessage[] {
  return entries
    .filter((entry) => entry.content.trim().length > 0)
    .map((entry) => ({ role: entry.role, content: entry.content }))
    .slice(-limit);
}

/** The user message to send again after a failed reply, if there is one. */
export function lastUserMessage(entries: readonly ChatEntry[]): UserEntry | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.role === 'user') {
      return entry;
    }
  }
  return null;
}

export function copilotStorageKey(orgId: string): string {
  return `postgear:copilot:${orgId}`;
}

/**
 * Entries as stored. A reply that was streaming when the page went away is
 * stored settled: its text is whatever had arrived, and a tool still running
 * is recorded as interrupted — the API run was aborted with the connection.
 */
export function serializeHistory(entries: readonly ChatEntry[]): string {
  return JSON.stringify(
    entries
      .map((entry) =>
        entry.role === 'assistant'
          ? {
              ...entry,
              streaming: false,
              tools: entry.tools.map((tool) =>
                tool.status === 'running'
                  ? { ...tool, status: 'failed' as const, summary: 'Interrupted' }
                  : tool,
              ),
            }
          : entry,
      )
      .filter((entry) => !isEmptyReply(entry)),
  );
}

const TOOL_NAMES: readonly string[] = [
  'list_channels',
  'generate_post',
  'draft_post',
  'generate_image',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseTool(value: unknown): ToolActivity | null {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !TOOL_NAMES.includes(value.name) ||
    (value.status !== 'ok' && value.status !== 'failed' && value.status !== 'running')
  ) {
    return null;
  }

  return {
    id: value.id,
    name: value.name as CopilotToolName,
    input: value.input ?? null,
    status: value.status === 'running' ? 'failed' : value.status,
    output: value.output ?? null,
    summary: typeof value.summary === 'string' ? value.summary : null,
  };
}

/** Stored entries back, or null when the storage holds anything unexpected. */
export function parseHistory(raw: string | null): ChatEntry[] | null {
  if (!raw) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) {
    return null;
  }

  const entries: ChatEntry[] = [];

  for (const value of parsed) {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.content !== 'string') {
      return null;
    }

    if (value.role === 'user') {
      entries.push({ id: value.id, role: 'user', content: value.content });
    } else if (value.role === 'assistant') {
      const tools = Array.isArray(value.tools) ? value.tools.map(parseTool) : [];
      if (tools.some((tool) => tool === null)) {
        return null;
      }
      entries.push({
        id: value.id,
        role: 'assistant',
        content: value.content,
        tools: tools as ToolActivity[],
        streaming: false,
      });
    } else {
      return null;
    }
  }

  return entries;
}

/** What a tool row says, in each of its states. */
export function describeTool(tool: ToolActivity): string {
  const summary = tool.summary;

  switch (tool.name) {
    case 'list_channels':
      return tool.status === 'running'
        ? 'Checking your channels…'
        : tool.status === 'ok'
          ? (summary ?? 'Checked your channels')
          : "Couldn't check your channels";
    case 'generate_post':
      return tool.status === 'running'
        ? 'Writing a post…'
        : tool.status === 'ok'
          ? (summary ?? 'Wrote a post')
          : "Couldn't write the post";
    case 'draft_post':
      return tool.status === 'running'
        ? 'Drafting a post…'
        : tool.status === 'ok'
          ? (summary ?? 'Drafted a post')
          : "Couldn't draft the post";
    case 'generate_image':
      return tool.status === 'running'
        ? 'Generating an image…'
        : tool.status === 'ok'
          ? (summary ?? 'Generated an image')
          : "Couldn't generate the image";
  }
}

/** Why a tool failed, when its output says. */
export function toolFailureReason(tool: ToolActivity): string | null {
  if (tool.status !== 'failed' || !isRecord(tool.output)) {
    return null;
  }

  const reason = tool.output.message ?? tool.output.error;
  return typeof reason === 'string' ? reason : null;
}

export function draftOutput(tool: ToolActivity): DraftPostToolOutput | null {
  if (tool.name !== 'draft_post' || tool.status !== 'ok' || !isRecord(tool.output)) {
    return null;
  }

  const { group, channelNames, parts } = tool.output;
  return typeof group === 'string' && Array.isArray(channelNames)
    ? {
        group,
        channelNames: channelNames.filter((name): name is string => typeof name === 'string'),
        parts: typeof parts === 'number' ? parts : 1,
      }
    : null;
}

export function imageOutput(tool: ToolActivity): GenerateImageToolOutput | null {
  if (tool.name !== 'generate_image' || tool.status !== 'ok' || !isRecord(tool.output)) {
    return null;
  }

  const { mediaId, url, thumbnailUrl, prompt } = tool.output;
  return typeof mediaId === 'string' && typeof url === 'string'
    ? {
        mediaId,
        url,
        thumbnailUrl: typeof thumbnailUrl === 'string' ? thumbnailUrl : null,
        prompt: typeof prompt === 'string' ? prompt : '',
      }
    : null;
}
