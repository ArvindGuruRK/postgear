/**
 * Remove Bad Takes (Sprint 13, Module 17 item 3): a start said again is cut,
 * the last attempt kept; a word said twice, a sentence that only shares its
 * first words much later, and anything outside the clip are left alone.
 */
import type { TranscriptWord } from '../transcript/types';
import { findBadTakes, RESTART_PAUSE_MS, TAKE_MAX_MS } from './bad-takes';

/** Words from "text@startMs" pairs, each 300 ms long, indexes from 10. */
function words(...said: [string, number][]): { words: TranscriptWord[] } {
  return {
    words: said.map(([text, start], n) => ({
      i: 10 + n,
      start,
      end: start + 300,
      text,
      sure: 0.9,
    })),
  };
}

const WHOLE = [{ fromMs: 0, toMs: 600_000 }];

/** A run of words, 350 ms apart, from `at`. */
function run(text: string, at: number): [string, number][] {
  return text.split(' ').map((word, n) => [word, at + n * 350] as [string, number]);
}

describe('findBadTakes', () => {
  it('cuts the first attempt of a restarted sentence and keeps the last', () => {
    const said = words(
      ...run('So today we are,', 0),
      ...run('so today we are going to look.', 2_000),
    );
    const takes = findBadTakes(said, WHOLE);
    expect(takes).toHaveLength(1);
    expect(takes[0]?.words).toEqual([10, 11, 12, 13]);
    expect(takes[0]?.keptFrom).toBe(14);
    expect(takes[0]?.matched).toBe(4);
    // The cut ends before the kept start, leaving its breath.
    expect(takes[0]?.cut.fromMs).toBeLessThanOrEqual(0);
    expect(takes[0]?.cut.toMs).toBeLessThanOrEqual(2_000);
    expect(takes[0]?.cut.toMs).toBeGreaterThan(1_350);
  });

  it('keeps only the last of three attempts, as one cut', () => {
    const said = words(
      ...run('I think we', 0),
      ...run('I think we', 2_000),
      ...run('I think we should go.', 4_000),
    );
    const takes = findBadTakes(said, WHOLE);
    expect(takes).toHaveLength(1);
    expect(takes[0]?.words).toEqual([10, 11, 12, 13, 14, 15]);
    expect(takes[0]?.keptFrom).toBe(16);
  });

  it('takes a restart after a cut-off word with no pause', () => {
    const said = words(['We', 0], ['need-', 350], ['we', 700], ['need', 1_050], ['more.', 1_400]);
    expect(findBadTakes(said, WHOLE)[0]?.words).toEqual([10, 11]);
  });

  it('never takes one repeated word', () => {
    const said = words(...run('I.', 0), ...run('I think so.', 1_000));
    expect(findBadTakes(said, WHOLE)).toEqual([]);
  });

  it('never takes words repeated in the middle of a sentence', () => {
    // "we went" comes back, but not at a fresh start: no pause, no sentence end.
    const said = words(...run('we went to the shop and then we went home.', 0));
    expect(findBadTakes(said, WHOLE)).toEqual([]);
  });

  it('leaves a start said again much later', () => {
    const said = words(
      ...run('So today we are here.', 0),
      ...run('So today we are done.', TAKE_MAX_MS + 5_000),
    );
    expect(findBadTakes(said, WHOLE)).toEqual([]);
  });

  it('needs a fresh start: a pause long enough, or a sentence end', () => {
    const tight = words(['so', 0], ['today', 350], ['so', 700], ['today', 1_050], ['we', 1_400]);
    expect(findBadTakes(tight, WHOLE)).toEqual([]);
    const paused = words(
      ['so', 0],
      ['today', 350],
      ['so', 650 + RESTART_PAUSE_MS],
      ['today', 1_000 + RESTART_PAUSE_MS],
      ['we', 1_350 + RESTART_PAUSE_MS],
    );
    expect(findBadTakes(paused, WHOLE)[0]?.words).toEqual([10, 11]);
  });

  it('compares words without case or punctuation', () => {
    const said = words(...run('Okay, so...', 0), ...run('okay so here it is.', 1_500));
    expect(findBadTakes(said, WHOLE)[0]?.words).toEqual([10, 11]);
  });

  it('only cuts inside the clip', () => {
    const said = words(...run('So today we are,', 0), ...run('so today we are going.', 2_000));
    expect(findBadTakes(said, [{ fromMs: 1_000, toMs: 60_000 }])).toEqual([]);
    expect(findBadTakes(said, [{ fromMs: 0, toMs: 1_500 }])).toEqual([]);
  });

  it('leaves two finished sentences that only open alike', () => {
    const said = words(
      ...run('That is the worst thing you can do.', 0),
      ...run('Open with the best moment.', 3_000),
      ...run('That is such a good point.', 6_000),
    );
    expect(findBadTakes(said, WHOLE)).toEqual([]);
  });

  it('takes a whole sentence said again word for word, from three words', () => {
    const echo = words(
      ...run('Hours are a trap.', 0),
      ...run('Hours are a trap.', 3_000),
      ...run('I am writing.', 5_000),
    );
    const takes = findBadTakes(echo, WHOLE);
    expect(takes.map((take) => take.words)).toEqual([[10, 11, 12, 13]]);
    const shout = words(...run('Oh no!', 0), ...run('Oh no, no, no!', 1_000));
    expect(findBadTakes(shout, WHOLE)).toEqual([]);
    const different = words(...run('Hours are a trap.', 0), ...run('Hours are a lie.', 3_000));
    expect(findBadTakes(different, WHOLE)).toEqual([]);
  });

  it('finds several takes in one clip, in time order', () => {
    const said = words(
      ...run('First thing,', 0),
      ...run('first thing is the bridge.', 1_500),
      ...run('Then we', 5_000),
      ...run('then we take the tunnel.', 6_500),
    );
    const takes = findBadTakes(said, WHOLE);
    expect(takes.map((take) => take.words)).toEqual([
      [10, 11],
      [17, 18],
    ]);
  });
});
