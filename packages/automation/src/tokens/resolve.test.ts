import { applyFilter, isKnownFilter, TOKEN_FILTERS } from './filters';
import { resolveConfig, resolveTemplate } from './resolve';
import { isEmptyValue, type RunScope, resolveValue, toEpoch, toNumber, toText } from './values';

const scope: RunScope = {
  trigger: {
    post: {
      url: 'https://instagram.com/p/Cx1',
      preview: '  Fresh sourdough is out of the oven.  ',
      channel: { name: 'Bloom Bakery' },
    },
    tags: ['launch', 'bakery'],
    publishedAt: '2026-11-03T09:00:12Z',
    likes: 42,
    empty: '',
  },
  nodes: {
    k3f9: {
      output: { text: 'Hello {{ nodes.k3f9.output.text }}', image: { url: 'https://x/1.png' } },
    },
  },
  run: { id: 'run_1', startedAt: '2026-11-03T09:00:00.000Z', mode: 'test' },
  workspace: { name: 'Bloom Bakery' },
};

const value = (text: string, options = {}) => resolveTemplate(text, scope, options).value;

describe('resolveTemplate', () => {
  it('keeps the type when a field is one data chip', () => {
    expect(value('{{ trigger.likes }}')).toBe(42);
    expect(value('{{ trigger.tags }}')).toEqual(['launch', 'bakery']);
    expect(value('{{ nodes.k3f9.output.image }}')).toEqual({ url: 'https://x/1.png' });
  });

  it('writes data as text when it is mixed with text', () => {
    expect(value('Likes: {{ trigger.likes }}, tags: {{ trigger.tags }}')).toBe(
      'Likes: 42, tags: launch, bakery',
    );
    expect(value('Image {{ nodes.k3f9.output.image }}')).toBe('Image {"url":"https://x/1.png"}');
  });

  it('never fills in chips that arrive inside data (no injection)', () => {
    expect(value('{{ nodes.k3f9.output.text }}')).toBe('Hello {{ nodes.k3f9.output.text }}');
    expect(value('Say: {{ nodes.k3f9.output.text }}')).toBe(
      'Say: Hello {{ nodes.k3f9.output.text }}',
    );
  });

  it('reports missing data and reads it as empty', () => {
    const resolved = resolveTemplate('A {{ trigger.nope }} B {{ nodes.gone.output.text }}', scope);
    expect(resolved.value).toBe('A  B ');
    expect(resolved.missing).toEqual(['trigger.nope', 'nodes.gone.output.text']);
    expect(resolveTemplate('{{ trigger.nope }}', scope)).toMatchObject({
      value: '',
      missing: ['trigger.nope'],
    });
  });

  it('does not report data that "If Empty Use" filled in', () => {
    const resolved = resolveTemplate('{{ trigger.nope | default: "n/a" }}', scope);
    expect(resolved).toMatchObject({ value: 'n/a', missing: [] });
  });

  it('skips a format that does not exist and says so', () => {
    const resolved = resolveTemplate('{{ trigger.post.url | shout }}', scope);
    expect(resolved).toMatchObject({
      value: 'https://instagram.com/p/Cx1',
      unknownFilters: ['shout'],
    });
  });

  it('writes escaped braces as braces', () => {
    expect(value('Use \\{{ this }} literally')).toBe('Use {{ this }} literally');
  });

  it('reads run and workspace data', () => {
    expect(value('{{ run.id }} in {{ workspace.name }}')).toBe('run_1 in Bloom Bakery');
  });
});

