/**
 * The chat producer (Module 16 section 3; research 06 section 5.1).
 *
 * **Twitch past broadcasts only, and only when `CLIPS_TWITCH_CHAT=true`.**
 * Twitch has no documented route for a past broadcast's chat; this reads the
 * one its own web player uses (a persisted GraphQL query, read in
 * TwitchDownloader's source, MIT: `VideoCommentsByOffsetOrCursor`). The
 * query's hash changes a few times a year without notice, so it is one
 * constant overridable by `TWITCH_CHAT_QUERY`, fixable without a release.
 *
 * Rules, all from the research:
 * - Each message becomes a time and a weight (1, or 1.5 with a reaction word
 *   or an emote) the moment it is read; its text and its author are dropped
 *   there and never stored, logged or passed on.
 * - One page at a time, at most `maxPages` pages and `maxMs`; at a cap we
 *   keep what we have.
 * - Any failure (a refused request, an error mid-way, a deleted video, chat
 *   replay off, a page that does not read) returns null and logs one line.
 *   Never retried in a loop: the run goes on from sound and picture.
 *
 * The fetch is injected, so tests read recorded pages; under
 * `CLIPS_SIMULATION` the worker binds `recordedChatSource` instead, which
 * reads the sample stream's recorded chat. Development never calls Twitch.
 */
import {
  type ChatMessageWeight,
  type ChannelPlatformId,
  chatTrack,
  type LinkKind,
  type SignalTrack,
} from '@postgear/video-engine';
import { sampleChat } from '../downloader/samples';

export const TWITCH_GQL_URL = 'https://gql.twitch.tv/gql';
/** Twitch's web client id, public in every page Twitch serves (research 06 section 5.1). */
export const TWITCH_WEB_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
/** `VideoCommentsByOffsetOrCursor`'s persisted query hash, as TwitchDownloader sends it. `TWITCH_CHAT_QUERY` overrides it. */
export const TWITCH_CHAT_QUERY_HASH =
  'b70a3591ff0f4e0313d126c6a1502d79a1c02baebb288227c582044aa76adf6a';
export const CHAT_MAX_PAGES = 3_000;
export const CHAT_MAX_MS = 5 * 60_000;
const PAGE_TIMEOUT_MS = 15_000;

/** What the chat step asks for. Only a Twitch past broadcast has a chat we read. */
export interface ChatRequest {
  platform: ChannelPlatformId | 'upload';
  /** `past_stream` for a past broadcast; clips have no chat replay of their own. */
  kind: LinkKind | 'upload';
  externalId: string | null;
  durationMs: number;
  signal?: AbortSignal;
}

/** Where chat messages come from: the Twitch pager, the recording, or nowhere. */
export interface ChatSource {
  /** Messages as times and weights, or null when there is no chat to use. */
  messages(request: ChatRequest): Promise<ChatMessageWeight[] | null>;
}

/** The chat track for a request, or null. */
export async function produceChat(
  source: ChatSource | null,
  request: ChatRequest,
): Promise<SignalTrack | null> {
  if (
    !source ||
    request.platform !== 'twitch' ||
    request.kind !== 'past_stream' ||
    !request.externalId
  ) {
    return null;
  }
  const messages = await source.messages(request);
  if (!messages || messages.length === 0) return null;
  return chatTrack(messages, request.durationMs);
}

// ---- Reaction words ---------------------------------------------------------------

/** Research 06 section 6's starter list: whole words, any case. */
export const REACTION_WORDS: readonly string[] = [
  'lul',
  'kekw',
  'omegalul',
  'lmao',
  'pog',
  'pogchamp',
  'poggers',
  'w',
  'clip',
  'omg',
  'wtf',
  'monkas',
  'kappa',
];
const REACTION_PHRASES: readonly string[] = ['clip it', 'clip that'];
const REACTION_WEIGHT = 1.5;

/** A message's weight from its text (the text itself goes no further). */
export function reactionWeight(text: string, hasEmote: boolean): number {
  if (hasEmote) return REACTION_WEIGHT;
  const lower = text.toLowerCase();
  if (REACTION_PHRASES.some((phrase) => lower.includes(phrase))) return REACTION_WEIGHT;
  const words = lower.split(/[^a-z0-9]+/).filter(Boolean);
  return words.some((word) => REACTION_WORDS.includes(word)) ? REACTION_WEIGHT : 1;
}

// ---- The Twitch pager ----------------------------------------------------------------

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface TwitchChatOptions {
  fetch?: FetchLike;
  clientId?: string;
  /** `TWITCH_CHAT_QUERY`, or the built-in hash. */
  queryHash?: string;
  maxPages?: number;
  maxMs?: number;
  now?: () => number;
}

interface PageResult {
  messages: ChatMessageWeight[];
  cursor: string | null;
  hasNextPage: boolean;
}

class ChatUnreadable extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

