'use client';

/**
 * The reader (Sprint 11, Module 08, blueprint section 6): a right-hand sheet
 * that shows a story's own page as plain text, without leaving Discover.
 *
 * It opens two ways. **Read** on a card or a competitor's row reads that
 * item's page at once (a Google News link is turned into the publisher's
 * address by the API first, which is why that wait says "Opening the
 * story..."). **Read A Page** on the News tab opens it on an address field
 * instead (story DC-8.3), and the field stays after a read, so another page
 * can be read without closing anything.
 *
 * ## Only text, and only when asked
 *
 * A page is a stranger's markup. The API hands back text and nothing else,
 * and this file draws it as text nodes: one paragraph per `<p>`, never as
 * HTML. The picture, when there is one, leaves with no referrer and is taken
 * away if it fails, never left as a grey box. Nothing is read until a person
 * presses Read, and an answer that lands after the sheet closed, or after a
 * newer address was asked for, is dropped.
 *
 * ## When a page cannot be read
 *
 * The API says why in one sentence (private, not readable, not an article, a
 * link that would not open here, too many reads). That sentence replaces the
 * text, in the design system's warning `Alert`, and **Open** stays: the page
 * can always be opened in a new tab.
 *
 * ## Create Post From This
 *
 * The sheet's one call to action, enabled once an article is on screen. It
 * hands the Create Post sheet a brief built from the article
 * (`readerPostTarget` in `discover-model.ts`) and closes the reader.
 */
