import {
  buildPostDetails,
  orderChain,
  parseImageIds,
  parseProviderSettings,
  previewOf,
  previousAttemptInFlight,
} from './publish-details';

const doc = (text: string) =>
  JSON.stringify({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  });

const publicUrl = (key: string) => `http://localhost:3001/uploads/${key}`;

describe('orderChain', () => {
  it('follows parent links from the root and keeps orphans', () => {
    const rows = [
      { id: 'c', parentPostId: 'b' },
      { id: 'a', parentPostId: null },
      { id: 'b', parentPostId: 'a' },
      { id: 'orphan', parentPostId: 'missing' },
    ];

    expect(orderChain(rows).map((row) => row.id)).toEqual(['a', 'b', 'c', 'orphan']);
  });

  it('cannot loop on a cycle', () => {
    const rows = [
      { id: 'a', parentPostId: 'b' },
      { id: 'b', parentPostId: 'a' },
    ];

    expect(orderChain(rows)).toHaveLength(2);
  });
});

describe('buildPostDetails', () => {
  it('renders each part and resolves media to public URLs, skipping deleted media', () => {
    const rows = [
      {
        id: 'part-2',
        parentPostId: 'part-1',
        content: doc('Second'),
        image: JSON.stringify([{ id: 'gone' }]),
        settings: null,
      },
      {
        id: 'part-1',
        parentPostId: null,
        content: doc('First line'),
        image: JSON.stringify([{ id: 'm1' }]),
        settings: JSON.stringify({ customized: true, title: 'A title' }),
      },
    ];
    const media = new Map([
      [
        'm1',
        {
          id: 'm1',
          type: 'image',
          path: '2026/10/0123456789abcdef0123456789abcdef.jpg',
          thumbnail: '2026/10/0123456789abcdef0123456789abcdef.thumb.webp',
          alt: 'Alt',
          mimeType: 'image/jpeg',
          fileSize: 1234,
          width: 100,
          height: 50,
        },
      ],
    ]);

    const details = buildPostDetails(rows, media, publicUrl);

    expect(details.map((part) => part.id)).toEqual(['part-1', 'part-2']);
    expect(details[0].message).toBe('First line');
    expect(details[0].settings).toEqual({ title: 'A title' });
    expect(details[0].media).toEqual([
      {
        type: 'image',
        path: 'http://localhost:3001/uploads/2026/10/0123456789abcdef0123456789abcdef.jpg',
        thumbnail:
          'http://localhost:3001/uploads/2026/10/0123456789abcdef0123456789abcdef.thumb.webp',
        alt: 'Alt',
        mimeType: 'image/jpeg',
        bytes: 1234,
        width: 100,
        height: 50,
      },
    ]);
    expect(details[1].media).toEqual([]);
    expect(previewOf(details)).toBe('First line');
  });

  it('tolerates unreadable image and settings columns', () => {
    expect(parseImageIds('not json')).toEqual([]);
    expect(parseImageIds(JSON.stringify([{ nope: 1 }, { id: 'ok' }]))).toEqual(['ok']);
    expect(parseProviderSettings('[]')).toEqual({});
    expect(parseProviderSettings('{broken')).toEqual({});
  });
});

describe('previousAttemptInFlight', () => {
  const marker = (attempt: number) =>
    JSON.stringify({ kind: 'in_flight', attempt, startedAt: '2026-10-11T10:00:00.000Z' });

  it('is true only for a marker left by an earlier attempt', () => {
    expect(previousAttemptInFlight(marker(1), 2)).toBe(true);
    expect(previousAttemptInFlight(marker(2), 2)).toBe(false);
    expect(previousAttemptInFlight(null, 2)).toBe(false);
    expect(
      previousAttemptInFlight(
        JSON.stringify({
          kind: 'retrying',
          attempt: 1,
          maxAttempts: 5,
          nextAttemptAt: '2026-10-11T10:01:00.000Z',
          message: 'x',
        }),
        2,
      ),
    ).toBe(false);
  });
});
