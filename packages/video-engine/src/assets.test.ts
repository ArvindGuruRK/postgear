import { readStickerAssetMeta, STICKER_UPLOAD_MAX_BYTES, stickerNameFromFile } from './assets';

describe("a workspace's own sticker", () => {
  it('reads the three states the API and the check write, and nothing else', () => {
    expect(readStickerAssetMeta({ status: 'checking', name: 'Wave' })).toEqual({ status: 'checking', name: 'Wave' });
    expect(
      readStickerAssetMeta({
        status: 'ready',
        name: 'Wave',
        animated: true,
        width: 256,
        height: 200,
        fps: 12,
        frames: 18,
        durationMs: 1_500,
        previewKey: 'clips/org/library/abc.webp',
      }),
    ).toMatchObject({ status: 'ready', frames: 18 });
    expect(readStickerAssetMeta({ status: 'failed', name: 'Wave', error: 'sticker_too_large' })).toMatchObject({
      error: 'sticker_too_large',
    });
    expect(readStickerAssetMeta({ status: 'ready', name: 'Wave' })).toBeNull();
    expect(readStickerAssetMeta({ status: 'failed', name: 'Wave', error: 'tool_failed' })).toBeNull();
    expect(readStickerAssetMeta(null)).toBeNull();
    expect(readStickerAssetMeta({ height: 90 })).toBeNull();
  });

  it('names a sticker after its file, plainly', () => {
    expect(stickerNameFromFile('party_hat-final.v2.PNG')).toBe('party hat final v2');
    expect(stickerNameFromFile('C:\\Users\\me\\Pictures\\wave.gif')).toBe('wave');
    expect(stickerNameFromFile('../../etc/passwd')).toBe('passwd');
    expect(stickerNameFromFile('<script>.webp')).toBe('script');
    expect(stickerNameFromFile('.png')).toBe('Sticker');
    expect(stickerNameFromFile(`${'a'.repeat(100)}.png`)).toHaveLength(60);
  });

  it('caps an upload at 8 MB', () => {
    expect(STICKER_UPLOAD_MAX_BYTES).toBe(8 * 1024 * 1024);
  });
});
