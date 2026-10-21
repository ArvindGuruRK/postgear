/**
 * What a search sees of a post: its words only. Styling must not hide a word
 * (a bold "launch" is still "launch"), and the JSON forms of a word cover how
 * the document is stored.
 */
import { type PostDocument, parseDocument } from '@postgear/social-core';
import { documentSearchText, storedForms } from './post-search';

describe('documentSearchText', () => {
  it('keeps bold and italic words as plain letters', () => {
    const document: PostDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Big ' },
            { type: 'text', text: 'launch', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' today', marks: [{ type: 'italic' }] },
          ],
        },
      ],
    };

    expect(documentSearchText(document)).toBe('Big launch today');
  });

  it('does not append a link URL, only the words of the link', () => {
    const document: PostDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'read this',
              marks: [{ type: 'link', attrs: { href: 'https://example.com/x' } }],
            },
          ],
        },
      ],
    };

    expect(documentSearchText(document)).toBe('read this');
  });

  it('puts blocks on their own lines, walks lists and reads a line break as a space', () => {
    const document: PostDocument = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'one' },
            { type: 'hardBreak' },
            { type: 'text', text: 'two' },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }],
            },
          ],
        },
      ],
    };

    expect(documentSearchText(document)).toBe('Title\none two\nitem');
  });

  it('reads a plain-text row (a seed or a script wrote it) as its text', () => {
    expect(documentSearchText(parseDocument('Just words'))).toBe('Just words');
  });

  it('is empty for no content', () => {
    expect(documentSearchText(parseDocument(null))).toBe('');
  });
});

describe('storedForms', () => {
  it('is the word alone when JSON stores it as is', () => {
    expect(storedForms('launch')).toEqual(['launch']);
  });

  it('adds the escaped form of a word with a quote or a backslash', () => {
    expect(storedForms('say "hi"')).toEqual(['say "hi"', 'say \\"hi\\"']);
    expect(storedForms('a\\b')).toEqual(['a\\b', 'a\\\\b']);
  });
});
