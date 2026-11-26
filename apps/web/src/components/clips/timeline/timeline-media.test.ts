/**
 * The waveform file as the import stores it (a JSON array of numbers, see the
 * worker's `peaksToJson`) and as raw bytes: both read as the same peaks.
 */
import { peaksFromFile } from './timeline-media';

function ascii(text: string): ArrayBuffer {
  return Uint8Array.from(text, (char) => char.charCodeAt(0)).buffer;
}

describe('peaksFromFile', () => {
  it('reads the stored JSON array as peaks, not as its characters', () => {
    expect(Array.from(peaksFromFile(ascii('[2,2,15,0,255]')))).toEqual([2, 2, 15, 0, 255]);
    expect(Array.from(peaksFromFile(ascii(' \n[]')))).toEqual([]);
  });

  it('reads a long JSON file whole', () => {
    const values = Array.from({ length: 20_000 }, (_, k) => k % 256);
    expect(Array.from(peaksFromFile(ascii(JSON.stringify(values))))).toEqual(values);
  });

  it('keeps a file of raw bytes as it is, even one starting with 91', () => {
    expect(Array.from(peaksFromFile(Uint8Array.from([4, 120, 7]).buffer))).toEqual([4, 120, 7]);
    expect(Array.from(peaksFromFile(Uint8Array.from([91, 3, 200]).buffer))).toEqual([91, 3, 200]);
  });
});
