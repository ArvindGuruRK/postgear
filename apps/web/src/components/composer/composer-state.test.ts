/**
 * The composer reducer and what it sends.
 *
 * These pin the behaviours that would be silent if wrong: a customized channel
 * no longer follows shared edits, a reorder keeps each part's identity, a save
 * does not swallow edits made while it was in flight, and the payload never
 * carries a client-side key or an unnormalized editor document.
 */
import { documentFromText, renderPlainText } from '@postgear/social-core/composer';
import type { Channel, ProviderSummary } from '@/types/channel';
import type { MediaItem } from '@/types/media';
import type { PostDetail } from '@/types/post';
import type { Tag } from '@/types/tag';
import { buildReport, queueBlockers } from './channel-report';
import {
  type ComposerState,
  composerReducer,
  defaultPublishAt,
  duplicateParts,
  effectiveParts,
  initialComposerState,
  isDirty,
  isValidPublishAt,
  MAX_TAGS,
  SHARED,
  textPart,
  toSavePayload,
} from './composer-state';

const image: MediaItem = {
  id: '6f1c2f7e-5d2b-4d0c-9a4e-3b8f0e2a1c11',
  name: 'photo.jpg',
  type: 'image',
  mimeType: 'image/jpeg',
  fileSize: 1000,
  width: 1080,
  height: 1080,
  url: 'http://localhost:3001/uploads/a.jpg',
  thumbnailUrl: null,
  createdAt: '2026-09-14T00:00:00.000Z',
};

function fresh(): ComposerState {
  return initialComposerState({
    post: null,
    availableChannelIds: new Set(),
    now: new Date('2026-09-14T13:41:00'),
  });
}

function withText(state: ComposerState, text: string): ComposerState {
  return composerReducer(state, {
    type: 'editContent',
    scope: SHARED,
    key: state.shared[0].key,
    content: documentFromText(text),
  });
}

const textOf = (content: unknown) =>
  renderPlainText(content as ReturnType<typeof documentFromText>);