import { ExternalLinkIcon } from '@animateicons/react/lucide/external-link-icon';
import {
  Alert,
  AspectRatio,
  Button,
  cn,
  FormErrorMessage,
  FormField,
  FormLabel,
  Input,
  MotionIcon,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  Skeleton,
} from '@postgear/ui';
import { type FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import { readPage } from '@/lib/discover-api';
import type { DiscoverItem, Locality, ReaderArticle } from '@/types/discover';
import { INSET } from '../ai/ai-ui';
import { FOCUS } from '../analytics/analytics-ui';
import { ActionLink } from '../home/home-actions';
import { viewerTimeZone } from '../home/home-model';
import { websiteAddress } from './competitor-model';
import type { CreatePostTarget } from './create-post-sheet';
import {
  openHref,
  readerMeta,
  readerParagraphs,
  readerPostTarget,
  readHref,
  readResolvesLink,
  safeHref,
} from './discover-model';

/** What the reader is open on: an item's own page, or an address field. */
export type ReaderTarget = { mode: 'item'; item: DiscoverItem } | { mode: 'page' };

/** What the page hands the reader: what to read, and the place and language it was asked in. */
export interface ReadRequest {
  target: ReaderTarget;
  place: Locality;
  language: string;
}

export const READ_A_PAGE = 'Read A Page';
export const OPENING_STORY = 'Opening the story...';
export const READING_PAGE = 'Reading the page...';
/** Ours, for a read that never reached the API. The API says the same for a page it could not read. */
export const READ_FAILED = 'We could not read this page. Open it in a new tab instead.';
export const NOT_AN_ADDRESS = 'That does not look like a web address.';

type ReadState =
  | { phase: 'idle' }
  | { phase: 'loading'; asked: string; resolving: boolean }
  | { phase: 'done'; asked: string; article: ReaderArticle }
  | { phase: 'failed'; asked: string | null; message: string };

/** The API's own sentence for a refusal; ours when it never answered. */
function sentenceOf(cause: unknown): string {
  return cause instanceof ApiError && cause.status !== 0 ? cause.message : READ_FAILED;
}

/** Smaller than this, a "picture" is a tracking pixel or an icon, not the article's photo. */
export const MIN_PICTURE_WIDTH = 120;

/**
 * The article's picture: no referrer, and gone if it does not load. The box
 * stays closed until the picture is in (Module 10), so a slow or broken one
 * never leaves an empty frame at the top of the sheet, and a tracking pixel
 * counts as no picture. Not lazy: it is the first thing in view, and a lazy
 * picture inside a closed box would never be asked for.
 */
function HeroImage({ src }: { src: string }) {
  const [state, setState] = useState<'loading' | 'shown' | 'failed'>('loading');
  if (state === 'failed') return null;

  return (
    <AspectRatio
      ratio={16 / 9}
      data-state={state}
      className={cn(
        'shrink-0 overflow-hidden rounded-lg border-2 border-outline',
        state === 'loading' && 'invisible absolute h-0 w-0 border-0',
      )}
    >
      {/* biome-ignore lint/performance/noImgElement: a picture from the publisher's own host, with no remote pattern for the optimizer */}
      <img
        src={src}
        alt=""
        decoding="async"
        referrerPolicy="no-referrer"
        onLoad={(event) =>
          setState(event.currentTarget.naturalWidth >= MIN_PICTURE_WIDTH ? 'shown' : 'failed')
        }
        onError={() => setState('failed')}
        data-testid="reader-image"
        className="h-full w-full object-cover"
      />
    </AspectRatio>
  );
}

/**
 * An article as the reader draws it: the picture, then the text in a box you
 * read (the inset layer, no shadow), a paragraph at a time. It is the one part
 * of the sheet that scrolls, so it takes focus and can be moved by keyboard.
 * Text nodes only: nothing from the page is ever drawn as markup.
 */
export function ReaderArticleBody({
  article,
  className,
}: {
  article: Pick<ReaderArticle, 'text' | 'image'>;
  className?: string;
}) {
  const image = safeHref(article.image);

  return (
    <section
      aria-label="Article"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling region has to take focus to be scrolled by keyboard
      tabIndex={0}
      className={cn(
        'flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto rounded-lg',
        FOCUS,
        className,
      )}
    >
      {image ? <HeroImage src={image} /> : null}
      <div dir="auto" data-testid="reader-text" className={cn(INSET, 'p-4')}>
        <div className="mx-auto flex max-w-prose flex-col gap-3">
          {readerParagraphs(article.text).map((paragraph, index) => (
            <p
              // biome-ignore lint/suspicious/noArrayIndexKey: one article's paragraphs, in order, and two can be the same sentence
              key={index}
              dir="auto"
              className="m-0 break-words font-sans text-sm leading-relaxed text-ink"
            >
              {paragraph}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}

export interface ReaderSheetProps {
  /** Null is closed. */
  target: ReaderTarget | null;
  /** The place and the chip's language the page is being read in, for Create Post From This. */
  place: Locality | null;
  language: string | null;
  onClose: () => void;
  onCreatePost: (target: CreatePostTarget) => void;
}

export function ReaderSheet({ target, place, language, onClose, onCreatePost }: ReaderSheetProps) {
  // The last target stays on screen while the sheet slides shut, and every
  // opening is a session of its own, so the same card read twice reads twice.
  const [session, setSession] = useState<{ id: number; target: ReaderTarget | null }>({
    id: 0,
    target,
  });
  if (target !== null && target !== session.target) {
    setSession({ id: session.id + 1, target });
  }
  const shown = target ?? session.target;

  return (
    <Sheet open={target !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent
        className="max-w-xl"
        data-testid="reader-sheet"
        // The line over the title describes the sheet when there is one (`ReaderBody`).
        aria-describedby={undefined}
      >
        {shown ? (
          <ReaderBody
            key={session.id}
            target={shown}
            place={place}
            language={language}
            active={target !== null}
            onClose={onClose}
            onCreatePost={onCreatePost}
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function ReaderBody({
  target,
  place,
  language,
  active,
  onClose,
  onCreatePost,
}: {
  target: ReaderTarget;
  place: Locality | null;
  language: string | null;
  /** False once the sheet is closing: whatever is still on its way is nobody's. */
  active: boolean;
  onClose: () => void;
  onCreatePost: (target: CreatePostTarget) => void;
}) {
  const id = useId();
  const item = target.mode === 'item' ? target.item : null;
  const [state, setState] = useState<ReadState>({ phase: 'idle' });
  const [address, setAddress] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  // Counts the reads, so an answer that lands after a newer one began is dropped.
  const run = useRef(0);
  const alive = useRef(true);
  const started = useRef(false);
  const open = useRef(active);
  open.current = active;

  const read = useCallback((url: string, resolving: boolean) => {
    run.current += 1;
    const mine = run.current;
    const current = () => alive.current && open.current && run.current === mine;
    setState({ phase: 'loading', asked: url, resolving });

    readPage(url)
      .then((article) => {
        if (current()) setState({ phase: 'done', asked: url, article });
      })
      .catch((cause: unknown) => {
        if (current()) setState({ phase: 'failed', asked: url, message: sentenceOf(cause) });
      });
  }, []);

  // An item is read as the sheet opens, once: React runs an effect twice in
  // development, and a second read would count against the workspace's ten a minute.
  useEffect(() => {
    alive.current = true;
    if (!started.current) {
      started.current = true;
      if (item) {
        const url = readHref(item);
        if (url) read(url, readResolvesLink(item));
        else setState({ phase: 'failed', asked: null, message: READ_FAILED });
      }
    }
    return () => {
      alive.current = false;
    };
  }, [item, read]);

  function readTyped(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!address.trim() || state.phase === 'loading') return;

    const url = websiteAddress(address);
    if (!url) {
      setProblem(NOT_AN_ADDRESS);
      return;
    }
    setProblem(null);
    read(url, false);
  }

  const article = state.phase === 'done' ? state.article : null;
  const meta = article ? readerMeta(article, viewerTimeZone()) : '';
  // Where Open goes: where the page really was, else the card's own Open, else what was typed.
  const asked = state.phase === 'idle' ? null : state.asked;
  const openTo =
    (article ? safeHref(article.finalUrl) : null) ??
    (item ? safeHref(openHref(item)) : safeHref(asked));
  const title = article?.title || item?.title || READ_A_PAGE;
  const canDraft = article !== null && place !== null && language !== null;

  function createPost() {
    if (!article || !place || !language) return;
    onCreatePost(readerPostTarget(article, item, place, language));
    onClose();
  }

  return (
    <>
      <SheetHeader>
        {meta ? (
          <SheetDescription dir="auto" data-testid="reader-meta">
            {meta}
          </SheetDescription>
        ) : null}
        <SheetTitle dir="auto" className="break-words">
          {title}
        </SheetTitle>
      </SheetHeader>

      {target.mode === 'page' ? (
        <form onSubmit={readTyped} noValidate aria-label="Read a page">
          <FormField>
            <FormLabel htmlFor={`${id}-address`}>Page address</FormLabel>
            <div className="flex flex-wrap gap-2">
              <Input
                id={`${id}-address`}
                className="min-w-0 flex-1 basis-56"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="Enter your page address"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                variant={problem ? 'error' : 'default'}
              />
              <Button
                type="submit"
                variant="secondary"
                disabled={state.phase === 'loading' || address.trim() === ''}
              >
                Read
              </Button>
            </div>
            {problem ? <FormErrorMessage>{problem}</FormErrorMessage> : null}
          </FormField>
        </form>
      ) : null}

      {state.phase === 'loading' ? (
        <div
          aria-busy="true"
          role="status"
          data-testid="reader-loading"
          className="flex flex-col gap-3"
        >
          <p className="m-0 font-sans text-sm text-ink type-muted">
            {state.resolving ? OPENING_STORY : READING_PAGE}
          </p>
          <Skeleton className="h-40" />
          <Skeleton className="h-4 w-11/12" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </div>
      ) : null}

      {state.phase === 'failed' ? (
        <Alert variant="warning" data-testid="reader-error">
          {state.message}
        </Alert>
      ) : null}

      {article ? <ReaderArticleBody article={article} /> : null}

      <SheetFooter className="flex-wrap justify-start">
        <Button size="sm" onClick={createPost} disabled={!canDraft}>
          Create Post From This
        </Button>
        {openTo ? (
          <ActionLink
            href={openTo}
            target="_blank"
            rel="noopener noreferrer"
            prefetch={false}
            aria-label={`Open ${title} in a new tab`}
          >
            <MotionIcon icon={ExternalLinkIcon} className="h-4 w-4" />
            Open
          </ActionLink>
        ) : null}
      </SheetFooter>
    </>
  );
}
