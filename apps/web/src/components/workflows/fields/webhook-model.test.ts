import {
  curlExample,
  lastReceivedWords,
  maskedSecret,
  SECRET_HEADER,
  SECRET_PLACEHOLDER,
} from './webhook-model';

describe('webhook link words', () => {
  it('builds an example that carries only the placeholder secret', () => {
    const example = curlExample('https://api.example.com/hooks/abc');
    expect(example).toContain('curl -X POST "https://api.example.com/hooks/abc"');
    expect(example).toContain(`${SECRET_HEADER}: ${SECRET_PLACEHOLDER}`);
  });

  it('shows only the last 4 characters of a saved secret', () => {
    expect(maskedSecret('a9F2')).toBe('...a9F2');
  });

  it('says when something last arrived', () => {
    const now = Date.parse('2026-10-31T10:03:00.000Z');
    expect(lastReceivedWords('2026-10-31T10:00:00.000Z', now)).toBe('Last received 3 minutes ago');
    expect(lastReceivedWords(null, now)).toBe('Nothing received yet.');
  });
});
