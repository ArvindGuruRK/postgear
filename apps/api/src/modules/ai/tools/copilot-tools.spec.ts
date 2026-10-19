/**
 * The copilot's tools against fakes: what each one charges, what it returns,
 * what it refuses, and that a refusal is a thrown message rather than a
 * provider error or a silent success.
 */
import { renderPlainText } from '@postgear/social-core';
import type { ChannelView } from '../../channels/channels.service';
import type { CreatePostInput } from '../../posts/dto/posts.schema';
import { AI_MESSAGES } from '../ai.messages';
import type { CreditContext } from '../credits/credits.service';
import type { AiEngine } from '../engine/engine.types';
import { type CopilotToolDeps, createCopilotTools, listNames, nextFullHour } from './copilot-tools';

const RESETS_AT = new Date('2026-11-13T00:00:00Z');

function channel(overrides: Partial<ChannelView>): ChannelView {
  return {
    id: 'ch_li',
    internalId: 'acct',
    rootInternalId: 'acct',
    providerIdentifier: 'linkedin',
    name: 'Acme Marketing',
    profile: 'acme-marketing',
    picture: null,
    disabled: false,
    refreshNeeded: false,
    inBetweenSteps: false,
    tokenExpiration: null,
    postingTimes: [],
    additionalSettings: {},
    createdAt: new Date(),
    health: 'connected',
    providerName: 'LinkedIn',
    color: 0,
    ...overrides,
  };
}

const credits = (used: number) => ({
  allowance: 100,
  used,
  remaining: 100 - used,
  resetsAt: RESETS_AT.toISOString(),
  tier: 'STANDARD' as const,
  low: false,
  costs: { generate_post: 5, generate_image: 10, copilot_message: 1, seo_advice: 3 },
});

const result = {
  tone: 'personal' as const,
  format: 'one_short' as const,
  category: 'Announcement',
  hook: 'Calendars just got a drag handle.',
  parts: [
    {
      text: 'Calendars just got a drag handle.\nMove a post, change its day.',
      imagePrompt: null,
      image: null,
    },
  ],
  sources: [],
  researched: false,
};

