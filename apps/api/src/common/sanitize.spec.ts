import {
  collapseWhitespace,
  normalizeEmail,
  sanitizeText,
  stripControlChars,
  stripHtml,
} from './sanitize';

// Built with fromCharCode rather than written literally: these characters are
// invisible in an editor, and a reviewer needs to see which one a test means.
const ZWSP = String.fromCharCode(0x200b); // zero-width space
const RTL_OVERRIDE = String.fromCharCode(0x202e); // right-to-left override
const BOM = String.fromCharCode(0xfeff);
const NUL = String.fromCharCode(0x00);

describe('stripHtml', () => {
  it('removes a script element and its contents, not just its tags', () => {
    // The failure mode this guards: a stripper that removes only tags turns
    // `<script>alert(1)</script>` into the visible string `alert(1)`.
    expect(stripHtml('<script>alert(1)</script>Bob')).toBe('Bob');
  });

  it('removes a style element and its contents', () => {
    expect(stripHtml('<style>body{display:none}</style>Bob')).toBe('Bob');
  });

  it('removes an unterminated script tag and everything after it', () => {
    expect(stripHtml('Bob<script src=evil.js')).toBe('Bob');
  });

  it('removes ordinary markup but keeps the text inside it', () => {
    expect(stripHtml('<b>Bob</b>')).toBe('Bob');
    expect(stripHtml('<p>Hello <em>world</em></p>')).toBe('Hello world');
  });

  it('removes an attribute-bearing tag entirely', () => {
    expect(stripHtml('<img src=x onerror=alert(1)>')).toBe('');
  });

  it('removes a dangling open bracket that never became a tag', () => {
    expect(stripHtml('Bob <')).toBe('Bob ');
  });

  it('removes HTML entities rather than decoding them back into markup', () => {
    // The angle brackets are removed with the entity, leaving inert text. The
    // point is that no pass ever turns `&lt;` back into `<` — a stripper that
    // decoded first and stripped second would hand back a live `<script>`.
    expect(stripHtml('&lt;script&gt;')).toBe('script');
    expect(stripHtml('&#60;script&#62;')).toBe('script');
  });

  it('leaves plain text untouched', () => {
    expect(stripHtml("Ada O'Brien-Smith")).toBe("Ada O'Brien-Smith");
  });
});

describe('stripControlChars', () => {
  it('removes C0 control characters', () => {
    expect(stripControlChars(`a${NUL}bc`)).toBe('abc');
  });

  it('removes zero-width characters', () => {
    expect(stripControlChars(`Bo${ZWSP}b`)).toBe('Bob');
  });

  it('removes direction overrides used for display spoofing', () => {
    expect(stripControlChars(`admin${RTL_OVERRIDE}`)).toBe('admin');
  });

  it('removes a stray byte-order mark', () => {
    expect(stripControlChars(`${BOM}Bob`)).toBe('Bob');
  });

  it('leaves ordinary whitespace alone — collapseWhitespace owns that', () => {
    expect(stripControlChars('a b\tc')).toBe('a b\tc');
  });
});

describe('collapseWhitespace', () => {
  it('collapses runs and trims the ends', () => {
    expect(collapseWhitespace('  Alice   Smith  ')).toBe('Alice Smith');
  });

  it('collapses newlines and tabs too', () => {
    expect(collapseWhitespace('Alice\n\t Smith')).toBe('Alice Smith');
  });
});

describe('sanitizeText', () => {
  it('strips control characters before tags, so zero-width smuggling fails', () => {
    // Without the control-char pass running first, `<scr[ZWSP]ipt>` does not
    // match the script rule and its body survives as the text `alert(1)`.
    expect(sanitizeText(`<scr${ZWSP}ipt>alert(1)</script>`)).toBe('');
  });

  it('reduces a markup-only value to the empty string', () => {
    // The schema layer rejects this rather than storing a blank name; see
    // dto/common.schema.ts.
    expect(sanitizeText('<b></b>')).toBe('');
  });

  it('preserves a legitimate name with punctuation', () => {
    expect(sanitizeText("  Ada   O'Brien-Smith ")).toBe("Ada O'Brien-Smith");
  });

  it('turns a pasted multi-line name into one line rather than gluing it', () => {
    expect(sanitizeText('Alice\nSmith')).toBe('Alice Smith');
  });

  it('preserves non-ASCII names', () => {
    expect(sanitizeText('José Müller 田中')).toBe('José Müller 田中');
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmail('  Bob@Example.COM ')).toBe('bob@example.com');
  });

  it('keeps plus-addressing and dots — stripping them misdirects mail', () => {
    expect(normalizeEmail('Bob.Smith+news@Example.com')).toBe('bob.smith+news@example.com');
  });

  it('removes smuggled zero-width characters', () => {
    expect(normalizeEmail(`bob${ZWSP}@example.com`)).toBe('bob@example.com');
  });
});
