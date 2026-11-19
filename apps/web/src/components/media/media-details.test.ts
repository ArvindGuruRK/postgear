import type { MediaItem } from '@/types/media';
import { detailsOf, formatOf, lengthOf, stickerOf, tileLine, usageLine } from './media-details';

const item = (overrides: Partial<MediaItem> = {}): MediaItem => ({
  id: 'm1',
  name: 'banner.jpg',
  type: 'image',
  mimeType: 'image/jpeg',
  fileSize: 776 * 1024,
  width: 2048,
  height: 1365,
  url: 'https://cdn.example/banner.jpg',
  thumbnailUrl: null,
  createdAt: new Date(2026, 9, 22, 9).toISOString(),
  ...overrides,
});

describe('media details', () => {
  it('names the format the way people know it', () => {
    expect(formatOf(item())).toBe('JPEG');
    expect(formatOf(item({ mimeType: 'video/quicktime', type: 'video' }))).toBe('MOV');
    expect(formatOf(item({ mimeType: 'video/mp4', type: 'video' }))).toBe('MP4');
    expect(formatOf(item({ mimeType: null, type: 'video' }))).toBe('Video');
  });

  it('keeps the tile to format and size', () => {
    expect(tileLine(item())).toMatch(/^JPEG, 776/);
  });

  it('stickers only what a still frame hides', () => {
    expect(stickerOf(item())).toBeNull();
    expect(stickerOf(item({ mimeType: 'image/gif' }))).toBe('GIF');
    expect(stickerOf(item({ type: 'video', mimeType: 'video/mp4' }))).toBe('Video');
  });

  it('lists dimensions only when they are known', () => {
    expect(detailsOf(item()).map((row) => row.label)).toEqual([
      'Format',
      'Size',
      'Dimensions',
      'Uploaded',
    ]);
    expect(detailsOf(item()).find((row) => row.label === 'Dimensions')?.value).toBe('2048 × 1365');
    expect(detailsOf(item({ width: null, height: null })).map((row) => row.label)).not.toContain(
      'Dimensions',
    );
  });

  it('says where a file is used in plain words', () => {
    expect(usageLine(0)).toBe('Not used in any draft or queued post');
    expect(usageLine(1)).toBe('Used in 1 unpublished post');
    expect(usageLine(3)).toBe('Used in 3 unpublished posts');
  });

  it("gives a video's length as a clock, past an hour too (Module 19)", () => {
    const video = (durationMs: number | null | undefined) =>
      item({ type: 'video', mimeType: 'video/mp4', durationMs });
    expect(lengthOf(video(42_400))).toBe('0:42');
    expect(lengthOf(video(62_000))).toBe('1:02');
    expect(lengthOf(video(3_725_000))).toBe('1:02:05');
    expect(lengthOf(video(400))).toBe('0:01');
    expect(lengthOf(video(null))).toBeNull();
    expect(lengthOf(video(undefined))).toBeNull();
    expect(lengthOf(item({ durationMs: 5_000 }))).toBeNull();
  });

  it("lists a video's length in the viewer once it is known", () => {
    const video = item({ type: 'video', mimeType: 'video/mp4', durationMs: 42_400 });
    expect(detailsOf(video).map((row) => row.label)).toEqual([
      'Format',
      'Size',
      'Dimensions',
      'Length',
      'Uploaded',
    ]);
    expect(detailsOf(video).find((row) => row.label === 'Length')?.value).toBe('0:42');
    expect(
      detailsOf(item({ type: 'video', mimeType: 'video/mp4', durationMs: null })).map(
        (row) => row.label,
      ),
    ).not.toContain('Length');
  });
});
