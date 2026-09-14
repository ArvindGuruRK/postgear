/**
 * The post document schema — the boundary between what a browser sends and
 * what is stored and later rendered.
 *
 * Paired with the normalizer in social-core: whatever `normalizeDocument`
 * produces from real editor output must pass, and nothing outside the
 * allowlist may.
 */
import { MAX_LIST_DEPTH, normalizeDocument } from '@postgear/social-core';
import { createPostSchema, postDocumentSchema, updatePostSchema } from './posts.schema';

const text = (value: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }],
});

function body(overrides: Record<string, unknown> = {}) {
  return {
    state: 'DRAFT',
    publishDate: '2026-10-01T09:00:00.000Z',
    shared: [{ content: text('hello'), media: [] }],
    channels: [{ channelId: 'ch_1', customized: false }],
    ...overrides,
  };
}

describe('postDocumentSchema', () => {
  it('accepts what the normalizer makes of real TipTap output', () => {
    const tiptap = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Launch' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Read ', marks: [{ type: 'bold' }] },
            {
              type: 'text',
              text: 'this',
              marks: [
                {
                  type: 'link',
                  attrs: {
                    href: 'https://postgear.test',
                    target: '_blank',
                    rel: 'noopener',
                    class: null,
                  },
                },
              ],
            },
            { type: 'hardBreak' },
          ],
        },
        {
          type: 'orderedList',
          attrs: { start: 1, type: null },
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
            },
          ],
        },
        { type: 'paragraph' },
      ],
    };

    expect(postDocumentSchema.safeParse(normalizeDocument(tiptap)).success).toBe(true);
    // The raw editor JSON itself is not accepted — its extra attributes are
    // exactly what the normalizer exists to remove.
    expect(postDocumentSchema.safeParse(tiptap).success).toBe(false);
  });

  it('rejects a node type outside the allowlist', () => {
    expect(
      postDocumentSchema.safeParse({
        type: 'doc',
        content: [{ type: 'codeBlock', content: [{ type: 'text', text: 'x' }] }],
      }).success,
    ).toBe(false);
    expect(
      postDocumentSchema.safeParse({
        type: 'doc',
        content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: 'x' } }] }],
      }).success,
    ).toBe(false);
  });

  it('rejects an attribute the renderer does not read', () => {
    expect(
      postDocumentSchema.safeParse({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { style: 'color:red' },
            content: [{ type: 'text', text: 'x' }],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      postDocumentSchema.safeParse({
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'x', onclick: 'alert(1)' }] },
        ],
      }).success,
    ).toBe(false);
  });

  it('rejects a link that is not http or https', () => {
    for (const href of [
      'javascript:alert(1)',
      'data:text/html,<script>',
      'vbscript:x',
      '//evil.test',
    ]) {
      expect(
        postDocumentSchema.safeParse({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href } }] }],
            },
          ],
        }).success,
      ).toBe(false);
    }
  });

  it('has no shape for a list nested past the depth limit', () => {
    let block: Record<string, unknown> = {
      type: 'paragraph',
      content: [{ type: 'text', text: 'x' }],
    };

    for (let depth = 0; depth < MAX_LIST_DEPTH; depth++) {
      block = {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [{ type: 'paragraph' }, block] }],
      };
    }

    expect(postDocumentSchema.safeParse({ type: 'doc', content: [block] }).success).toBe(true);

    const tooDeep = {
      type: 'bulletList',
      content: [{ type: 'listItem', content: [{ type: 'paragraph' }, block] }],
    };
    expect(postDocumentSchema.safeParse({ type: 'doc', content: [tooDeep] }).success).toBe(false);
  });

  it('survives hostile nesting without overflowing the stack', () => {
    let block: Record<string, unknown> = { type: 'paragraph' };

    for (let depth = 0; depth < 20_000; depth++) {
      block = { type: 'bulletList', content: [{ type: 'listItem', content: [block] }] };
    }

    expect(() => postDocumentSchema.safeParse({ type: 'doc', content: [block] })).not.toThrow();
  });

  it('requires a list item to open with a paragraph, or the editor could not reload it', () => {
    expect(
      postDocumentSchema.safeParse({
        type: 'doc',
        content: [
          {
            type: 'bulletList',
            content: [{ type: 'listItem', content: [{ type: 'heading', attrs: { level: 2 } }] }],
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('createPostSchema', () => {
  it('accepts a shared post', () => {
    expect(createPostSchema.safeParse(body()).success).toBe(true);
  });

  it('only lets a person set DRAFT or QUEUE', () => {
    expect(createPostSchema.safeParse(body({ state: 'QUEUE' })).success).toBe(true);
    expect(createPostSchema.safeParse(body({ state: 'PUBLISHED' })).success).toBe(false);
    expect(createPostSchema.safeParse(body({ state: 'ERROR' })).success).toBe(false);
  });

  it('sends parts for a channel exactly when it is customized', () => {
    const part = { content: text('custom'), media: [] };

    expect(
      createPostSchema.safeParse(
        body({ channels: [{ channelId: 'ch_1', customized: true, parts: [part] }] }),
      ).success,
    ).toBe(true);
    expect(
      createPostSchema.safeParse(body({ channels: [{ channelId: 'ch_1', customized: true }] }))
        .success,
    ).toBe(false);
    expect(
      createPostSchema.safeParse(
        body({ channels: [{ channelId: 'ch_1', customized: false, parts: [part] }] }),
      ).success,
    ).toBe(false);
  });

  it('refuses a channel listed twice, a missing channel, and a duplicate attachment', () => {
    const ch = { channelId: 'ch_1', customized: false };
    const id = '6f1c2f7e-5d2b-4d0c-9a4e-3b8f0e2a1c11';

    expect(createPostSchema.safeParse(body({ channels: [ch, ch] })).success).toBe(false);
    expect(createPostSchema.safeParse(body({ channels: [] })).success).toBe(false);
    expect(
      createPostSchema.safeParse(
        body({ shared: [{ content: text('x'), media: [{ id }, { id }] }] }),
      ).success,
    ).toBe(false);
  });

  it('never accepts a row id from the client', () => {
    expect(
      createPostSchema.safeParse(
        body({ shared: [{ id: 'cl_someone_elses_post', content: text('x'), media: [] }] }),
      ).success,
    ).toBe(false);
    expect(createPostSchema.safeParse(body({ group: 'chosen-by-client' })).success).toBe(false);
  });

  it('requires the loaded version on update', () => {
    expect(updatePostSchema.safeParse(body()).success).toBe(false);
    expect(
      updatePostSchema.safeParse(body({ expectedUpdatedAt: '2026-09-14T10:00:00.000Z' })).success,
    ).toBe(true);
  });
});
