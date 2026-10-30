import { edgeLook } from './step-edge';

const base = { isError: false, selected: false, markerId: 'm' };

describe('edgeLook', () => {
  it('draws a plain line in ink with the ink arrow', () => {
    expect(edgeLook({ ...base, run: undefined })).toEqual({
      path: 'pg-edge-path stroke-ink stroke-2',
      group: '',
      marker: 'url(#m)',
    });
  });

  it('keeps On Error lines red', () => {
    const look = edgeLook({ ...base, isError: true, run: undefined });
    expect(look.path).toContain('stroke-actionDanger');
    expect(look.marker).toBe('url(#m-error)');
  });

  it('turns a taken line solid success green, even from On Error', () => {
    for (const isError of [false, true]) {
      const look = edgeLook({ ...base, isError, run: 'taken' });
      expect(look.path).toContain('stroke-successInk');
      expect(look.path).not.toContain('pg-edge-skipped');
      expect(look.marker).toBe('url(#m-taken)');
    }
  });

  it('dashes and fades a skipped line', () => {
    const look = edgeLook({ ...base, run: 'skipped' });
    expect(look.path).toContain('pg-edge-skipped');
    expect(look.group).toBe('opacity-35');
  });

  it('marks a flowing line and thickens a selected one', () => {
    expect(edgeLook({ ...base, run: 'active' }).path).toContain('pg-edge-active');
    expect(edgeLook({ ...base, selected: true, run: 'taken' }).path).toContain('stroke-[3px]');
  });
});
