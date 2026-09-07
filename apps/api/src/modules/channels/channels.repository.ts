/**
 * The persistence layer for connected channels — and the encryption boundary.
 *
 * This is the repository layer that `packages/db/src/crypto.ts` and
 * `SCHEMA_NOTES.md` have both been pointing at since Sprint 1. It is the first
 * one in the codebase, so it sets the pattern: **plaintext above, ciphertext
 * below.** No service and no controller ever holds an encrypted value, and
 * nothing but this file ever hands one to Prisma.
 *
 * ## The rules that make it correct
 *
 * - **Two read paths, deliberately.** `listForOrg` never decrypts, because a
 *   channel list has no business touching credentials. `getWithCredentials` is
 *   the only method that does, and exists for publishing and refreshing.
 * - **Every read filters `deletedAt: null`.** SCHEMA_NOTES calls forgetting
 *   this "the single most likely data bug in this codebase."
 * - **Never look a channel up by its token.** The IV is random, so the same
 *   token encrypts differently every time and `where: { token }` matches nothing.
 * - **A named parameter object, never positional arguments.** The reference
 *   implementation's equivalent takes sixteen positional parameters, and that
 *   single choice is the direct cause of its bug where every token refresh
 *   silently nulls the account handle.
 * - **`orgId` in every signature and every `where`.** The reference has a
 *   cross-tenant write precisely because one query omitted it.
 */

import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  decryptNullable,
  encrypt,
  encryptNullable,
  type Integration,
  type PrismaTransactionClient,
  prisma,
  State,
} from '@postgear/db';

/** The default the schema itself declares, used when a stored value is unreadable. */
const DEFAULT_POSTING_TIMES = [{ time: 120 }, { time: 400 }, { time: 700 }];

/** A channel as the rest of the app sees it. Deliberately carries no credentials. */
export interface ChannelSummary {
  id: string;
  internalId: string;
  rootInternalId: string;
  providerIdentifier: string;
  name: string;
  profile: string | null;
  picture: string | null;
  disabled: boolean;
  refreshNeeded: boolean;
  inBetweenSteps: boolean;
  tokenExpiration: Date | null;
  postingTimes: { time: number }[];
  additionalSettings: Record<string, unknown>;
  createdAt: Date;
}

/** A channel plus its decrypted credentials. Only for publishing and refreshing. */
export interface ChannelWithCredentials extends ChannelSummary {
  token: string;
  refreshToken: string | null;
}

/** Everything needed to create or update a channel from an OAuth result. */
export interface UpsertChannelInput {
  orgId: string;
  providerIdentifier: string;
  /** The platform id of the post target. */
  internalId: string;
  /** The platform id of the account that granted access. Only set on create. */
  rootInternalId: string;
  name: string;
  token: string;
  refreshToken?: string | null;
  /** Seconds until the access token expires. */
  expiresIn?: number;
  profile?: string | null;
  picture?: string | null;
  /** True when the channel still needs the user to pick a page/board/channel. */
  inBetweenSteps?: boolean;
  /** True on a reconnect — suppresses the `inBetweenSteps` write. */
  isReconnect?: boolean;
}

@Injectable()
export class ChannelsRepository {
  /**
   * The channel list for an organization.
   *
   * Selects explicitly rather than returning the row, so `token` and
   * `refreshToken` cannot reach a caller even by accident — a safer default
   * than remembering to strip them at every call site.
   */
  async listForOrg(orgId: string): Promise<ChannelSummary[]> {
    const rows = await prisma.integration.findMany({
      where: { organizationId: orgId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: this.summarySelect(),
    });

    return rows.map((row) => this.toSummary(row));
  }

  /** One channel, without credentials. */
  async findById(orgId: string, id: string): Promise<ChannelSummary | null> {
    const row = await prisma.integration.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
      select: this.summarySelect(),
    });