describe('composerReducer', () => {
  it('starts a new post with one empty part, scheduled at the top of the next hour', () => {
    const state = fresh();

    expect(state.shared).toHaveLength(1);
    expect(state.publishAt).toBe('2026-09-14T14:00');
    expect(isDirty(state)).toBe(false);
  });

  it('starts with library media when opened from "Use in a post"', () => {
    const state = initialComposerState({
      post: null,
      media: image,
      availableChannelIds: new Set(),
      now: new Date(),
    });

    expect(state.shared[0].media).toEqual([image]);
  });

  it('starts a new post with a template’s text, one paragraph per line, and is not dirty', () => {
    const state = initialComposerState({
      post: null,
      availableChannelIds: new Set(),
      now: new Date('2026-09-14T13:41:00'),
      text: 'Tips for [topic]:\n\n1. [First tip]',
    });

    expect(state.shared).toHaveLength(1);
    expect(state.shared[0].content).toEqual(
      documentFromText('Tips for [topic]:\n\n1. [First tip]'),
    );
    expect(textOf(state.shared[0].content)).toContain('1. [First tip]');
    // Starter text is not the writer's own: closing it untouched asks nothing.
    expect(isDirty(state)).toBe(false);
    expect(toSavePayload(state, 'DRAFT').shared[0].content).toEqual(
      documentFromText('Tips for [topic]:\n\n1. [First tip]'),
    );
  });

  it('ignores template text when reopening a saved post', () => {
    const post: PostDetail = {
      group: 'g_saved',
      state: 'DRAFT',
      publishDate: '2026-09-15T09:00:00.000Z',
      updatedAt: '2026-09-14T00:00:00.000Z',
      shared: [{ content: documentFromText('mine'), media: [], removedMedia: 0 }],
      channels: [],
      tags: [],
      intervalInDays: null,
    };

    const state = initialComposerState({
      post,
      availableChannelIds: new Set(),
      now: new Date('2026-09-14T13:41:00'),
      text: 'A template',
    });

    expect(textOf(state.shared[0].content)).toBe('mine');
  });

  it('copies the shared thread on customize, so later shared edits stop reaching the channel', () => {
    let state = withText(fresh(), 'shared');
    state = composerReducer(state, { type: 'toggleChannel', channelId: 'ch_x' });
    state = composerReducer(state, { type: 'customize', channelId: 'ch_x' });

    expect(state.scope).toBe('ch_x');
    expect(state.custom.ch_x[0].key).not.toBe(state.shared[0].key);

    state = withText(state, 'edited after');

    expect(textOf(effectiveParts(state, 'ch_x')[0].content)).toBe('shared');
    expect(textOf(state.shared[0].content)).toBe('edited after');
  });

  it('ignores edits aimed at a channel that follows the shared thread', () => {
    let state = composerReducer(fresh(), { type: 'toggleChannel', channelId: 'ch_x' });
    const before = state;
    state = composerReducer(state, { type: 'addPart', scope: 'ch_x' });

    expect(state).toBe(before);
  });

  it('keeps a customization when a channel is deselected by accident', () => {
    let state = composerReducer(fresh(), { type: 'toggleChannel', channelId: 'ch_x' });
    state = composerReducer(state, { type: 'customize', channelId: 'ch_x' });
    state = composerReducer(state, { type: 'toggleChannel', channelId: 'ch_x' });

    expect(state.scope).toBe(SHARED);
    expect(state.custom.ch_x).toBeDefined();
    expect(toSavePayload(state, 'DRAFT').channels).toEqual([]);
  });

  it('moves parts without changing their identity', () => {
    let state = composerReducer(fresh(), { type: 'addPart', scope: SHARED });
    state = composerReducer(state, { type: 'addPart', scope: SHARED });
    const keys = state.shared.map((part) => part.key);

    state = composerReducer(state, { type: 'movePart', scope: SHARED, from: 2, to: 0 });

    expect(state.shared.map((part) => part.key)).toEqual([keys[2], keys[0], keys[1]]);
  });

  it('refuses a move outside the thread, and never removes the last part', () => {
    const one = fresh();

    expect(composerReducer(one, { type: 'movePart', scope: SHARED, from: 0, to: 3 })).toBe(one);
    expect(
      composerReducer(one, { type: 'removePart', scope: SHARED, key: one.shared[0].key }),
    ).toBe(one);
  });

  it('attaches each media item once', () => {
    let state = fresh();
    const key = state.shared[0].key;
    state = composerReducer(state, { type: 'attachMedia', scope: SHARED, key, media: [image] });
    state = composerReducer(state, { type: 'attachMedia', scope: SHARED, key, media: [image] });

    expect(state.shared[0].media).toHaveLength(1);

    state = composerReducer(state, { type: 'detachMedia', scope: SHARED, key, mediaId: image.id });
    expect(state.shared[0].media).toHaveLength(0);
  });

  it('keeps edits made while a save was in flight marked as unsaved', () => {
    let state = withText(fresh(), 'first');
    const sentRevision = state.revision;
    state = withText(state, 'typed during the save');

    state = composerReducer(state, {
      type: 'saved',
      revision: sentRevision,
      post: { group: 'g', updatedAt: '2026-09-14T10:00:00.000Z', state: 'DRAFT' } as PostDetail,
    });

    expect(state.group).toBe('g');
    expect(isDirty(state)).toBe(true);
  });

  it('does not treat inherited object properties as customized channels', () => {
    const state = composerReducer(fresh(), { type: 'toggleChannel', channelId: 'constructor' });

    expect(toSavePayload(state, 'DRAFT').channels).toEqual([
      { channelId: 'constructor', customized: false, settings: {} },
    ]);
  });
});