describe('every data format', () => {
  it('shortens text to at most the given length', () => {
    expect(value('{{ trigger.post.url | truncate: 12 }}')).toBe('https://ins…');
    expect(value('{{ trigger.post.url | truncate: 200 }}')).toBe('https://instagram.com/p/Cx1');
    expect(Array.from(String(value('{{ trigger.post.preview | truncate: 10 }}')))).toHaveLength(10);
  });

  it('changes case and trims spaces', () => {
    expect(value('{{ trigger.post.channel.name | upper }}')).toBe('BLOOM BAKERY');
    expect(value('{{ trigger.post.channel.name | lower }}')).toBe('bloom bakery');
    expect(value('{{ trigger.post.preview | trim }}')).toBe('Fresh sourdough is out of the oven.');
  });

  it('writes dates in the pattern and zone asked for', () => {
    expect(value('{{ trigger.publishedAt | date }}')).toBe('2026-11-03');
    expect(value('{{ trigger.publishedAt | date: "d MMM yyyy, HH:mm" }}')).toBe(
      '3 Nov 2026, 09:00',
    );
    expect(
      value('{{ trigger.publishedAt | date: "EEEE h:mm a" }}', { timeZone: 'Asia/Kolkata' }),
    ).toBe('Tuesday 2:30 PM');
    expect(value('{{ trigger.post.url | date }}')).toBe('https://instagram.com/p/Cx1');
    expect(value('{{ trigger.nope | date }}')).toBe('');
  });

  it('uses a stand-in when the data is empty', () => {
    expect(value('{{ trigger.empty | default: "n/a" }}')).toBe('n/a');
    expect(value('{{ trigger.likes | default: "n/a" }}')).toBe(42);
  });

  it('writes JSON, joins lists, takes the first item and counts', () => {
    expect(value('{{ trigger.tags | json }}')).toBe('["launch","bakery"]');
    expect(value('{{ trigger.tags | join: " / " }}')).toBe('launch / bakery');
    expect(value('{{ trigger.tags | join }}')).toBe('launch, bakery');
    expect(value('{{ trigger.tags | first }}')).toBe('launch');
    expect(value('{{ trigger.tags | count }}')).toBe(2);
    expect(value('{{ trigger.post.channel.name | count }}')).toBe(12);
    expect(value('{{ trigger.nope | count }}')).toBe(0);
  });

  it('makes text safe for a web address', () => {
    expect(value('https://x.com/?q={{ trigger.post.channel.name | urlencode }}')).toBe(
      'https://x.com/?q=Bloom%20Bakery',
    );
  });

  it('chains formats left to right', () => {
    expect(value('{{ trigger.tags | first | upper }}')).toBe('LAUNCH');
  });

  it('knows each format and its argument', () => {
    expect(TOKEN_FILTERS.map((filter) => filter.name)).toEqual([
      'truncate',
      'upper',
      'lower',
      'trim',
      'date',
      'default',
      'json',
      'join',
      'first',
      'count',
      'urlencode',
    ]);
    expect(isKnownFilter({ name: 'truncate', arg: 200 })).toBe(true);
    expect(isKnownFilter({ name: 'truncate' })).toBe(false);
    expect(isKnownFilter({ name: 'truncate', arg: 0 })).toBe(false);
    expect(isKnownFilter({ name: 'upper', arg: 'x' })).toBe(false);
    expect(isKnownFilter({ name: 'default' })).toBe(false);
    expect(isKnownFilter({ name: 'date' })).toBe(true);
    expect(isKnownFilter({ name: 'eval' })).toBe(false);
  });

  it('leaves the value alone for a format it does not know', () => {
    expect(applyFilter('x', { name: 'nope' }, {})).toBe('x');
  });
});

describe('resolveValue and the value readers', () => {
  it('reads only the data itself, never JavaScript internals', () => {
    expect(resolveValue('trigger.constructor', scope)).toBeUndefined();
    expect(resolveValue('trigger.post.__proto__', scope)).toBeUndefined();
    expect(resolveValue('trigger.tags.length', scope)).toBeUndefined();
    expect(resolveValue('trigger.tags.1', scope)).toBe('bakery');
    expect(resolveValue('nodes.k3f9.text', scope)).toBeUndefined();
  });

  it('reads numbers strictly: empty and "12 likes" are not numbers', () => {
    expect(toNumber('12')).toBe(12);
    expect(toNumber(' 1.5e3 ')).toBe(1500);
    expect(toNumber('')).toBeNaN();
    expect(toNumber('12 likes')).toBeNaN();
    expect(toNumber(true)).toBeNaN();
    expect(toNumber(Number.POSITIVE_INFINITY)).toBeNaN();
  });

  it('writes values as text the same way everywhere', () => {
    expect(toText(null)).toBe('');
    expect(toText(false)).toBe('false');
    expect(toText([1, [2, 3]])).toBe('1, 2, 3');
    expect(toText(Number.NaN)).toBe('');
    expect(toText(BigInt(7))).toBe('7');
    expect(toText(new Date(Date.UTC(2026, 10, 3)))).toBe('2026-11-03T00:00:00.000Z');
    expect(toText(new Date(Number.NaN))).toBe('');
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(toText(loop)).toBe('');
  });

  it('reads dates from ISO text, milliseconds and dates', () => {
    expect(toEpoch('2026-11-03')).toBe(Date.UTC(2026, 10, 3));
    expect(toEpoch(5)).toBe(5);
    expect(toEpoch(new Date(Date.UTC(2026, 10, 3)))).toBe(Date.UTC(2026, 10, 3));
    expect(toEpoch(new Date(Number.NaN))).toBeUndefined();
    expect(toEpoch(true)).toBeUndefined();
  });

  it('calls empty objects empty but never zero or false', () => {
    expect([isEmptyValue({}), isEmptyValue(0), isEmptyValue(false), isEmptyValue(' ')]).toEqual([
      true,
      false,
      false,
      true,
    ]);
  });
});

describe('resolveConfig', () => {
  it('fills every string in a config and lists what was missing by field', () => {
    const resolved = resolveConfig(
      {
        message: 'On {{ trigger.post.channel.name }}',
        fields: [{ value: '{{ trigger.nope }}' }],
        n: 3,
      },
      scope,
    );
    expect(resolved.value).toEqual({ message: 'On Bloom Bakery', fields: [{ value: '' }], n: 3 });
    expect(resolved.missing).toEqual([{ field: 'fields.0.value', path: 'trigger.nope' }]);
  });
});
