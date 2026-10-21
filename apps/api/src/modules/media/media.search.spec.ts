/**
 * `MediaService.search`: the database narrows by one word, the service checks
 * every word on the name, and a result carries URLs, never storage keys.
 */
import type { MediaRecord, MediaRepository } from './media.repository';
import { MediaService } from './media.service';
import type { StorageBackend } from './storage/storage.interface';

function record(id: string, name: string): MediaRecord {
  return {
    id,
    name,
    type: 'image',
    mimeType: 'image/jpeg',
    fileSize: 100,
    width: 10,
    height: 10,
    path: `2026/10/${id}.jpg`,
    thumbnail: `2026/10/${id}-thumb.jpg`,
    createdAt: new Date('2026-10-01'),
  };
}

describe('MediaService.search', () => {
  let repository: { list: jest.Mock };
  let service: MediaService;

  beforeEach(() => {
    repository = { list: jest.fn() };
    const storage: StorageBackend = {
      kind: 'local',
      put: jest.fn(),
      delete: jest.fn(),
      publicUrl: (key: string) => `http://localhost:3001/uploads/${key}`,
    };
    service = new MediaService(repository as unknown as MediaRepository, storage);
  });

  it('asks the repository for the workspace, by the longest term, newest first page', async () => {
    repository.list.mockResolvedValue({ items: [], total: 0 });

    await service.search('org_1', ['big', 'banner'], 4);

    expect(repository.list).toHaveBeenCalledWith({
      orgId: 'org_1',
      search: 'banner',
      page: 1,
      pageSize: 60,
    });
  });

  it('keeps only items whose name holds every term', async () => {
    repository.list.mockResolvedValue({
      items: [record('m1', 'big-summer-banner.jpg'), record('m2', 'banner.jpg')],
      total: 2,
    });

    const result = await service.search('org_1', ['summer', 'banner'], 4);

    expect(result.media.map((item) => item.id)).toEqual(['m1']);
  });

  it('does not let % act as a wildcard', async () => {
    repository.list.mockResolvedValue({ items: [record('m1', 'photo.jpg')], total: 1 });

    expect((await service.search('org_1', ['%'], 4)).media).toEqual([]);
  });

  it('returns URLs and no storage keys', async () => {
    repository.list.mockResolvedValue({ items: [record('m1', 'banner.jpg')], total: 1 });

    const [item] = (await service.search('org_1', ['banner'], 4)).media;

    expect(item).toEqual({
      id: 'm1',
      name: 'banner.jpg',
      type: 'image',
      url: 'http://localhost:3001/uploads/2026/10/m1.jpg',
      thumbnailUrl: 'http://localhost:3001/uploads/2026/10/m1-thumb.jpg',
    });
  });

  it('stops at the limit and says there are more', async () => {
    repository.list.mockResolvedValue({
      items: ['a', 'b', 'c'].map((suffix) => record(`m_${suffix}`, `banner-${suffix}.jpg`)),
      total: 3,
    });

    const result = await service.search('org_1', ['banner'], 2);

    expect(result.media).toHaveLength(2);
    expect(result.more).toBe(true);
  });
});
