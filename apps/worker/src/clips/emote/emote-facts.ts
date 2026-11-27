/**
 * What an emote file holds, read from its own bytes (Module 14): the picture
 * size, the frame count and whether it loops for ever.
 *
 * ffprobe counts GIF and APNG frames but cannot open an animated WebP in
 * FFmpeg 9.0.2 ("Invalid data found"), and every ffprobe run costs a process.
 * These readers walk the containers' own blocks instead, so the worker
 * measures every file the same way and a test can check a file's loop flag
 * (the spike found WebP and APNG play once unless told otherwise).
 *
 * They read only headers and block lengths, never the pictures, and a file
 * that does not parse answers null: the caller treats that as a failed
 * encode, never as a fit.
 */
import type { EmoteFormat } from '@postgear/video-engine';

export interface EmoteFileFacts {
  width: number;
  height: number;
  frames: number;
  /** 0 is for ever; a GIF or APNG with no loop block plays once (1). */
  loops: number;
}

function gifFacts(data: Buffer): EmoteFileFacts | null {
  if (data.length < 13) return null;
  const magic = data.toString('latin1', 0, 6);
  if (magic !== 'GIF89a' && magic !== 'GIF87a') return null;
  const width = data.readUInt16LE(6);
  const height = data.readUInt16LE(8);
  const packed = data[10] as number;
  let at = 13;
  if (packed & 0x80) at += 3 * 2 ** ((packed & 0x07) + 1);
  let frames = 0;
  let loops = 1;

  /** Skips data sub-blocks (a length byte, that many bytes, until a zero). */
  const skipBlocks = (from: number): number | null => {
    let index = from;
    for (;;) {
      if (index >= data.length) return null;
      const size = data[index] as number;
      index += 1;
      if (size === 0) return index;
      index += size;
    }
  };

  while (at < data.length) {
    const marker = data[at] as number;
    if (marker === 0x3b) return { width, height, frames, loops };
    if (marker === 0x21) {
      const label = data[at + 1];
      if (label === 0xff && data[at + 2] === 11) {
        const app = data.toString('latin1', at + 3, at + 14);
        // NETSCAPE2.0: sub-block [3, 1, count low, count high]; 0 is for ever.
        if ((app === 'NETSCAPE2.0' || app === 'ANIMEXTS1.0') && data[at + 14] === 3) {
          loops = data.readUInt16LE(at + 16);
        }
      }
      const next = skipBlocks(at + 2);
      if (next === null) return null;
      at = next;
      continue;
    }
    if (marker === 0x2c) {
      if (at + 10 > data.length) return null;
      const local = data[at + 9] as number;
      let index = at + 10;
      if (local & 0x80) index += 3 * 2 ** ((local & 0x07) + 1);
      // The LZW minimum code size, then the picture's sub-blocks.
      const next = skipBlocks(index + 1);
      if (next === null) return null;
      frames += 1;
      at = next;
      continue;
    }
    return null;
  }
  return null;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngFacts(data: Buffer, animated: boolean): EmoteFileFacts | null {
  if (data.length < 33 || !data.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  let at = 8;
  let width = 0;
  let height = 0;
  let declared: number | null = null;
  let plays = 1;
  let frameControls = 0;
  while (at + 8 <= data.length) {
    const length = data.readUInt32BE(at);
    const type = data.toString('latin1', at + 4, at + 8);
    const body = at + 8;
    if (body + length + 4 > data.length) return null;
    if (type === 'IHDR') {
      width = data.readUInt32BE(body);
      height = data.readUInt32BE(body + 4);
    } else if (type === 'acTL') {
      declared = data.readUInt32BE(body);
      plays = data.readUInt32BE(body + 4);
    } else if (type === 'fcTL') {
      frameControls += 1;
    } else if (type === 'IEND') {
      if (width === 0 || height === 0) return null;
      if (!animated) return { width, height, frames: 1, loops: 0 };
      if (declared === null || declared !== frameControls) return null;
      return { width, height, frames: declared, loops: plays };
    }
    at = body + length + 4;
  }
  return null;
}

function webpFacts(data: Buffer): EmoteFileFacts | null {
  if (
    data.length < 30 ||
    data.toString('latin1', 0, 4) !== 'RIFF' ||
    data.toString('latin1', 8, 12) !== 'WEBP'
  ) {
    return null;
  }
  let at = 12;
  let width = 0;
  let height = 0;
  let loops: number | null = null;
  let frames = 0;
  while (at + 8 <= data.length) {
    const fourcc = data.toString('latin1', at, at + 4);
    const size = data.readUInt32LE(at + 4);
    const body = at + 8;
    if (body + size > data.length) return null;
    if (fourcc === 'VP8X') {
      width = data.readUIntLE(body + 4, 3) + 1;
      height = data.readUIntLE(body + 7, 3) + 1;
    } else if (fourcc === 'ANIM') {
      loops = data.readUInt16LE(body + 4);
    } else if (fourcc === 'ANMF') {
      frames += 1;
    }
    // Chunks are padded to an even length.
    at = body + size + (size % 2);
  }
  if (width === 0 || height === 0 || loops === null || frames === 0) return null;
  return { width, height, frames, loops };
}

/** The facts of a file the encoder made, or null when it does not read as `format`. */
export function readEmoteFacts(data: Buffer, format: EmoteFormat): EmoteFileFacts | null {
  switch (format) {
    case 'gif':
      return gifFacts(data);
    case 'apng':
      return pngFacts(data, true);
    case 'png':
      return pngFacts(data, false);
    case 'webp':
      return webpFacts(data);
  }
}
