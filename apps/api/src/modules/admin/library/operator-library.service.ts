/**
 * The operator's Library screen (Sprint 12, Module 19 section 9): review what
 * the ingest scripts staged, publish it, and look after what is live.
 *
 * - **Nothing here fetches anything or takes an address.** Ingest is a script
 *   on the media worker box; these routes only read and change rows, and
 *   delete a removed item's files through the storage abstraction.
 * - **The licence guard is here, whatever the screen sends**: publishing or
 *   restoring an item whose licence is not on its kind's allow-list (sounds
 *   are never CC BY), whose origin is not one of the library's adapters, or
 *   whose source still lacks a required credit line is refused. The rules
 *   live in `@postgear/video-engine` (`libraryPublishRefusal`), shared with
 *   the ingest, so the two can never disagree.
 * - **Hide** leaves search at once (the product only ever lists ACTIVE) and
 *   keeps clips that use the item working; **remove** writes the deny list,
 *   keeps the row and its evidence, then deletes the files.
 * - Every write needs a reason and is recorded (`OperatorAuditService`).
 */
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  creditGroupFor,
  type LibraryCreditGroup,
  type LibraryItemType,
  type LibraryPublishRefusal,
  libraryPublishRefusal,
  libraryRunNeedsReview,
} from '@postgear/video-engine';
import type { AuthenticatedUser } from '../../../common/decorators/current-user.decorator';
import { stickerTsQuery } from '../../clips/library/clip-library.repository';
import {
  PRIVATE_STORAGE,
  type PrivateStorage,
  STORAGE_BACKEND,
  type StorageBackend,
} from '../../media/storage/storage.interface';
import { OperatorAuditService } from '../operator-audit.service';
import { OPERATOR_LIBRARY_MESSAGES } from './operator-library.messages';
import {
  type ItemDetailRow,
  type ItemListRow,
  OperatorLibraryRepository,
  type RunRow,
  type StatusCounts,
} from './operator-library.repository';
import {
  LIBRARY_ITEMS_PAGE_SIZE,
  type LibraryItemsQuery,
  type LibraryStatus,
  type PatchSourceInput,
} from './operator-library.schema';

type ActorUser = Pick<AuthenticatedUser, 'id' | 'email'>;

/** How long the licence report's signed address lives. */
export const REPORT_URL_SECONDS = 600;

/** An item's kind as the screen says it. */
type ItemKind = 'static' | 'animated' | 'sfx' | 'music';

export interface RunView {
  id: string;
  origin: string;
  type: LibraryItemType;
  startedAt: string;
  finishedAt: string | null;
  accepted: number;
  rejected: number;
  /** Largest first: `[{ reason: 'licence_not_allowed', count: 41 }]`. */
  rejections: Array<{ reason: string; count: number }>;
  counts: StatusCounts;
  /** Openverse and OpenGameArt runs: never auto-published, always reviewed. */
  needsReview: boolean;
  hasReport: boolean;
}

export interface HeldBackItem {
  id: string;
  type: LibraryItemType;
  name: string;
  reason: string;
}

export interface RunDetailView extends RunView {
  args: unknown;
  /** Signed for ten minutes; null when the run has no report. */
  reportUrl: string | null;
  /** The staged items that would go live on Publish Run. */
  publishable: number;
  /** The staged items the licence guard holds back, with why. */
  heldBack: HeldBackItem[];
}

export interface ItemView {
  id: string;
  type: LibraryItemType;
  name: string;
  kind: ItemKind;
  category: string;
  status: LibraryStatus;
  licence: string;
  author: string;
  authorUrl: string | null;
  sourceUrl: string;
  origin: string;
  runId: string;
  sourceId: string;
  sourceName: string;
  /** A sticker's picture; null for a sound and once removed. */
  previewUrl: string | null;
  /** A sound's file to play; null for a sticker and once removed. */
  audioUrl: string | null;
  durationMs: number | null;
  createdAt: string;
  statusAt: string | null;
  statusReason: string | null;
}

