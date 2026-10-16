/**
 * Zod validation for `/v1`, with a message an integrator can act on.
 *
 * The house pipes (`ZodBody`, `ZodQuery`) answer every failure with the
 * bare "Invalid input", naming no field, because on an *auth* form the field
 * is itself an oracle. A `/v1` caller is already authenticated, acting in
 * their own workspace, and reading the error in a terminal — for them
 * "channelIds: Array must contain at least 1 element(s)" is the difference
 * between a fixed integration and a support ticket. So this pipe names the
 * first failing path and its message. The full issue list still goes to the
 * security log, exactly as the house pipes write it.
 */
import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';
import { securityLogger } from '../../../../common/logging/security-logger';
import { DEVELOPERS_MESSAGES } from '../../developers.messages';

class PublicZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(
    private readonly schema: ZodSchema<T>,
    private readonly label: string,
    private readonly source: 'body' | 'query',
  ) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);

    if (result.success) {
      return result.data;
    }

    securityLogger.warn('validation.failed', {
      route: this.label,
      source: this.source,
      issues: result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        code: issue.code,
        message: issue.message,
      })),
    });

    const [first] = result.error.issues;
    const path = first?.path.join('.');

    throw new BadRequestException(
      first && path ? `${path}: ${first.message}` : (first?.message ?? DEVELOPERS_MESSAGES.INVALID_INPUT),
    );
  }
}

export class PublicZodBody<T> extends PublicZodPipe<T> {
  constructor(schema: ZodSchema<T>, label: string) {
    super(schema, label, 'body');
  }
}

export class PublicZodQuery<T> extends PublicZodPipe<T> {
  constructor(schema: ZodSchema<T>, label: string) {
    super(schema, label, 'query');
  }
}
