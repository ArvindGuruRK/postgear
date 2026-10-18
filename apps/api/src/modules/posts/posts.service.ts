/**
 * Posts: compose, save as a draft, queue, reopen, delete.
 *
 * ## Drafts are forgiving; the queue is not
 *
 * A draft is somewhere to put unfinished work, so saving one checks only that
 * the post is well-formed and that every channel and attachment belongs to
 * this workspace. It may be empty, too long, or missing the image Instagram
 * requires: that is what unfinished means.
 *
 * Entering the queue is a promise that the post can be published, so it is
 * held to everything the provider will enforce: a future time, a channel that
 * is set up, and every platform rule, checked by the same validator the
 * composer runs in the browser and the provider runs before publishing.
 * Queueing hands the post to the scheduler (Sprint 5): every save tells it
 * which rows to wait on and which to forget.
 */
import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { State } from '@postgear/db';
import { parsePublishStatus, type PublishStatus } from '@postgear/scheduling';
import {
  IntegrationManager,
  isDocumentEmpty,
  type PostDocument,
  parseDocument,
  renderPlainText,
  validatePost,
} from '@postgear/social-core';
import { securityLogger } from '../../common/logging/security-logger';
import type { ChannelView } from '../channels/channels.service';
import { ChannelsService } from '../channels/channels.service';
import type { MediaView } from '../media/media.service';
import { MediaService } from '../media/media.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import type {
  CalendarQuery,
  CreatePostInput,
  PostPartInput,
  QueueQuery as QueueQueryInput,
  UpdatePostInput,
} from './dto/posts.schema';
import { groupState } from './post-state';
import { POST_MESSAGES } from './posts.messages';
import {
  type ChainRoot,
  orderChain,
  type PostRow,
  PostsRepository,
  type StoredPart,
} from './posts.repository';

/** How many recent posts a list returns. */
const LIST_LIMIT = 50;

/** Groups per page of the queue. */
export const QUEUE_PAGE_SIZE = 20;

/** Characters of text shown for a post in a list. */
const PREVIEW_LENGTH = 160;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PartView {
  content: PostDocument;
  media: MediaView[];
  /** Attachments that were deleted from the library after this was saved. */
  removedMedia: number;
}

/** Where one channel's publish stands (Sprint 5). */
export interface ChannelPublishView {
  /** This channel's own state; the group's state is the worst of them. */
  state: State;
  /** The platform permalink, once published. */
  releaseURL: string | null;
  /** What the worker last recorded: a retry in progress, or why it gave up. */
  publishStatus: PublishStatus | null;
}

export interface PostChannelView extends ChannelPublishView {
  channelId: string;
  name: string;
  providerIdentifier: string;
  picture: string | null;
  profile: string | null;
  customized: boolean;
  /** True when the channel was disconnected after the post was saved. */
  disconnected: boolean;
  parts: PartView[];
}

export interface PostDetail {
  group: string;
  state: State;
  publishDate: Date;
  /** Send this back as `expectedUpdatedAt` when saving. */
  updatedAt: Date;
  shared: PartView[];
  channels: PostChannelView[];
}

export interface PostSummary {
  group: string;
  state: State;
  publishDate: Date;
  updatedAt: Date;
  preview: string;
  parts: number;
  channels: Pick<
    PostChannelView,
    | 'channelId'
    | 'name'
    | 'providerIdentifier'
    | 'picture'
    | 'disconnected'
    | 'state'
    | 'releaseURL'
    | 'publishStatus'
  >[];
}

export interface QueuePage {
  posts: PostSummary[];
  page: number;
  pageCount: number;
  total: number;
}

@Injectable()
export class PostsService {
  private readonly manager = new IntegrationManager();

  constructor(
    private readonly repository: PostsRepository,
    private readonly channels: ChannelsService,
    private readonly media: MediaService,
    private readonly scheduling: SchedulingService,
  ) {}

