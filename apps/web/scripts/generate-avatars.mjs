/**
 * Generates the preset avatars in `apps/web/public/avatars/`.
 *
 *     node apps/web/scripts/generate-avatars.mjs
 *
 * Run once by hand; the SVGs it writes are committed. Nothing generates an
 * avatar at runtime and nothing fetches one from DiceBear's HTTP API: the
 * files are static assets served by Next like the logo.
 *
 * ## The style and its licence
 *
 * DiceBear's `notionists` style, drawn by Zoish. The **artwork is CC0 1.0**
 * (public domain dedication: no attribution required, commercial use fine);
 * the DiceBear library code that assembles it is MIT. Both are stated in
 * `node_modules/@dicebear/notionists/LICENSE` and recorded in
 * `public/avatars/README.md`. Most other DiceBear styles carry CC BY 4.0
 * (attribution) or worse, so check the style's LICENSE before switching.
 *
 * ## Why fixed seeds
 *
 * A seed fully determines the drawing, so re-running this reproduces the same
 * files byte for byte. The seeds below were hand-picked from a pool of 120 for
 * friendly expressions and a spread of people (hair, hijab, beard, glasses,
 * an older face); the backgrounds are the brand fills plus a pastel tint of
 * each, arranged so no two neighbours in the 4-column picker grid share one.
 *
 * ## Keep three lists in step
 *
 * The ids here are duplicated in `apps/web/src/lib/avatars.ts` (ids + alt
 * text, what the picker renders) and `apps/api/src/modules/users/avatar.presets.ts`
 * (the server's allowlist). Adding an avatar means a new entry in all three.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { notionists } from '@dicebear/collection';
import { createAvatar } from '@dicebear/core';

const OUTPUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'avatars');

/** Brand fills (`colors.css`) and a pastel tint of each. */
const BG = {
  blue: '1d4ed8',
  yellow: 'ffd100',
  orange: 'ff6b35',
  violet: '7657ef',
  green: '22c55e',
  blueTint: 'bfdbfe',
  yellowTint: 'fff3b0',
  orangeTint: 'ffd4c2',
  violetTint: 'ddd6fe',
  greenTint: 'bbf7d0',
};

/**
 * Picker order. Laid out for a 4-column grid at first; the picker became 9
 * columns (6 on a phone) on 2026-10-20, with the upload card as the 18th cell,
 * and notionists-17 was added then with a background that differs from its
 * neighbours in both grids.
 */
const PRESETS = [
  { id: 'notionists-01', seed: 'pg-2', background: BG.yellow },
  { id: 'notionists-02', seed: 'pg-42', background: BG.blue },
  { id: 'notionists-03', seed: 'pg-13', background: BG.greenTint },
  { id: 'notionists-04', seed: 'pg-67', background: BG.orange },
  { id: 'notionists-05', seed: 'pg-39', background: BG.violet },
  { id: 'notionists-06', seed: 'pg-1', background: BG.blueTint },
  { id: 'notionists-07', seed: 'pg-44', background: BG.green },
  { id: 'notionists-08', seed: 'pg-41', background: BG.orangeTint },
  { id: 'notionists-09', seed: 'pg-11', background: BG.yellowTint },
  { id: 'notionists-10', seed: 'pg-68', background: BG.violetTint },
  { id: 'notionists-11', seed: 'pg-51', background: BG.yellow },
  { id: 'notionists-12', seed: 'pg-22', background: BG.blue },
  { id: 'notionists-13', seed: 'pg-84', background: BG.green },
  { id: 'notionists-14', seed: 'pg-111', background: BG.orange },
  { id: 'notionists-15', seed: 'pg-30', background: BG.violet },
  { id: 'notionists-16', seed: 'pg-47', background: BG.greenTint },
  { id: 'notionists-17', seed: 'pg-6', background: BG.blueTint },
];

await mkdir(OUTPUT, { recursive: true });

for (const preset of PRESETS) {
  // No `size`: the SVG keeps only its viewBox and scales to whatever box the
  // page gives it (a 32px menu avatar, a 128px preview).
  const svg = createAvatar(notionists, {
    seed: preset.seed,
    backgroundColor: [preset.background],
  }).toString();

  await writeFile(join(OUTPUT, `${preset.id}.svg`), `${svg}\n`);
}

console.log(`Wrote ${PRESETS.length} avatars to ${OUTPUT}`);