describe('initialComposerState from a saved post', () => {
  const saved: PostDetail = {
    group: 'g_1',
    state: 'DRAFT',
    publishDate: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-09-14T10:00:00.000Z',
    shared: [{ content: documentFromText('shared'), media: [], removedMedia: 0 }],
    channels: [
      {
        channelId: 'ch_x',
        name: 'X',
        providerIdentifier: 'x',
        picture: null,
        profile: null,
        color: 0,
        customized: true,
        disconnected: false,
        state: 'DRAFT',
        releaseURL: null,
        publishStatus: null,
        parts: [{ content: documentFromText('mine'), media: [], removedMedia: 1 }],
        settings: { replySettings: 'following' },
      },
      {
        channelId: 'ch_li',
        name: 'LinkedIn',
        providerIdentifier: 'linkedin',
        picture: null,
        profile: null,
        color: 1,
        customized: false,
        disconnected: false,
        state: 'DRAFT',
        releaseURL: null,
        publishStatus: null,
        parts: [],
        settings: {},
      },
      {
        channelId: 'ch_gone',
        name: 'Old page',
        providerIdentifier: 'facebook',
        picture: null,
        profile: null,
        color: 2,
        customized: false,
        disconnected: true,
        state: 'DRAFT',
        releaseURL: null,
        publishStatus: null,
        parts: [],
        settings: {},
      },
    ],
    tags: [{ id: 'tag_1', name: 'Launch', color: 'teal' }],
    intervalInDays: 7,
  };

  it('restores selection, customizations and version, and flags a disconnected channel', () => {
    const state = initialComposerState({
      post: saved,
      availableChannelIds: new Set(['ch_x', 'ch_li']),
      now: new Date(),
    });

    expect(state.selected).toEqual(['ch_x', 'ch_li']);
    expect(Object.keys(state.custom)).toEqual(['ch_x']);
    expect(state.custom.ch_x[0].removedMedia).toBe(1);
    expect(state.disconnected).toEqual([{ channelId: 'ch_gone', name: 'Old page' }]);
    // Saving will drop the disconnected channel, which is a change worth saving.
    expect(isDirty(state)).toBe(true);
  });

  it('sends the loaded version back, so a stale save is refused', () => {
    const state = initialComposerState({
      post: saved,
      availableChannelIds: new Set(['ch_x', 'ch_li']),
      now: new Date(),
    });

    expect(toSavePayload(state, 'QUEUE')).toMatchObject({
      state: 'QUEUE',
      publishDate: '2026-10-01T09:00:00.000Z',
      expectedUpdatedAt: '2026-09-14T10:00:00.000Z',
      channels: [
        {
          channelId: 'ch_x',
          customized: true,
          parts: [{ content: documentFromText('mine'), media: [] }],
        },
        { channelId: 'ch_li', customized: false },
      ],
    });
  });

  it('loads tags, the repeat and each channel’s settings, and sends them back', () => {
    const state = initialComposerState({
      post: saved,
      availableChannelIds: new Set(['ch_x', 'ch_li']),
      now: new Date(),
    });

    expect(state.tags).toEqual([{ id: 'tag_1', name: 'Launch', color: 'teal' }]);
    expect(state.intervalInDays).toBe(7);
    expect(state.settings).toEqual({ ch_x: { replySettings: 'following' } });

    const payload = toSavePayload(state, 'QUEUE');
    expect(payload.tags).toEqual(['tag_1']);
    expect(payload.intervalInDays).toBe(7);
    expect(payload.channels.map((channel) => channel.settings)).toEqual([
      { replySettings: 'following' },
      {},
    ]);
  });

  it('defaults the new fields when the API sends a post without them', () => {
    const { tags: _tags, intervalInDays: _interval, ...older } = saved;
    const state = initialComposerState({
      post: {
        ...older,
        channels: older.channels.map(({ settings: _settings, ...channel }) => channel),
      } as unknown as PostDetail,
      availableChannelIds: new Set(['ch_x', 'ch_li']),
      now: new Date(),
    });

    expect(state.tags).toEqual([]);
    expect(state.intervalInDays).toBeNull();
    expect(state.settings).toEqual({});
  });
});

