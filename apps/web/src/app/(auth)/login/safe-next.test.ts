import { safeNextPath, withNext } from './safe-next';

describe('safeNextPath', () => {
  it.each(['/invite/abc.def', '/', '/seed-demo-org/calendar?view=week#today'])(
    'keeps the same-site path %s',
    (path) => {
      expect(safeNextPath(path)).toBe(path);
    },
  );

  it.each([
    ['an absolute URL', 'https://evil.test/invite'],
    ['a protocol-relative URL', '//evil.test'],
    ['a backslash that browsers read as a slash', '/\\evil.test'],
    ['a scheme', 'javascript:alert(1)'],
    ['a relative path', 'invite/abc'],
    ['a tab a browser would strip', '/\t/evil.test'],
    ['a newline', '/\n/evil.test'],
    ['an empty value', ''],
    ['something too long', `/${'a'.repeat(600)}`],
    ['not a string', 42],
    ['nothing', undefined],
  ])('refuses %s', (_label, value) => {
    expect(safeNextPath(value)).toBeNull();
  });

  it('takes the first of a repeated parameter', () => {
    expect(safeNextPath(['/invite/a', '//evil.test'])).toBe('/invite/a');
    expect(safeNextPath(['//evil.test', '/invite/a'])).toBeNull();
  });
});

describe('withNext', () => {
  it('carries a destination, encoded', () => {
    expect(withNext('/login', '/invite/a.b')).toBe('/login?next=%2Finvite%2Fa.b');
    expect(withNext('/register', null)).toBe('/register');
  });
});
