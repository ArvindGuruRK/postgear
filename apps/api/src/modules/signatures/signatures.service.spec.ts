/**
 * The signatures service against a fake repository: 404s for malformed and
 * foreign ids, the cap as a 422, and the schema's cleanup of the text.
 */
import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createSignatureSchema, updateSignatureSchema } from './dto/signatures.schema';
import type { SignaturesRepository } from './signatures.repository';
import { SignaturesService } from './signatures.service';

const ID = '7d1e2f3a-4b5c-4d6e-8f70-112233445566';
const NOW = new Date('2026-10-19T10:00:00Z');

describe('SignaturesService', () => {
  let repository: jest.Mocked<SignaturesRepository>;
  let service: SignaturesService;

  beforeEach(() => {
    repository = {
      list: jest.fn().mockResolvedValue([]),
      findDefault: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn().mockResolvedValue(null),
      softDelete: jest.fn().mockResolvedValue(true),
    } as unknown as jest.Mocked<SignaturesRepository>;
    service = new SignaturesService(repository);
  });

  it('returns the created signature, or refuses past the cap', async () => {
    const signature = { id: ID, content: 'Thanks', autoAdd: true, createdAt: NOW, updatedAt: NOW };
    repository.create.mockResolvedValueOnce({ outcome: 'created', signature });
    await expect(service.create('org_1', { content: 'Thanks', autoAdd: true })).resolves.toEqual(
      signature,
    );

    repository.create.mockResolvedValueOnce({ outcome: 'too_many' });
    await expect(service.create('org_1', { content: 'x', autoAdd: false })).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('treats a malformed or unknown id as not found', async () => {
    await expect(service.update('org_1', 'default', { autoAdd: true })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(repository.update).not.toHaveBeenCalled();

    await expect(service.update('org_1', ID, { autoAdd: true })).rejects.toBeInstanceOf(
      NotFoundException,
    );

    repository.softDelete.mockResolvedValueOnce(false);
    await expect(service.remove('org_1', ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('signature schemas', () => {
  it('keeps line breaks, normalises Windows ones and trims the ends', () => {
    expect(
      createSignatureSchema.parse({ content: '\n  Cheers,\r\nThe Acme team​  \n', autoAdd: false }),
    ).toEqual({ content: 'Cheers,\nThe Acme team', autoAdd: false });
  });

  it.each([
    ['empty text', { content: '   ', autoAdd: false }],
    ['text over 2,000 characters', { content: 'x'.repeat(2_001), autoAdd: false }],
    ['a missing autoAdd', { content: 'x' }],
    ['an unknown key', { content: 'x', autoAdd: false, organizationId: 'org_2' }],
  ])('refuses %s', (_label, body) => {
    expect(createSignatureSchema.safeParse(body).success).toBe(false);
  });

  it('requires an update to change something', () => {
    expect(updateSignatureSchema.safeParse({}).success).toBe(false);
    expect(updateSignatureSchema.safeParse({ autoAdd: true }).success).toBe(true);
  });
});