describe('tags, repeat and settings', () => {
  const launch: Tag = { id: 'tag_1', name: 'Launch', color: 'teal' };
  const promo: Tag = { id: 'tag_2', name: 'Promo', color: 'rose' };

  it('sets tags as an edit, in the order they were added, and sends their ids', () => {
    const state = composerReducer(fresh(), { type: 'setTags', tags: [promo, launch] });

    expect(isDirty(state)).toBe(true);
    expect(toSavePayload(state, 'DRAFT').tags).toEqual(['tag_2', 'tag_1']);
  });

  it('caps a post at the API’s tag limit', () => {
    const many = Array.from({ length: MAX_TAGS + 2 }, (_, index) => ({
      ...launch,
      id: `tag_${index}`,
    }));

    expect(composerReducer(fresh(), { type: 'setTags', tags: many }).tags).toHaveLength(MAX_TAGS);
  });

  it('follows a tag renamed or deleted in the workspace without counting it as an edit', () => {
    let state = composerReducer(fresh(), { type: 'setTags', tags: [launch, promo] });
    state = composerReducer(state, {
      type: 'saved',
      revision: state.revision,
      post: { group: 'g', updatedAt: '2026-09-14T10:00:00.000Z', state: 'DRAFT' } as PostDetail,
    });

    state = composerReducer(state, {
      type: 'tagChanged',
      tag: { ...launch, name: 'Launch day', color: 'green' },
    });
    state = composerReducer(state, { type: 'tagDeleted', tagId: promo.id });

    expect(state.tags).toEqual([{ id: 'tag_1', name: 'Launch day', color: 'green' }]);
    expect(isDirty(state)).toBe(false);
  });

  it('ignores a workspace change to a tag the post does not have', () => {
    const state = fresh();

    expect(composerReducer(state, { type: 'tagChanged', tag: launch })).toBe(state);
    expect(composerReducer(state, { type: 'tagDeleted', tagId: launch.id })).toBe(state);
  });

  it('sets and clears the repeat, and sends null for none', () => {
    let state = composerReducer(fresh(), { type: 'setRepeat', value: 14 });

    expect(toSavePayload(state, 'QUEUE').intervalInDays).toBe(14);
    expect(isDirty(state)).toBe(true);

    state = composerReducer(state, { type: 'setRepeat', value: null });
    expect(toSavePayload(state, 'QUEUE').intervalInDays).toBeNull();

    // Choosing what is already chosen changes nothing.
    expect(composerReducer(state, { type: 'setRepeat', value: null })).toBe(state);
  });

  it('keeps settings per channel, clears a field with undefined, and sends only selected channels', () => {
    let state = composerReducer(fresh(), { type: 'toggleChannel', channelId: 'ch_yt' });
    state = composerReducer(state, { type: 'toggleChannel', channelId: 'ch_x' });
    state = composerReducer(state, {
      type: 'setSetting',
      channelId: 'ch_yt',
      key: 'title',
      value: 'Launch video',
    });
    state = composerReducer(state, {
      type: 'setSetting',
      channelId: 'ch_yt',
      key: 'madeForKids',
      value: true,
    });
    state = composerReducer(state, {
      type: 'setSetting',
      channelId: 'ch_x',
      key: 'replySettings',
      value: 'verified',
    });
    state = composerReducer(state, {
      type: 'setSetting',
      channelId: 'ch_yt',
      key: 'title',
      value: undefined,
    });

    expect(toSavePayload(state, 'DRAFT').channels).toEqual([
      { channelId: 'ch_yt', customized: false, settings: { madeForKids: true } },
      { channelId: 'ch_x', customized: false, settings: { replySettings: 'verified' } },
    ]);

    // Deselected, a channel keeps its settings for when it comes back.
    state = composerReducer(state, { type: 'toggleChannel', channelId: 'ch_x' });
    expect(toSavePayload(state, 'DRAFT').channels.map((channel) => channel.channelId)).toEqual([
      'ch_yt',
    ]);
    state = composerReducer(state, { type: 'toggleChannel', channelId: 'ch_x' });
    expect(toSavePayload(state, 'DRAFT').channels[1].settings).toEqual({
      replySettings: 'verified',
    });
  });

  it('asks to publish now only for the queue', () => {
    const state = fresh();

    expect(toSavePayload(state, 'QUEUE', { publishNow: true })).toMatchObject({
      state: 'QUEUE',
      publishNow: true,
    });
    expect(toSavePayload(state, 'DRAFT', { publishNow: true })).not.toHaveProperty('publishNow');
    expect(toSavePayload(state, 'QUEUE')).not.toHaveProperty('publishNow');
  });
});

