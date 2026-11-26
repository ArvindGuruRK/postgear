/**
 * The workspace's own bleep words (Sprint 13, Module 09): the list cleaned
 * (trimmed, lower-case, one of each), its limits refused with a sentence
 * naming them, the body strict, the rows keyed by the workspace, and no word
 * in any log.
 */
import { HttpException, Logger } from '@nestjs/common';
import { Prisma } from '@postgear/db';
import { CLIP_WORD_LIST_MESSAGES } from './clip-word-list.messages';
import { ClipWordListRepository } from './clip-word-list.repository';
import {
  MAX_WORD_CHARS,
  MAX_WORD_LIST_WORDS,
  normaliseWordList,
  putWordListSchema,
} from './clip-word-list.schema';
import { ClipWordListService } from './clip-word-list.service';

const mockWordList = { findUnique: jest.fn(), upsert: jest.fn() };
jest.mock('@postgear/db', () => {
  const actual = jest.requireActual('@postgear/db');
  return {
    ...actual,
    prisma: {
      get clipWordList() {
        return mockWordList;
      },
    },
  };
});

const ORG = 'seed-demo-org';
const OTHER_ORG = 'seed-second-org';
const USER = 'seed-demo-user';

/** A repository over an in-memory table, one row per workspace. */
function memoryRepository() {
  const rows = new Map<string, string[]>();
  const repository = {
    read: jest.fn(async (orgId: string) => rows.get(orgId) ?? null),
    save: jest.fn(async (orgId: string, _userId: string, words: readonly string[]) => {
      rows.set(orgId, [...words]);
      return [...words];
    }),
  };
  return { repository, rows };
}

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof HttpException) {
      return { status: error.getStatus(), body: error.getResponse() as Record<string, unknown> };
    }
    throw error;
  }
  throw new Error('expected a refusal');
}

let logs: string[];
beforeEach(() => {
  logs = [];
  jest.spyOn(Logger.prototype, 'log').mockImplementation((message: unknown) => {
    logs.push(String(message));
  });
});
afterEach(() => jest.restoreAllMocks());

describe('normaliseWordList', () => {
  it('trims, lower-cases, drops blanks and keeps one of each in first place', () => {
    expect(
      normaliseWordList(['  Heck ', 'DARN', '', '   ', 'heck', 'darn', 'Golly\u0007']),
    ).toEqual({ ok: true, words: ['heck', 'darn', 'golly'] });
  });

  it('keeps words in any script, composed', () => {
    const decomposed = 'Café';
    expect(normaliseWordList([decomposed, 'café', 'बकवास'])).toEqual({
      ok: true,
      words: ['café', 'बकवास'],
    });
  });

  it('allows 1 to 40 characters and refuses longer', () => {
    expect(normaliseWordList(['a', 'b'.repeat(MAX_WORD_CHARS)]).ok).toBe(true);
    expect(normaliseWordList(['b'.repeat(MAX_WORD_CHARS + 1)])).toEqual({
      ok: false,
      code: 'word_list_word_too_long',
    });
  });

  it('refuses an entry with a space inside', () => {
    expect(normaliseWordList(['two words'])).toEqual({ ok: false, code: 'word_list_one_word' });
  });

  it('allows 200 different words, counting repeats once, and refuses 201', () => {
    const many = Array.from({ length: MAX_WORD_LIST_WORDS }, (_, n) => `word${n}`);
    expect(normaliseWordList([...many, ...many.map((word) => word.toUpperCase())]).ok).toBe(true);
    expect(normaliseWordList([...many, 'one-more'])).toEqual({
      ok: false,
      code: 'word_list_full',
    });
  });
});

describe('the PUT body', () => {
  it('is a strict object with an array of strings', () => {
    expect(putWordListSchema.safeParse({ words: ['heck'] }).success).toBe(true);
    expect(putWordListSchema.safeParse({ words: [] }).success).toBe(true);
    expect(putWordListSchema.safeParse({ words: ['heck'], language: 'en' }).success).toBe(false);
    expect(putWordListSchema.safeParse({ words: 'heck' }).success).toBe(false);
    expect(putWordListSchema.safeParse({ words: [1] }).success).toBe(false);
    expect(putWordListSchema.safeParse({}).success).toBe(false);
  });
});

