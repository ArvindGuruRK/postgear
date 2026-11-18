/**
 * `npm run clips:sounds:make`: makes PostGear's own sounds (Module 14) into
 * the folder the library's `own` sound source reads.
 *
 * Each sound in `sounds-catalogue.ts` is an FFmpeg `lavfi` graph, written as
 * a 48 kHz 32-bit float WAV (float, so a loud graph is never clipped; the
 * ingest's `normaliseSound` levels it), with `licences.json` naming every
 * file. Like the sticker pack, the folder is made, not kept in git: the code
 * is the source, and the worker image runs this same step.
 *
 *   --out <folder>    where to write (default: CLIPS_SOUNDS_OWN_DIR or <repo>/.cache/clips-sounds-own)
 *   --only <text>     make only the sounds whose id contains this text
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import * as path from 'node:path';
import { createRunTool } from '../src/run/runner';
import { toolPaths } from '../src/run/paths';
import { OWN_SOUNDS, type OwnSound } from './sounds-catalogue';

export const OWN_SOUND_LICENCE_FILE = 'licences.json';

function argument(name: string): string | undefined {
  const at = process.argv.indexOf(name);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

/** The FFmpeg arguments that make one sound's WAV. */
export function makeSoundArgs(sound: OwnSound, file: string): string[] {
  return [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    sound.graph,
    '-t',
    sound.seconds.toFixed(3),
    '-ar',
    '48000',
    '-c:a',
    'pcm_f32le',
    '-fflags',
    '+bitexact',
    '-flags:a',
    '+bitexact',
    '-f',
    'wav',
    file,
  ];
}

async function main(): Promise<void> {
  const repo = path.resolve(__dirname, '..', '..', '..');
  const outDir = path.resolve(
    argument('--out') ??
      process.env.CLIPS_SOUNDS_OWN_DIR ??
      path.join(repo, '.cache', 'clips-sounds-own'),
  );
  const only = argument('--only');
  const sounds = OWN_SOUNDS.filter((sound) => !only || sound.id.includes(only));
  const ids = new Set<string>();
  for (const sound of OWN_SOUNDS) {
    if (ids.has(sound.id)) throw new Error(`Two sounds are called ${sound.id}`);
    ids.add(sound.id);
  }
  mkdirSync(outDir, { recursive: true });
  const runTool = createRunTool(toolPaths(process.env));

  const started = Date.now();
  for (const sound of sounds) {
    const file = `${sound.category}/${sound.id}.wav`;
    mkdirSync(path.join(outDir, sound.category), { recursive: true });
    await runTool('ffmpeg', makeSoundArgs(sound, file), { cwd: outDir, timeoutMs: 180_000 });
  }
  // The manifest always names every sound, so `--only` remakes a few files without dropping the rest.
  const items: Array<Record<string, unknown>> = [];
  for (const sound of OWN_SOUNDS) {
    const file = `${sound.category}/${sound.id}.wav`;
    items.push({
      file,
      originId: `sounds/${sound.id}`,
      name: sound.name,
      category: sound.category,
      kind: sound.kind,
      tags: sound.tags,
      bpm: sound.bpm ?? null,
    });
  }
  writeFileSync(
    path.join(outDir, OWN_SOUND_LICENCE_FILE),
    `${JSON.stringify(
      {
        licence: 'OWN',
        creator: 'PostGear',
        note: 'Made in code from FFmpeg lavfi graphs by packages/media-tools/scripts/sounds-make.ts. No recording is used.',
        items,
      },
      null,
      2,
    )}\n`,
  );
  const loops = sounds.filter((sound) => sound.kind === 'music').length;
  console.log(
    `Made ${sounds.length} sounds (${sounds.length - loops} effects, ${loops} music loops) into ${outDir} in ${((Date.now() - started) / 1000).toFixed(1)} s.`,
  );
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
