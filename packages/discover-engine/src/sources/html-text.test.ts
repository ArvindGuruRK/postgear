import {
  cleanText,
  decodeEntities,
  safeHttpUrl,
  stripControlChars,
  stripHtml,
  tokenize,
} from './html-text';

const ch = String.fromCodePoint;

describe('decodeEntities', () => {
  it('decodes the named entities headlines use', () => {
    expect(decodeEntities('Tom &amp; Jerry &lt;3 &quot;hi&quot;')).toBe('Tom & Jerry <3 "hi"');
    expect(decodeEntities('it&rsquo;s')).toBe(`it${ch(0x2019)}s`);
  });

  it('decodes numeric entities in both bases, Tamil included', () => {
    expect(decodeEntities('&#65;&#x42;&#X43;')).toBe('ABC');
    expect(decodeEntities('&#2980;')).toBe(ch(2980));
  });

  it('turns an impossible number into nothing, and leaves an unknown name', () => {
    expect(decodeEntities('a&#x110000;b&#0;c')).toBe('abc');
    expect(decodeEntities('&unknown;')).toBe('&unknown;');
  });
});

describe('tokenize', () => {
  it('reads tags, attributes in any quote style, and text', () => {
    expect(tokenize(`<a href="x" target='y' data-z=1>hi</a>`)).toEqual([
      { type: 'open', name: 'a', attrs: { href: 'x', target: 'y', 'data-z': '1' } },
      { type: 'text', text: 'hi' },
      { type: 'close', name: 'a' },
    ]);
  });

  it('steps over a closing bracket inside a quoted attribute', () => {
    expect(tokenize('<a title="1 > 0">x</a>')[0]).toMatchObject({ attrs: { title: '1 > 0' } });
  });

  it('drops comments and script bodies, and keeps CDATA as text', () => {
    const text = tokenize('<!-- no --><script>alert(1)</script><![CDATA[yes]]>').filter(
      (token) => token.type === 'text',
    );
    expect(text).toEqual([{ type: 'text', text: 'yes' }]);
  });

  it('survives a bare bracket and an unclosed tag', () => {
    expect(tokenize('a < b')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'text', text: '<' },
      { type: 'text', text: ' b' },
    ]);
    expect(() => tokenize('<a href="never')).not.toThrow();
  });
});

describe('stripControlChars', () => {
  it('removes controls and the characters that make text read backwards', () => {
    const hidden = [0x00, 0x07, 0x1f, 0x7f, 0x9f, 0x200b, 0x200e, 0x202e, 0x2066, 0xfeff];
    expect(stripControlChars(`a${hidden.map((code) => ch(code)).join('')}b`)).toBe('ab');
  });

  it('keeps the joiners that Malayalam, Sinhala and Persian spelling needs', () => {
    const joined = `a${ch(0x200c)}b${ch(0x200d)}c`;
    expect(stripControlChars(joined)).toBe(joined);
  });

  it('keeps ordinary whitespace for the next step to deal with', () => {
    expect(stripControlChars('a\tb\nc')).toBe('a\tb\nc');
  });
});

describe('cleanText', () => {
  it('collapses all whitespace, non-breaking spaces too', () => {
    expect(cleanText(`  a \n\t b${ch(0xa0)}${ch(0xa0)}c  `)).toBe('a b c');
  });
});

describe('stripHtml', () => {
  it('takes the tags out and decodes what is left', () => {
    expect(stripHtml('<b>Rain</b> &amp; <a href="x">wind</a>')).toBe('Rain & wind');
  });

  it('decodes an entity recorded in place of a banned character', () => {
    expect(stripHtml('a &#8212; b')).toBe(`a ${ch(0x2014)} b`);
  });

  it('does not run words together across a line break or list item', () => {
    expect(stripHtml('one<br>two<li>three</li>')).toBe('one two three');
  });

  it('does not add a space across an inline tag', () => {
    expect(stripHtml('un<b>break</b>able')).toBe('unbreakable');
  });

  it('leaves nothing of a script behind', () => {
    expect(stripHtml('<script>alert(1)</script>safe')).toBe('safe');
  });

  it('keeps Tamil exactly as it came', () => {
    expect(stripHtml('<b>சென்னையில் மழை</b>')).toBe('சென்னையில் மழை');
  });
});

describe('safeHttpUrl', () => {
  it('lets only web addresses through', () => {
    expect(safeHttpUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
    expect(safeHttpUrl('  http://example.com ')).toBe('http://example.com/');
  });

  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,hi',
    'file:///etc/passwd',
    'not a url',
    '',
  ])('refuses %s', (value) => {
    expect(safeHttpUrl(value)).toBeUndefined();
  });

  it('refuses nothing at all', () => {
    expect(safeHttpUrl(undefined)).toBeUndefined();
    expect(safeHttpUrl(null)).toBeUndefined();
  });
});
