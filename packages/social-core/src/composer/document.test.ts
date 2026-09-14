/**
 * The post document's normalizer and reader.
 *
 * The normalizer runs on TipTap's raw JSON in the browser, so these tests feed
 * it what TipTap actually emits — null attributes, `target`/`rel` on links,
 * node types from extensions PostGear does not use — and pin that nothing
 * outside the allowlist survives while the user's words always do.
 */
import {
  documentFromText,
  emptyDocument,
  isDocumentEmpty,
  isSafeHref,
  MAX_LIST_DEPTH,
  normalizeDocument,
  parseDocument,
} from './document';
import { renderPlainText } from './render';

describe('normalizeDocument', () => {
  it('keeps only href on a link, dropping the attributes TipTap adds', () => {
    const doc = normalizeDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'site',
              marks: [
                {
                  type: 'link',
                  attrs: {
                    href: 'https://postgear.test',
                    target: '_blank',
                    rel: 'noopener noreferrer nofollow',
                    class: null,
                    title: null,
                  },
                },
              ],
            },
          ],
        },
      ],
    });

    expect(doc.content[0]).toEqual({
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'site',
          marks: [{ type: 'link', attrs: { href: 'https://postgear.test' } }],
        },
      ],
    });
  });

  it('drops an unsafe link but keeps the linked words', () => {
    const doc = normalizeDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'click me',
              marks: [{ type: 'bold' }, { type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
          ],
        },
      ],
    });

    expect(doc.content[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'click me', marks: [{ type: 'bold' }] }],
    });
  });

  it('unwraps unknown containers so pasted blockquotes and code keep their text', () => {
    const doc = normalizeDocument({
      type: 'doc',
      content: [
        {
          type: 'blockquote',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'quoted' }] }],
        },
        { type: 'codeBlock', content: [{ type: 'text', text: 'const a = 1;' }] },
        { type: 'horizontalRule' },
      ],
    });

    expect(renderPlainText(doc)).toBe('quoted\nconst a = 1;');
  });

  it('drops unknown marks, deduplicates the rest, and orders them stably', () => {
    const doc = normalizeDocument({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'x',
              marks: [{ type: 'italic' }, { type: 'strike' }, { type: 'bold' }, { type: 'italic' }],
            },
          ],
        },
      ],
    });

    expect(doc.content[0]).toEqual({
      type: 'paragraph',
      content: [{ type: 'text', text: 'x', marks: [{ type: 'bold' }, { type: 'italic' }] }],
    });
  });

  it('clamps heading levels to the three the schema accepts', () => {
    const doc = normalizeDocument({
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 6 }, content: [{ type: 'text', text: 'H' }] }],
    });

    expect(doc.content[0]).toEqual({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: 'H' }],
    });
  });

  it('forces a list item to start with a paragraph, as TipTap requires on reload', () => {
    const doc = normalizeDocument({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'bulletList',
                  content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }],
                },
              ],
            },
          ],
        },
      ],
    });

    const list = doc.content[0];
    expect(list.type).toBe('bulletList');
    expect(list.type === 'bulletList' && list.content[0].content[0].type).toBe('paragraph');
  });

  it('flattens lists nested past the depth limit instead of losing their text', () => {
    let node: Record<string, unknown> = {
      type: 'paragraph',
      content: [{ type: 'text', text: 'deep' }],
    };

    for (let depth = 0; depth < MAX_LIST_DEPTH + 3; depth++) {
      node = { type: 'bulletList', content: [{ type: 'listItem', content: [node] }] };
    }

    const doc = normalizeDocument({ type: 'doc', content: [node] });

    expect(renderPlainText(doc)).toContain('deep');
    expect(maxListDepth(doc.content)).toBeLessThanOrEqual(MAX_LIST_DEPTH);
  });

  it('keeps an ordered list start only when it is not the default', () => {
    const items = [
      {
        type: 'listItem',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }],
      },
    ];

    expect(
      normalizeDocument({
        type: 'doc',
        content: [{ type: 'orderedList', attrs: { start: 1, type: null }, content: items }],
      }).content[0],
    ).toEqual({
      type: 'orderedList',
      content: expect.any(Array),
    });
    expect(
      normalizeDocument({
        type: 'doc',
        content: [{ type: 'orderedList', attrs: { start: 4 }, content: items }],
      }).content[0],
    ).toMatchObject({
      attrs: { start: 4 },
    });
  });

  it('returns an empty document for anything that is not one', () => {
    expect(normalizeDocument(null)).toEqual(emptyDocument());
    expect(normalizeDocument({ type: 'paragraph' })).toEqual(emptyDocument());
    expect(normalizeDocument({ type: 'doc', content: 'nope' })).toEqual(emptyDocument());
  });
});

describe('parseDocument', () => {
  it('reads a stored document', () => {
    const stored = JSON.stringify(documentFromText('hello\nworld'));
    expect(renderPlainText(parseDocument(stored))).toBe('hello\nworld');
  });

  it('treats a plain-text row as text rather than crashing or blanking it', () => {
    expect(renderPlainText(parseDocument('written by a script'))).toBe('written by a script');
    // Valid JSON that is not a document is still just text.
    expect(renderPlainText(parseDocument('[1,2,3]'))).toBe('[1,2,3]');
  });

  it('reads nothing as an empty document', () => {
    expect(parseDocument(null)).toEqual(emptyDocument());
    expect(parseDocument('')).toEqual(emptyDocument());
  });
});

describe('isDocumentEmpty', () => {
  it('ignores whitespace-only text and empty list items', () => {
    expect(isDocumentEmpty(emptyDocument())).toBe(true);
    expect(isDocumentEmpty(documentFromText('   \n\n'))).toBe(true);
    expect(
      isDocumentEmpty({
        type: 'doc',
        content: [
          { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph' }] }] },
        ],
      }),
    ).toBe(true);
    expect(isDocumentEmpty(documentFromText('hi'))).toBe(false);
  });
});

describe('isSafeHref', () => {
  it('allows only http and https', () => {
    expect(isSafeHref('https://postgear.test/a?b=c')).toBe(true);
    expect(isSafeHref('http://localhost:3000')).toBe(true);
    expect(isSafeHref('javascript:alert(1)')).toBe(false);
    expect(isSafeHref('data:text/html;base64,PHNjcmlwdD4=')).toBe(false);
    expect(isSafeHref('mailto:a@b.test')).toBe(false);
    expect(isSafeHref('not a url')).toBe(false);
  });
});

function maxListDepth(blocks: ReturnType<typeof normalizeDocument>['content'], depth = 0): number {
  return blocks.reduce((deepest, block) => {
    if (block.type !== 'bulletList' && block.type !== 'orderedList') {
      return deepest;
    }
    const inner = block.content.map((item) => maxListDepth(item.content, depth + 1));
    return Math.max(deepest, depth + 1, ...inner);
  }, depth);
}
