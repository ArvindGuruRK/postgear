/**
 * Connections (Sprint 10, Module 04): outside apps linked to a workspace
 * once and picked by any workflow.
 *
 * - **Credentials go one way.** A pasted value is judged by its app
 *   (`providers/`), stored through `encrypt()`, and from then on only Check
 *   Connection and the steps that send (Modules 12 and 13) decrypt it. Every
 *   response is built by `toSafeConnection`, which has no credentials to
 *   leak: the rows it reads never select them.
 * - **A check never makes a connection look better than it is.** An
 *   incoming webhook can only be proven by sending a message, so its check
 *   re-judges the stored link and can only mark it broken; it never stamps
 *   `lastCheckedAt` (that means a real check: a Google read, or a real send
 *   in Module 12).
 * - **Delete is refused while a running workflow uses the connection**,
 *   naming them. Drafts that use it simply get a validation issue.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type ConnectionKind, connectionKindInfo } from '@postgear/automation';
import { decrypt, encrypt } from '@postgear/db';
import type { Env } from '../../../config/env';
import { AutomationContextService, type ConnectionUsage } from '../automation-context.service';
import { CONNECTION_MESSAGES } from './connections.messages';
import { type ConnectionRow, ConnectionsRepository } from './connections.repository';
import {
  type CreateConnectionInput,
  MAX_CONNECTIONS_PER_WORKSPACE,
  type UpdateConnectionInput,
} from './dto/connections.schema';
import { type ConnectionProvider, type JudgeOptions, providerFor } from './providers';

export interface SafeConnection {
  id: string;
  provider: string;
  name: string;
  status: ConnectionRow['status'];
  maskedHint: string;
  meta: Record<string, unknown> | null;
  lastCheckedAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  /** Workflows naming it, in their draft or their running version. */
  usedBy: { id: string; name: string; live: boolean }[];
}

export interface CheckResult {
  connection: SafeConnection;
  /** What the check did, in a sentence ("Saved, not checked. ..."). */
  message: string;
}

/** What an OAuth plug-in hands back after the code exchange. */
export interface OAuthGrant {
  credentials: unknown;
  meta: Record<string, unknown> | null;
  /** A name to start with, such as the Google account's email. */
  name: string;
}

export function toSafeConnection(row: ConnectionRow, usage?: ConnectionUsage): SafeConnection {
  const live = new Set(usage?.live.map((ref) => ref.id));
  const usedBy = new Map<string, SafeConnection['usedBy'][number]>();
  for (const ref of [...(usage?.live ?? []), ...(usage?.draft ?? [])]) {
    if (!usedBy.has(ref.id))
      usedBy.set(ref.id, { id: ref.id, name: ref.name, live: live.has(ref.id) });
  }
  return {
    id: row.id,
    provider: row.provider,
    name: row.name,
    status: row.status,
    maskedHint: row.maskedHint,
    meta: isRecord(row.meta) ? row.meta : null,
    lastCheckedAt: row.lastCheckedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    usedBy: [...usedBy.values()],
  };
}

@Injectable()
export class ConnectionsService {
  private readonly judgeOptions: JudgeOptions;

  constructor(
    private readonly repository: ConnectionsRepository,
    private readonly context: AutomationContextService,
    config: ConfigService<Env, true>,
  ) {
    this.judgeOptions = {
      allowPrivate: config.get('WEBHOOK_ALLOW_PRIVATE_URLS', { infer: true }) === 'true',
    };
  }

  async list(orgId: string): Promise<SafeConnection[]> {
    const [rows, usage] = await Promise.all([
      this.repository.list(orgId),
      this.context.connectionUsage(orgId),
    ]);
    return rows.map((row) => toSafeConnection(row, usage[row.id]));
  }

