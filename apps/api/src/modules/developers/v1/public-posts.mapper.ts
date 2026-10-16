/**
 * Between the public post shape and the composer's (Sprint 8).
 *
 * ## Text in, document out
 *
 * An integrator sends plain text; the composer stores a document. The
 * mapping is the one `render.ts` already defines, in reverse: a run of
 * non-blank lines is one paragraph with a hard break between its lines, and
 * a blank line is an *empty paragraph* — which is exactly what TipTap
 * stores when a person presses Enter twice, and what the renderer turns
 * back into a blank line. (Merely splitting paragraphs on blank lines would
 * lose them: the renderer joins paragraphs with one newline, so "A, blank,
 * B" would publish as two adjacent lines.) Round-tripping
 * `renderPlainText(textToDocument(text))` gives the text back, modulo
 * trimmed edges, which is what makes `GET` after `POST` show what was sent
 * and the platform receive it.
 *
 * The result is checked against the composer's own document schema before
 * it goes anywhere near the posts service. A text with more paragraphs than
 * a document may hold would be *stored* fine — the service does not
 * re-validate — and then refused the first time someone opened it in the
 * composer and saved. Refusing it here keeps every stored post editable.
 *
 * ## Document out, text in
 *
 * `PostDetail` and `PostSummary` are the internal views; `PublicPost` and
 * `PublicPostSummary` are what `/v1` promises. Only the shared parts are
 * exposed: per-channel customisation is a composer feature the public shape
 * does not offer yet, and showing one channel's parts as "the" post would
 * be a lie for the others.
 */
import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { State } from '@postgear/db';
import {
  type InlineNode,
  type ParagraphNode,
  type PostDocument,
  renderPlainText,
} from '@postgear/social-core';
import { type CreatePostInput, postDocumentSchema } from '../../posts/dto/posts.schema';
import type { PostDetail, PostSummary } from '../../posts/posts.service';
import { DEVELOPERS_MESSAGES } from '../developers.messages';
import type { CreatePublicPostInput, PublicStateFilter } from './dto/v1.schema';
import type { PublicPost, PublicPostChannel, PublicPostSummary } from './v1.types';

/** Characters of text in a list preview — the queue's own figure. */
export const PREVIEW_LENGTH = 160;

/** A post queued through the API with no time lands this far ahead. */
export const DEFAULT_PUBLISH_DELAY_MS = 5 * 60 * 1_000;

const STATE_BY_FILTER: Record<PublicStateFilter, State> = {
  draft: State.DRAFT,
  queue: State.QUEUE,
  published: State.PUBLISHED,
  error: State.ERROR,
};

/**
 * Plain text → a post document. Throws 400 for text with no visible
 * character and 422 for text the composer's document could not hold.
 */
export function textToDocument(text: string): PostDocument {
  const blocks: ParagraphNode[] = [];
  let run: string[] = [];

  const flush = () => {
    if (run.length > 0) {
      blocks.push(paragraphOf(run));
      run = [];
    }
  };

  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim().length === 0) {
      // A blank line — whitespace-only counts — is an empty paragraph, one
      // per line, so two blank lines stay two blank lines when rendered.
      flush();
      blocks.push({ type: 'paragraph' });
    } else {
      run.push(line);
    }
  }
  flush();

  // The renderer drops leading and trailing newlines anyway; storing them
  // would only put empty paragraphs at the edges of the composer's editor.
  const content = trimEmptyEdges(blocks);

  if (content.length === 0) {
    throw new BadRequestException(DEVELOPERS_MESSAGES.TEXT_EMPTY);
  }

  const document: PostDocument = { type: 'doc', content };

  if (!postDocumentSchema.safeParse(document).success) {
    throw new UnprocessableEntityException(DEVELOPERS_MESSAGES.TEXT_TOO_COMPLEX);
  }

  return document;
}

/** Consecutive non-blank lines: text nodes with a hard break between them. */
function paragraphOf(lines: string[]): ParagraphNode {
  return {
    type: 'paragraph',
    content: lines.flatMap((line, index): InlineNode[] =>
      index === 0 ? [{ type: 'text', text: line }] : [{ type: 'hardBreak' }, { type: 'text', text: line }],
    ),
  };
}

function trimEmptyEdges(blocks: ParagraphNode[]): ParagraphNode[] {
  const isEmpty = (block: ParagraphNode) => !block.content || block.content.length === 0;
  let start = 0;
  let end = blocks.length;

  while (start < end && isEmpty(blocks[start])) {
    start += 1;
  }
  while (end > start && isEmpty(blocks[end - 1])) {
    end -= 1;
  }

  return blocks.slice(start, end);
}

/** The public create body → what `PostsService.create` takes. */
export function toCreatePostInput(input: CreatePublicPostInput, now: Date): CreatePostInput {
  return {
    state: input.state === 'draft' ? 'DRAFT' : 'QUEUE',
    publishDate: input.publishAt ?? new Date(now.getTime() + DEFAULT_PUBLISH_DELAY_MS).toISOString(),
    shared: [
      {
        content: textToDocument(input.text),
        media: (input.mediaIds ?? []).map((id) => ({ id })),
      },
    ],
    channels: input.channelIds.map((channelId) => ({ channelId, customized: false })),
  };
}

export function toStateFilter(filter: PublicStateFilter | undefined): State | undefined {
  return filter ? STATE_BY_FILTER[filter] : undefined;
}

export function toPublicPostSummary(summary: PostSummary): PublicPostSummary {
  return {
    id: summary.group,
    state: summary.state,
    publishAt: summary.publishDate.toISOString(),
    updatedAt: summary.updatedAt.toISOString(),
    preview: summary.preview,
    channels: summary.channels.map(toPublicChannel),
  };
}

export function toPublicPost(detail: PostDetail): PublicPost {
  const parts = detail.shared.map((part) => ({
    text: renderPlainText(part.content),
    media: part.media.map((item) => ({ id: item.id, url: item.url })),
  }));

  return {
    id: detail.group,
    state: detail.state,
    publishAt: detail.publishDate.toISOString(),
    updatedAt: detail.updatedAt.toISOString(),
    preview: truncate(parts[0]?.text ?? '', PREVIEW_LENGTH),
    channels: detail.channels.map(toPublicChannel),
    parts,
  };
}

function toPublicChannel(channel: {
  channelId: string;
  name: string;
  providerIdentifier: string;
  state: State;
  releaseURL: string | null;
}): PublicPostChannel {
  return {
    channelId: channel.channelId,
    name: channel.name,
    provider: channel.providerIdentifier,
    state: channel.state,
    url: channel.releaseURL,
  };
}

/** The queue's truncation: by code point, with an ellipsis that fits inside the length. */
function truncate(text: string, length: number): string {
  const characters = Array.from(text);

  return characters.length <= length
    ? text
    : `${characters
        .slice(0, length - 1)
        .join('')
        .trimEnd()}…`;
}
