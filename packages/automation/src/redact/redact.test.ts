import { NODE_CATALOG } from '../catalog';
import { graphOf, line, step } from '../testing/builders';
import { HIDDEN, redact, utf8Bytes } from './redact';
import { findSecretLikeValues, SECRET_REFUSED_MESSAGE } from './secrets';

const SLACK_URL = 'https://hooks.slack.com/services/T000/B000/abcdefghijklmnop';

describe('redact', () => {
  it('hides fields whose names say secret, at any depth', () => {
    const { value, hidden } = redact({
      request: { headers: { Authorization: 'Bearer abc', 'X-Api-Key': 'k-123' }, apiKey: 'xyz' },
      list: [{ password: 'hunter2' }, { client_secret: { a: 1 } }],
      ok: 'kept',
    });
    expect(value).toEqual({
      request: { headers: { Authorization: HIDDEN, 'X-Api-Key': HIDDEN }, apiKey: HIDDEN },
      list: [{ password: HIDDEN }, { client_secret: HIDDEN }],
      ok: 'kept',
    });
    expect(hidden).toBe(5);
  });

  it('keeps numbers, yes/no and empty values under secret-looking names', () => {
    expect(redact({ maxTokens: 500, hasToken: true, token: '', secret: null }).value).toEqual({
      maxTokens: 500,
      hasToken: true,
      token: '',
      secret: null,
    });
  });

  it('hides the value of a header pair by its name', () => {
    expect(
      redact([
        { name: 'Authorization', value: 'Basic dXNlcjpwYXNz' },
        { name: 'Accept', value: 'application/json' },
      ]).value,
    ).toEqual([
      { name: 'Authorization', value: HIDDEN },
      { name: 'Accept', value: 'application/json' },
    ]);
  });

  it('hides text that contains a connection value, even inside longer text', () => {
    const { value } = redact(
      { sent: `Posted to ${SLACK_URL} at 09:00`, other: 'fine', short: 'abc' },
      { connectionValues: [SLACK_URL, 'abc'] },
    );
    expect(value).toEqual({ sent: HIDDEN, other: 'fine', short: 'abc' });
  });

  it('cuts secret-shaped parts out of text', () => {
    const { value } = redact({
      note: 'Use Bearer abcdefghijklmnopqrstuv now',
      key: 'sk-proj-abcdefghijklmnopqrstuvwxyz0123',
      hook: `Hook: ${SLACK_URL}`,
    });
    expect(value).toEqual({
      note: `Use ${HIDDEN} now`,
      key: HIDDEN,
      hook: `Hook: ${HIDDEN}`,
    });
  });

  it('keeps only the scheme and host of a link with a secret in its query string', () => {
    const { value } = redact({
      url: 'Called https://api.example.com/v1/items?id=4&api_key=abc123 just now',
      plain: 'https://example.com/page?id=4',
    });
    expect(value).toEqual({
      url: `Called https://api.example.com/${HIDDEN} just now`,
      plain: 'https://example.com/page?id=4',
    });
  });

  it('never changes the input', () => {
    const input = { password: 'x', nested: { token: 'y' } };
    redact(input);
    expect(input).toEqual({ password: 'x', nested: { token: 'y' } });
  });

  it('copes with loops, dates and functions', () => {
    const loop: Record<string, unknown> = { name: 'a' };
    loop.self = loop;
    const { value } = redact({ loop, at: new Date(Date.UTC(2026, 10, 3)), fn: () => 1 });
    expect(value).toEqual({
      loop: { name: 'a', self: '[circular]' },
      at: '2026-11-03T00:00:00.000Z',
    });
  });

  it('caps the result at 64 KB and says how big the cut text was', () => {
    const big = 'x'.repeat(812 * 1024);
    const { value, truncated } = redact({ body: big, small: 'kept' });
    expect(truncated).toBe(true);
    expect(utf8Bytes(JSON.stringify(value))).toBeLessThanOrEqual(64 * 1024);
    const body = (value as { body: string }).body;
    expect(body.endsWith('... (cut, 812 KB in total)')).toBe(true);
    expect((value as { small: string }).small).toBe('kept');
  });

  it('cuts long lists when cutting text is not enough', () => {
    const rows = Array.from({ length: 5_000 }, (_, i) => ({ row: i, text: 'y'.repeat(40) }));
    const { value, truncated } = redact({ rows });
    expect(truncated).toBe(true);
    expect(utf8Bytes(JSON.stringify(value))).toBeLessThanOrEqual(64 * 1024);
    const kept = (value as { rows: unknown[] }).rows;
    expect(kept.at(-1)).toMatch(/^\.\.\. \(cut, \d+ more items\)$/);
  });

  it('leaves small data alone', () => {
    expect(redact({ a: 1 })).toEqual({ value: { a: 1 }, truncated: false, hidden: 0 });
  });

  it('counts UTF-8 bytes like the database does', () => {
    expect(utf8Bytes('aé日\u{1F389}')).toBe(1 + 2 + 3 + 4);
  });
});

