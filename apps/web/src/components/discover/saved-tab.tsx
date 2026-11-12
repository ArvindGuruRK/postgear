'use client';

/**
 * The Saved tab (Module 10, backlog #3): the cards anyone in the workspace
 * kept to come back to, newest first, each with who saved it, when, and the
 * place it was read in.
 *
 * A saved card is a box you read, like the cards it came from, so it sits on
 * `bg-inset`. It keeps the actions that still make sense days later: Create
 * Post (in the place and language it was read in), Open, and a note anyone
 * in the workspace can write ("Use this for the Pongal carousel"). The filled
 * bookmark takes it back off the list, the same control that put it there.
 *
 * Nothing here is fetched again: a saved card is the copy that was saved, so
 * it still reads the same after the trend has gone.
 */
import { PencilIcon } from '@animateicons/react/lucide/pencil-icon';
import { ExternalLinkIcon } from '@animateicons/react/lucide/external-link-icon';
import { Button, cn, EmptyState, ErrorState, MotionIcon, Skeleton, Textarea } from '@postgear/ui';
import { Bookmark, StickyNote } from 'lucide-react';
import { useId, useState } from 'react';
import { formatRelative } from '../seo/seo-view-model';
import type { DiscoverItem, Locality, SavedIdea } from '@/types/discover';
import { IDEA_NOTE_MAX } from '@/types/discover';
import { ActionLink } from '../home/home-actions';
import type { CreatePostTarget } from './create-post-sheet';
import { SaveButton } from './discover-cards';
import { WORLDWIDE_PLACE, openHref, safeHref } from './discover-model';
import type { SavedIdeasHandle } from './use-saved-ideas';

export const SAVED_EMPTY_TITLE = 'Nothing saved yet.';
export const SAVED_LOAD_FAILED_TITLE = 'Your saved ideas could not load';
export const SAVED_EMPTY_HINT =
  'Press the bookmark on any card to keep it here for everyone in your workspace.';

/** What a saved card was, in a word, ahead of where it came from. */
const KIND_NAMES: Record<DiscoverItem['kind'], string> = {
  trend: 'Trend',
  news: 'Story',
  wiki: 'Wikipedia',
  social: 'Social post',
  video: 'Video',
  festival: 'Festival',
  competitor: 'Competitor post',
};

/**
 * The place a card was saved in, as Create Post needs it: the country and the
 * language it was read in. The saved label stands in for the names.
 */
export function savedLocality(idea: SavedIdea): Locality {
  if (!idea.place.countryCode) {
    return { ...WORLDWIDE_PLACE, languages: [idea.language], newsLanguages: [idea.language] };
  }
  return {
    countryCode: idea.place.countryCode,
    countryName: idea.place.label,
    regionCode: null,
    regionName: null,
    city: null,
    timeZone: null,
    languages: [idea.language],
    newsLanguages: [idea.language],
  };
}

/** "Saved by Asha 2 hours ago, read in Chennai". Someone who left the workspace is left out. */
export function savedLine(idea: SavedIdea, now: Date): string {
  const who = idea.savedBy?.name ? `Saved by ${idea.savedBy.name}` : 'Saved';
  return `${who} ${formatRelative(idea.createdAt, now)}, read in ${idea.place.label}`;
}

function NoteEditor({
  idea,
  onSave,
  onClose,
}: {
  idea: SavedIdea;
  onSave: (note: string | null) => Promise<boolean>;
  onClose: () => void;
}) {
  const fieldId = useId();
  const [text, setText] = useState(idea.note ?? '');
  const [saving, setSaving] = useState(false);
  const left = IDEA_NOTE_MAX - text.length;

  async function save() {
    if (saving) return;
    setSaving(true);
    const trimmed = text.trim();
    const done = await onSave(trimmed.length > 0 ? trimmed : null);
    setSaving(false);
    if (done) onClose();
  }

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={fieldId} className="sr-only">
        Note for {idea.item.title}
      </label>
      <Textarea
        id={fieldId}
        value={text}
        maxLength={IDEA_NOTE_MAX}
        rows={3}
        placeholder="Enter your note"
        autoFocus
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose();
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void save();
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => void save()} disabled={saving}>
          Save Note
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <span
          className={cn(
            'ms-auto font-sans text-xs tabular-nums text-ink type-muted',
            left < 20 && 'text-actionDanger',
          )}
          aria-live="polite"
        >
          {left} left
        </span>
      </div>
    </div>
  );
}

