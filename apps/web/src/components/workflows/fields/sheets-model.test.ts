import {
  columnsFromHeaders,
  columnsOf,
  headersForNew,
  missingHeaders,
  refreshColumns,
  sheetOf,
  spreadsheetOf,
} from './sheets-model';

describe('reading the stored sheet fields', () => {
  it('reads a spreadsheet and a tab, or nothing', () => {
    expect(spreadsheetOf({ id: 's1', name: 'Report' })).toEqual({ id: 's1', name: 'Report' });
    expect(spreadsheetOf({ id: '' })).toBeNull();
    expect(spreadsheetOf(null)).toBeNull();
    expect(sheetOf({ id: 0, title: 'Posts' })).toEqual({ id: 0, title: 'Posts' });
    expect(sheetOf({ id: '0', title: 'Posts' })).toBeNull();
  });

  it('reads columns with text headers and values', () => {
    expect(
      columnsOf([{ header: 'Date', value: '{{ trigger.date }}' }, 'x', { header: 3 }]),
    ).toEqual([
      { header: 'Date', value: '{{ trigger.date }}' },
      { header: '', value: '' },
    ]);
  });
});

describe('Refresh Columns', () => {
  const current = [
    { header: 'Date', value: 'today' },
    { header: 'Old', value: 'kept' },
    { header: 'Text', value: '{{ trigger.post.text }}' },
  ];

  it('follows the header row, keeps typed values and adds new columns empty', () => {
    const result = refreshColumns(current, ['Text', 'Date', 'Link']);
    expect(result.columns).toEqual([
      { header: 'Text', value: '{{ trigger.post.text }}' },
      { header: 'Date', value: 'today' },
      { header: 'Link', value: '' },
      { header: 'Old', value: 'kept' },
    ]);
    expect(result.added).toEqual(['Link']);
    expect(result.missing).toEqual(['Old']);
  });

  it('skips blank and repeated headers', () => {
    const result = refreshColumns([], ['Date', '', 'Date', 'Text']);
    expect(result.columns.map((column) => column.header)).toEqual(['Date', 'Text']);
  });

  it('flags the columns the tab no longer has, once the header row is known', () => {
    expect([...missingHeaders(current, ['Date', 'Text'])]).toEqual(['Old']);
    expect(missingHeaders(current, null).size).toBe(0);
  });

  it('builds columns for a first read and headers for a new spreadsheet', () => {
    expect(columnsFromHeaders(['Date', '', 'Text'])).toEqual([
      { header: 'Date', value: '' },
      { header: 'Text', value: '' },
    ]);
    expect(
      headersForNew([
        { header: ' Date ', value: '' },
        { header: 'Date', value: '' },
        { header: '', value: 'x' },
        { header: 'Link', value: '' },
      ]),
    ).toEqual(['Date', 'Link']);
  });
});
