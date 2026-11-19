import { parseClipsRemoveArgs } from './clips-remove.args';

describe('parseClipsRemoveArgs', () => {
  it('reads the three options, spaced or with =', () => {
    expect(
      parseClipsRemoveArgs([
        '--url',
        'https://www.twitch.tv/videos/900000001',
        '--reason=The owner asked by mail.',
        '--by',
        'Demo@PostGear.local',
      ]),
    ).toEqual({
      url: 'https://www.twitch.tv/videos/900000001',
      reason: 'The owner asked by mail.',
      by: 'demo@postgear.local',
    });
  });

  it.each([
    [[], '--url is required'],
    [['--url', 'x', '--by', 'a@b.c'], '--reason needs at least 10 characters'],
    [['--url', 'x', '--reason', 'long enough reason'], "--by needs the operator's email"],
    [['--url'], '--url needs a value'],
    [['--url', 'x', '--force', 'yes'], 'Unknown option --force'],
    [['stray'], 'Unexpected "stray"'],
  ])('refuses %j with a sentence', (argv, start) => {
    const parsed = parseClipsRemoveArgs(argv);
    expect('error' in parsed && parsed.error.startsWith(start)).toBe(true);
  });
});