    return row ? this.toSummary(row) : null;
  }

  /**
   * One channel with its credentials decrypted.
   *
   * The only method that decrypts. Keep its callers few and obvious: the
   * publish path, the refresh path, and revocation on disconnect.
   */
  async getWithCredentials(orgId: string, id: string): Promise<ChannelWithCredentials | null> {
    const row = await prisma.integration.findFirst({
      where: { id, organizationId: orgId, deletedAt: null },
    });

    if (!row) {
      return null;
    }

    return {
      ...this.toSummary(row),
      // `token` is NOT NULL in the schema but is emptied on disconnect, and
      // `decrypt` rejects an empty string — so an emptied credential reads back
      // as empty rather than throwing.
      token: row.token ? (decryptNullable(row.token) ?? '') : '',
      refreshToken: row.refreshToken ? decryptNullable(row.refreshToken) : null,
    };
  }

  /**
   * Creates a channel, or folds a repeat connection into the existing row.
   *
   * The upsert key is the schema's `@@unique([organizationId, internalId])`, and
   * using it is what makes reconnecting non-destructive: the row keeps its
   * primary key, so scheduled posts, posting times and the user's chosen name
   * all survive, and `deletedAt: null` resurrects a channel that had been
   * disconnected.
   *
   * The update branch deliberately omits `name`, `disabled` and `postingTimes`.
   * Those carry user intent, and a machine-driven reconnect or token refresh
   * must not overwrite them.
   */
  async upsertFromAuth(input: UpsertChannelInput): Promise<ChannelSummary> {
    const tokenExpiration = input.expiresIn
      ? new Date(Date.now() + input.expiresIn * 1_000)
      : undefined;

    const row = await prisma.integration.upsert({
      where: {
        organizationId_internalId: {
          organizationId: input.orgId,
          internalId: input.internalId,
        },
      },
      create: {
        organizationId: input.orgId,
        internalId: input.internalId,
        rootInternalId: input.rootInternalId,
        providerIdentifier: input.providerIdentifier,
        type: 'social',
        name: input.name,
        profile: input.profile ?? null,
        picture: input.picture ?? null,
        token: encrypt(input.token),
        refreshToken: encryptNullable(input.refreshToken),
        tokenExpiration: tokenExpiration ?? null,
        inBetweenSteps: input.inBetweenSteps ?? false,
        refreshNeeded: false,
      },
      update: {
        token: encrypt(input.token),
        refreshToken: encryptNullable(input.refreshToken),
        // A conditional spread, not a plain assignment: a refresh that does not
        // know the expiry must leave the stored one alone rather than null it.
        ...(tokenExpiration ? { tokenExpiration } : {}),
        ...(input.profile ? { profile: input.profile } : {}),
        ...(input.picture ? { picture: input.picture } : {}),
        // A reconnect must not drop the user back into the page picker for a
        // page they already chose.
        ...(input.isReconnect ? {} : { inBetweenSteps: input.inBetweenSteps ?? false }),
        deletedAt: null,
        refreshNeeded: false,
      },
      select: this.summarySelect(),
    });

    return this.toSummary(row);
  }

  /**
   * Applies a refreshed token.
   *
   * Separate from `upsertFromAuth` because a refresh knows strictly less: it has
   * new credentials and nothing else. Writing only those three columns is what
   * stops a refresh from nulling the handle — the exact bug the reference
   * implementation has.
   */
  async applyRefreshedToken(params: {
    orgId: string;
    id: string;
    token: string;
    refreshToken?: string | null;
    expiresIn?: number;
  }): Promise<void> {
    await prisma.integration.updateMany({
      where: { id: params.id, organizationId: params.orgId, deletedAt: null },
      data: {
        token: encrypt(params.token),
        ...(params.refreshToken ? { refreshToken: encrypt(params.refreshToken) } : {}),
        ...(params.expiresIn
          ? { tokenExpiration: new Date(Date.now() + params.expiresIn * 1_000) }
          : {}),
        refreshNeeded: false,
      },
    });
  }

  /**
   * Propagates a refreshed token to sibling channels of the same account.
   *
   * One LinkedIn authorization covers the member profile and every company page
   * they administer, which are separate rows sharing a `rootInternalId`.
   * Refreshing one without the others leaves the rest holding a dead token.
   *
   * Scoped to `organizationId` — without it, refreshing in one workspace
   * rewrites another workspace's credentials for the same account, which is
   * exactly the cross-tenant write the reference implementation has.
   */
  async propagateTokenToSiblings(params: {
    orgId: string;
    rootInternalId: string;
    exceptId: string;
    token: string;
    refreshToken?: string | null;
    expiresIn?: number;
  }): Promise<void> {
    await prisma.integration.updateMany({
      where: {
        organizationId: params.orgId,
        rootInternalId: params.rootInternalId,
        id: { not: params.exceptId },
        deletedAt: null,
      },
      data: {
        token: encrypt(params.token),
        ...(params.refreshToken ? { refreshToken: encrypt(params.refreshToken) } : {}),
        ...(params.expiresIn
          ? { tokenExpiration: new Date(Date.now() + params.expiresIn * 1_000) }
          : {}),
        refreshNeeded: false,
      },
    });
  }

  /** Flags a channel as needing the user to reconnect it. */
  async markRefreshNeeded(orgId: string, id: string): Promise<void> {
    await prisma.integration.updateMany({
      where: { id, organizationId: orgId, deletedAt: null },
      data: { refreshNeeded: true },
    });
  }

  /**
   * Commits the user's page / channel / board choice.
   *
   * This flips the row's identity: `internalId` moves from the authorizing
   * account to the thing being posted to, and where the platform issues a
   * scoped token it replaces the user token. `rootInternalId` stays on the
   * account, which is what later tells a reconnect that it must re-derive the
   * scoped credential.
   *
   * Wrapped in a transaction because claiming the new `internalId` can collide
   * with an existing row, and resolving that takes several writes that must not
   * be interleaved with a concurrent finalize.
   */
  async completeEntitySelection(params: {
    orgId: string;
    id: string;
    entityId: string;
    name: string;
    picture?: string | null;
    profile?: string | null;
    token?: string;
  }): Promise<ChannelSummary> {
    return prisma.$transaction(async (tx) => {
      const current = await tx.integration.findFirst({
        where: { id: params.id, organizationId: params.orgId, deletedAt: null },
      });

      if (!current) {
        throw new Error('Channel not found');
      }

      // Guards the transition, so a replayed finalize cannot re-point a
      // channel that has already been configured.
      if (!current.inBetweenSteps) {
        throw new Error('Channel is not awaiting selection');
      }

      await this.vacateInternalId(tx, params.orgId, params.entityId, params.id);

      const target = await this.findLiveHolder(tx, params.orgId, params.entityId, params.id);

      // If a live channel already represents this entity, that row wins: it is
      // the one carrying the scheduled posts, webhooks and history. The
      // half-configured row we just created is the disposable one.
      const rowId = target?.id ?? params.id;

      if (target) {
        await tx.integration.update({
          where: { id: params.id },
          data: {
            internalId: `discarded_${params.entityId}_${randomBytes(6).toString('hex')}`,
            deletedAt: new Date(),
            token: '',
            refreshToken: null,
          },
        });
      }

      const updated = await tx.integration.update({
        where: { id: rowId },
        data: {
          internalId: params.entityId,
          name: params.name,
          ...(params.picture ? { picture: params.picture } : {}),
          ...(params.profile ? { profile: params.profile } : {}),
          ...(params.token ? { token: encrypt(params.token) } : {}),
          inBetweenSteps: false,
          refreshNeeded: false,
          deletedAt: null,
        },
        select: this.summarySelect(),
      });

      return this.toSummary(updated);
    });
  }

  /**
   * Disconnects a channel.
   *
   * Soft delete, because `Post.integrationId` is a required foreign key — a hard
   * delete would break referential integrity for any workspace that has ever
   * scheduled to this channel.
   *
   * The credentials are **cleared**, not merely orphaned. Leaving live tokens in
   * a soft-deleted row (as the reference does) is a retention problem for no
   * benefit: reconnecting is a full re-authorization anyway.
   *
   * Queued posts are moved back to `DRAFT` rather than deleted. The user's
   * writing survives, the calendar stops claiming they are scheduled, and
   * nothing silently fails at publish time.
   */
  async disconnect(orgId: string, id: string): Promise<{ draftedPosts: number }> {
    return prisma.$transaction(async (tx) => {
      const drafted = await tx.post.updateMany({
        where: {
          integrationId: id,
          organizationId: orgId,
          state: State.QUEUE,
          deletedAt: null,
        },
        data: { state: State.DRAFT },
      });

      await tx.integration.updateMany({
        where: { id, organizationId: orgId, deletedAt: null },
        data: {
          deletedAt: new Date(),
          disabled: true,
          refreshNeeded: false,
          // `token` is NOT NULL, so the empty string is the way to clear it.
          token: '',
          refreshToken: null,
        },
      });

      return { draftedPosts: drafted.count };
    });
  }

  /** How many queued posts a disconnect would affect, so the UI can say the number. */
  async countQueuedPosts(orgId: string, id: string): Promise<number> {
    return prisma.post.count({
      where: { integrationId: id, organizationId: orgId, state: State.QUEUE, deletedAt: null },
    });
  }

  /** Updates the fields a user owns. Never called by a machine-driven path. */
  async updateSettings(params: {
    orgId: string;
    id: string;
    name?: string;
    postingTimes?: { time: number }[];
  }): Promise<ChannelSummary | null> {
    await prisma.integration.updateMany({
      where: { id: params.id, organizationId: params.orgId, deletedAt: null },
      data: {
        ...(params.name ? { name: params.name } : {}),
        ...(params.postingTimes ? { postingTimes: JSON.stringify(params.postingTimes) } : {}),
      },
    });

    return this.findById(params.orgId, params.id);
  }

  /**
   * Moves a tombstoned row off the `internalId` about to be claimed.
   *
   * Soft delete plus `@@unique([organizationId, internalId])` means a deleted
   * row still occupies the slot. Postgres would express this better as a partial
   * unique index, but Prisma cannot declare one, so the tombstone is renamed
   * instead. The rename must not happen on delete — keeping `internalId` intact
   * there is exactly what lets a reconnect resurrect the original row.
   */
  private async vacateInternalId(
    tx: PrismaTransactionClient,
    orgId: string,
    internalId: string,
    exceptId: string,
  ): Promise<void> {
    await tx.integration.updateMany({
      where: {
        organizationId: orgId,
        internalId,
        deletedAt: { not: null },
        id: { not: exceptId },
      },
      data: { internalId: `deleted_${internalId}_${randomBytes(6).toString('hex')}` },
    });
  }

  private async findLiveHolder(
    tx: PrismaTransactionClient,
    orgId: string,
    internalId: string,
    exceptId: string,
  ): Promise<{ id: string } | null> {
    return tx.integration.findFirst({
      where: { organizationId: orgId, internalId, deletedAt: null, id: { not: exceptId } },
      select: { id: true },
    });
  }

  /** The column set safe to hand upwards — note the absence of token columns. */
  private summarySelect() {
    return {
      id: true,
      internalId: true,
      rootInternalId: true,
      providerIdentifier: true,
      name: true,
      profile: true,
      picture: true,
      disabled: true,
      refreshNeeded: true,
      inBetweenSteps: true,
      tokenExpiration: true,
      postingTimes: true,
      additionalSettings: true,
      createdAt: true,
    } as const;
  }

  private toSummary(
    row: Pick<
      Integration,
      | 'id'
      | 'internalId'
      | 'rootInternalId'
      | 'providerIdentifier'
      | 'name'
      | 'profile'
      | 'picture'
      | 'disabled'
      | 'refreshNeeded'
      | 'inBetweenSteps'
      | 'tokenExpiration'
      | 'postingTimes'
      | 'additionalSettings'
      | 'createdAt'
    >,
  ): ChannelSummary {
    return {
      id: row.id,
      internalId: row.internalId,
      // Nullable on legacy rows; falling back to `internalId` reproduces the
      // "no page indirection" case, which is the safe reading.
      rootInternalId: row.rootInternalId ?? row.internalId,
      providerIdentifier: row.providerIdentifier,
      name: row.name,
      profile: row.profile,
      picture: row.picture,
      disabled: row.disabled,
      refreshNeeded: row.refreshNeeded,
      inBetweenSteps: row.inBetweenSteps,
      tokenExpiration: row.tokenExpiration,
      postingTimes: this.parsePostingTimes(row.postingTimes),
      additionalSettings: this.parseSettings(row.additionalSettings),
      createdAt: row.createdAt,
    };
  }

  /**
   * `postingTimes` is JSON in a `String` column.
   *
   * Parsed defensively: in the reference, one malformed row takes down the
   * entire channel-list endpoint with a 500, because the parse sits
   * unguarded in a controller.
   */
  private parsePostingTimes(raw: string | null): { time: number }[] {
    if (!raw) {
      return DEFAULT_POSTING_TIMES;
    }

    try {
      const parsed: unknown = JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        return DEFAULT_POSTING_TIMES;
      }

      const times = parsed
        .filter(
          (entry): entry is { time: number } =>
            typeof entry === 'object' &&
            entry !== null &&
            typeof (entry as { time?: unknown }).time === 'number',
        )
        .map((entry) => ({ time: entry.time }));

      return times.length > 0 ? times : DEFAULT_POSTING_TIMES;
    } catch {
      return DEFAULT_POSTING_TIMES;
    }
  }

  private parseSettings(raw: string | null): Record<string, unknown> {
    if (!raw) {
      return {};
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
}
