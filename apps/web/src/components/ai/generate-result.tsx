'use client';

/**
 * What the model produced: the category, the hook, the parts, the image, the
 * sources, and the three things to do with it.
 *
 * Rendered from the reducer's partial fields rather than the final result,
 * so the hook appears the moment it streams and a run that failed at the
 * image stage still shows its parts. Violet marks the model's output (the
 * hook bubble, the category badge); the parts themselves are restrained
 * cards, because they are the composer's content next, not an exhibit
 * (design-system-rules.md §16b).
 *
 * "Open in composer" creates a real DRAFT through `POST /posts` (the same
 * payload the composer sends, one part per generated part, the hero image on
 * the first) and navigates to it. The composer is where the post is edited
 * and scheduled; this screen does not grow a second editor.
 */
import { documentFromText, measureLength } from '@postgear/social-core/composer';
import {
  Alert,
  Badge,
  Button,
  Card,
  cn,
  Skeleton,
  SpeechBubble,
  Text,
  useToast,
} from '@postgear/ui';
import { Copy, ExternalLink, PenSquare, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { GeneratedPart } from '@/types/ai';
import type { PostDetail } from '@/types/post';
import type { SavePayload } from '../composer/composer-state';
import {
  type CharacterLimit,
  FORMAT_OPTIONS,
  type GenerateState,
  nextFullHour,
  partsAsText,
} from './generate-state';

export function GenerateResult({
  orgId,
  state,
  limit,
  onRegenerate,
}: {
  orgId: string;
  state: GenerateState;
  limit: CharacterLimit | null;
  onRegenerate: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  const running = state.phase === 'running';
  const parts = state.parts ?? [];
  const request = state.request;
  const format = FORMAT_OPTIONS.find((option) => option.value === request?.format);
  const imageExpected = Boolean(request?.withImage) && state.stages.image.status === 'active';

  async function openInComposer() {
    if (!request || parts.length === 0) {
      return;
    }

    setOpening(true);
    setOpenError(null);

    const payload: SavePayload = {
      state: 'DRAFT',
      publishDate: nextFullHour(new Date()).toISOString(),
      shared: parts.map((part, index) => ({
        content: documentFromText(part.text),
        // Platforms attach media to the root post; comment parts cannot carry it.
        media: index === 0 && part.image ? [{ id: part.image.mediaId }] : [],
      })),
      channels: request.channelIds.map((channelId) => ({ channelId, customized: false })),
    };

    try {
      const { post } = await api<{ post: PostDetail }>('/posts', { method: 'POST', body: payload });
      router.push(`/${orgId}/composer?group=${encodeURIComponent(post.group)}`);
    } catch (cause) {
      setOpenError(
        cause instanceof ApiError
          ? cause.message
          : 'The draft could not be created. Copy the text instead.',
      );
      setOpening(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(partsAsText(parts));
      toast({
        title: 'Copied',
        description: `${parts.length} ${parts.length === 1 ? 'part' : 'parts'} on the clipboard.`,
      });
    } catch {
      toast({ title: "Couldn't copy", description: 'Select the text and copy it by hand.' });
    }
  }

  return (
    <section aria-label="Generated post" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {state.category ? (
          <Badge variant="ai">{state.category}</Badge>
        ) : running ? (
          <Badge variant="outline">Classifying…</Badge>
        ) : null}
        {request ? (
          <Text size="sm" muted as="span">
            {request.tone === 'company' ? 'Company voice' : 'Personal voice'}
            {format ? ` · ${format.label}` : ''}
          </Text>
        ) : null}
      </div>

      {state.hook ? (
        <SpeechBubble variant="ai" className="whitespace-pre-wrap" aria-label="Hook">
          {state.hook}
        </SpeechBubble>
      ) : running ? (
        <Skeleton className="h-16" aria-label="Writing the hook" />
      ) : null}

      {parts.length > 0 ? (
        <ol className="m-0 flex list-none flex-col gap-3 p-0">
          {parts.map((part, index) => (
            <PartCard
              // Parts have no identity of their own and are never reordered
              // here: the list is replaced whole by the `content` event, and an
              // `image` event changes one part in place. Position is the key.
              // biome-ignore lint/suspicious/noArrayIndexKey: see above
              key={index}
              part={part}
              index={index}
              total={parts.length}
              limit={limit}
              imagePending={index === 0 && imageExpected}
            />
          ))}
        </ol>
      ) : running && state.hook ? (
        <Skeleton className="h-32" aria-label="Writing the post" />
      ) : null}

      {state.sources && state.sources.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="type-label text-sm text-ink">
            Backed by research
          </h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {state.sources.map((source) => (
              <li key={source.url} className="flex flex-col gap-0.5">
                <a
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 font-sans text-sm font-bold text-ink underline outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
                >
                  {source.title}
                  <ExternalLink className="h-3.5 w-3.5" strokeWidth={2.5} />
                </a>
                <Text size="xs" muted>
                  {source.snippet}
                </Text>
              </li>
            ))}
          </ul>
        </div>
      ) : state.phase !== 'running' && parts.length > 0 ? (
        <Text size="xs" muted>
          Written without web research.
        </Text>
      ) : null}

      {openError ? <Alert variant="danger">{openError}</Alert> : null}

      {parts.length > 0 && !running ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void openInComposer()} disabled={opening}>
            <PenSquare className="h-4 w-4" strokeWidth={2.5} />
            {opening ? 'Opening…' : 'Open in composer'}
          </Button>
          <Button variant="secondary" onClick={() => void copy()} disabled={opening}>
            <Copy className="h-4 w-4" strokeWidth={2.5} />
            Copy
          </Button>
          <Button variant="secondary" onClick={onRegenerate} disabled={opening}>
            <RefreshCw className="h-4 w-4" strokeWidth={2.5} />
            Regenerate
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function PartCard({
  part,
  index,
  total,
  limit,
  imagePending,
}: {
  part: GeneratedPart;
  index: number;
  total: number;
  limit: CharacterLimit | null;
  imagePending: boolean;
}) {
  const length = limit ? measureLength(part.text, limit.lengthMethod) : part.text.length;
  const over = limit !== null && length > limit.maxLength;

  return (
    <li data-testid="ai-result-part" data-index={index + 1}>
      <Card className="flex flex-col gap-3 border-2 p-4 shadow-surfaceSm">
        <div className="flex items-center justify-between gap-3">
          <span className="type-label text-sm text-ink">
            {total > 1 ? `Part ${index + 1} of ${total}` : 'Post'}
          </span>
          <span
            className={cn(
              'font-sans text-xs font-medium text-ink',
              over ? 'font-bold text-actionDanger' : 'opacity-70',
            )}
            title={
              limit
                ? `${length.toLocaleString()} of ${limit.maxLength.toLocaleString()} characters for ${limit.platform}`
                : `${length.toLocaleString()} characters`
            }
          >
            {length.toLocaleString()}
            {limit ? ` / ${limit.maxLength.toLocaleString()}` : ''}
          </span>
        </div>

        <p className="m-0 whitespace-pre-wrap font-sans text-sm text-ink">{part.text}</p>

        {part.image ? (
          <figure className="m-0 flex flex-col gap-1">
            {/* biome-ignore lint/performance/noImgElement: a library item served from media storage, as the media tile shows it */}
            <img
              src={part.image.url}
              alt={part.imagePrompt ?? 'Generated hero image'}
              className="max-h-72 w-full rounded-md border-2 border-outline object-cover"
            />
            {part.imagePrompt ? (
              <figcaption className="font-sans text-xs font-medium text-ink opacity-70">
                {part.imagePrompt}
              </figcaption>
            ) : null}
          </figure>
        ) : imagePending ? (
          <Skeleton className="h-40 w-full" aria-label="Generating the hero image" />
        ) : null}
      </Card>
    </li>
  );
}
