/**
 * Module 10: Create Draft, Add To Queue, Publish To {Platform} and Get Post,
 * through the API's step gateway (`callGateway`). The worker never writes
 * a post itself: the API runs the composer's own `PostsService`, so every
 * channel, media, tag and platform rule is the composer's, and its effect
 * ledger plus a group derived from the step make a retried activity return
 * the first post instead of writing a second.
 *
 * What the worker does: turns the Media field (one or more `MediaRef`s from
 * earlier steps) plus the library picks into Media ids, drops the built-in
 * sample image (not a real row) with a note, reads a chosen time in the
 * step's zone, and writes the "Would ..." sentence of a dry run.
 *
 * Dry runs: Add To Queue and Publish To publish (they post without a
 * person), so a test run only describes them unless the step is sent for
 * real; the engine sets `ctx.dryRun`. Create Draft stays inside PostGear
 * and runs for real in tests (its output says so). Get Post only reads.
 */
import {
  formatDate,
  isValidTimeZone,
  MEDIA_FIELD_MESSAGE,
  mediaRefsFrom,
  nextFreeSlot,
  PUBLISH_PLATFORMS,
  parseIsoDate,
  platformById,
  SAMPLE_MEDIA_ID,
  toText,
  zonedToEpoch,
} from '@postgear/automation';
import type { AutomationDryRunOutput } from '@postgear/scheduling';
import { permanent } from '../failures';
import { callGateway } from '../gateway-client';
import type { ChannelRecord } from '../run-store';
import type { ExecContext, ExecResult, Executor } from './types';

/** The composer's limit on one part's attachments. */
export const MAX_POST_MEDIA = 20;
/** Characters of the post a dry run quotes. */
export const PREVIEW_CHARACTERS = 80;

export const SAMPLE_MEDIA_NOTE =
  'The sample image was left out because it is not in your media library.';
export const TEST_DRAFT_NOTE = 'Draft created from a test run.';
export const TOO_MUCH_MEDIA_MESSAGE = `A post can carry at most ${MAX_POST_MEDIA} images or videos.`;
export const BAD_TIME_MESSAGE =
  'Add To Queue needs a date and time it can read, like 2026-11-03 09:00.';
export const BAD_ZONE_MESSAGE = 'Choose a valid time zone for this step.';
export const NO_POST_MESSAGE = 'Choose which post to look up.';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/i;
const DATE_WORDS = "EEE d MMM 'at' HH:mm";

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item !== '')
    : [];
}

/** The Media field's refs plus the library picks, as Media ids, and what was left out. */
export function mediaIdsFor(config: Record<string, unknown>): { ids: string[]; notes: string[] } {
  const found = mediaRefsFrom(config.media);
  if (!found.ok) throw permanent(found.message, 'bad_media');

  const notes: string[] = [];
  const fromSteps: string[] = [];
  for (const ref of found.refs) {
    if (ref.id === SAMPLE_MEDIA_ID) {
      if (!notes.includes(SAMPLE_MEDIA_NOTE)) notes.push(SAMPLE_MEDIA_NOTE);
      continue;
    }
    if (!UUID.test(ref.id)) throw permanent(MEDIA_FIELD_MESSAGE, 'bad_media');
    fromSteps.push(ref.id);
  }

  const ids = [...new Set([...fromSteps, ...strings(config.mediaIds)])];
  if (ids.length > MAX_POST_MEDIA) throw permanent(TOO_MUCH_MEDIA_MESSAGE, 'too_much_media');
  return { ids, notes };
}

/** The first 80 characters of the post, on one line. */
export function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  const characters = Array.from(flat);
  return characters.length <= PREVIEW_CHARACTERS
    ? flat
    : `${characters.slice(0, PREVIEW_CHARACTERS).join('').trimEnd()}...`;
}

function platformTitle(provider: string): string {
  return (
    PUBLISH_PLATFORMS.find((platform) => platform.providers.includes(provider))?.title ?? provider
  );
}