describe('starting a new post', () => {
  const original: PostDetail = {
    group: 'g_orig',
    state: 'QUEUE',
    publishDate: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-09-14T10:00:00.000Z',
    shared: [
      { content: documentFromText('shared words'), media: [image], removedMedia: 0 },
      { content: documentFromText('a reply'), media: [], removedMedia: 0 },
    ],
    channels: [
      {
        channelId: 'ch_li',
        name: 'LinkedIn',
        providerIdentifier: 'linkedin',
        picture: null,
        profile: null,
        color: 1,
        customized: false,
        disconnected: false,
        state: 'QUEUE',
        releaseURL: null,
        publishStatus: null,
        parts: [],
        settings: {},
      },
    ],
    tags: [{ id: 'tag_1', name: 'Launch', color: 'teal' }],
    intervalInDays: 7,
  };

  it('duplicates the shared parts with their media, and nothing else', () => {
    const state = initialComposerState({
      post: null,
      parts: duplicateParts(original),
      availableChannelIds: new Set(['ch_li']),
      now: new Date('2026-09-14T13:41:00'),
    });

    expect(state.group).toBeNull();
    expect(state.shared.map((part) => textOf(part.content))).toEqual(['shared words', 'a reply']);
    expect(state.shared[0].media).toEqual([image]);
    expect(state.selected).toEqual([]);
    expect(state.tags).toEqual([]);
    expect(state.intervalInDays).toBeNull();
    expect(state.settings).toEqual({});
    expect(state.publishAt).toBe('2026-09-14T14:00');
    expect(isDirty(state)).toBe(false);
  });

  it('duplicates the first channel’s own version when it had one', () => {
    const customized: PostDetail = {
      ...original,
      channels: [
        {
          ...original.channels[0],
          customized: true,
          parts: [{ content: documentFromText('for LinkedIn'), media: [], removedMedia: 2 }],
        },
      ],
    };

    const parts = duplicateParts(customized);

    expect(parts.map((part) => textOf(part.content))).toEqual(['for LinkedIn']);
    expect(parts[0].removedMedia).toBe(0);
  });

  it('preselects a channel that can still be targeted, and ignores one that cannot', () => {
    const picked = initialComposerState({
      post: null,
      channelId: 'ch_li',
      availableChannelIds: new Set(['ch_li']),
      now: new Date(),
    });
    const gone = initialComposerState({
      post: null,
      channelId: 'ch_gone',
      availableChannelIds: new Set(['ch_li']),
      now: new Date(),
    });

    expect(picked.selected).toEqual(['ch_li']);
    expect(isDirty(picked)).toBe(false);
    expect(gone.selected).toEqual([]);
  });

  it('starts a blank post with the default signature after one empty line, not as an edit', () => {
    const state = initialComposerState({
      post: null,
      signature: 'Thanks,\nAcme',
      availableChannelIds: new Set(),
      now: new Date(),
    });

    expect(state.shared[0].content).toEqual(documentFromText('\nThanks,\nAcme'));
    expect(isDirty(state)).toBe(false);
  });

  it('gives a template or a duplicate precedence over the signature', () => {
    const fromTemplate = initialComposerState({
      post: null,
      text: 'A template',
      signature: 'Thanks',
      availableChannelIds: new Set(),
      now: new Date(),
    });
    const fromDuplicate = initialComposerState({
      post: null,
      parts: duplicateParts(original),
      signature: 'Thanks',
      availableChannelIds: new Set(),
      now: new Date(),
    });

    expect(textOf(fromTemplate.shared[0].content)).toBe('A template');
    expect(textOf(fromDuplicate.shared[0].content)).toBe('shared words');
  });
});

