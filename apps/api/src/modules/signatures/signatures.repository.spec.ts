/**
 * The one rule signatures have: at most one default per workspace, kept by
 * clearing the others in the same serializable transaction that sets it.
 * Also pinned: reads and deletes are scoped and soft, and the cap.
 */
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');

  return {
    ...actual,
    prisma: {
      signatures: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(),
    },
  };
});

import { Prisma, prisma } from '@postgear/db';
import { SignaturesRepository } from './signatures.repository';

type PrismaMock = {
  signatures: Record<
    'findMany' | 'findFirst' | 'count' | 'create' | 'update' | 'updateMany',
    jest.Mock
  >;
  $transaction: jest.Mock;
};

const db = prisma as unknown as PrismaMock;
const NOW = new Date('2026-10-19T10:00:00Z');

describe('SignaturesRepository', () => {
  let repository: SignaturesRepository;

  beforeEach(() => {
    repository = new SignaturesRepository();
    db.$transaction.mockImplementation(async (work: (tx: unknown) => Promise<unknown>) => work(db));
    db.signatures.count.mockResolvedValue(0);
    db.signatures.updateMany.mockResolvedValue({ count: 0 });
    db.signatures.create.mockImplementation(async ({ data }) => ({
      id: 's-new',
      content: data.content,
      autoAdd: data.autoAdd,
      createdAt: NOW,
      updatedAt: NOW,
    }));
  });

  it('clears every other default when a new one is created, in one serializable transaction', async () => {
    await repository.create('org_1', { content: 'Thanks for reading', autoAdd: true }, 50);

    expect(db.$transaction.mock.calls[0][1]).toEqual({
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
    expect(db.signatures.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org_1', deletedAt: null, autoAdd: true },
      data: { autoAdd: false },
    });
    // Cleared before the new mark is written, so it never clears itself.
    expect(db.signatures.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      db.signatures.create.mock.invocationCallOrder[0],
    );
  });

  it('leaves the existing default alone when the new signature is not one', async () => {
    await repository.create('org_1', { content: 'Cheers', autoAdd: false }, 50);
    expect(db.signatures.updateMany).not.toHaveBeenCalled();
  });

  it('marks an existing signature as the default, clearing the rest but not itself', async () => {
    db.signatures.findFirst.mockResolvedValueOnce({ id: 's-2' });
    db.signatures.update.mockResolvedValue({
      id: 's-2',
      content: 'x',
      autoAdd: true,
      createdAt: NOW,
      updatedAt: NOW,
    });

    await expect(repository.update('org_1', 's-2', { autoAdd: true })).resolves.toMatchObject({
      autoAdd: true,
    });
    expect(db.signatures.updateMany).toHaveBeenCalledWith({
      where: { organizationId: 'org_1', deletedAt: null, autoAdd: true, id: { not: 's-2' } },
      data: { autoAdd: false },
    });
  });

  it('does not touch the others when only the text changes or the mark is removed', async () => {
    db.signatures.findFirst.mockResolvedValue({ id: 's-2' });
    db.signatures.update.mockResolvedValue({ id: 's-2' });

    await repository.update('org_1', 's-2', { content: 'New text' });
    await repository.update('org_1', 's-2', { autoAdd: false });

    expect(db.signatures.updateMany).not.toHaveBeenCalled();
  });

  it('answers null for a signature of another workspace or a deleted one', async () => {
    db.signatures.findFirst.mockResolvedValueOnce(null);

    await expect(repository.update('org_1', 's-9', { content: 'x' })).resolves.toBeNull();
    expect(db.signatures.findFirst.mock.calls[0][0].where).toEqual({
      id: 's-9',
      organizationId: 'org_1',
      deletedAt: null,
    });
    expect(db.signatures.update).not.toHaveBeenCalled();
  });

  it('stops at the cap', async () => {
    db.signatures.count.mockResolvedValueOnce(50);
    await expect(repository.create('org_1', { content: 'x', autoAdd: false }, 50)).resolves.toEqual(
      {
        outcome: 'too_many',
      },
    );
  });

  it('reads the default from live signatures of the workspace only', async () => {
    db.signatures.findFirst.mockResolvedValueOnce(null);

    await expect(repository.findDefault('org_1')).resolves.toBeNull();
    expect(db.signatures.findFirst.mock.calls[0][0].where).toEqual({
      organizationId: 'org_1',
      deletedAt: null,
      autoAdd: true,
    });
  });

  it('soft-deletes and drops the mark with it', async () => {
    db.signatures.updateMany.mockResolvedValueOnce({ count: 1 });

    await expect(repository.softDelete('org_1', 's-1')).resolves.toBe(true);
    expect(db.signatures.updateMany).toHaveBeenCalledWith({
      where: { id: 's-1', organizationId: 'org_1', deletedAt: null },
      data: { deletedAt: expect.any(Date), autoAdd: false },
    });
  });
});
