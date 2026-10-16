/**
 * API-key lifecycle: list, create, rotate, revoke (Sprint 8, PRD 5.10).
 *
 * ## The secret is shown once
 *
 * `create` and `rotate` are the only methods that ever return a secret, and
 * they return it from the value they just generated — nothing stored can
 * reproduce it. A caller who loses it rotates; there is no "reveal".
 *
 * ## Rotation is revoke + create, atomically
 *
 * A rotated key keeps its name and gets a new secret under a new id. Both
 * ids come back so an integrator's audit trail can link them, and the old
 * one stops working in the same transaction the new one starts, so the
 * workspace never holds two live secrets for one name by accident.
 *
 * ## Why every lifecycle event is logged
 *
 * A key is a credential. Its creation, rotation and revocation go to the
 * security log by id and prefix — never by hash, never by secret — so an
 * investigation can reconstruct who could call the API when.
 */
import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { securityLogger } from '../../../common/logging/security-logger';
import { DEVELOPERS_MESSAGES } from '../developers.messages';
import { generateApiKey } from './api-key.crypto';
import { type ApiKeyRow, ApiKeysRepository } from './api-keys.repository';

/** Live keys per workspace. Past this a workspace is hoarding, not integrating. */
export const MAX_LIVE_API_KEYS = 10;

/** What `/developers/api-keys` returns — mirrored in `apps/web/src/types/developers.ts`. */
export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface ApiKeyCreated {
  key: ApiKeyView;
  /** The full secret. This response is the only place it ever appears. */
  secret: string;
}

export interface ApiKeyRotated extends ApiKeyCreated {
  revokedKeyId: string;
}

@Injectable()
export class ApiKeysService {
  constructor(private readonly repository: ApiKeysRepository) {}

  async list(orgId: string): Promise<ApiKeyView[]> {
    const rows = await this.repository.listForOrg(orgId);

    return rows.map(toView);
  }

  async create(orgId: string, createdById: string | null, name: string): Promise<ApiKeyCreated> {
    const live = await this.repository.countLive(orgId);

    if (live >= MAX_LIVE_API_KEYS) {
      throw new UnprocessableEntityException(DEVELOPERS_MESSAGES.KEY_LIMIT);
    }

    const generated = generateApiKey();
    const row = await this.repository.create({
      orgId,
      name,
      prefix: generated.prefix,
      keyHash: generated.keyHash,
      createdById,
    });

    securityLogger.log('apikey.created', { orgId, keyId: row.id, prefix: row.prefix });

    return { key: toView(row), secret: generated.secret };
  }

  async rotate(orgId: string, createdById: string | null, id: string): Promise<ApiKeyRotated> {
    const existing = await this.repository.findById(orgId, id);

    if (!existing) {
      throw new NotFoundException(DEVELOPERS_MESSAGES.KEY_NOT_FOUND);
    }

    if (existing.revokedAt) {
      throw new UnprocessableEntityException(DEVELOPERS_MESSAGES.KEY_REVOKED);
    }

    const generated = generateApiKey();
    const result = await this.repository.rotate({
      orgId,
      oldId: id,
      name: existing.name,
      prefix: generated.prefix,
      keyHash: generated.keyHash,
      createdById,
      at: new Date(),
    });

    // Revoked between the read above and the transaction — by a colleague,
    // or by a double-click. Either way there is no longer a live key to rotate.
    if (!result) {
      throw new UnprocessableEntityException(DEVELOPERS_MESSAGES.KEY_REVOKED);
    }

    securityLogger.log('apikey.rotated', {
      orgId,
      keyId: result.created.id,
      prefix: result.created.prefix,
      revokedKeyId: result.revoked.id,
    });

    return {
      key: toView(result.created),
      secret: generated.secret,
      revokedKeyId: result.revoked.id,
    };
  }

  /**
   * Revokes a key. Idempotent: revoking a revoked key returns it unchanged
   * and logs nothing, because nothing happened.
   */
  async revoke(orgId: string, id: string): Promise<ApiKeyView> {
    const at = new Date();
    const row = await this.repository.revoke(orgId, id, at);

    if (!row) {
      throw new NotFoundException(DEVELOPERS_MESSAGES.KEY_NOT_FOUND);
    }

    if (row.revokedAt?.getTime() === at.getTime()) {
      securityLogger.log('apikey.revoked', { orgId, keyId: row.id, prefix: row.prefix });
    }

    return toView(row);
  }
}

export function toView(row: ApiKeyRow): ApiKeyView {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}