describe('findSecretLikeValues', () => {
  const graphWith = (type: Parameters<typeof step>[1], config: Record<string, unknown>) =>
    graphOf([step('trig', 'trigger.manual'), step('s1', type, { config })], [line('trig', 's1')]);

  it('refuses a Slack webhook link typed into a Set Fields value', () => {
    const findings = findSecretLikeValues(
      graphWith('logic.setFields', { fields: [{ name: 'hook', type: 'text', value: SLACK_URL }] }),
    );
    expect(findings).toEqual([
      { nodeKey: 's1', field: 'fields.0.value', reason: 'a Slack webhook link' },
    ]);
    expect(SECRET_REFUSED_MESSAGE).toBe(
      'Secrets cannot be saved in a step. Add them as a connection instead.',
    );
  });

  it('refuses typed text under a password name', () => {
    expect(
      findSecretLikeValues(
        graphWith('logic.setFields', {
          fields: [{ name: 'password', type: 'text', value: 'hunter2' }],
        }),
      ),
    ).toEqual([{ nodeKey: 's1', field: 'fields.0.value', reason: "a field named 'password'" }]);
  });

  it('refuses a bearer token in an HTTP header and a password in a JSON body', () => {
    const findings = findSecretLikeValues(
      graphWith('data.httpRequest', {
        url: 'https://api.example.com/items',
        headers: [{ name: 'X-Trace', value: 'Bearer abcdefghijklmnopqrstuvwx' }],
        body: '{"user": "me", "password": "hunter2"}',
      }),
    );
    expect(findings.map((finding) => [finding.field, finding.reason])).toEqual([
      ['headers.0.value', 'a sign-in token'],
      ['body', "a field named 'password'"],
    ]);
  });

  it('refuses a link with a key in its query string, and keys in notes', () => {
    const graph = graphWith('data.httpRequest', {
      url: 'https://api.example.com/items?api_key=abc123',
    });
    graph.notes.push({
      id: 'note1',
      position: { x: 0, y: 0 },
      size: { w: 200, h: 100 },
      text: 'Our key is sk-abcdefghijklmnopqrstuvwxyz',
      colour: 'yellow',
    });
    expect(findSecretLikeValues(graph)).toEqual([
      { nodeKey: 's1', field: 'url', reason: 'a link with a secret in it' },
      { noteId: 'note1', field: 'text', reason: 'an API key' },
    ]);
  });

  it('accepts harmless links, data chips in secret fields, and connection ids', () => {
    expect(
      findSecretLikeValues(
        graphWith('data.httpRequest', {
          url: 'https://shop.example.com/sale?key=summer&id=4',
          headers: [{ name: 'Authorization', value: '{{ trigger.inputs.token }}' }],
          secretHeadersConnectionId: 'conn_123',
          body: '{"password": "{{ trigger.inputs.password }}"}',
        }),
      ),
    ).toEqual([]);
  });

  it('finds nothing in any step default', () => {
    for (const def of NODE_CATALOG) {
      const graph = graphOf([step('only', def.type)]);
      expect(findSecretLikeValues(graph)).toEqual([]);
    }
  });
});