/** Reads one answer page into times and weights; throws `ChatUnreadable` for anything off. */
export function readChatPage(body: unknown): PageResult {
  const root = Array.isArray(body) ? body[0] : body;
  const video = (root as { data?: { video?: unknown } } | null)?.data?.video;
  if (video === null || video === undefined) throw new ChatUnreadable('video_gone');
  const comments = (video as { comments?: unknown }).comments;
  if (comments === null || comments === undefined || typeof comments !== 'object') {
    throw new ChatUnreadable('no_comments');
  }
  const { edges, pageInfo } = comments as { edges?: unknown; pageInfo?: { hasNextPage?: unknown } };
  if (!Array.isArray(edges)) throw new ChatUnreadable('no_edges');

  const messages: ChatMessageWeight[] = [];
  let cursor: string | null = null;
  for (const edge of edges) {
    const node = (edge as { node?: unknown })?.node as
      | { contentOffsetSeconds?: unknown; message?: { fragments?: unknown } }
      | undefined;
    const offset = node?.contentOffsetSeconds;
    if (typeof offset !== 'number' || !Number.isFinite(offset) || offset < 0) continue;
    const fragments = Array.isArray(node?.message?.fragments) ? node.message.fragments : [];
    let text = '';
    let hasEmote = false;
    for (const fragment of fragments as Array<{ text?: unknown; emote?: unknown }>) {
      if (typeof fragment?.text === 'string') text += fragment.text;
      if (fragment?.emote) hasEmote = true;
    }
    messages.push({ offsetMs: Math.round(offset * 1000), weight: reactionWeight(text, hasEmote) });
    const next = (edge as { cursor?: unknown }).cursor;
    if (typeof next === 'string' && next.length > 0) cursor = next;
  }
  return { messages, cursor, hasNextPage: pageInfo?.hasNextPage === true };
}

/** The Twitch replay pager. See the file comment for every rule. */
export function createTwitchChatSource(options: TwitchChatOptions = {}): ChatSource {
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));
  const clientId = options.clientId ?? TWITCH_WEB_CLIENT_ID;
  const hash = options.queryHash ?? TWITCH_CHAT_QUERY_HASH;
  const maxPages = options.maxPages ?? CHAT_MAX_PAGES;
  const maxMs = options.maxMs ?? CHAT_MAX_MS;
  const now = options.now ?? Date.now;

  async function page(
    videoId: string,
    cursor: string | null,
    signal?: AbortSignal,
  ): Promise<PageResult> {
    const variables = cursor
      ? { videoID: videoId, cursor }
      : { videoID: videoId, contentOffsetSeconds: 0 };
    let response: Response;
    try {
      response = await doFetch(TWITCH_GQL_URL, {
        method: 'POST',
        headers: { 'Client-ID': clientId, 'content-type': 'application/json' },
        body: JSON.stringify([
          {
            operationName: 'VideoCommentsByOffsetOrCursor',
            variables,
            extensions: { persistedQuery: { version: 1, sha256Hash: hash } },
          },
        ]),
        redirect: 'error',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(PAGE_TIMEOUT_MS)])
          : AbortSignal.timeout(PAGE_TIMEOUT_MS),
      });
    } catch {
      throw new ChatUnreadable(signal?.aborted ? 'cancelled' : 'network');
    }
    if (!response.ok) throw new ChatUnreadable(`status_${response.status}`);
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ChatUnreadable('not_json');
    }
    const root = Array.isArray(body) ? body[0] : body;
    if ((root as { errors?: unknown } | null)?.errors) throw new ChatUnreadable('query_refused');
    return readChatPage(body);
  }

  return {
    async messages(request) {
      if (request.platform !== 'twitch' || !request.externalId) return null;
      const started = now();
      const all: ChatMessageWeight[] = [];
      let cursor: string | null = null;
      try {
        for (let pages = 0; pages < maxPages; pages += 1) {
          if (now() - started > maxMs) break;
          const result = await page(request.externalId, cursor, request.signal);
          all.push(...result.messages);
          if (!result.hasNextPage || !result.cursor) break;
          cursor = result.cursor;
        }
      } catch (error) {
        const reason = error instanceof ChatUnreadable ? error.reason : 'unreadable';
        console.warn(JSON.stringify({ event: 'clips.signals.chat_unreadable', reason }));
        return null;
      }
      if (all.length === 0) {
        // Chat replay off, or nobody typed: the run goes on without chat.
        console.warn(JSON.stringify({ event: 'clips.signals.chat_unreadable', reason: 'empty' }));
        return null;
      }
      return all;
    },
  };
}

// ---- The recording (simulation) ---------------------------------------------------------

/**
 * The sample stream's recorded chat (message times only), for the simulation
 * links whose ids it names. Anything else has no chat.
 */
export function recordedChatSource(): ChatSource {
  return {
    async messages(request) {
      const recording = sampleChat();
      if (request.platform !== 'twitch' || !request.externalId) return null;
      if (!recording.videoExternalIds.includes(request.externalId)) return null;
      return recording.messageOffsetsMs.map((offsetMs) => ({ offsetMs, weight: 1 }));
    },
  };
}