  /** Every post with a channel scheduled inside the range, for the calendar. */
  async calendar(orgId: string, query: CalendarQuery): Promise<PostSummary[]> {
    const rows = await this.repository.listCalendar({
      orgId,
      from: new Date(query.from),
      to: new Date(query.to),
    });

    return [...groupRows(rows).entries()]
      .map(([group, groupRows]) => this.summarize(group, groupRows))
      .sort((a, b) => a.publishDate.getTime() - b.publishDate.getTime());
  }

  /** One page of the queue, in publish order. */
  async queue(orgId: string, query: QueueQueryInput): Promise<QueuePage> {
    const { rows, total } = await this.repository.listQueue({
      orgId,
      states: query.state ? [query.state] : undefined,
      channelId: query.channelId,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      sort: query.sort,
      page: query.page,
      pageSize: QUEUE_PAGE_SIZE,
    });

    const posts = [...groupRows(rows).entries()]
      .map(([group, groupRows]) => this.summarize(group, groupRows))
      .sort((a, b) =>
        query.sort === 'asc'
          ? a.publishDate.getTime() - b.publishDate.getTime()
          : b.publishDate.getTime() - a.publishDate.getTime(),
      );

    return {
      posts,
      page: query.page,
      pageCount: Math.max(1, Math.ceil(total / QUEUE_PAGE_SIZE)),
      total,
    };
  }

  /**
   * Moves a post to a new time: the calendar's drag-and-drop and the
   * "Reschedule" action both end here.
   *
   * A queued or failed post may not be moved into the past: that would publish
   * it at once, which is what "Post now" is for and should be asked for by
   * name. A draft may sit anywhere.
   */
  async reschedule(orgId: string, group: string, publishDate: Date): Promise<PostDetail> {
    if (!UUID_PATTERN.test(group)) {
      throw new NotFoundException(POST_MESSAGES.NOT_FOUND);
    }

    const current = await this.repository.findRoots(orgId, group);

    if (current.length === 0) {
      throw new NotFoundException(POST_MESSAGES.NOT_FOUND);
    }

    const pending = current.some(
      (root) => root.state === State.QUEUE || root.state === State.ERROR,
    );

    if (pending && publishDate.getTime() <= Date.now()) {
      throw new UnprocessableEntityException(POST_MESSAGES.RESCHEDULE_PAST);
    }

    const result = await this.repository.reschedule({ orgId, group, publishDate });

    switch (result.outcome) {
      case 'not_found':
        throw new NotFoundException(POST_MESSAGES.NOT_FOUND);
      case 'locked':
        throw new ConflictException(POST_MESSAGES.LOCKED);
      case 'saved':
        await this.syncSchedules(orgId, result.roots);
        return this.get(orgId, group);
    }
  }

  /** Publishes a queued or failed post as soon as the worker picks it up. */
  async publishNow(orgId: string, group: string): Promise<PostDetail> {
    if (!UUID_PATTERN.test(group)) {
      throw new NotFoundException(POST_MESSAGES.NOT_FOUND);
    }

    const result = await this.repository.publishNow({ orgId, group });

    switch (result.outcome) {
      case 'not_found':
        throw new NotFoundException(POST_MESSAGES.NOT_FOUND);
      case 'not_queued':
        throw new UnprocessableEntityException(POST_MESSAGES.NOT_QUEUED);
      case 'saved':
        await this.scheduling.publishNow(
          result.roots.map((root) => ({ postId: root.id, organizationId: orgId })),
        );
        return this.get(orgId, group);
    }
  }

