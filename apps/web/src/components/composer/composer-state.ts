/**
 * The composer's state, as a pure reducer.
 *
 * ## The model
 *
 * One **shared** thread, written once, and a set of **selected channels**.
 * A channel follows the shared thread until someone customizes it, at which
 * point it gets its own copy — copied, not referenced, so later shared edits
 * stop reaching it. "Use the shared post" throws the copy away.
 *
 * That is the reference's global-plus-per-channel-override design, kept, with
 * one change in where it lives: plain data and a reducer instead of a global
 * store module, so every transition is testable without rendering anything.
 *
 * ## Why parts carry a client-only key
 *
 * Reordering moves text between positions, and each part owns a TipTap editor
 * instance. Keying editors by position would hand one part's editor (and its
 * undo history, and the cursor) to another part's text on every drag. The key
 * travels with the part; it is never sent to the API, which matches rows by
 * position itself.
 *
 * ## Why editors are uncontrolled
 *
 * A part's `content` is whatever the editor last reported, and the editor is
 * never pushed new content while mounted — pushing on every keystroke is the
 * classic cause of a cursor jumping to the end. Content only enters an editor
 * when it mounts, which is exactly when a part is created, copied or loaded.
 */
import {
  documentFromText,
  emptyDocument,
  normalizeDocument,
  type PostDocument,
} from '@postgear/social-core/composer';
import type { MediaItem } from '@/types/media';
import type { PostDetail, PostPart, PostState } from '@/types/post';

/** The tab that edits the thread every non-customized channel uses. */
export const SHARED = 'shared';

/** `SHARED`, or the id of a selected channel. */
export type Scope = string;

export interface DraftPart {
  /** Client-only identity, for React keys and drag-and-drop. Never sent. */
  key: string;
  /**
   * Editor JSON as TipTap last reported it. Not yet normalized: that happens
   * when it is rendered for a preview or serialized for a save.
   */
  content: unknown;
  media: MediaItem[];
  /** Attachments on the saved version that have since been deleted from the library. */
  removedMedia: number;
}

export interface ComposerState {
  /** Null until the first save. */
  group: string | null;
  /** The version the editor holds; sent back so a stale save is refused. */
  updatedAt: string | null;
  /** The saved post's state, or null for a post never saved. */
  savedState: PostState | null;
  /** A `datetime-local` value, in the browser's time zone. */
  publishAt: string;
  shared: DraftPart[];
  /** Selected channel ids, in the order they were picked. */
  selected: string[];
  /**
   * Channels with their own content. A deselected channel keeps its entry, so
   * an accidental click does not destroy a customization.
   */
  custom: Record<string, DraftPart[]>;
  scope: Scope;
  /** Bumped on every edit. A save records the revision it sent. */
  revision: number;
  savedRevision: number;
  /** Channels on the saved post that have since been disconnected; dropped on the next save. */
  disconnected: { channelId: string; name: string }[];
}

export type ComposerAction =
  | { type: 'toggleChannel'; channelId: string }
  | { type: 'setScope'; scope: Scope }
  | { type: 'editContent'; scope: Scope; key: string; content: unknown }
  | { type: 'addPart'; scope: Scope }
  | { type: 'removePart'; scope: Scope; key: string }
  | { type: 'movePart'; scope: Scope; from: number; to: number }
  | { type: 'attachMedia'; scope: Scope; key: string; media: MediaItem[] }
  | { type: 'detachMedia'; scope: Scope; key: string; mediaId: string }
  | { type: 'customize'; channelId: string }
  | { type: 'useShared'; channelId: string }
  | { type: 'setPublishAt'; value: string }
  | { type: 'saved'; post: PostDetail; revision: number };

/** Parts a thread may have. Mirrors the API's `MAX_THREAD_PARTS`. */
export const MAX_PARTS = 25;

/** Attachments one part may carry. Mirrors the API's `MAX_MEDIA_PER_PART`. */
export const MAX_MEDIA_PER_PART = 20;

let keyCounter = 0;

/**
 * A key unique within this page.
 *
 * Deliberately not `crypto.randomUUID()`, which only exists in a secure
 * context — opening the app over a LAN address would break the composer.
 */
export function newKey(): string {
  keyCounter += 1;
  return `part-${keyCounter}`;
}

function newPart(content: unknown = emptyDocument(), media: MediaItem[] = []): DraftPart {
  return { key: newKey(), content, media, removedMedia: 0 };
}

