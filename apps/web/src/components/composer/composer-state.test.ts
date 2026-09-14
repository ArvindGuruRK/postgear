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
import { buildReport, queueBlockers } from './channel-report';
import {
  type ComposerState,
  composerReducer,
  defaultPublishAt,
  effectiveParts,
  initialComposerState,
  isDirty,
  isValidPublishAt,
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
      { channelId: 'constructor', customized: false },
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
        customized: true,
        disconnected: false,
        parts: [{ content: documentFromText('mine'), media: [], removedMedia: 1 }],
      },
      {
        channelId: 'ch_li',
        name: 'LinkedIn',
        providerIdentifier: 'linkedin',
        picture: null,
        profile: null,
        customized: false,
        disconnected: false,
        parts: [],
      },
      {
        channelId: 'ch_gone',
        name: 'Old page',
        providerIdentifier: 'facebook',
        picture: null,
        profile: null,
        customized: false,
        disconnected: true,
        parts: [],
      },
    ],
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
