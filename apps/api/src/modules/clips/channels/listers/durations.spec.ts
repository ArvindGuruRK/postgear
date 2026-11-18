import { parseHelixDuration, parseIso8601Duration } from './durations';

describe('parseHelixDuration', () => {
  it.each([
    ['3m21s', 201],
    ['1h0m5s', 3_605],
    ['45s', 45],
    ['2h', 7_200],
    ['10m', 600],
    ['12h34m56s', 45_296],
  ])('reads %s as %d seconds', (text, seconds) => {
    expect(parseHelixDuration(text)).toBe(seconds);
  });

  it.each(['', 'abc', '3m21', 's', '1h-2m', '1d', ' 3m21s', null, undefined, 201])(
    'reads %p as unknown',
    (text) => {
      expect(parseHelixDuration(text)).toBeNull();
    },
  );
});

describe('parseIso8601Duration', () => {
  it.each([
    ['PT1H2M3S', 3_723],
    ['PT45S', 45],
    ['PT10M', 600],
    ['P1DT2H', 93_600],
    ['PT45.5S', 46],
    ['P0D', 0],
    ['PT0S', 0],
  ])('reads %s as %d seconds', (text, seconds) => {
    expect(parseIso8601Duration(text)).toBe(seconds);
  });

  it.each(['', 'P', 'PT', 'P1DT', '1H2M', 'PT1H2M3', 'P1W', 'P1Y', null, 3_723])(
    'reads %p as unknown',
    (text) => {
      expect(parseIso8601Duration(text)).toBeNull();
    },
  );
});