function fromSaved(part: PostPart): DraftPart {
  return {
    key: newKey(),
    content: part.content,
    media: part.media,
    removedMedia: part.removedMedia,
  };
}

/** The top of the next hour — a sensible default that is always in the future. */
export function defaultPublishAt(now: Date): string {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return toLocalInputValue(next);
}

/** A `datetime-local` value (`2026-09-14T15:00`) for a moment, in the browser's zone. */
export function toLocalInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function initialComposerState(options: {
  post: PostDetail | null;
  /** Library media to start a new post with ("Use in a post"). */
  media?: MediaItem | null;
  /** Ids of channels that can still be targeted. */
  availableChannelIds: Set<string>;
  now: Date;
}): ComposerState {
  const { post } = options;

  if (!post) {
    return {
      group: null,
      updatedAt: null,
      savedState: null,
      publishAt: defaultPublishAt(options.now),
      shared: [newPart(emptyDocument(), options.media ? [options.media] : [])],
      selected: [],
      custom: {},
      scope: SHARED,
      revision: 0,
      savedRevision: 0,
      disconnected: [],
    };
  }

  const live = post.channels.filter(
    (channel) => !channel.disconnected && options.availableChannelIds.has(channel.channelId),
  );

  return {
    group: post.group,
    updatedAt: post.updatedAt,
    savedState: post.state,
    publishAt: toLocalInputValue(new Date(post.publishDate)),
    shared: post.shared.length > 0 ? post.shared.map(fromSaved) : [newPart()],
    selected: live.map((channel) => channel.channelId),
    custom: Object.fromEntries(
      live
        .filter((channel) => channel.customized)
        .map((channel) => [channel.channelId, channel.parts.map(fromSaved)]),
    ),
    scope: SHARED,
    revision: 0,
    savedRevision: 0,
    disconnected: post.channels
      .filter((channel) => !live.includes(channel))
      .map((channel) => ({ channelId: channel.channelId, name: channel.name })),
  };
}

/**
 * A channel's own parts, if it has them.
 *
 * An own-property check rather than `id in custom` or `custom[id]`: both of
 * those also find `constructor` and `toString` on every object.
 */
function customParts(state: ComposerState, channelId: string): DraftPart[] | undefined {
  return Object.hasOwn(state.custom, channelId) ? state.custom[channelId] : undefined;
}

/** The parts a scope edits: the shared thread, or a customized channel's own. */
export function partsFor(state: ComposerState, scope: Scope): DraftPart[] {
  return scope === SHARED ? state.shared : (customParts(state, scope) ?? state.shared);
}

/** The parts a channel will actually publish. */
export function effectiveParts(state: ComposerState, channelId: string): DraftPart[] {
  return customParts(state, channelId) ?? state.shared;
}

export function isCustomized(state: ComposerState, channelId: string): boolean {
  return customParts(state, channelId) !== undefined;
}

export function isDirty(state: ComposerState): boolean {
  return state.revision !== state.savedRevision || state.disconnected.length > 0;
}

