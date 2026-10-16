/**
 * Authenticates a `/v1` request by API key (Sprint 8).
 *
 * The session guards (`JwtAuthGuard`, `RolesGuard`) never run on `/v1`:
 * `@ApiKeyAuth()` marks the route `@Public()` for them and applies this
 * guard in their place. The two worlds do not mix — a session cookie on a
 * `/v1` call is ignored, and an API key on a session route is not a session.
 *
 * ## What a key resolves to
 *
 * A key belongs to a workspace, not a person, and it may do what an admin
 * may do there. So on success the guard sets `request.activeOrg` to
 * `{ id, role: ADMIN }` — the shape `RolesGuard` would have produced — which
 * is what lets the `/v1` controllers hand `@CurrentOrg()` straight to the
 * same services the session routes use, with no second code path.
 *
 * ## One failure message
 *
 * Missing, malformed, unknown and revoked all answer 401 `Invalid API key`.
 * Distinguishing them would tell a caller guessing keys when a guess has the
 * right shape, or when a real key used to exist. The distinction goes to the
 * security log instead, with the prefix when there is a plausible one.
 *
 * ## `lastUsedAt`, at most once a minute
 *
 * The page shows when a key was last used so a stale one can be spotted and
 * revoked. Writing on every request would turn a read-heavy API into a
 * write-per-call; a minute's resolution is what the page needs. The guard
 * remembers its own last write per key and skips the query inside the
 * window; the repository's `where` repeats the condition so several API
 * instances still produce one write between them. The write is
 * fire-and-forget: a slow or failed timestamp never delays or fails a call.
 */
import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Role } from '@postgear/db';
import type { Request } from 'express';
import type { ActiveOrg } from '../../../common/decorators/current-org.decorator';
import { securityLogger } from '../../../common/logging/security-logger';
import { hashApiKey, looksLikeApiKey, visiblePrefix } from '../api-keys/api-key.crypto';
import { ApiKeysRepository } from '../api-keys/api-keys.repository';
import { DEVELOPERS_MESSAGES } from '../developers.messages';

/** What a `/v1` handler may know about the key that called it. Never the secret. */
export interface ApiKeyPrincipal {
  id: string;
  name: string;
  prefix: string;
  organizationId: string;
}

export type ApiKeyRequest = Request & { activeOrg?: ActiveOrg; apiKey?: ApiKeyPrincipal };

/** How often `lastUsedAt` may be written per key. */
export const LAST_USED_WRITE_INTERVAL_MS = 60_000;

/** Past this many remembered keys the memo is cleared rather than grown. */
const TOUCH_MEMO_LIMIT = 10_000;

const API_KEY_HEADER = 'x-api-key';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger('ApiKeyGuard');

  /** Key id → when this instance last wrote `lastUsedAt` for it. */
  private readonly lastTouched = new Map<string, number>();

  constructor(private readonly repository: ApiKeysRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApiKeyRequest>();
    const route = `${request.method} ${request.path}`;
    const presented = extractSecret(request);

    if (presented === null) {
      securityLogger.warn('apikey.rejected', { reason: 'missing', route });
      throw new UnauthorizedException(DEVELOPERS_MESSAGES.INVALID_API_KEY);
    }

    if (!looksLikeApiKey(presented)) {
      // Not even key-shaped: a session JWT sent to the wrong API, or noise.
      // No prefix is logged, because there is no prefix — slicing eleven
      // characters off an arbitrary string would put part of some other
      // credential in the log.
      securityLogger.warn('apikey.rejected', { reason: 'malformed', route });
      throw new UnauthorizedException(DEVELOPERS_MESSAGES.INVALID_API_KEY);
    }

    const key = await this.repository.findByHash(hashApiKey(presented));

    if (!key) {
      securityLogger.warn('apikey.rejected', {
        reason: 'unknown',
        prefix: visiblePrefix(presented),
        route,
      });
      throw new UnauthorizedException(DEVELOPERS_MESSAGES.INVALID_API_KEY);
    }

    if (key.revokedAt) {
      securityLogger.warn('apikey.rejected', {
        reason: 'revoked',
        keyId: key.id,
        prefix: key.prefix,
        orgId: key.organizationId,
        route,
      });
      throw new UnauthorizedException(DEVELOPERS_MESSAGES.INVALID_API_KEY);
    }

    request.activeOrg = { id: key.organizationId, role: Role.ADMIN };
    request.apiKey = {
      id: key.id,
      name: key.name,
      prefix: key.prefix,
      organizationId: key.organizationId,
    };

    this.touch(key.id);

    return true;
  }

  private touch(keyId: string): void {
    const now = Date.now();
    const last = this.lastTouched.get(keyId) ?? 0;

    if (now - last < LAST_USED_WRITE_INTERVAL_MS) {
      return;
    }

    if (this.lastTouched.size >= TOUCH_MEMO_LIMIT) {
      this.lastTouched.clear();
    }

    this.lastTouched.set(keyId, now);

    void this.repository
      .touchLastUsed(keyId, new Date(now), new Date(now - LAST_USED_WRITE_INTERVAL_MS))
      .catch((error: unknown) => {
        // The call has already been authorised; a timestamp that did not
        // land is a log line, not a failure the caller should see.
        this.logger.warn(
          `Could not record lastUsedAt for key ${keyId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      });
  }
}

/**
 * `Authorization: Bearer <secret>` first, then `X-API-Key: <secret>`. The
 * bearer form is what every HTTP client library already knows how to send;
 * the header form exists for tools that reserve `Authorization` for
 * something else.
 */
function extractSecret(request: Request): string | null {
  const authorization = request.headers.authorization;

  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    const value = authorization.slice('Bearer '.length).trim();
    return value.length > 0 ? value : null;
  }

  const header = request.headers[API_KEY_HEADER];
  const value = Array.isArray(header) ? header[0] : header;

  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  return null;
}
