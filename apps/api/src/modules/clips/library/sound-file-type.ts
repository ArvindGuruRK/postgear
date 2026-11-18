/**
 * What an uploaded sound really is, from its first bytes (Module 14): MP3,
 * WAV, M4A or AAC, nothing else. The name and the browser's type are never
 * trusted, and ffprobe in the worker's check still has the last word (an MP4
 * video passes this sniff and is refused there, having no sound-only stream).
 * The same signatures as the worker's `sniffSoundType`, kept here because the
 * media-tools root is worker-only.
 */

export type SniffedSound =
  | { ext: 'mp3'; mimeType: 'audio/mpeg' }
  | { ext: 'wav'; mimeType: 'audio/wav' }
  | { ext: 'm4a'; mimeType: 'audio/mp4' }
  | { ext: 'aac'; mimeType: 'audio/aac' };

/** How many leading bytes `sniffSound` needs. */
export const SOUND_SNIFF_BYTES = 16;

export function sniffSound(head: Uint8Array): SniffedSound | null {
  if (head.length < 4) return null;
  const ascii = (from: number, to: number) => String.fromCharCode(...head.subarray(from, to));
  if (ascii(0, 4) === 'RIFF' && head.length >= 12 && ascii(8, 12) === 'WAVE') {
    return { ext: 'wav', mimeType: 'audio/wav' };
  }
  if (head.length >= 8 && ascii(4, 8) === 'ftyp') return { ext: 'm4a', mimeType: 'audio/mp4' };
  if (ascii(0, 3) === 'ID3') return { ext: 'mp3', mimeType: 'audio/mpeg' };
  const b0 = head[0] as number;
  const b1 = head[1] as number;
  if (b0 === 0xff) {
    // ADTS AAC: 12 sync bits, then layer 00.
    if ((b1 & 0xf6) === 0xf0) return { ext: 'aac', mimeType: 'audio/aac' };
    // An MPEG audio frame: 11 sync bits, a known version, layer III.
    const version = (b1 >> 3) & 0x03;
    const layer = (b1 >> 1) & 0x03;
    if ((b1 & 0xe0) === 0xe0 && version !== 0x01 && layer === 0x01) {
      return { ext: 'mp3', mimeType: 'audio/mpeg' };
    }
  }
  return null;
}
