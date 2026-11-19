import {
  decodeSignalsFile,
  encodeSignalsFile,
  reusableTrack,
  SIGNALS_FILE_FORMAT,
  SignalsFileError,
  withTracks,
} from './file';
import { binTrack, TRACKS } from './tracks';

const loud = binTrack(
  'loudness',
  [
    { sec: 0, value: -20.123_456 },
    { sec: 0.5, value: -8.004 },
  ],
  1_500,
  { combine: 'max', empty: 'null' },
);
const scene = binTrack('scene', [{ sec: 0, value: 50 }], 1_500, { combine: 'max', empty: 'hold' });

describe('the signals file', () => {
  it('round-trips, keeping two decimals and no data', () => {
    const text = encodeSignalsFile({
      format: SIGNALS_FILE_FORMAT,
      durationMs: 1_500,
      tracks: [loud, scene],
    });
    const file = decodeSignalsFile(text);
    expect(file.durationMs).toBe(1_500);
    expect(file.tracks[0]?.values).toEqual([-20.12, -8, null]);
    expect(file.tracks[1]?.values).toEqual([50, 50, 50]);
  });

  it('refuses what is not one', () => {
    expect(() => decodeSignalsFile('not json')).toThrow(SignalsFileError);
    expect(() => decodeSignalsFile('{"format":2,"durationMs":0,"tracks":[]}')).toThrow(
      SignalsFileError,
    );
    expect(() =>
      decodeSignalsFile(
        '{"format":1,"durationMs":0,"tracks":[{"name":"loudness","version":1,"sampleRateHz":2,"startSec":0,"unit":"lufs","values":[1],"text":"hi"}]}',
      ),
    ).toThrow(SignalsFileError);
  });

  it('reuses a stored track only at the current version and the same length', () => {
    const file = withTracks(null, 1_500, [loud]);
    expect(reusableTrack(file, 'loudness', 1_500)).toBe(loud);
    expect(reusableTrack(file, 'loudness', 90_000)).toBeNull();
    expect(reusableTrack(file, 'scene', 1_500)).toBeNull();
    const old = withTracks(null, 1_500, [{ ...loud, version: TRACKS.loudness.version + 1 }]);
    expect(reusableTrack(old, 'loudness', 1_500)).toBeNull();
  });

  it('puts new tracks in beside the others, replacing one of the same name', () => {
    const first = withTracks(null, 1_500, [loud, scene]);
    const louder = { ...loud, values: [1, 2, 3] };
    const next = withTracks(first, 1_500, [louder]);
    expect(next.tracks.map((track) => track.name)).toEqual(['scene', 'loudness']);
    expect(next.tracks[1]?.values).toEqual([1, 2, 3]);
    // Another length starts over.
    expect(withTracks(first, 60_000, [louder]).tracks.map((track) => track.name)).toEqual([
      'loudness',
    ]);
  });
});