describe('ClipWordListService', () => {
  it('reads an empty list before the first save, then the saved one', async () => {
    const { repository } = memoryRepository();
    const service = new ClipWordListService(repository as unknown as ClipWordListRepository);
    expect(await service.read(ORG)).toEqual({ words: [] });
    expect(await service.replace(ORG, USER, [' Heck', 'heck', 'DARN'])).toEqual({
      words: ['heck', 'darn'],
    });
    expect(await service.read(ORG)).toEqual({ words: ['heck', 'darn'] });
    expect(repository.save).toHaveBeenCalledWith(ORG, USER, ['heck', 'darn']);
  });

  it('keeps each workspace list apart', async () => {
    const { repository } = memoryRepository();
    const service = new ClipWordListService(repository as unknown as ClipWordListRepository);
    await service.replace(ORG, USER, ['heck']);
    expect(await service.read(OTHER_ORG)).toEqual({ words: [] });
    await service.replace(OTHER_ORG, USER, ['darn']);
    expect(await service.read(ORG)).toEqual({ words: ['heck'] });
  });

  it('replaces the whole list, and an empty list clears it', async () => {
    const { repository } = memoryRepository();
    const service = new ClipWordListService(repository as unknown as ClipWordListRepository);
    await service.replace(ORG, USER, ['heck', 'darn']);
    expect(await service.replace(ORG, USER, ['golly'])).toEqual({ words: ['golly'] });
    expect(await service.replace(ORG, USER, [])).toEqual({ words: [] });
  });

  it('refuses each limit with 422 and a sentence naming it, saving nothing', async () => {
    const { repository } = memoryRepository();
    const service = new ClipWordListService(repository as unknown as ClipWordListRepository);
    const cases: Array<[string[], string, string]> = [
      [['x'.repeat(41)], 'word_list_word_too_long', 'at most 40 characters'],
      [['two words'], 'word_list_one_word', 'one word'],
      [
        Array.from({ length: MAX_WORD_LIST_WORDS + 1 }, (_, n) => `w${n}`),
        'word_list_full',
        'at most 200 words',
      ],
    ];
    for (const [words, code, phrase] of cases) {
      const answer = await refusal(service.replace(ORG, USER, words));
      expect(answer.status).toBe(422);
      expect(answer.body.code).toBe(code);
      expect(answer.body.message).toBe(
        CLIP_WORD_LIST_MESSAGES[code as keyof typeof CLIP_WORD_LIST_MESSAGES],
      );
      expect(String(answer.body.message)).toContain(phrase);
    }
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('never logs a word', async () => {
    const { repository } = memoryRepository();
    const service = new ClipWordListService(repository as unknown as ClipWordListRepository);
    await service.replace(ORG, USER, ['flibbertigibbet']);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain('"words":1');
    expect(logs.join('\n')).not.toContain('flibbertigibbet');
  });
});

describe('ClipWordListRepository', () => {
  beforeEach(() => {
    mockWordList.findUnique.mockReset();
    mockWordList.upsert.mockReset();
  });

  it('reads by the workspace', async () => {
    mockWordList.findUnique.mockResolvedValueOnce({ words: ['heck'] }).mockResolvedValueOnce(null);
    const repository = new ClipWordListRepository();
    expect(await repository.read(ORG)).toEqual(['heck']);
    expect(await repository.read(OTHER_ORG)).toBeNull();
    expect(mockWordList.findUnique).toHaveBeenNthCalledWith(1, {
      where: { organizationId: ORG },
      select: { words: true },
    });
  });

  it('upserts the one row of the workspace, with who saved it', async () => {
    mockWordList.upsert.mockResolvedValue({ words: ['heck'] });
    expect(await new ClipWordListRepository().save(ORG, USER, ['heck'])).toEqual(['heck']);
    expect(mockWordList.upsert).toHaveBeenCalledWith({
      where: { organizationId: ORG },
      create: { organizationId: ORG, words: ['heck'], updatedById: USER },
      update: { words: ['heck'], updatedById: USER },
      select: { words: true },
    });
  });

  it('retries once when two first saves race', async () => {
    const race = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });
    mockWordList.upsert.mockRejectedValueOnce(race).mockResolvedValueOnce({ words: ['darn'] });
    expect(await new ClipWordListRepository().save(ORG, USER, ['darn'])).toEqual(['darn']);
    expect(mockWordList.upsert).toHaveBeenCalledTimes(2);
  });
});
