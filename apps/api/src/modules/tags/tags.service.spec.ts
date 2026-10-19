/**
 * The tags service against a fake repository: outcomes become the right
 * status codes, a malformed id is a 404 without a query, and `findLive`
 * (what a post save checks its tag ids with) only ever returns live tags of
 * the workspace.
 */
import { ConflictException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createTagSchema, updateTagSchema } from './dto/tags.schema';
import type { TagsRepository } from './tags.repository';
import { TagsService } from './tags.service';

const TAG_ID = '3a5c7d2e-1f4b-4c8a-9e6d-0b2a4c6e8f10';

describe('TagsService', () => {
  let repository: jest.Mocked<TagsRepository>;
  let service: TagsService;

  beforeEach(() => {
    repository = {
      list: jest.fn().mockResolvedValue([{ id: TAG_ID, name: 'Launch', color: 'teal' }]),
      findLive: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      update: jest.fn(),
      softDelete: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<TagsRepository>;
    service = new TagsService(repository);
  });

  it('maps each create outcome to its response', async () => {
    repository.create.mockResolvedValueOnce({
      outcome: 'created',
      tag: { id: TAG_ID, name: 'Launch', color: 'teal' },
    });
    await expect(service.create('org_1', { name: 'Launch', color: 'teal' })).resolves.toEqual({
      id: TAG_ID,
      name: 'Launch',
      color: 'teal',
    });

    repository.create.mockResolvedValueOnce({ outcome: 'name_taken' });
    await expect(service.create('org_1', { name: 'launch', color: 'teal' })).rejects.toBeInstanceOf(
      ConflictException,
    );

    repository.create.mockResolvedValueOnce({ outcome: 'too_many' });
    await expect(service.create('org_1', { name: 'More', color: 'teal' })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('treats a malformed id as not found without querying', async () => {
    await expect(service.update('org_1', "x'; DROP", { color: 'rose' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(service.remove('org_1', 'nope')).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.softDelete).not.toHaveBeenCalled();
  });

  it('reports a delete of a tag that is not there as not found', async () => {
    repository.softDelete.mockResolvedValueOnce(false);
    await expect(service.remove('org_1', TAG_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('resolves only well-formed ids, once each, and keys the result by id', async () => {
    repository.findLive.mockResolvedValueOnce([{ id: TAG_ID, name: 'Launch', color: 'teal' }]);

    const found = await service.findLive('org_1', [TAG_ID, TAG_ID, 'not-a-uuid']);

    expect(repository.findLive).toHaveBeenCalledWith('org_1', [TAG_ID]);
    expect([...found.keys()]).toEqual([TAG_ID]);
  });
});

describe('tag schemas', () => {
  it('cleans a name before judging its length', () => {
    expect(createTagSchema.parse({ name: '  Product​   launch ', color: 'violet' })).toEqual({
      name: 'Product launch',
      color: 'violet',
    });
  });

  it.each([
    ['an empty name', { name: '   ', color: 'teal' }],
    ['a name over 40 characters', { name: 'x'.repeat(41), color: 'teal' }],
    ['a colour outside the palette', { name: 'x', color: 'blue' }],
    ['a hex colour', { name: 'x', color: '#ff0000' }],
    ['an unknown key', { name: 'x', color: 'teal', orgId: 'org_2' }],
  ])('refuses %s', (_label, body) => {
    expect(createTagSchema.safeParse(body).success).toBe(false);
  });

  it('requires an update to change something', () => {
    expect(updateTagSchema.safeParse({}).success).toBe(false);
    expect(updateTagSchema.safeParse({ color: 'cyan' }).success).toBe(true);
  });
});
