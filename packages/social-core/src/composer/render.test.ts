/**
 * Document → platform text.
 *
 * This output is what the preview shows, what the counter measures and what
 * Sprint 5 publishes, so each rule is pinned to an exact string.
 */
import type { InlineNode, PostDocument } from './document';
import { documentFromText } from './document';
import { measureLength } from './length';
import { renderPlainText } from './render';
import { styleText, underlineText } from './unicode';

function doc(...content: PostDocument['content']): PostDocument {
  return { type: 'doc', content };
}

function p(...content: InlineNode[]) {
  return { type: 'paragraph' as const, content };
}

function t(
  text: string,
  ...marks: Array<'bold' | 'italic' | 'underline' | { href: string }>
): InlineNode {
  return {
    type: 'text',
    text,
    marks: marks.map((mark) =>
      typeof mark === 'string'
        ? { type: mark }
        : { type: 'link' as const, attrs: { href: mark.href } },
    ),
  };
}

describe('renderPlainText', () => {
  it('turns paragraphs into lines and an empty paragraph into a blank line', () => {
    expect(renderPlainText(documentFromText('one\n\ntwo'))).toBe('one\n\ntwo');
  });

  it('drops the trailing empty paragraph TipTap keeps for the cursor', () => {
    expect(renderPlainText(doc(p(t('hello')), { type: 'paragraph' }))).toBe('hello');
  });

  it('renders bold, italic and both as Unicode styles', () => {
    expect(renderPlainText(doc(p(t('Big', 'bold'), t(' and '), t('slanted', 'italic'))))).toBe(
      '𝗕𝗶𝗴 and 𝘴𝘭𝘢𝘯𝘵𝘦𝘥',
    );
    expect(renderPlainText(doc(p(t('Both', 'bold', 'italic'))))).toBe('𝘽𝙤𝙩𝙝');
  });

  it('renders a heading as a bold line', () => {
    expect(
      renderPlainText(
        doc({ type: 'heading', attrs: { level: 2 }, content: [t('Launch day')] }, p(t('Details'))),
      ),
    ).toBe(`${styleText('Launch day', { bold: true })}\nDetails`);
  });

  it('renders bullet and numbered lists, honouring a start number and nesting', () => {
    const item = (text: string, ...nested: PostDocument['content']) => ({
      type: 'listItem' as const,
      content: [p(t(text)), ...nested],
    });

    const rendered = renderPlainText(
      doc(p(t('Why:')), {
        type: 'bulletList',
        content: [
          item('fast', {
            type: 'orderedList',
            attrs: { start: 3 },
            content: [item('really'), item('very')],
          }),
          item('cheap'),
        ],
      }),
    );

    expect(rendered).toBe('Why:\n• fast\n  3. really\n  4. very\n• cheap');
  });

  it('keeps a link target that differs from its words', () => {
    expect(
      renderPlainText(doc(p(t('Read the docs', { href: 'https://postgear.test/docs' })))),
    ).toBe('Read the docs (https://postgear.test/docs)');
  });

  it('prints a link once when its words already are the URL', () => {
    expect(
      renderPlainText(doc(p(t('postgear.test', { href: 'https://www.postgear.test/' })))),
    ).toBe('postgear.test');
  });

  it('appends the URL once for a link whose middle word is bold', () => {
    const href = { href: 'https://postgear.test' };

    expect(
      renderPlainText(doc(p(t('try ', href), t('it', 'bold', href), t(' now', href), t('!')))),
    ).toBe(`try ${styleText('it', { bold: true })} now (https://postgear.test)!`);
  });

  it('separates two adjacent links to different targets', () => {
    expect(
      renderPlainText(
        doc(p(t('a', { href: 'https://a.test' }), t('b', { href: 'https://b.test' }))),
      ),
    ).toBe('a (https://a.test)b (https://b.test)');
  });

  it('turns a hard break into a newline', () => {
    expect(renderPlainText(doc(p(t('line one'), { type: 'hardBreak' }, t('line two'))))).toBe(
      'line one\nline two',
    );
  });

  it('underlines each letter and digit with a combining low line, as Postiz does', () => {
    expect(renderPlainText(doc(p(t('Go 2', 'underline'), t(' now!'))))).toBe('G̲o̲ 2̲ now!');
  });

  it('underlines the styled letter when underline is combined with bold or italic', () => {
    expect(renderPlainText(doc(p(t('Hi', 'bold', 'underline'))))).toBe(
      `${styleText('H', { bold: true })}̲${styleText('i', { bold: true })}̲`,
    );
    expect(renderPlainText(doc(p(t('a', 'italic', 'underline'))))).toBe(
      `${styleText('a', { italic: true })}̲`,
    );
  });

  it('underlines link words but compares the raw words to the target', () => {
    expect(
      renderPlainText(doc(p(t('postgear.test', 'underline', { href: 'https://postgear.test' })))),
    ).toBe(underlineText('postgear.test'));
  });
});

describe('underlineText', () => {
  it('keeps accents with their letter and leaves spaces, punctuation and emoji bare', () => {
    expect(underlineText('é, ok')).toBe('é̲, o̲k̲');
    // A decomposed accent stays before the line, in one grapheme.
    expect(underlineText('é')).toBe('é̲');
    expect(underlineText('🚀 1️⃣')).toBe('🚀 1️⃣');
  });

  it('adds one UTF-16 unit and one X weight per underlined character', () => {
    const underlined = underlineText('abc');
    expect(measureLength(underlined, 'utf16')).toBe(6);
    expect(measureLength(underlined, 'x-weighted')).toBe(6);
    // A bold letter weighs 2 on X, and its line 1 more.
    expect(measureLength(underlineText(styleText('a', { bold: true })), 'x-weighted')).toBe(3);
  });
});

describe('styleText', () => {
  it('styles only unaccented Latin letters and digits', () => {
    expect(styleText('Café 2026 ✓', { bold: true })).toBe('𝗖𝗮𝗳é 𝟮𝟬𝟮𝟲 ✓');
  });

  it('covers the whole alphabet, including the letter the serif italic range skips', () => {
    const italic = styleText('abcdefghijklmnopqrstuvwxyz', { italic: true });

    // 26 styled letters, each one astral code point.
    expect(Array.from(italic)).toHaveLength(26);
    expect(italic).not.toMatch(/[a-z]/);
    expect(styleText('h', { italic: true })).toBe('𝘩');
  });

  it('has no italic digits, so digits stay plain unless bold', () => {
    expect(styleText('42', { italic: true })).toBe('42');
  });
});