describe('insertText', () => {
  it('fills an empty part', () => {
    const state = fresh();
    const next = composerReducer(state, {
      type: 'insertText',
      scope: SHARED,
      key: state.shared[0].key,
      text: 'Line one\nLine two',
    });

    expect(next.shared[0].content).toEqual(documentFromText('Line one\nLine two'));
    expect(isDirty(next)).toBe(true);
  });

  it('adds paragraphs after what is already written', () => {
    const state = withText(fresh(), 'Mine');
    const next = composerReducer(state, {
      type: 'insertText',
      scope: SHARED,
      key: state.shared[0].key,
      text: 'Added',
    });

    expect(textOf(next.shared[0].content)).toBe('Mine\nAdded');
  });
});

describe('toSavePayload', () => {
  it('normalizes editor JSON and sends media as ids only, with no client keys', () => {
    let state = fresh();
    state = composerReducer(state, {
      type: 'editContent',
      scope: SHARED,
      key: state.shared[0].key,
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'hi',
                marks: [
                  {
                    type: 'link',
                    attrs: { href: 'https://a.test', target: '_blank', class: null },
                  },
                ],
              },
            ],
          },
        ],
      },
    });
    state = composerReducer(state, {
      type: 'attachMedia',
      scope: SHARED,
      key: state.shared[0].key,
      media: [image],
    });

    const payload = toSavePayload(state, 'DRAFT');

    expect(payload.shared[0]).toEqual({
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'hi',
                marks: [{ type: 'link', attrs: { href: 'https://a.test' } }],
              },
            ],
          },
        ],
      },
      media: [{ id: image.id }],
    });
    expect(JSON.stringify(payload)).not.toContain('part-');
    expect(payload).not.toHaveProperty('expectedUpdatedAt');
  });
});

describe('schedule helpers', () => {
  it('rolls the default over midnight and rejects an emptied field', () => {
    expect(defaultPublishAt(new Date('2026-12-31T23:30:00'))).toBe('2027-01-01T00:00');
    expect(isValidPublishAt('')).toBe(false);
    expect(isValidPublishAt('2026-09-14T15:00')).toBe(true);
  });
});

describe('buildReport', () => {
  const channel = {
    id: 'ch_x',
    name: 'Acme on X',
    providerName: 'X',
    providerIdentifier: 'x',
    inBetweenSteps: false,
    disabled: false,
  } as Channel;
  const x = {
    identifier: 'x',
    name: 'X',
    configured: true,
    requiresEntitySelection: false,
    analytics: true,
    rules: {
      maxLength: 280,
      lengthMethod: 'x-weighted',
      thread: 'replies',
      followUpMedia: true,
      media: { required: false, maxItems: 4, maxImages: 4, maxVideos: 1, allowMixed: false },
    },
  } as ProviderSummary;

  it('measures the rendered text the platform’s way and labels blockers by channel', () => {
    const report = buildReport(channel, x, [textPart('日'.repeat(141))]);

    expect(report.parts[0].length).toBe(282);
    expect(queueBlockers([report])).toEqual([
      'Acme on X: X allows 280 characters; this post has 282.',
    ]);
  });

  it('blocks queueing to a channel still being set up, whatever the content', () => {
    const report = buildReport({ ...channel, inBetweenSteps: true }, x, [textPart('fine')]);

    expect(queueBlockers([report])).toEqual([
      'Finish setting up Acme on X before adding posts to its queue.',
    ]);
  });
});
