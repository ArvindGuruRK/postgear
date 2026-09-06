import { type ExecutionContext, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';

/**
 * The authenticated user, as attached to the request by `JwtAuthGuard`.
 *
 * Kept deliberately small — id, email, and the two flags the guards need. It
 * is not the full `User` row: handing every handler a fat object invites
 * accidental serialization of fields like `password` into a response.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  isSuperAdmin: boolean;
  onboardingCompletedAt: Date | null;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const request = context.switchToHttp().getRequest<Request & { user: AuthenticatedUser }>();
    return request.user;
  },
);