export interface ItemsPage {
  items: ItemView[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ItemDetailView extends ItemView {
  tags: string[];
  licenceUrl: string;
  originId: string | null;
  originalWork: boolean;
  retrievedAt: string;
  sourceChecksum: string;
  bytes: number;
  width: number | null;
  height: number | null;
  statusByEmail: string | null;
  /** "{N} clips use this item". */
  usage: number;
  source: { id: string; name: string; requiresCredit: boolean; creditLine: string | null };
  /** The sentence Publish Item or Restore Item would be refused with; null when it may go live. */
  publishRefusal: string | null;
}

export interface DenyView {
  id: string;
  sourceChecksum: string | null;
  origin: string | null;
  originId: string | null;
  reason: string;
  createdAt: string;
}

export interface MissView {
  term: string;
  kind: string;
  count: number;
  lastAt: string;
}

export interface SourceView {
  id: string;
  code: string;
  name: string;
  author: string;
  url: string;
  licence: string;
  licenceUrl: string;
  creditLine: string | null;
  changeNote: string | null;
  noticeText: string | null;
  requiresCredit: boolean;
  creditPerItem: boolean;
  group: LibraryCreditGroup;
  stickers: StatusCounts;
  sounds: StatusCounts;
  /** A credit is required, none is written, and items are live or waiting. */
  needsCreditLine: boolean;
}

const KIND_OF: Record<string, ItemKind> = {
  STATIC: 'static',
  ANIMATED: 'animated',
  SFX: 'sfx',
  MUSIC: 'music',
};

const ACTIONS = {
  publish: 'Publish Item',
  hide: 'Hide Item',
  restore: 'Restore Item',
  remove: 'Remove Item',
} as const;

/** The sentence for a refusal of the shared publish rules. */
export function refusalSentence(type: LibraryItemType, refusal: LibraryPublishRefusal): string {
  switch (refusal) {
    case 'licence_not_allowed':
      return type === 'sound'
        ? OPERATOR_LIBRARY_MESSAGES.LICENCE_NOT_ALLOWED_SOUND
        : OPERATOR_LIBRARY_MESSAGES.LICENCE_NOT_ALLOWED_STICKER;
    case 'unknown_source':
      return OPERATOR_LIBRARY_MESSAGES.UNKNOWN_SOURCE;
    case 'credit_line_missing':
      return OPERATOR_LIBRARY_MESSAGES.CREDIT_LINE_MISSING;
  }
}

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function total(counts: StatusCounts): number {
  return counts.staged + counts.active + counts.hidden + counts.removed;
}

@Injectable()
export class OperatorLibraryService {
  private readonly logger = new Logger(OperatorLibraryService.name);

  constructor(
    private readonly repository: OperatorLibraryRepository,
    private readonly audit: OperatorAuditService,
    @Inject(STORAGE_BACKEND) private readonly storage: StorageBackend,
    @Inject(PRIVATE_STORAGE) private readonly privateStorage: PrivateStorage,
  ) {}

  // --- Runs ---------------------------------------------------------------------

  async runs(): Promise<RunView[]> {
    return (await this.repository.runs()).map((run) => this.runView(run));
  }

  async run(id: string): Promise<RunDetailView> {
    const run = await this.repository.run(id);
    if (!run) throw new NotFoundException(OPERATOR_LIBRARY_MESSAGES.RUN_NOT_FOUND);
    const staged = await this.repository.stagedItemsOf(id);
    const heldBack = this.heldBack(staged);
    let reportUrl: string | null = null;
    if (run.reportKey) {
      try {
        reportUrl = await this.privateStorage.signedUrl(run.reportKey, {
          expiresInSeconds: REPORT_URL_SECONDS,
          downloadName: `library-run-${run.id}.md`,
        });
      } catch (error) {
        this.logger.warn(
          JSON.stringify({
            event: 'operator.library_report_unsigned',
            runId: run.id,
            reason: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
    return {
      ...this.runView(run),
      args: run.args,
      reportUrl,
      publishable: staged.length - heldBack.length,
      heldBack,
    };
  }

  /**
   * Publishes a run's staged items that pass the licence guard, in one
   * transaction; the ones it holds back stay STAGED and are listed back.
   */
  async publishRun(
    id: string,
    user: ActorUser,
  ): Promise<{ published: number; heldBack: HeldBackItem[]; run: RunDetailView }> {
    const run = await this.repository.run(id);
    if (!run) throw new NotFoundException(OPERATOR_LIBRARY_MESSAGES.RUN_NOT_FOUND);
    const staged = await this.repository.stagedItemsOf(id);
    if (staged.length === 0) {
      throw new ConflictException({
        message: OPERATOR_LIBRARY_MESSAGES.NOTHING_STAGED,
        code: 'nothing_staged',
      });
    }
    const heldBack = this.heldBack(staged);
    const held = new Set(heldBack.map((item) => `${item.type}:${item.id}`));
    const passing = staged.filter((item) => !held.has(`${item.type}:${item.id}`));
    if (passing.length === 0) {
      throw new UnprocessableEntityException({
        message: heldBack[0]?.reason ?? OPERATOR_LIBRARY_MESSAGES.NOTHING_STAGED,
        code: 'licence_not_allowed',
      });
    }
    const published = await this.repository.publishRunItems(
      id,
      {
        sticker: passing.filter((item) => item.type === 'sticker').map((item) => item.id),
        sound: passing.filter((item) => item.type === 'sound').map((item) => item.id),
      },
      user.id,
    );
    await this.audit.record(user, {
      action: 'library.run_published',
      summary: `published ${published} library items`,
      lines: [
        `Run ${run.id} (${run.origin}): ${published} items published.`,
        ...(heldBack.length > 0 ? [`${heldBack.length} held back by the licence guard.`] : []),
      ],
      reason: 'The operator listened to a sample and checked the licences.',
      target: { runId: run.id, origin: run.origin, published, heldBack: heldBack.length },
    });
    return { published, heldBack, run: await this.run(id) };
  }

  // --- Items --------------------------------------------------------------------

  async items(query: LibraryItemsQuery): Promise<ItemsPage> {
    const page = query.page;
    const { rows, total: count } = await this.repository.items({
      type: query.type,
      status: query.status,
      kind: this.kindFor(query.type, query.kind),
      category: query.category,
      origin: query.origin,
      runId: query.runId,
      tsQuery: stickerTsQuery(query.q),
      limit: LIBRARY_ITEMS_PAGE_SIZE,
      offset: (page - 1) * LIBRARY_ITEMS_PAGE_SIZE,
    });
    return {
      items: rows.map((row) => this.itemView(query.type, row)),
      total: count,
      page,
      pageSize: LIBRARY_ITEMS_PAGE_SIZE,
    };
  }

  async item(type: LibraryItemType, id: string): Promise<ItemDetailView> {
    const row = await this.requireItem(type, id);
    const [usage, emails] = await Promise.all([
      this.repository.usageCount(type, id),
      this.repository.emailsOf(row.statusById ? [row.statusById] : []),
    ]);
    const refusal = libraryPublishRefusal(type, row, row.source);
    return {
      ...this.itemView(type, {
        ...row,
        sourceId: row.source.id,
        sourceName: row.source.name,
      }),
      tags: row.tags,
      licenceUrl: row.licenceUrl,
      originId: row.originId,
      originalWork: row.originalWork,
      retrievedAt: row.retrievedAt.toISOString(),
      sourceChecksum: row.sourceChecksum,
      bytes: row.bytes,
      width: row.width,
      height: row.height,
      statusByEmail: row.statusById ? (emails.get(row.statusById) ?? null) : null,
      usage,
      source: {
        id: row.source.id,
        name: row.source.name,
        requiresCredit: row.source.requiresCredit,
        creditLine: row.source.creditLine,
      },
      publishRefusal: refusal ? refusalSentence(type, refusal) : null,
    };
  }

  /** Publish Item: a STAGED item goes live, if the licence guard lets it. */
  async publishItem(
    type: LibraryItemType,
    id: string,
    reason: string,
    user: ActorUser,
  ): Promise<ItemDetailView> {
    const row = await this.requireItem(type, id);
    if (row.status === 'REMOVED') this.refuseRemoved();
    if (row.status !== 'STAGED') {
      throw new ConflictException({
        message: OPERATOR_LIBRARY_MESSAGES.ONLY_STAGED,
        code: 'not_staged',
      });
    }
    this.guard(type, row);
    await this.move(type, row, ['STAGED'], 'ACTIVE', reason, user, 'publish');
    return this.item(type, id);
  }

  /** Hide Item: out of search at once; clips that use it keep working. */
  async hideItem(
    type: LibraryItemType,
    id: string,
    reason: string,
    user: ActorUser,
  ): Promise<ItemDetailView> {
    const row = await this.requireItem(type, id);
    if (row.status === 'REMOVED') this.refuseRemoved();
    if (row.status === 'HIDDEN') {
      throw new ConflictException({
        message: OPERATOR_LIBRARY_MESSAGES.ALREADY_HIDDEN,
        code: 'already_hidden',
      });
    }
    await this.move(type, row, ['STAGED', 'ACTIVE'], 'HIDDEN', reason, user, 'hide');
    return this.item(type, id);
  }

  /** Restore Item: a hidden item goes live again, under the same licence guard as publish. */
  async restoreItem(
    type: LibraryItemType,
    id: string,
    reason: string,
    user: ActorUser,
  ): Promise<ItemDetailView> {
    const row = await this.requireItem(type, id);
    if (row.status === 'REMOVED') this.refuseRemoved();
    if (row.status !== 'HIDDEN') {
      throw new ConflictException({
        message: OPERATOR_LIBRARY_MESSAGES.ONLY_HIDDEN,
        code: 'not_hidden',
      });
    }
    this.guard(type, row);
    await this.move(type, row, ['HIDDEN'], 'ACTIVE', reason, user, 'restore');
    return this.item(type, id);
  }

  /**
   * Remove Item: the deny list first and the row to REMOVED (one
   * transaction, the evidence kept), then the files leave the public bucket.
   * A delete that fails is logged, never a failed removal: the item is
   * already out of every list and cannot be ingested again.
   */
  async removeItem(
    type: LibraryItemType,
    id: string,
    reason: string,
    user: ActorUser,
  ): Promise<ItemDetailView> {
    const row = await this.requireItem(type, id);
    if (row.status === 'REMOVED') this.refuseRemoved();
    const moved = await this.repository.markRemoved(type, row, reason, user.id);
    if (!moved) this.refuseRemoved();
    const keys = [row.fileKey, ...(row.previewKey ? [row.previewKey] : [])];
    const deleted = await Promise.allSettled(keys.map((key) => this.storage.delete(key)));
    deleted.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.error(
          JSON.stringify({
            event: 'operator.library_file_not_deleted',
            type,
            itemId: id,
            key: keys[index],
            reason: result.reason instanceof Error ? result.reason.message : String(result.reason),
          }),
        );
      }
    });
    await this.recordItem(type, row, 'remove', reason, user);
    return this.item(type, id);
  }

  // --- Deny list, gaps, sources ---------------------------------------------------

  async deny(): Promise<DenyView[]> {
    return (await this.repository.deny()).map((row) => ({
      id: row.id,
      sourceChecksum: row.sourceChecksum,
      origin: row.origin,
      originId: row.originId,
      reason: row.reason,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  async misses(): Promise<MissView[]> {
    return (await this.repository.misses()).map((row) => ({
      term: row.term,
      kind: row.kind,
      count: row.count,
      lastAt: row.lastAt.toISOString(),
    }));
  }

  async sources(): Promise<SourceView[]> {
    return (await this.repository.sources()).map((source) => ({
      id: source.id,
      code: source.code,
      name: source.name,
      author: source.author,
      url: source.url,
      licence: source.licence,
      licenceUrl: source.licenceUrl,
      creditLine: source.creditLine,
      changeNote: source.changeNote,
      noticeText: source.noticeText,
      requiresCredit: source.requiresCredit,
      creditPerItem: source.creditPerItem,
      group: creditGroupFor(source),
      stickers: source.stickers,
      sounds: source.sounds,
      needsCreditLine:
        source.requiresCredit &&
        !source.creditLine &&
        source.stickers.active +
          source.stickers.staged +
          source.sounds.active +
          source.sounds.staged >
          0,
    }));
  }

  /** Only the credits page's words change here: the credit line, the change note and the notice. */
  async updateSource(id: string, input: PatchSourceInput, user: ActorUser): Promise<SourceView> {
    const before = await this.repository.source(id);
    if (!before) throw new NotFoundException(OPERATOR_LIBRARY_MESSAGES.SOURCE_NOT_FOUND);
    const fields = ['creditLine', 'changeNote', 'noticeText'] as const;
    const data: Partial<Record<(typeof fields)[number], string | null>> = {};
    const lines: string[] = [];
    for (const field of fields) {
      const next = input[field];
      if (next === undefined || next === before[field]) continue;
      data[field] = next;
      lines.push(`${FIELD_NAMES[field]}: ${shown(before[field])} to ${shown(next)}`);
    }
    if (lines.length > 0) {
      await this.repository.updateSource(id, data);
      await this.audit.record(user, {
        action: 'library.source_updated',
        summary: `credits of ${before.name}`,
        lines: [`Source ${before.name} (${before.code})`, ...lines],
        reason: input.reason,
        target: { sourceId: id, fields: Object.keys(data) },
      });
    }
    const sources = await this.sources();
    const view = sources.find((source) => source.id === id);
    if (!view) throw new NotFoundException(OPERATOR_LIBRARY_MESSAGES.SOURCE_NOT_FOUND);
    return view;
  }

  // --- Helpers --------------------------------------------------------------------

  private runView(run: RunRow): RunView {
    const type: LibraryItemType =
      isSoundRun(run.args) || total(run.sounds) > total(run.stickers) ? 'sound' : 'sticker';
    const counts = type === 'sound' ? run.sounds : run.stickers;
    return {
      id: run.id,
      origin: run.origin,
      type,
      startedAt: run.startedAt.toISOString(),
      finishedAt: iso(run.finishedAt),
      accepted: run.accepted,
      rejected: run.rejected,
      rejections: rejectionsOf(run.rejectionsByReason),
      counts,
      needsReview: libraryRunNeedsReview(type, run.origin),
      hasReport: Boolean(run.reportKey),
    };
  }

  private itemView(
    type: LibraryItemType,
    row: ItemListRow | (ItemDetailRow & { sourceId: string; sourceName: string }),
  ): ItemView {
    const live = row.status !== 'REMOVED';
    return {
      id: row.id,
      type,
      name: row.name,
      kind: KIND_OF[row.kind] ?? (type === 'sound' ? 'sfx' : 'static'),
      category: row.category,
      status: row.status,
      licence: row.licence,
      author: row.author,
      authorUrl: row.authorUrl,
      sourceUrl: row.sourceUrl,
      origin: row.origin,
      runId: row.runId,
      sourceId: row.sourceId,
      sourceName: row.sourceName,
      previewUrl:
        type === 'sticker' && live ? this.storage.publicUrl(row.previewKey ?? row.fileKey) : null,
      audioUrl: type === 'sound' && live ? this.storage.publicUrl(row.fileKey) : null,
      durationMs: row.durationMs,
      createdAt: row.createdAt.toISOString(),
      statusAt: iso(row.statusAt),
      statusReason: row.statusReason,
    };
  }

  private heldBack(
    staged: Awaited<ReturnType<OperatorLibraryRepository['stagedItemsOf']>>,
  ): HeldBackItem[] {
    const held: HeldBackItem[] = [];
    for (const item of staged) {
      const refusal = libraryPublishRefusal(item.type, item, item);
      if (refusal) {
        held.push({
          id: item.id,
          type: item.type,
          name: item.name,
          reason: refusalSentence(item.type, refusal),
        });
      }
    }
    return held;
  }

  private kindFor(type: LibraryItemType, kind: LibraryItemsQuery['kind']): string | undefined {
    if (!kind) return undefined;
    const soundKind = kind === 'sfx' || kind === 'music';
    // A sticker kind on the Sounds list (or the other way) matches nothing, as asked.
    return soundKind === (type === 'sound') ? kind : 'none';
  }

  private async requireItem(type: LibraryItemType, id: string): Promise<ItemDetailRow> {
    const row = UUID.test(id) ? await this.repository.item(type, id) : null;
    if (!row) throw new NotFoundException(OPERATOR_LIBRARY_MESSAGES.ITEM_NOT_FOUND);
    return row;
  }

  /** The shared publish rules, refused with their sentence. */
  private guard(type: LibraryItemType, row: ItemDetailRow): void {
    const refusal = libraryPublishRefusal(type, row, row.source);
    if (refusal) {
      this.logger.warn(
        JSON.stringify({
          event: 'operator.library_publish_refused',
          type,
          itemId: row.id,
          refusal,
        }),
      );
      throw new UnprocessableEntityException({
        message: refusalSentence(type, refusal),
        code: refusal,
      });
    }
  }

  private refuseRemoved(): never {
    throw new ConflictException({
      message: OPERATOR_LIBRARY_MESSAGES.REMOVED_FOR_GOOD,
      code: 'item_removed',
    });
  }

  private async move(
    type: LibraryItemType,
    row: ItemDetailRow,
    from: LibraryStatus[],
    to: 'ACTIVE' | 'HIDDEN',
    reason: string,
    user: ActorUser,
    action: keyof typeof ACTIONS,
  ): Promise<void> {
    const moved = await this.repository.setStatus(type, row.id, from, to, reason, user.id);
    if (!moved) {
      throw new ConflictException({
        message: OPERATOR_LIBRARY_MESSAGES.ITEM_CHANGED,
        code: 'operator_conflict',
      });
    }
    await this.recordItem(type, row, action, reason, user);
  }

  private async recordItem(
    type: LibraryItemType,
    row: ItemDetailRow,
    action: keyof typeof ACTIONS,
    reason: string,
    user: ActorUser,
  ): Promise<void> {
    await this.audit.record(user, {
      action: `library.item_${action === 'publish' ? 'published' : action === 'hide' ? 'hidden' : action === 'restore' ? 'restored' : 'removed'}`,
      summary: `${ACTIONS[action]}, ${row.name}`,
      lines: [
        `${type === 'sound' ? 'Sound' : 'Sticker'} ${row.name} (${row.id})`,
        `Licence ${row.licence}, from ${row.origin}, run ${row.runId}`,
        `Was ${row.status}`,
      ],
      reason,
      target: { type, itemId: row.id, origin: row.origin, runId: row.runId },
    });
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FIELD_NAMES = {
  creditLine: 'Credit line',
  changeNote: 'Change note',
  noticeText: 'Notice',
} as const;

function shown(value: string | null): string {
  if (!value) return 'none';
  return value.length > 80 ? `"${value.slice(0, 77)}..."` : `"${value}"`;
}

function isSoundRun(args: unknown): boolean {
  return Boolean(args && typeof args === 'object' && (args as { kind?: unknown }).kind === 'sound');
}

/** `{ licence_not_allowed: 41, brand_name: 6 }` as a list, largest first. */
function rejectionsOf(value: unknown): Array<{ reason: string; count: number }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > 0)
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}