  async create(
    orgId: string,
    userId: string,
    input: CreateConnectionInput,
  ): Promise<SafeConnection> {
    const provider = this.provider(input.provider);
    if (!provider.formEntry) {
      throw new BadRequestException(CONNECTION_MESSAGES.OAUTH_ONLY(this.title(provider.kind)));
    }
    const credentials = await this.judge(provider, input.credentials);
    return this.insert(orgId, userId, provider, input.name, credentials, null);
  }

  /** The OAuth callback's save: a new connection, or new tokens for an existing one. */
  async saveGrant(
    orgId: string,
    userId: string,
    kind: ConnectionKind,
    grant: OAuthGrant,
    connectionId?: string,
  ): Promise<SafeConnection> {
    const provider = this.provider(kind);
    const credentials = await this.judge(provider, grant.credentials);
    if (!connectionId) {
      return this.insert(
        orgId,
        userId,
        provider,
        await this.freeName(orgId, kind, grant.name),
        credentials,
        grant.meta,
      );
    }
    const existing = await this.repository.find(orgId, connectionId);
    if (!existing || existing.provider !== kind)
      throw new NotFoundException(CONNECTION_MESSAGES.NOT_FOUND);
    return this.replaceCredentials(orgId, userId, existing, provider, credentials, grant.meta);
  }

  async update(
    orgId: string,
    userId: string,
    id: string,
    input: UpdateConnectionInput,
  ): Promise<SafeConnection> {
    if (input.name === undefined && input.credentials === undefined) {
      throw new BadRequestException(CONNECTION_MESSAGES.NOTHING_TO_CHANGE);
    }
    const existing = await this.found(orgId, id);
    const provider = this.provider(existing.provider);

    if (input.name !== undefined && input.name.toLowerCase() !== existing.name.toLowerCase()) {
      await this.assertNameFree(orgId, provider.kind, input.name, id);
    }

    if (input.credentials !== undefined) {
      if (!provider.formEntry) {
        throw new BadRequestException(CONNECTION_MESSAGES.OAUTH_ONLY(this.title(provider.kind)));
      }
      const credentials = await this.judge(provider, input.credentials);
      return this.replaceCredentials(
        orgId,
        userId,
        existing,
        provider,
        credentials,
        undefined,
        input.name,
      );
    }

    const updated = await this.repository.update(orgId, id, userId, { name: input.name });
    return this.withUsage(orgId, this.ensure(updated));
  }

  async remove(orgId: string, id: string): Promise<void> {
    await this.found(orgId, id);
    const usage = (await this.context.connectionUsage(orgId))[id];
    if (usage && usage.live.length > 0) {
      throw new ConflictException({
        message: CONNECTION_MESSAGES.IN_USE(usage.live.map((ref) => ref.name).join(', ')),
        code: 'connection_in_use',
      });
    }
    if (!(await this.repository.softDelete(orgId, id))) {
      throw new NotFoundException(CONNECTION_MESSAGES.NOT_FOUND);
    }
  }

  async check(orgId: string, userId: string, id: string): Promise<CheckResult> {
    const row = await this.repository.findWithCredentials(orgId, id);
    if (!row) throw new NotFoundException(CONNECTION_MESSAGES.NOT_FOUND);
    const provider = this.provider(row.provider);
    const app = this.title(provider.kind);

    let stored: unknown;
    try {
      stored = JSON.parse(decrypt(row.credentials));
    } catch {
      return this.recordFailure(orgId, userId, id, CONNECTION_MESSAGES.UNREADABLE);
    }

    const verdict = await provider.judge(stored, this.judgeOptions);
    if (!verdict.ok) return this.recordFailure(orgId, userId, id, verdict.message);

    const message =
      provider.check === 'send'
        ? CONNECTION_MESSAGES.CHECK_SEND(app)
        : provider.check === 'none'
          ? CONNECTION_MESSAGES.CHECK_NONE
          : CONNECTION_MESSAGES.CHECK_LATER(app);
    const { credentials: _secret, ...safe } = row;
    return { connection: await this.withUsage(orgId, safe), message };
  }

