/**
 * The text ↔ document mapping and the public views, pinned.
 */
import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { State } from '@postgear/db';
import { documentFromText, renderPlainText } from '@postgear/social-core';
import type { PostDetail, PostSummary } from '../../posts/posts.service';
import {
  DEFAULT_PUBLISH_DELAY_MS,
  textToDocument,
  toCreatePostInput,
  toPublicPost,
  toPublicPostSummary,
  toStateFilter,
} from './public-posts.mapper';

const GROUP = '0b8f3f3e-8a1f-4c55-9a55-2f1f5d1c9e11';
const NOW = new Date('2026-10-16T10:00:00Z');

describe('textToDocument', () => {
  it('makes one paragraph from one line', () => {
    expect(textToDocument('Hello world')).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello world' }] }],
    });
  });

  it('makes a hard break of a single newline and an empty paragraph of a blank line', () => {
    // The blank line is stored as the composer stores Enter-twice: an empty
    // paragraph between the two. Splitting on it alone would publish the two
    // paragraphs as adjacent lines, because the renderer joins paragraphs
    // with one newline.
    expect(textToDocument('First line\nsecond line\n\nNew paragraph')).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'First line' },
            { type: 'hardBreak' },
            { type: 'text', text: 'second line' },
          ],
        },
        { type: 'paragraph' },
        { type: 'paragraph', content: [{ type: 'text', text: 'New paragraph' }] },
      ],
    });
  });

  it('keeps every blank line, whitespace-only ones included, and normalises CRLF', () => {
    const document = textToDocument('A\r\n\r\n  \r\n\r\nB');

    expect(document.content).toHaveLength(5);
    expect(document.content.slice(1, 4)).toEqual([
      { type: 'paragraph' },
      { type: 'paragraph' },
      { type: 'paragraph' },
    ]);
    expect(renderPlainText(document)).toBe('A\n\n\n\nB');
  });

  it('never emits an empty text node, so the result passes the composer schema', () => {
    const document = textToDocument('  \n\nIndented line\n   \n\nTrailing spaces   ');

    expect(document.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Indented line' }] },
      { type: 'paragraph' },
      { type: 'paragraph' },
      { type: 'paragraph', content: [{ type: 'text', text: 'Trailing spaces   ' }] },
    ]);
  });

  it('drops leading and trailing blank lines rather than making empty paragraphs', () => {
    const document = textToDocument('\n\nOnly this\n\n');

    expect(document.content).toEqual([
      { type: 'paragraph', content: [{ type: 'text', text: 'Only this' }] },
    ]);
  });

  it('round-trips through the renderer, so GET shows what POST sent', () => {
    const text =
      'Launch day.\nDoors open at nine.\n\nSee you there, and bring a friend.\n\n\n#launch';

    expect(renderPlainText(textToDocument(text))).toBe(text);
  });

  it('rejects text with no visible character as 400', () => {
    expect(() => textToDocument('')).toThrow(BadRequestException);
    expect(() => textToDocument('   \n\n \t ')).toThrow(BadRequestException);
  });

  it('rejects text the composer document could not hold as 422', () => {
    // 501 lines, each its own paragraph: past the document's 500-block ceiling.
    const tooManyParagraphs = Array.from({ length: 501 }, (_, i) => `p${i}`).join('\n\n');

    expect(() => textToDocument(tooManyParagraphs)).toThrow(UnprocessableEntityException);
  });
});

describe('toCreatePostInput', () => {
  it('maps the public body to the composer input, queued five minutes out by default', () => {
    const input = toCreatePostInput(
      { text: 'Hello', channelIds: ['ch_a', 'ch_b'], state: 'queue' },
      NOW,
    );

    expect(input).toEqual({
      state: 'QUEUE',
      publishDate: new Date(NOW.getTime() + DEFAULT_PUBLISH_DELAY_MS).toISOString(),
      shared: [{ content: documentFromText('Hello'), media: [] }],
      channels: [
        { channelId: 'ch_a', customized: false },
        { channelId: 'ch_b', customized: false },
      ],
    });
  });

  it('keeps an explicit publishAt, a draft state and media references', () => {
    const input = toCreatePostInput(
      {
        text: 'Hello',
        channelIds: ['ch_a'],
        state: 'draft',
        publishAt: '2026-11-01T09:00:00.000Z',
        mediaIds: ['6f1c2f7e-5d2b-4d0c-9a4e-3b8f0e2a1c11'],
      },
      NOW,
    );

    expect(input.state).toBe('DRAFT');
    expect(input.publishDate).toBe('2026-11-01T09:00:00.000Z');
    expect(input.shared[0].media).toEqual([{ id: '6f1c2f7e-5d2b-4d0c-9a4e-3b8f0e2a1c11' }]);
  });
});