export function composerReducer(state: ComposerState, action: ComposerAction): ComposerState {
  switch (action.type) {
    case 'toggleChannel': {
      const selected = state.selected.includes(action.channelId)
        ? state.selected.filter((id) => id !== action.channelId)
        : [...state.selected, action.channelId];

      return touch({
        ...state,
        selected,
        scope: selected.includes(state.scope) || state.scope === SHARED ? state.scope : SHARED,
      });
    }

    case 'setScope':
      return action.scope === SHARED || state.selected.includes(action.scope)
        ? { ...state, scope: action.scope }
        : state;

    case 'editContent':
      return updateParts(state, action.scope, (parts) =>
        parts.map((part) =>
          part.key === action.key ? { ...part, content: action.content } : part,
        ),
      );

    case 'addPart':
      return updateParts(state, action.scope, (parts) =>
        parts.length >= MAX_PARTS ? parts : [...parts, newPart()],
      );

    case 'removePart':
      // A thread always keeps one part; an empty post is still a post.
      return updateParts(state, action.scope, (parts) =>
        parts.length <= 1 ? parts : parts.filter((part) => part.key !== action.key),
      );

    case 'movePart':
      return updateParts(state, action.scope, (parts) => {
        const { from, to } = action;

        if (from === to || from < 0 || to < 0 || from >= parts.length || to >= parts.length) {
          return parts;
        }

        const next = [...parts];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });

    case 'attachMedia':
      return updateParts(state, action.scope, (parts) =>
        parts.map((part) => {
          if (part.key !== action.key) {
            return part;
          }

          const present = new Set(part.media.map((item) => item.id));
          const added = action.media.filter((item) => !present.has(item.id));

          return { ...part, media: [...part.media, ...added].slice(0, MAX_MEDIA_PER_PART) };
        }),
      );

    case 'detachMedia':
      return updateParts(state, action.scope, (parts) =>
        parts.map((part) =>
          part.key === action.key
            ? { ...part, media: part.media.filter((item) => item.id !== action.mediaId) }
            : part,
        ),
      );

    case 'customize':
      if (!state.selected.includes(action.channelId) || isCustomized(state, action.channelId)) {
        return state;
      }

      // A deep copy with fresh keys: the copy gets its own editors, and editing
      // it must never write through to the shared thread.
      return touch({
        ...state,
        custom: {
          ...state.custom,
          [action.channelId]: state.shared.map((part) =>
            // Editor content is plain JSON, so a JSON round trip is a complete
            // copy — and unlike structuredClone it exists in every test runner.
            newPart(JSON.parse(JSON.stringify(part.content)) as unknown, [...part.media]),
          ),
        },
        scope: action.channelId,
      });

    case 'useShared': {
      if (!isCustomized(state, action.channelId)) {
        return state;
      }

      const { [action.channelId]: _discarded, ...custom } = state.custom;
      return touch({ ...state, custom });
    }

    case 'setPublishAt':
      return touch({ ...state, publishAt: action.value });

    case 'saved':
      // Content stays as the editors hold it — the server stored exactly what
      // was sent. Only the version changes, and anything typed while the save
      // was in flight stays unsaved.
      return {
        ...state,
        group: action.post.group,
        updatedAt: action.post.updatedAt,
        savedState: action.post.state,
        savedRevision: action.revision,
        disconnected: [],
        shared: state.shared.map((part) => ({ ...part, removedMedia: 0 })),
        custom: Object.fromEntries(
          Object.entries(state.custom).map(([id, parts]) => [
            id,
            parts.map((part) => ({ ...part, removedMedia: 0 })),
          ]),
        ),
      };
  }
}

/** Applies an edit to a scope's parts. Edits to a channel that follows the shared thread are ignored. */
function updateParts(
  state: ComposerState,
  scope: Scope,
  update: (parts: DraftPart[]) => DraftPart[],
): ComposerState {
  if (scope === SHARED) {
    const shared = update(state.shared);
    return shared === state.shared ? state : touch({ ...state, shared });
  }

  const current = customParts(state, scope);

  if (!current) {
    return state;
  }

  const next = update(current);
  return next === current ? state : touch({ ...state, custom: { ...state.custom, [scope]: next } });
}

function touch(state: ComposerState): ComposerState {
  return { ...state, revision: state.revision + 1 };
}

/** True when the schedule field holds a real moment. An emptied field does not. */
export function isValidPublishAt(value: string): boolean {
  return value.length > 0 && !Number.isNaN(new Date(value).getTime());
}

/** What `POST /posts` and `PUT /posts/:group` expect. */
export interface SavePayload {
  state: 'DRAFT' | 'QUEUE';
  publishDate: string;
  shared: { content: PostDocument; media: { id: string }[] }[];
  channels: (
    | { channelId: string; customized: false }
    | {
        channelId: string;
        customized: true;
        parts: { content: PostDocument; media: { id: string }[] }[];
      }
  )[];
  expectedUpdatedAt?: string;
}

export function toSavePayload(state: ComposerState, target: 'DRAFT' | 'QUEUE'): SavePayload {
  const toPart = (part: DraftPart) => ({
    content: normalizeDocument(part.content),
    media: part.media.map((item) => ({ id: item.id })),
  });

  return {
    state: target,
    publishDate: new Date(state.publishAt).toISOString(),
    shared: state.shared.map(toPart),
    channels: state.selected.map((channelId) => {
      const custom = customParts(state, channelId);
      return custom
        ? { channelId, customized: true as const, parts: custom.map(toPart) }
        : { channelId, customized: false as const };
    }),
    ...(state.updatedAt ? { expectedUpdatedAt: state.updatedAt } : {}),
  };
}

/** Plain-text starting content, for tests and for anything that seeds a draft. */
export function textPart(text: string, media: MediaItem[] = []): DraftPart {
  return newPart(documentFromText(text), media);
}
