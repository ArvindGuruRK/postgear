/**
 * The AI gateway routes' shape: public to user sessions but behind the
 * internal token, strict bodies, and a hang-up that aborts the model call.
 */
import { EventEmitter } from 'node:events';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../../../common/decorators/public.decorator';
import { abortOnHangUp, GatewayAiController } from './gateway-ai.controller';
import {
  gatewayAiHashtagsSchema,
  gatewayAiImageSchema,
  gatewayAiRewriteSchema,
  gatewayAiTextSchema,
} from './gateway-ai.schema';
import { InternalTokenGuard } from './internal-token.guard';

const bound = {
  runId: '22222222-2222-4222-8222-222222222222',
  nodeKey: 'write',
  organizationId: '11111111-1111-4111-8111-111111111111',
};

describe('GatewayAiController', () => {
  it('skips the session guard and requires the internal token', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, GatewayAiController)).toBe(true);
    expect(Reflect.getMetadata(GUARDS_METADATA, GatewayAiController)).toEqual([InternalTokenGuard]);
  });

  it('accepts each step’s filled-in settings and nothing else', () => {
    const text = {
      ...bound,
      prompt: 'Weekly bread news',
      platform: 'linkedin',
      voice: 'personal',
      format: 'thread_short',
      research: true,
      withImage: false,
    };
    expect(gatewayAiTextSchema.safeParse(text).success).toBe(true);
    expect(gatewayAiTextSchema.safeParse({ ...text, extra: 1 }).success).toBe(false);
    expect(gatewayAiTextSchema.safeParse({ ...text, prompt: '   ' }).success).toBe(false);
    expect(
      gatewayAiImageSchema.safeParse({ ...bound, prompt: 'Bread', style: 'flat' }).success,
    ).toBe(true);
    expect(
      gatewayAiImageSchema.safeParse({ ...bound, prompt: 'Bread', style: 'oil' }).success,
    ).toBe(false);
    expect(
      gatewayAiHashtagsSchema.safeParse({ ...bound, text: 'Bread', platform: 'x', count: 16 })
        .success,
    ).toBe(false);
    expect(
      gatewayAiRewriteSchema.safeParse({ ...bound, text: 'Bread', platform: 'x', voice: 'company' })
        .success,
    ).toBe(true);
    expect(
      gatewayAiRewriteSchema.safeParse({ text: 'Bread', platform: 'x', voice: 'company' }).success,
    ).toBe(false);
  });

  it('aborts the call when the worker hangs up, not after a normal answer', () => {
    const hungUp = Object.assign(new EventEmitter(), { writableFinished: false });
    const signal = abortOnHangUp(hungUp as never);
    hungUp.emit('close');
    expect(signal.aborted).toBe(true);

    const answered = Object.assign(new EventEmitter(), { writableFinished: true });
    const kept = abortOnHangUp(answered as never);
    answered.emit('close');
    expect(kept.aborted).toBe(false);
  });
});
