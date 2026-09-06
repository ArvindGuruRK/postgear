import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:isPublic';

/**
 * Opts a route out of `JwtAuthGuard`.
 *
 * The guard is registered globally, so **authentication is the default and
 * exemption is explicit**. That ordering matters: with an opt-in guard, a new
 * controller added in a later sprint is unauthenticated until someone
 * remembers to protect it, and forgetting produces no error — just an open
 * endpoint. This way, forgetting produces a 401 in the first manual test.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