function listWords(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "Instagram (Bloom Bakery) and LinkedIn (Acme)", from the workspace's channels. */
async function channelWords(
  ctx: ExecContext,
  ids: string[],
): Promise<{
  words: string;
  channels: ChannelRecord[];
}> {
  const channels = await ctx.deps.store.loadChannels(ctx.run.organizationId, ids);
  const words = listWords(
    channels.map((channel) => `${platformTitle(channel.provider)} (${channel.name})`),
  );
  return { words: words || 'the chosen channels', channels };
}

/**
 * A chosen time: an instant (a date with a zone, or a number), or a wall
 * time with no zone, read in the step's zone ("2026-11-03 09:00").
 */
export function chosenTime(value: unknown, timeZone: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime();
  const text = toText(value).trim();
  const parsed = parseIsoDate(text);
  if (parsed === undefined) throw permanent(BAD_TIME_MESSAGE, 'bad_time');
  if (HAS_OFFSET.test(text)) return parsed;
  // Parsed as if UTC: those are the wall clock's numbers, in the step's zone.
  const wall = new Date(parsed);
  return zonedToEpoch(
    {
      year: wall.getUTCFullYear(),
      month: wall.getUTCMonth() + 1,
      day: wall.getUTCDate(),
      hour: wall.getUTCHours(),
      minute: wall.getUTCMinutes(),
      second: wall.getUTCSeconds(),
    },
    timeZone,
  );
}

function dryRun(wouldSend: string, notes: string[]): ExecResult {
  const output: AutomationDryRunOutput & { note?: string } = {
    dryRun: true,
    wouldSend,
    ...(notes.length > 0 ? { note: notes.join(' ') } : {}),
  };
  return { output, status: 'dryRun' };
}

function withNotes(output: unknown, notes: string[]): unknown {
  if (notes.length === 0 || typeof output !== 'object' || output === null) return output;
  return { ...(output as Record<string, unknown>), note: notes.join(' ') };
}

export const createDraftExecutor: Executor = {
  type: 'postgear.createDraft',
  async run(ctx) {
    const { ids, notes } = mediaIdsFor(ctx.config);
    const tags = strings(ctx.config.tags);
    const { output, credits } = await callGateway(ctx, '/posts/draft', {
      channels: strings(ctx.config.channels),
      text: toText(ctx.config.text),
      mediaIds: ids,
      ...(tags.length > 0 ? { tags } : {}),
      parts: ctx.config.parts === 'splitOnBlankLines' ? 'splitOnBlankLines' : 'single',
    });
    // A draft is harmless and the person wants to open it, so a test makes a real one.
    const said = ctx.run.mode === 'test' ? [TEST_DRAFT_NOTE, ...notes] : notes;
    return { output: withNotes(output, said), credits };
  },
};

export const addToQueueExecutor: Executor = {
  type: 'postgear.addToQueue',
  async run(ctx) {
    const { ids, notes } = mediaIdsFor(ctx.config);
    const channelIds = strings(ctx.config.channels);
    const text = toText(ctx.config.text);
    const timeZone = toText(ctx.config.timeZone).trim() || ctx.timeZone;
    if (!isValidTimeZone(timeZone)) throw permanent(BAD_ZONE_MESSAGE, 'bad_time_zone');
    const at = ctx.config.when === 'at' ? chosenTime(ctx.config.at, timeZone) : undefined;

    if (ctx.dryRun) {
      const { words, channels } = await channelWords(ctx, channelIds);
      // Without the queue in hand, the first posting time; the real run skips taken ones.
      const slot =
        at ??
        nextFreeSlot({
          postingTimes: channels.flatMap((channel) => channel.postingTimes),
          taken: [],
          from: ctx.deps.now(),
          timeZone,
        });
      const when =
        slot === null
          ? 'at its next free posting time'
          : `on ${formatDate(slot, DATE_WORDS, timeZone)}`;
      return dryRun(`Would add to the queue for ${words} ${when}: ${preview(text)}`, notes);
    }

    const tags = strings(ctx.config.tags);
    const { output, credits } = await callGateway(ctx, '/posts/queue', {
      channels: channelIds,
      text,
      mediaIds: ids,
      ...(tags.length > 0 ? { tags } : {}),
      when: at === undefined ? 'nextSlot' : 'at',
      ...(at === undefined ? {} : { at: new Date(at).toISOString() }),
      timeZone,
    });
    return { output: withNotes(output, notes), credits };
  },
};

export const publishExecutor: Executor = {
  type: 'postgear.publish',
  async run(ctx) {
    const { ids, notes } = mediaIdsFor(ctx.config);
    const channelIds = strings(ctx.config.channels);
    const text = toText(ctx.config.text);
    const provider = toText(ctx.config.provider);

    if (ctx.dryRun) {
      const { words } = await channelWords(ctx, channelIds);
      return dryRun(`Would publish to ${words} now: ${preview(text)}`, notes);
    }

    const settings = ctx.config.settings;
    const { output, credits } = await callGateway(ctx, '/posts/publish', {
      provider: platformById(provider)?.id ?? provider,
      channels: channelIds,
      text,
      mediaIds: ids,
      ...(settings && typeof settings === 'object' && !Array.isArray(settings) ? { settings } : {}),
    });
    return { output: withNotes(output, notes), credits };
  },
};

export const getPostExecutor: Executor = {
  type: 'postgear.getPost',
  async run(ctx) {
    const post = toText(ctx.config.post).trim();
    if (!post) throw permanent(NO_POST_MESSAGE, 'no_post');
    const { output, credits } = await callGateway(ctx, '/posts/get', { post });
    return { output, credits };
  },
};

export const POSTS_EXECUTORS: Executor[] = [
  createDraftExecutor,
  addToQueueExecutor,
  publishExecutor,
  getPostExecutor,
];
