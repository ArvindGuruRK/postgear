import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  copyWatermarkInto,
  defaultWatermarkFile,
  loadWatermark,
  pngSize,
  WATERMARK_SCRATCH_NAME,
} from './watermark';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'watermark-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('the watermark file', () => {
  it('is found in the package and is the 600 px wide PNG the script draws', async () => {
    const file = defaultWatermarkFile();
    expect(file).not.toBeNull();
    const mark = await loadWatermark(file as string);
    expect(mark).toMatchObject({ width: 600 });
    expect(mark?.height).toBeGreaterThan(100);
    expect(mark?.height).toBeLessThan(200);
  });

  it('is copied into the scratch folder under its plain name, with its size for the plan', async () => {
    const mark = await loadWatermark(defaultWatermarkFile() as string);
    const asset = await copyWatermarkInto(mark as NonNullable<typeof mark>, dir);
    expect(asset).toEqual({ file: WATERMARK_SCRATCH_NAME, width: 600, height: mark?.height });
    const copied = await readFile(path.join(dir, WATERMARK_SCRATCH_NAME));
    expect(pngSize(copied)).toEqual({ width: 600, height: mark?.height });
  });

  it('reads nothing from a file that is missing or is not a PNG', async () => {
    expect(await loadWatermark(path.join(dir, 'missing.png'))).toBeNull();
    await writeFile(path.join(dir, 'fake.png'), 'not a picture at all, just words');
    expect(await loadWatermark(path.join(dir, 'fake.png'))).toBeNull();
    expect(pngSize(Buffer.alloc(10))).toBeNull();
  });
});