function SavedCard({
  idea,
  now,
  saved,
  onCreatePost,
}: {
  idea: SavedIdea;
  now: Date;
  saved: SavedIdeasHandle;
  onCreatePost?: (target: CreatePostTarget) => void;
}) {
  const titleId = useId();
  const [editing, setEditing] = useState(false);
  const { item } = idea;
  const href = safeHref(openHref(item));
  const pending = idea.id.startsWith('pending:');

  return (
    <article
      aria-labelledby={titleId}
      data-testid="discover-saved-idea"
      className="flex min-w-0 animate-fadeIn flex-col gap-3 rounded-lg border-2 border-outline bg-inset p-4 motion-reduce:animate-none"
    >
      <p dir="auto" className="m-0 font-sans text-xs text-ink type-muted">
        {KIND_NAMES[item.kind]}, {item.source.name}
      </p>
      <h3 id={titleId} dir="auto" className="m-0 break-words type-heading text-base text-ink">
        {item.title}
      </h3>
      {item.summary && item.kind !== 'video' ? (
        <p dir="auto" className="m-0 line-clamp-2 font-sans text-sm text-ink">
          {item.summary}
        </p>
      ) : null}

      {editing ? (
        <NoteEditor
          idea={idea}
          onSave={(note) => saved.updateNote(idea, note)}
          onClose={() => setEditing(false)}
        />
      ) : idea.note ? (
        <blockquote
          dir="auto"
          data-testid="discover-saved-note"
          className="m-0 flex gap-2 rounded-md border-2 border-outline bg-secondary p-3 font-sans text-sm text-ink"
        >
          <StickyNote aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 whitespace-pre-line break-words">{idea.note}</span>
        </blockquote>
      ) : null}

      <p className="m-0 font-sans text-xs text-ink type-muted">{savedLine(idea, now)}</p>

      <div className="mt-auto flex items-center gap-2 pt-1">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {onCreatePost ? (
            <Button
              variant="secondary"
              size="sm"
              aria-label={`Create Post for ${item.title}`}
              onClick={() =>
                onCreatePost({ item, place: savedLocality(idea), language: idea.language })
              }
            >
              Create Post
            </Button>
          ) : null}
          {href ? (
            <ActionLink
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              prefetch={false}
              aria-label={`Open ${item.title} in a new tab`}
            >
              <MotionIcon icon={ExternalLinkIcon} className="h-4 w-4" />
              Open
            </ActionLink>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1 self-end">
          {!editing && !pending ? (
            <Button
              variant="ghost"
              size="sm"
              className="w-9 px-0"
              aria-label={
                idea.note ? `Edit the note on ${item.title}` : `Add a note to ${item.title}`
              }
              title={idea.note ? 'Edit note' : 'Add note'}
              onClick={() => setEditing(true)}
            >
              <MotionIcon icon={PencilIcon} className="h-4 w-4" />
            </Button>
          ) : null}
          <SaveButton
            item={item}
            save={{ saved: true, busy: pending, onToggle: () => void saved.remove(idea) }}
          />
        </div>
      </div>
    </article>
  );
}

function SavedSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} className="h-48 rounded-lg" />
      ))}
    </div>
  );
}

export interface SavedTabProps {
  saved: SavedIdeasHandle;
  now: Date;
  onCreatePost?: (target: CreatePostTarget) => void;
}

export function SavedTab({ saved, now, onCreatePost }: SavedTabProps) {
  if (saved.loading && saved.ideas.length === 0) return <SavedSkeleton />;

  if (saved.error && saved.ideas.length === 0) {
    return (
      <ErrorState
        title={SAVED_LOAD_FAILED_TITLE}
        description={saved.error}
        action={{ label: 'Try Again', onClick: saved.reload, variant: 'secondary' }}
      />
    );
  }

  if (saved.ideas.length === 0) {
    return <EmptyState icon={Bookmark} title={SAVED_EMPTY_TITLE} description={SAVED_EMPTY_HINT} />;
  }

  return (
    <section aria-label="Saved ideas" className="flex flex-col gap-3" aria-busy={saved.loading}>
      <p className="m-0 font-sans text-sm text-ink type-muted" data-testid="discover-saved-count">
        {saved.ideas.length} of {saved.limit} saved, shared with your workspace.
      </p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {saved.ideas.map((idea) => (
          <SavedCard
            key={idea.id}
            idea={idea}
            now={now}
            saved={saved}
            onCreatePost={onCreatePost}
          />
        ))}
      </div>
    </section>
  );
}