describe('toStateFilter', () => {
  it('maps the lowercase filter to the stored state', () => {
    expect(toStateFilter(undefined)).toBeUndefined();
    expect(toStateFilter('draft')).toBe(State.DRAFT);
    expect(toStateFilter('queue')).toBe(State.QUEUE);
    expect(toStateFilter('published')).toBe(State.PUBLISHED);
    expect(toStateFilter('error')).toBe(State.ERROR);
  });
});

describe('view mappers', () => {
  const channel = {
    channelId: 'ch_li',
    name: 'Acme Marketing',
    providerIdentifier: 'linkedin',
    picture: null,
    profile: 'acme',
    color: 0,
    disconnected: false,
    state: State.PUBLISHED,
    releaseURL: 'https://www.linkedin.com/feed/update/1',
    publishStatus: null,
  };

  it('maps a summary to the public summary', () => {
    const summary: PostSummary = {
      group: GROUP,
      state: State.PUBLISHED,
      publishDate: new Date('2026-10-15T09:30:00Z'),
      updatedAt: new Date('2026-10-15T09:31:00Z'),
      preview: 'Yesterday: the first post',
      parts: 1,
      channels: [channel],
    };

    expect(toPublicPostSummary(summary)).toEqual({
      id: GROUP,
      state: 'PUBLISHED',
      publishAt: '2026-10-15T09:30:00.000Z',
      updatedAt: '2026-10-15T09:31:00.000Z',
      preview: 'Yesterday: the first post',
      channels: [
        {
          channelId: 'ch_li',
          name: 'Acme Marketing',
          provider: 'linkedin',
          state: 'PUBLISHED',
          url: 'https://www.linkedin.com/feed/update/1',
        },
      ],
    });
  });

  it('maps a detail to the public post with plain-text parts and media urls', () => {
    const part = {
      content: documentFromText('Hello\nthere'),
      media: [
        {
          id: '6f1c2f7e-5d2b-4d0c-9a4e-3b8f0e2a1c11',
          name: 'a.jpg',
          type: 'image' as const,
          mimeType: 'image/jpeg',
          fileSize: 1,
          width: 1,
          height: 1,
          url: 'http://localhost:3001/uploads/a.jpg',
          thumbnailUrl: null,
          createdAt: new Date(),
        },
      ],
      removedMedia: 0,
    };
    const detail: PostDetail = {
      group: GROUP,
      state: State.QUEUE,
      publishDate: new Date('2026-10-17T10:00:00Z'),
      updatedAt: new Date('2026-10-16T10:00:00Z'),
      shared: [part, { content: documentFromText('Second part'), media: [], removedMedia: 0 }],
      channels: [
        { ...channel, customized: false, parts: [part], state: State.QUEUE, releaseURL: null },
      ],
    };

    const post = toPublicPost(detail);

    expect(post).toMatchObject({
      id: GROUP,
      state: 'QUEUE',
      publishAt: '2026-10-17T10:00:00.000Z',
      preview: 'Hello\nthere',
      channels: [{ channelId: 'ch_li', provider: 'linkedin', state: 'QUEUE', url: null }],
    });
    expect(post.parts).toEqual([
      {
        text: 'Hello\nthere',
        media: [
          {
            id: '6f1c2f7e-5d2b-4d0c-9a4e-3b8f0e2a1c11',
            url: 'http://localhost:3001/uploads/a.jpg',
          },
        ],
      },
      { text: 'Second part', media: [] },
    ]);
    // Internal fields do not leak into the public shape.
    expect(post).not.toHaveProperty('group');
    expect(post.channels[0]).not.toHaveProperty('publishStatus');
  });

  it('truncates a long first part into the preview', () => {
    const detail: PostDetail = {
      group: GROUP,
      state: State.DRAFT,
      publishDate: NOW,
      updatedAt: NOW,
      shared: [{ content: documentFromText('x'.repeat(400)), media: [], removedMedia: 0 }],
      channels: [],
    };

    const { preview } = toPublicPost(detail);

    expect(Array.from(preview)).toHaveLength(160);
    expect(preview.endsWith('…')).toBe(true);
  });
});