  private async recordFailure(orgId: string, userId: string, id: string, message: string) {
    const updated = await this.repository.update(orgId, id, userId, {
      status: 'ERROR',
      lastError: message,
    });
    return { connection: await this.withUsage(orgId, this.ensure(updated)), message };
  }

  private async insert(
    orgId: string,
    userId: string,
    provider: ConnectionProvider,
    name: string,
    credentials: unknown,
    meta: Record<string, unknown> | null,
  ): Promise<SafeConnection> {
    await this.assertNameFree(orgId, provider.kind, name);
    if ((await this.repository.count(orgId)) >= MAX_CONNECTIONS_PER_WORKSPACE) {
      throw new BadRequestException(CONNECTION_MESSAGES.LIMIT(MAX_CONNECTIONS_PER_WORKSPACE));
    }
    const created = await this.repository.create({
      organizationId: orgId,
      provider: provider.kind,
      name,
      credentials: encrypt(JSON.stringify(credentials)),
      maskedHint: provider.mask(credentials, meta),
      meta,
      createdById: userId,
    });
    return toSafeConnection(created);
  }

  /** Reconnect: new credentials, a fresh mask, and a clean slate. */
  private async replaceCredentials(
    orgId: string,
    userId: string,
    existing: ConnectionRow,
    provider: ConnectionProvider,
    credentials: unknown,
    meta: Record<string, unknown> | null | undefined,
    name?: string,
  ): Promise<SafeConnection> {
    const keptMeta = meta !== undefined ? meta : isRecord(existing.meta) ? existing.meta : null;
    const updated = await this.repository.update(orgId, existing.id, userId, {
      name,
      credentials: encrypt(JSON.stringify(credentials)),
      maskedHint: provider.mask(credentials, keptMeta),
      meta,
      status: 'CONNECTED',
      lastError: null,
      lastCheckedAt: null,
    });
    return this.withUsage(orgId, this.ensure(updated));
  }

  private async judge(provider: ConnectionProvider, input: unknown): Promise<unknown> {
    const verdict = await provider.judge(input, this.judgeOptions);
    if (!verdict.ok) throw new BadRequestException(verdict.message);
    return verdict.credentials;
  }

  private async assertNameFree(
    orgId: string,
    kind: ConnectionKind,
    name: string,
    exceptId?: string,
  ) {
    if (await this.repository.nameTaken(orgId, kind, name, exceptId)) {
      throw new ConflictException(CONNECTION_MESSAGES.NAME_TAKEN(this.title(kind), name));
    }
  }

  /** "Google", then "Google 2", ...: an OAuth grant never fails on a name clash. */
  private async freeName(orgId: string, kind: ConnectionKind, wanted: string): Promise<string> {
    const base = wanted.trim().slice(0, 50) || this.title(kind);
    for (let n = 1; n < 100; n += 1) {
      const name = n === 1 ? base : `${base} ${n}`;
      if (!(await this.repository.nameTaken(orgId, kind, name))) return name;
    }
    return `${base} ${Date.now()}`;
  }

  private async withUsage(orgId: string, row: ConnectionRow): Promise<SafeConnection> {
    const usage = await this.context.connectionUsage(orgId);
    return toSafeConnection(row, usage[row.id]);
  }

  private async found(orgId: string, id: string): Promise<ConnectionRow> {
    return this.ensure(await this.repository.find(orgId, id));
  }

  private ensure(row: ConnectionRow | null): ConnectionRow {
    if (!row) throw new NotFoundException(CONNECTION_MESSAGES.NOT_FOUND);
    return row;
  }

  private provider(kind: string): ConnectionProvider {
    const provider = providerFor(kind);
    if (!provider) throw new BadRequestException(CONNECTION_MESSAGES.UNKNOWN_APP);
    return provider;
  }

  private title(kind: ConnectionKind): string {
    return connectionKindInfo(kind).title;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
