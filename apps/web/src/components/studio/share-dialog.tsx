'use client';

/**
 * Share (DS-9.1, sprint Task 7): a link anyone can open without signing in,
 * so a manager can look at a design before it goes out.
 *
 * The share page draws the design as the server has it, so Create Link saves
 * what is on screen first (`flush`). When that save cannot happen (offline, a
 * conflict, a refusal), a warning says the link would show the version before
 * the newest changes, and Create Link Anyway goes ahead regardless.
 *
 * The API keeps only a hash of each token, so a link's address exists in one
 * answer only, the one that created it. It is shown under a warning, as every
 * once-only secret is (rules section 16d), until the dialog closes, and the
 * list of active links says why older ones cannot be copied again.
 * Everything the dialog holds lives in `ShareLinks`, which mounts with the
 * dialog's content: reopening starts fresh, and an answer that arrives after
 * the dialog closed is dropped.
 */
import { CopyIcon } from '@animateicons/react/lucide/copy-icon';
import { ExternalLinkIcon } from '@animateicons/react/lucide/external-link-icon';
import { LinkIcon } from '@animateicons/react/lucide/link-icon';
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  buttonVariants,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  FormField,
  FormHelperText,
  FormLabel,
  Input,
  MotionIcon,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
} from '@postgear/ui';
import { Check, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { ShareView } from '@/types/studio';
import { FOCUS } from './design-card';
import {
  createdLabel,
  dayLabel,
  listedShare,
  mergeShares,
  NOT_VIEWED,
  problemOf,
  revokeLabel,
  shareLinkOf,
  viewedLabel,
} from './share-model';
import { INSET, useNow } from './studio-ui';
import { DEFAULT_SHARE_DAYS, expiryLabel, SHARE_DAY_OPTIONS } from './studio-view-model';

const LOAD_FAILED = 'Your share links could not be loaded. Please try again.';
const CREATE_FAILED = 'The link could not be created. Please try again.';
const REVOKE_FAILED = 'The link could not be revoked. Please try again.';
const ADDRESS_MISSING = 'The new link could not be shown. Revoke it below and create another.';
const REVOKED = 'Share link revoked.';
const ALREADY_GONE = 'That link had already stopped working.';

export function ShareDialog({
  open,
  onOpenChange,
  designId,
  title,
  flush,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  designId: string;
  title: string;
  /** Saves what is on screen first, so the link shows it; false when it could not be saved. */
  flush: () => Promise<boolean>;
}) {
  // Opened from the editor's own button rather than a Radix trigger, so Radix
  // has nowhere to send focus back to on close: it goes to whatever had it.
  const opener = useRef<HTMLElement | null>(null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[90vh] flex-col p-0"
        onOpenAutoFocus={() => {
          const active = document.activeElement;
          opener.current =
            active instanceof HTMLElement && active !== document.body ? active : null;
        }}
        onCloseAutoFocus={(event) => {
          const target = opener.current;
          opener.current = null;
          if (target?.isConnected) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        <DialogHeader className="px-6 pt-6 pb-4 pe-14">
          <DialogTitle className="break-words">Share {title}</DialogTitle>
          <DialogDescription>
            Anyone with the link can view this design without signing in, and search engines do not
            index it.
          </DialogDescription>
        </DialogHeader>

        <ShareLinks designId={designId} flush={flush} />
      </DialogContent>
    </Dialog>
  );
}

type Phase = 'idle' | 'saving' | 'creating';

/** A message for the screen reader; `count` makes the same words a new announcement. */
interface Note {
  text: string;
  count: number;
}

/** Where focus goes when the revoke confirm closes: back to its row, or the row that took its place. */
type FocusAfter = { id: string } | { index: number } | null;

function ShareLinks({ designId, flush }: { designId: string; flush: () => Promise<boolean> }) {
  const id = useId();
  const now = useNow();
  const path = `/studio/designs/${encodeURIComponent(designId)}/shares`;

  const [shares, setShares] = useState<ShareView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [days, setDays] = useState<number>(DEFAULT_SHARE_DAYS);
  const [phase, setPhase] = useState<Phase>('idle');
  const [unsaved, setUnsaved] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [latest, setLatest] = useState<{ id: string; url: string } | null>(null);
  const [copyNote, setCopyNote] = useState<{ copied: boolean; count: number } | null>(null);
  const [confirming, setConfirming] = useState<ShareView | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<Note | null>(null);

  const alive = useRef(true);
  const loads = useRef(0);
  const working = useRef(false);
  // What this dialog made and revoked, so a list fetched before either still comes out right.
  const made = useRef<ShareView[]>([]);
  const revoked = useRef(new Set<string>());
  const focusAfter = useRef<FocusAfter>(null);
  // Said once the confirm has closed: while it is open, the dialog under it is hidden from
  // screen readers, and so is anything announced there.
  const pendingNote = useRef<string | null>(null);

  const list = useRef<HTMLUListElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const linkField = useRef<HTMLInputElement>(null);
  const copyButton = useRef<HTMLButtonElement>(null);

  const busy = phase !== 'idle';

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(() => {
    const request = ++loads.current;
    setLoadError(null);

    api<{ shares: ShareView[] }>(path)
      .then((result) => {
        if (!alive.current || request !== loads.current) return;
        setShares(mergeShares(result.shares.map(listedShare), made.current, revoked.current));
      })
      .catch((cause: unknown) => {
        if (!alive.current || request !== loads.current) return;
        setLoadError(problemOf(cause, LOAD_FAILED));
      });
  }, [path]);

  useEffect(() => {
    load();
  }, [load]);

  // Copying is what the person wants next.
  useEffect(() => {
    if (latest) copyButton.current?.focus();
  }, [latest]);

  function announce(text: string) {
    setAnnouncement((current) => ({ text, count: (current?.count ?? 0) + 1 }));
  }

  async function create(saveFirst: boolean) {
    if (working.current) return;
    working.current = true;
    setCreateError(null);

    try {
      if (saveFirst) {
        setPhase('saving');
        const saved = await flush().catch(() => false);
        if (!alive.current) return;
        if (!saved) {
          setUnsaved(true);
          return;
        }
      }

      setUnsaved(false);
      setPhase('creating');

      const { share } = await api<{ share: ShareView }>(path, {
        method: 'POST',
        body: { expiresInDays: days },
      });
      if (!alive.current) return;

      const listed = listedShare(share);
      made.current = [listed, ...made.current];
      setShares((current) =>
        current ? [listed, ...current.filter((entry) => entry.id !== listed.id)] : current,
      );
      setCopyNote(null);

      const url = shareLinkOf(share, window.location.origin);
      if (url) {
        setLatest({ id: share.id, url });
        announce(`Link created. It works for ${dayLabel(days)}.`);
      } else {
        setLatest(null);
        setCreateError(ADDRESS_MISSING);
      }
    } catch (cause) {
      if (alive.current) setCreateError(problemOf(cause, CREATE_FAILED));
    } finally {
      working.current = false;
      if (alive.current) setPhase('idle');
    }
  }

  function noteCopy(copied: boolean) {
    setCopyNote((current) => ({ copied, count: (current?.count ?? 0) + 1 }));
  }

  async function copy() {
    if (!latest) return;

    try {
      await navigator.clipboard.writeText(latest.url);
      if (alive.current) noteCopy(true);
    } catch {
      if (!alive.current) return;
      // An insecure origin or a denied permission: the link can still be copied by hand.
      linkField.current?.focus();
      linkField.current?.select();
      noteCopy(false);
    }
  }

  function revokeButtons(): HTMLButtonElement[] {
    return Array.from(
      list.current?.querySelectorAll<HTMLButtonElement>('button[data-share-id]') ?? [],
    );
  }

  function askRevoke(share: ShareView) {
    focusAfter.current = { id: share.id };
    setRevokeError(null);
    setConfirming(share);
  }

  /** Takes a link off the list at once, without a reload. */
  function removeShare(shareId: string, note: string) {
    const index = revokeButtons().findIndex((button) => button.dataset.shareId === shareId);
    focusAfter.current = index === -1 ? null : { index };
    pendingNote.current = note;

    revoked.current.add(shareId);
    setShares((current) => current?.filter((share) => share.id !== shareId) ?? current);
    setLatest((current) => (current?.id === shareId ? null : current));
    setConfirming(null);
  }

  async function revoke(event: React.MouseEvent) {
    // Kept open until the request settles, so an error has somewhere to show.
    event.preventDefault();
    const share = confirming;
    if (!share || revoking) return;

    setRevoking(true);
    setRevokeError(null);

    try {
      const result = await api<{ message?: string }>(`${path}/${encodeURIComponent(share.id)}`, {
        method: 'DELETE',
      });
      if (alive.current) removeShare(share.id, result.message ?? REVOKED);
    } catch (cause) {
      if (!alive.current) return;
      // Revoked in another tab, or its design deleted: the link no longer works either way.
      if (cause instanceof ApiError && cause.status === 404) removeShare(share.id, ALREADY_GONE);
      else setRevokeError(problemOf(cause, REVOKE_FAILED));
    } finally {
      if (alive.current) setRevoking(false);
    }
  }

  /**
   * After the confirm: back to the row's Revoke when it was kept, else the
   * Revoke of the row that moved up into its place (or the last one), else
   * the list's heading once no link is left.
   */
  function restoreFocus(event: Event) {
    event.preventDefault();
    const target = focusAfter.current;
    focusAfter.current = null;

    const buttons = revokeButtons();
    const button = !target
      ? undefined
      : 'id' in target
        ? buttons.find((entry) => entry.dataset.shareId === target.id)
        : buttons[Math.min(target.index, buttons.length - 1)];
    (button ?? heading.current)?.focus();

    const note = pendingNote.current;
    pendingNote.current = null;
    if (note) announce(note);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-6 pt-2 pb-6 pg-scrollbar pg-scrollbar-secondary">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <FormField className="min-w-0 flex-1">
            <FormLabel htmlFor={`${id}-days`}>How long the link works</FormLabel>
            {/* Radix Select is always modal, so its list sits above the dialog and takes focus. */}
            <Select
              value={String(days)}
              onValueChange={(value) => setDays(Number(value))}
              disabled={busy}
            >
              <SelectTrigger id={`${id}-days`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SHARE_DAY_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {dayLabel(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <Button className="shrink-0" disabled={busy} onClick={() => void create(true)}>
            <MotionIcon icon={LinkIcon} className="h-4 w-4" />
            {phase === 'saving'
              ? 'Saving changes…'
              : phase === 'creating'
                ? 'Creating…'
                : 'Create Link'}
          </Button>
        </div>

        {unsaved ? (
          <Alert variant="warning" role="status" className="flex-wrap items-center justify-between">
            <AlertDescription className="min-w-0 flex-1 basis-60">
              Your newest changes are not saved yet, so the link would show the version before them.
            </AlertDescription>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => void create(false)}
            >
              Create Link Anyway
            </Button>
          </Alert>
        ) : null}

        {createError ? (
          <Alert variant="danger">
            <AlertDescription>{createError}</AlertDescription>
          </Alert>
        ) : null}
      </div>

      {latest ? (
        <div data-testid="share-new-link" className="flex flex-col gap-3">
          {/* Shown once, like any secret (rules section 16d): only its hash is kept. */}
          <Alert variant="warning" role="status">
            <TriangleAlert className="h-4 w-4 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            <AlertDescription>
              Copy this link now. It is shown only once, so if you lose it, create a new one.
            </AlertDescription>
          </Alert>

          <FormField>
            <FormLabel htmlFor={`${id}-url`}>New link</FormLabel>
            <Input
              ref={linkField}
              id={`${id}-url`}
              data-testid="share-url"
              readOnly
              value={latest.url}
              spellCheck={false}
              onFocus={(event) => event.currentTarget.select()}
              aria-describedby={`${id}-url-hint`}
            />
            <FormHelperText id={`${id}-url-hint`}>
              It always shows the latest saved version of this design.
            </FormHelperText>
          </FormField>

          <div className="flex flex-wrap items-center gap-2">
            <Button ref={copyButton} variant="secondary" size="sm" onClick={() => void copy()}>
              <MotionIcon icon={CopyIcon} className="h-4 w-4" />
              Copy Link
            </Button>
            <a
              href={latest.url}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              <MotionIcon icon={ExternalLinkIcon} className="h-4 w-4" />
              Open Link
              <span className="sr-only">, opens in a new tab</span>
            </a>
          </div>

          <p
            role="status"
            aria-live="polite"
            className="m-0 min-h-4 font-sans text-xs font-bold text-ink"
          >
            {copyNote ? (
              <span key={copyNote.count} className="flex items-center gap-1.5">
                {copyNote.copied ? (
                  <Check aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={2.5} />
                ) : (
                  <TriangleAlert
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0"
                    strokeWidth={2.5}
                  />
                )}
                {copyNote.copied
                  ? 'Link copied to your clipboard.'
                  : 'Your browser blocked copying. The link is selected for you to copy.'}
              </span>
            ) : null}
          </p>
        </div>
      ) : null}

      <section aria-labelledby={`${id}-links`} className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h3
            ref={heading}
            id={`${id}-links`}
            tabIndex={-1}
            className={cn('m-0 self-start type-heading text-base text-ink', FOCUS)}
          >
            Active Links
          </h3>
          <p className="m-0 font-sans text-xs text-ink type-muted">
            A link can be copied only right after it is created, so older links cannot be shown
            again.
          </p>
        </div>

        {shares === null && loadError ? (
          <Alert variant="danger" className="flex-wrap items-center justify-between">
            <AlertDescription className="min-w-0 flex-1 basis-60">{loadError}</AlertDescription>
            <Button variant="secondary" size="sm" onClick={load}>
              Try Again
            </Button>
          </Alert>
        ) : shares === null ? (
          <div role="status" className="flex flex-col gap-2">
            <span className="sr-only">Loading share links…</span>
            <Skeleton className="h-16 w-full motion-reduce:animate-none" />
            <Skeleton className="h-16 w-full motion-reduce:animate-none" />
          </div>
        ) : shares.length === 0 ? (
          <p className="m-0 font-sans text-sm text-ink type-muted">
            No active links. Links you create show here until they expire or you revoke them.
          </p>
        ) : (
          <ul
            ref={list}
            data-testid="share-links"
            className="m-0 flex list-none flex-col gap-2 p-0"
          >
            {shares.map((share) => (
              <ShareRow key={share.id} share={share} now={now} onRevoke={askRevoke} />
            ))}
          </ul>
        )}
      </section>

      <p className="sr-only" role="status" aria-live="polite">
        {announcement ? <span key={announcement.count}>{announcement.text}</span> : null}
      </p>

      <AlertDialog
        open={confirming !== null}
        onOpenChange={(next) => {
          if (!next && !revoking) setConfirming(null);
        }}
      >
        <AlertDialogContent onCloseAutoFocus={restoreFocus}>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this link?</AlertDialogTitle>
            <AlertDialogDescription>
              Anyone with the link loses access at once. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {revokeError ? (
            <Alert variant="danger" className="mt-4">
              <AlertDescription>{revokeError}</AlertDescription>
            </Alert>
          ) : null}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={revoking}>Keep It</AlertDialogCancel>
            <AlertDialogAction variant="danger" onClick={revoke} disabled={revoking}>
              {revoking ? 'Revoking…' : 'Revoke'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * One active link: when it stops working, when it was made and whether
 * anyone has opened it, and its Revoke. Nothing time-relative is written
 * until the browser's clock has taken over from the server's.
 */
function ShareRow({
  share,
  now,
  onRevoke,
}: {
  share: ShareView;
  now: Date | null;
  onRevoke: (share: ShareView) => void;
}) {
  return (
    <li
      data-testid="share-link"
      className={cn(INSET, 'flex flex-wrap items-center gap-x-3 gap-y-2 p-3')}
    >
      <div className="flex min-w-0 flex-1 basis-40 flex-col gap-0.5">
        {now ? (
          <>
            <time dateTime={share.expiresAt} className="font-sans text-sm font-bold text-ink">
              {expiryLabel(share.expiresAt, now)}
            </time>
            <span className="flex flex-wrap gap-x-3 gap-y-0.5 font-sans text-xs text-ink type-muted">
              <time dateTime={share.createdAt}>{createdLabel(share.createdAt, now)}</time>
              {share.lastViewedAt ? (
                <time dateTime={share.lastViewedAt}>{viewedLabel(share.lastViewedAt, now)}</time>
              ) : (
                <span>{NOT_VIEWED}</span>
              )}
            </span>
          </>
        ) : null}
      </div>

      <Button
        variant="danger"
        size="sm"
        className="shrink-0"
        data-share-id={share.id}
        aria-label={now ? revokeLabel(share.expiresAt, now) : 'Revoke this link'}
        onClick={() => onRevoke(share)}
      >
        Revoke
      </Button>
    </li>
  );
}
