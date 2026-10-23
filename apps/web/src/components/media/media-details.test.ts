import type { MediaItem } from '@/types/media';
import { detailsOf, formatOf, stickerOf, tileLine, usageLine } from './media-details';

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
});
