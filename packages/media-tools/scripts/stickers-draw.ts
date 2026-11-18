/**
 * `npm run clips:stickers:draw`: draws PostGear's own sticker pack
 * (Module 12) into the folder the library's `own` source reads.
 *
 * Each piece in `stickers-catalogue.ts` is drawn on a 640 px square,
 * trimmed to its ink (one box for every frame of a moving one) and written
 * as a PNG (still) or an endless animated WebP at 12 frames a second
 * (moving), with `licences.json` naming every file. The ingest then runs
 * them through `normaliseSticker` like any other source.
 *
 * Like the fonts folder, the pack is drawn, not kept in git: the code is
 * the source, and the worker image runs this same step.
 *
 *   --out <folder>    where to write (default: CLIPS_STICKERS_OWN_DIR or <repo>/.cache/clips-stickers-own)
 *   --only <text>     draw only the pieces whose path contains this text
 *   --sheet <file>    also write a contact sheet of every piece (the middle frame of a moving one)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import sharp from 'sharp';
import { ART_FONT_NAMES } from './stickers-art';
import { OWN_FPS, OWN_STICKERS, type OwnSticker } from './stickers-catalogue';

const CANVAS = 640;
const PAD = 6;

export const OWN_LICENCE_FILE = 'licences.json';

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function argument(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

function frameSvg(content: string): Buffer {
  const half = CANVAS / 2;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="${-half} ${-half} ${CANVAS} ${CANVAS}">${content}</svg>`,
  );
}

async function inkBox(png: Buffer): Promise<Box> {
  const { info } = await sharp(png).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true });
  return {
    left: -(info.trimOffsetLeft ?? 0),
    top: -(info.trimOffsetTop ?? 0),
    width: info.width,
    height: info.height,
  };
}

function union(boxes: Box[]): Box {
  const left = Math.max(0, Math.min(...boxes.map((b) => b.left)) - PAD);
  const top = Math.max(0, Math.min(...boxes.map((b) => b.top)) - PAD);
  const right = Math.min(CANVAS, Math.max(...boxes.map((b) => b.left + b.width)) + PAD);
  const bottom = Math.min(CANVAS, Math.max(...boxes.map((b) => b.top + b.height)) + PAD);
  return { left, top, width: right - left, height: bottom - top };
}

/** Draws one piece; returns its file name inside the pack and its middle frame (for the sheet). */
async function drawOne(
  sticker: OwnSticker,
  outDir: string,
): Promise<{ file: string; first: Buffer }> {
  const count = sticker.frames ?? 1;
  const frames: Buffer[] = [];
  for (let k = 0; k < count; k += 1) {
    frames.push(
      await sharp(frameSvg(sticker.draw(k / count)))
        .png()
        .toBuffer(),
    );
  }
  const boxes = await Promise.all(frames.map(inkBox));
  const box = union(boxes);
  // A moving piece that touches the canvas edge would be cut: the drawing is too big.
  if (
    box.left === 0 ||
    box.top === 0 ||
    box.left + box.width === CANVAS ||
    box.top + box.height === CANVAS
  ) {
    throw new Error(`${sticker.slug} reaches the edge of the ${CANVAS} px canvas`);
  }
  const cut = await Promise.all(frames.map((frame) => sharp(frame).extract(box).png().toBuffer()));
  const first = cut[Math.floor(cut.length / 2)] as Buffer;
  mkdirSync(path.join(outDir, path.dirname(sticker.slug)), { recursive: true });
  if (sticker.frames === null) {
    const file = `${sticker.slug}.png`;
    await sharp(first)
      .png({ compressionLevel: 9, palette: true, effort: 10 })
      .toFile(path.join(outDir, file));
    return { file, first };
  }
  const file = `${sticker.slug}.webp`;
  const delay = Math.round(1000 / OWN_FPS);
  await sharp(cut, { join: { animated: true } })
    .webp({ loop: 0, delay: cut.map(() => delay), quality: 88, alphaQuality: 100, effort: 5 })
    .toFile(path.join(outDir, file));
  return { file, first };
}

async function contactSheet(firsts: Buffer[], file: string): Promise<void> {
  const tile = 120;
  const columns = 16;
  const rows = Math.ceil(firsts.length / columns);
  const tiles = await Promise.all(
    firsts.map((png) =>
      sharp(png)
        .resize(tile - 12, tile - 12, {
          fit: 'contain',
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer(),
    ),
  );
  await sharp({
    create: { width: columns * tile, height: rows * tile, channels: 4, background: '#E9E9EE' },
  })
    .composite(
      tiles.map((input, k) => ({
        input,
        left: (k % columns) * tile + 6,
        top: Math.floor(k / columns) * tile + 6,
      })),
    )
    .png()
    .toFile(file);
}

async function main(): Promise<void> {
  const repo = path.resolve(__dirname, '..', '..', '..');
  const outDir = path.resolve(
    argument('--out') ??
      process.env.CLIPS_STICKERS_OWN_DIR ??
      path.join(repo, '.cache', 'clips-stickers-own'),
  );
  const only = argument('--only');
  const sheet = argument('--sheet');
  const pieces = OWN_STICKERS.filter((sticker) => !only || sticker.slug.includes(only));
  mkdirSync(outDir, { recursive: true });

  const items: Array<Record<string, unknown>> = [];
  const firsts: Buffer[] = [];
  const started = Date.now();
  for (const sticker of pieces) {
    const { file, first } = await drawOne(sticker, outDir);
    firsts.push(first);
    items.push({
      file,
      originId: sticker.slug,
      name: sticker.name,
      category: sticker.category,
      tags: sticker.tags,
      animated: sticker.frames !== null,
    });
  }
  writeFileSync(
    path.join(outDir, OWN_LICENCE_FILE),
    `${JSON.stringify(
      {
        licence: 'OWN',
        creator: 'PostGear',
        note: 'Drawn in code by packages/media-tools/scripts/stickers-draw.ts. Words use these OFL-1.1 fonts as outlines.',
        fonts: Object.values(ART_FONT_NAMES),
        items,
      },
      null,
      2,
    )}\n`,
  );
  if (sheet) await contactSheet(firsts, path.resolve(sheet));
  const moving = items.filter((item) => item.animated).length;
  console.log(
    `Drew ${items.length} stickers (${items.length - moving} still, ${moving} moving) into ${outDir} in ${((Date.now() - started) / 1000).toFixed(1)} s.`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