  async list(orgId: string, state?: State): Promise<PostSummary[]> {
    const rows = await this.repository.listRecentGroups({ orgId, state, limit: LIST_LIMIT });
    const byGroup = groupRows(rows);

    return [...byGroup.entries()]
      .map(([group, groupRows]) => this.summarize(group, groupRows))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async get(orgId: string, group: string): Promise<PostDetail> {
    const rows = UUID_PATTERN.test(group) ? await this.repository.findGroup(orgId, group) : [];

    if (rows.length === 0) {
      throw new NotFoundException(POST_MESSAGES.NOT_FOUND);
    }

    return this.detail(orgId, group, rows);
  }

  async create(orgId: string, input: CreatePostInput): Promise<PostDetail> {
    const group = randomUUID();
    const write = await this.prepare(orgId, input);

    await this.repository.createGroup({ orgId, group, ...write });
    await this.syncSchedules(orgId, await this.repository.findRoots(orgId, group));

    return this.get(orgId, group);
  }

  async update(orgId: string, group: string, input: UpdatePostInput): Promise<PostDetail> {
    if (!UUID_PATTERN.test(group)) {
      throw new NotFoundException(POST_MESSAGES.NOT_FOUND);
    }

    const write = await this.prepare(orgId, input);
    const before = await this.repository.findRoots(orgId, group);
    const outcome = await this.repository.replaceGroup({
      orgId,
      group,
      ...write,
      expectedUpdatedAt: new Date(input.expectedUpdatedAt),
    });

    switch (outcome) {
      case 'not_found':
        throw new NotFoundException(POST_MESSAGES.NOT_FOUND);
      case 'locked':
        throw new ConflictException(POST_MESSAGES.LOCKED);
      case 'conflict':
        throw new ConflictException(POST_MESSAGES.CONFLICT);
      case 'saved': {
        const after = await this.repository.findRoots(orgId, group);
        const kept = new Set(after.map((root) => root.id));
        // Channels this save no longer targets: their rows are soft-deleted and
        // their workflows have nothing left to publish.
        await this.scheduling.cancelPublish(
          before.filter((root) => !kept.has(root.id)).map((root) => root.id),
        );
        await this.syncSchedules(orgId, after);
        return this.get(orgId, group);
      }
    }
  }

  async remove(orgId: string, group: string): Promise<void> {
    const roots = UUID_PATTERN.test(group) ? await this.repository.findRoots(orgId, group) : [];
    const outcome = UUID_PATTERN.test(group)
      ? await this.repository.deleteGroup(orgId, group)
      : 'not_found';

    if (outcome === 'not_found') {
      throw new NotFoundException(POST_MESSAGES.NOT_FOUND);
    }

    if (outcome === 'locked') {
      throw new ConflictException(POST_MESSAGES.LOCKED);
    }

    await this.scheduling.cancelPublish(roots.map((root) => root.id));
  }

  /**
   * Brings the scheduler in line with a group's rows after a write.
   *
   * Queued roots get a workflow started or woken; everything else gets its
   * workflow (if any) told to stop. Both are idempotent and best-effort: see
   * `SchedulingService` for why a scheduler outage never fails a save.
   */
  private async syncSchedules(orgId: string, roots: ChainRoot[]): Promise<void> {
    const queued = roots.filter((root) => root.state === State.QUEUE);
    const others = roots.filter((root) => root.state !== State.QUEUE);

    await Promise.all([
      this.scheduling.schedulePublish(
        queued.map((root) => ({ postId: root.id, organizationId: orgId })),
      ),
      this.scheduling.cancelPublish(others.map((root) => root.id)),
    ]);
  }

  /**
   * Resolves and checks everything a save refers to, and serializes it.
   *
   * Runs before any write, so a rejected save leaves the stored post exactly as
   * it was.
   */
  private async prepare(
    orgId: string,
    input: CreatePostInput,
  ): Promise<{
    state: 'DRAFT' | 'QUEUE';
    publishDate: Date;
    channels: { integrationId: string; customized: boolean; parts: StoredPart[] }[];
  }> {
    const available = new Map(
      (await this.channels.list(orgId)).map((channel) => [channel.id, channel]),
    );

    const targets = input.channels.map((entry) => {
      const channel = available.get(entry.channelId);

      if (!channel) {
        securityLogger.warn('post.foreign_reference', { orgId, kind: 'channel' });
        throw new BadRequestException(POST_MESSAGES.CHANNEL_UNAVAILABLE);
      }

      return { channel, customized: entry.customized, parts: entry.parts ?? input.shared };
    });

    const mediaIds = [input.shared, ...targets.map((target) => target.parts)]
      .flat()
      .flatMap((part) => part.media.map((item) => item.id));
    const mediaViews = await this.media.findViews(orgId, mediaIds);

    if (mediaIds.some((id) => !mediaViews.has(id))) {
      securityLogger.warn('post.foreign_reference', { orgId, kind: 'media' });
      throw new BadRequestException(POST_MESSAGES.MEDIA_UNAVAILABLE);
    }

    const publishDate = new Date(input.publishDate);

    if (input.state === State.QUEUE) {
      this.assertQueueable(targets, publishDate, mediaViews);
    }

    return {
      state: input.state,
      publishDate,
      channels: targets.map((target) => ({
        integrationId: target.channel.id,
        customized: target.customized,
        parts: target.parts.map((part) => ({
          content: JSON.stringify(part.content),
          // References only. The file behind an id is resolved at read and
          // publish time, so a stored post never holds a stale URL.
          image: JSON.stringify(part.media.map((item) => ({ id: item.id }))),
        })),
      })),
    };
  }

  /** Everything the queue requires beyond a draft. Throws the first problem found. */
  private assertQueueable(
    targets: { channel: ChannelView; parts: PostPartInput[] }[],
    publishDate: Date,
    mediaViews: Map<string, MediaView>,
  ): void {
    if (publishDate.getTime() <= Date.now()) {
      throw new UnprocessableEntityException(POST_MESSAGES.PUBLISH_DATE_PAST);
    }

    for (const { channel, parts } of targets) {
      // A channel needing reconnection may still be queued to: it can be fixed
      // before the post is due, and the Channels page already shouts about it.
      // One with no target yet, or one switched off, cannot.
      if (channel.inBetweenSteps) {
        throw new UnprocessableEntityException(
          `Finish setting up ${channel.name} before adding posts to its queue.`,
        );
      }

      if (channel.disabled) {
        throw new UnprocessableEntityException(
          `${channel.name} is disabled. Turn it back on to queue posts to it.`,
        );
      }

      const provider = this.manager.find(channel.providerIdentifier);

      if (!provider) {
        throw new UnprocessableEntityException(
          `PostGear can't publish to ${channel.name}: its platform is not supported.`,
        );
      }

      const [issue] = validatePost(
        provider.rules,
        parts.map((part) => ({
          text: renderPlainText(part.content),
          media: part.media.map((item) => {
            const view = mediaViews.get(item.id) as MediaView;
            return {
              type: view.type,
              mimeType: view.mimeType ?? undefined,
              bytes: view.fileSize,
              width: view.width ?? undefined,
              height: view.height ?? undefined,
            };
          }),
        })),
        { providerName: provider.name },
      );

      if (issue) {
        throw new UnprocessableEntityException(`${channel.name}: ${issue.message}`);
      }
    }
  }

  private async detail(orgId: string, group: string, rows: PostRow[]): Promise<PostDetail> {
    const mediaIds = rows.flatMap((row) => parseImageIds(row.image));
    const mediaViews = await this.media.findViews(orgId, mediaIds);

    const channels = channelChains(rows).map(({ integration, chain }) => {
      const parts = chain.map((row): PartView => {
        const ids = parseImageIds(row.image);
        const media = ids.flatMap((id) => mediaViews.get(id) ?? []);
        return {
          content: parseDocument(row.content),
          media,
          removedMedia: ids.length - media.length,
        };
      });

      return {
        channelId: integration.id,
        name: integration.name,
        providerIdentifier: integration.providerIdentifier,
        picture: integration.picture,
        profile: integration.profile,
        customized: parseCustomized(chain[0]?.settings ?? null),
        disconnected: integration.deletedAt !== null,
        ...publishView(chain),
        parts,
      };
    });

    // The shared content is the content of any channel that follows it. When
    // every channel is customized there is no such channel, and the first
    // channel's content is the most useful starting point for the shared editor.
    const shared = (channels.find((channel) => !channel.customized) ?? channels[0]).parts;

    return {
      group,
      state: groupState(rows.map((row) => row.state)),
      publishDate: rows[0].publishDate,
      updatedAt: new Date(Math.max(...rows.map((row) => row.updatedAt.getTime()))),
      shared,
      channels,
    };
  }

  private summarize(group: string, rows: PostRow[]): PostSummary {
    const chains = channelChains(rows);
    const first =
      chains.find((entry) => !parseCustomized(entry.chain[0]?.settings ?? null)) ?? chains[0];
    const firstDocument = parseDocument(first.chain[0]?.content ?? null);

    return {
      group,
      state: groupState(rows.map((row) => row.state)),
      publishDate: rows[0].publishDate,
      updatedAt: new Date(Math.max(...rows.map((row) => row.updatedAt.getTime()))),
      preview: isDocumentEmpty(firstDocument)
        ? ''
        : truncate(renderPlainText(firstDocument), PREVIEW_LENGTH),
      parts: Math.max(...chains.map((entry) => entry.chain.length)),
      channels: chains.map(({ integration, chain }) => ({
        channelId: integration.id,
        name: integration.name,
        providerIdentifier: integration.providerIdentifier,
        picture: integration.picture,
        disconnected: integration.deletedAt !== null,
        ...publishView(chain),
      })),
    };
  }
}

/**
 * One channel's publish standing, read from its chain.
 *
 * The state is the chain's worst (a thread whose comment failed is a failed
 * thread), the permalink is the root's, and the status is whatever the worker
 * wrote on the root: see `@postgear/scheduling`.
 */
function publishView(chain: PostRow[]): ChannelPublishView {
  const root = chain[0];

  return {
    state: groupState(chain.map((row) => row.state)),
    releaseURL: root?.releaseURL ?? null,
    publishStatus: parsePublishStatus(root?.error),
  };
}

function groupRows(rows: PostRow[]): Map<string, PostRow[]> {
  const byGroup = new Map<string, PostRow[]>();

  for (const row of rows) {
    byGroup.set(row.group, [...(byGroup.get(row.group) ?? []), row]);
  }

  return byGroup;
}

/** Each channel's rows as an ordered thread, channels in the order they were added. */
function channelChains(
  rows: PostRow[],
): { integration: PostRow['integration']; chain: PostRow[] }[] {
  const byChannel = new Map<string, PostRow[]>();

  for (const row of rows) {
    byChannel.set(row.integrationId, [...(byChannel.get(row.integrationId) ?? []), row]);
  }

  return [...byChannel.values()].map((channelRows) => ({
    integration: channelRows[0].integration,
    chain: orderChain(channelRows),
  }));
}

/** `Post.image` is `[{"id": …}]`. Anything else, including legacy URL lists, yields no ids. */
export function parseImageIds(raw: string | null): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    return Array.isArray(parsed)
      ? parsed.flatMap((entry) =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as { id?: unknown }).id === 'string'
            ? [(entry as { id: string }).id]
            : [],
        )
      : [];
  } catch {
    return [];
  }
}

/** `Post.settings` is `{"customized": boolean}`. A missing or unreadable value means shared. */
export function parseCustomized(raw: string | null): boolean {
  if (!raw) {
    return false;
  }

  try {
    const parsed: unknown = JSON.parse(raw);
    return (
      typeof parsed === 'object' &&
      parsed !== null &&
      (parsed as { customized?: unknown }).customized === true
    );
  } catch {
    return false;
  }
}

function truncate(text: string, length: number): string {
  const characters = Array.from(text);
  return characters.length <= length
    ? text
    : `${characters
        .slice(0, length - 1)
        .join('')
        .trimEnd()}…`;
}