describe('copilot tools', () => {
  let deps: CopilotToolDeps;
  let pipeline: { generate: jest.Mock };
  let tools: ReturnType<typeof createCopilotTools>;

  const tool = (name: string) => {
    const found = tools.find((entry) => entry.name === name);
    if (!found) {
      throw new Error(`no tool ${name}`);
    }
    return found as unknown as {
      readOnly: boolean;
      inputSchema: { safeParse(value: unknown): { success: boolean } };
      execute(input: unknown, context: { signal?: AbortSignal }): Promise<unknown>;
    };
  };

  beforeEach(() => {
    pipeline = { generate: jest.fn().mockResolvedValue(result) };
    const engine: Pick<AiEngine, 'createPipeline' | 'generateImage'> = {
      createPipeline: jest.fn().mockReturnValue(pipeline),
      generateImage: jest.fn().mockResolvedValue({
        mediaId: 'm1',
        url: 'http://localhost:3001/uploads/a.jpg',
        thumbnailUrl: 'http://localhost:3001/uploads/a.thumb.webp',
        revisedPrompt: 'A sunrise, redrawn',
      }),
    };
    const creditContext: CreditContext = {
      workspaceName: 'PostGear Demo Org',
      tier: 'STANDARD',
      allowance: 100,
      cycleStart: new Date('2026-10-13T00:00:00Z'),
      resetsAt: RESETS_AT,
    };

    deps = {
      orgId: 'org_1',
      workspaceName: 'PostGear Demo Org',
      engine,
      credits: {
        tryCharge: jest.fn().mockResolvedValue({ ok: true, credits: credits(28) }),
        refund: jest.fn().mockResolvedValue(undefined),
      },
      creditContext,
      channels: {
        list: jest.fn().mockResolvedValue([
          channel({}),
          channel({
            id: 'ch_x',
            name: 'Acme on X',
            providerIdentifier: 'x',
            providerName: 'X',
            health: 'needs_reconnect',
          }),
        ]),
      },
      posts: {
        create: jest.fn().mockResolvedValue({ group: '0b8f3f3e-8a1f-4c55-9a55-2f1f5d1c9e11' }),
      },
    };
    tools = createCopilotTools(deps);
  });

  it('exposes exactly the four tools the web knows, with strict input schemas', () => {
    expect(tools.map((entry) => entry.name)).toEqual([
      'list_channels',
      'generate_post',
      'draft_post',
      'generate_image',
    ]);
    expect(tool('list_channels').readOnly).toBe(true);
    expect(tool('draft_post').readOnly).toBe(false);
    expect(tool('generate_post').inputSchema.safeParse({ topic: 'abc', extra: 1 }).success).toBe(
      false,
    );
    expect(tool('generate_image').inputSchema.safeParse({ prompt: 'ab' }).success).toBe(false);
  });

  describe('list_channels', () => {
    it('lists the workspace’s channels with platform names and health, and charges nothing', async () => {
      const output = await tool('list_channels').execute({}, {});

      expect(output).toEqual({
        channels: [
          {
            id: 'ch_li',
            name: 'Acme Marketing',
            platform: 'LinkedIn',
            providerIdentifier: 'linkedin',
            health: 'connected',
            profile: 'acme-marketing',
          },
          {
            id: 'ch_x',
            name: 'Acme on X',
            platform: 'X',
            providerIdentifier: 'x',
            health: 'needs_reconnect',
            profile: 'acme-marketing',
          },
        ],
        summary: 'Found 2 channels',
      });
      expect(deps.channels.list).toHaveBeenCalledWith('org_1');
      expect(deps.credits.tryCharge).not.toHaveBeenCalled();
    });
  });

  describe('generate_post', () => {
    it('charges before running the pipeline in the workspace’s voice, and summarises the format', async () => {
      const controller = new AbortController();

      const output = await tool('generate_post').execute(
        { topic: 'Our new calendar', tone: 'company', format: 'thread_short', withImage: true },
        { signal: controller.signal },
      );

      expect(deps.credits.tryCharge).toHaveBeenCalledWith(
        'org_1',
        'generate_post',
        15,
        deps.creditContext,
      );
      expect((deps.credits.tryCharge as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
        pipeline.generate.mock.invocationCallOrder[0],
      );
      expect(pipeline.generate).toHaveBeenCalledWith(
        {
          topic: 'Our new calendar',
          tone: 'company',
          format: 'thread_short',
          withImage: true,
          maxCharacters: null,
          platforms: [],
          workspaceName: 'PostGear Demo Org',
        },
        expect.objectContaining({ signal: controller.signal }),
      );
      expect(output).toEqual({ ...result, summary: 'Wrote a short thread' });
      expect(deps.credits.refund).not.toHaveBeenCalled();
    });

    it('defaults to a personal short post', async () => {
      await tool('generate_post').execute({ topic: 'Our new calendar' }, {});

      expect(deps.credits.tryCharge).toHaveBeenCalledWith(
        'org_1',
        'generate_post',
        5,
        deps.creditContext,
      );
      expect(pipeline.generate.mock.calls[0][0]).toMatchObject({
        tone: 'personal',
        format: 'one_short',
        withImage: false,
      });
    });

    it('refuses with the out-of-credits message and never runs the pipeline when the cycle is spent', async () => {
      (deps.credits.tryCharge as jest.Mock).mockResolvedValue({ ok: false, credits: credits(97) });

      await expect(
        tool('generate_post').execute({ topic: 'Our new calendar' }, {}),
      ).rejects.toThrow(AI_MESSAGES.outOfCredits(RESETS_AT));
      expect(pipeline.generate).not.toHaveBeenCalled();
    });

    it('refunds the whole charge when the pipeline fails, and hides the provider’s words', async () => {
      pipeline.generate.mockRejectedValue(
        Object.assign(new Error('429 from api.openai.com: key sk-live-1 over quota'), {
          name: 'AiProviderError',
          kind: 'rate_limited',
          retryable: true,
        }),
      );

      const attempt = tool('generate_post').execute(
        { topic: 'Our new calendar', withImage: true },
        {},
      );

      await expect(attempt).rejects.toThrow(AI_MESSAGES.RATE_LIMITED);
      await expect(attempt).rejects.not.toThrow('sk-live');
      expect(deps.credits.refund).toHaveBeenCalledWith('org_1', 'generate_post', 15);
    });

    it('refunds only the image share when just the image stage fails', async () => {
      pipeline.generate.mockImplementation(async (_request, options) => {
        options.onEvent({ type: 'stage', stage: 'image', status: 'failed', detail: 'boom' });
        return result;
      });

      await tool('generate_post').execute({ topic: 'Our new calendar', withImage: true }, {});

      expect(deps.credits.refund).toHaveBeenCalledTimes(1);
      expect(deps.credits.refund).toHaveBeenCalledWith('org_1', 'generate_image', 10);
    });
  });

  describe('draft_post', () => {
    it('creates a draft at the next full hour with one document per part and media on the first', async () => {
      const output = await tool('draft_post').execute(
        {
          channelIds: ['ch_li', 'ch_x'],
          parts: ['First line\nsecond line', 'Part two'],
          mediaIds: ['m1'],
        },
        {},
      );

      const input = (deps.posts.create as jest.Mock).mock.calls[0][1] as CreatePostInput;
      expect((deps.posts.create as jest.Mock).mock.calls[0][0]).toBe('org_1');
      expect(input.state).toBe('DRAFT');
      expect(new Date(input.publishDate).getUTCMinutes()).toBe(0);
      expect(new Date(input.publishDate).getTime()).toBeGreaterThan(Date.now());
      expect(input.shared).toHaveLength(2);
      expect(renderPlainText(input.shared[0].content)).toBe('First line\nsecond line');
      expect(input.shared[0].media).toEqual([{ id: 'm1' }]);
      expect(input.shared[1].media).toEqual([]);
      expect(input.channels).toEqual([
        { channelId: 'ch_li', customized: false },
        { channelId: 'ch_x', customized: false },
      ]);
      expect(output).toEqual({
        group: '0b8f3f3e-8a1f-4c55-9a55-2f1f5d1c9e11',
        channelNames: ['Acme Marketing', 'Acme on X'],
        parts: 2,
        summary: 'Drafted a post for Acme Marketing and Acme on X',
      });
      expect(deps.credits.tryCharge).not.toHaveBeenCalled();
    });

    it('refuses a channel that is not in this workspace before writing anything', async () => {
      await expect(
        tool('draft_post').execute({ channelIds: ['ch_li', 'other-org'], parts: ['Hi'] }, {}),
      ).rejects.toThrow(AI_MESSAGES.CHANNEL_UNAVAILABLE);
      expect(deps.posts.create).not.toHaveBeenCalled();
    });

    it('passes the posts service’s own refusal through, worded as it was', async () => {
      const { BadRequestException } = await import('@nestjs/common');
      (deps.posts.create as jest.Mock).mockRejectedValue(
        new BadRequestException('An attachment is no longer in the media library.'),
      );

      await expect(
        tool('draft_post').execute(
          { channelIds: ['ch_li'], parts: ['Hi'], mediaIds: ['gone'] },
          {},
        ),
      ).rejects.toThrow('An attachment is no longer in the media library.');
    });
  });

  describe('generate_image', () => {
    it('charges ten credits, saves through the engine and returns the library item', async () => {
      const output = await tool('generate_image').execute({ prompt: 'A sunrise' }, {});

      expect(deps.credits.tryCharge).toHaveBeenCalledWith(
        'org_1',
        'generate_image',
        10,
        deps.creditContext,
      );
      expect(deps.engine.generateImage).toHaveBeenCalledWith(
        { orgId: 'org_1' },
        'A sunrise',
        expect.any(Object),
      );
      expect(output).toEqual({
        mediaId: 'm1',
        url: 'http://localhost:3001/uploads/a.jpg',
        thumbnailUrl: 'http://localhost:3001/uploads/a.thumb.webp',
        prompt: 'A sunrise',
        summary: 'Generated an image',
      });
    });

    it('refuses when out of credits, and refunds when the generator fails', async () => {
      (deps.credits.tryCharge as jest.Mock).mockResolvedValueOnce({
        ok: false,
        credits: credits(95),
      });
      await expect(tool('generate_image').execute({ prompt: 'A sunrise' }, {})).rejects.toThrow(
        "You've used this cycle's AI credits",
      );
      expect(deps.engine.generateImage).not.toHaveBeenCalled();

      (deps.engine.generateImage as jest.Mock).mockRejectedValue(new Error('socket hang up'));
      await expect(tool('generate_image').execute({ prompt: 'A sunrise' }, {})).rejects.toThrow(
        AI_MESSAGES.UNEXPECTED,
      );
      expect(deps.credits.refund).toHaveBeenCalledWith('org_1', 'generate_image', 10);
    });
  });
});

describe('helpers', () => {
  it('parks a draft at the top of the next hour', () => {
    expect(nextFullHour(new Date('2026-10-14T09:12:45.678Z')).toISOString()).toBe(
      '2026-10-14T10:00:00.000Z',
    );
    expect(nextFullHour(new Date('2026-10-14T23:00:00.000Z')).toISOString()).toBe(
      '2026-10-15T00:00:00.000Z',
    );
  });

  it('lists names the way a sentence would', () => {
    expect(listNames([])).toBe('');
    expect(listNames(['A'])).toBe('A');
    expect(listNames(['A', 'B'])).toBe('A and B');
    expect(listNames(['A', 'B', 'C'])).toBe('A, B and C');
  });
});
