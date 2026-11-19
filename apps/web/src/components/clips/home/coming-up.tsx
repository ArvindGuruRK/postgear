'use client';

/**
 * Coming Up on the Create tab (Module 17 section 6, CL-11.3): the waiting
 * posts in the next 14 days that use a clip, soonest first, five at most and
 * "and N more". Each row opens its post in the composer; View Calendar opens
 * the week of the first. Drawn once the workspace has an exported clip, and
 * read again when the composer closes over the page.
 */
import { Button, buttonVariants } from '@postgear/ui';
import { formatClipLength } from '@postgear/video-engine';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';
import { AnalyticsPanel, PanelHeader } from '@/components/analytics/analytics-ui';
import { cameBackFromComposer, useFocusAfterComposer } from '@/components/composer/composer-return';
import { PlatformIcon } from '@/components/platforms/platform-icon';
import { ApiError } from '@/lib/api';
import { getComingUp } from '@/lib/clips-api';
import type { ComingUpItem, ComingUpView } from '@/types/clips';
import { composerHref } from '../editor/send-model';
import { ClipPosterBox } from '../library/clip-card';
import {
  COMING_UP_EMPTY,
  COMING_UP_FAILED,
  COMING_UP_SUB,
  COMING_UP_TITLE,
  calendarWeekHref,
  comingUpWhen,
  moreLine,
} from './coming-up-model';

/** Channel marks shown on a row before "+N". */
const MARKS = 5;

function useComingUp(orgId: string) {
  const [data, setData] = useState<ComingUpView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Back from the composer: a post may have been scheduled, moved or deleted.
  const pathname = usePathname();
  const lastPath = useRef(pathname);
  useEffect(() => {
    const previous = lastPath.current;
    lastPath.current = pathname;
    if (cameBackFromComposer(previous, pathname, orgId)) setTick((value) => value + 1);
  }, [pathname, orgId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `tick` is the explicit reload trigger
  useEffect(() => {
    const abort = new AbortController();
    setError(null);
    getComingUp({ signal: abort.signal })
      .then((answer) => {
        if (!abort.signal.aborted) setData(answer);
      })
      .catch((cause: unknown) => {
        if (abort.signal.aborted) return;
        setError(
          cause instanceof ApiError && cause.status !== 0 ? cause.message : COMING_UP_FAILED,
        );
      });
    return () => abort.abort();
  }, [tick]);

  return { data, error, reload: () => setTick((value) => value + 1) };
}

export function ComingUp({ orgId, onSendAClip }: { orgId: string; onSendAClip: () => void }) {
  const headingId = useId();
  const { data, error, reload } = useComingUp(orgId);
  const opened = useRef<HTMLElement | null>(null);
  useFocusAfterComposer(orgId, () => opened.current);

  if (error && !data) {
    return (
      <AnalyticsPanel aria-labelledby={headingId} className="flex flex-col gap-4 p-5">
        <PanelHeader id={headingId} title={COMING_UP_TITLE} />
        <div className="flex flex-wrap items-center gap-3">
          <p className="m-0 font-sans text-sm text-ink">{error}</p>
          <Button variant="secondary" size="sm" onClick={reload}>
            Try Again
          </Button>
        </div>
      </AnalyticsPanel>
    );
  }
  if (!data?.anyExported) return null;

  const first = data.items[0];
  const more = moreLine(data.total, data.items.length);

  return (
    <AnalyticsPanel
      aria-labelledby={headingId}
      className="flex flex-col gap-4 p-5"
      data-testid="clips-coming-up"
    >
      <PanelHeader
        id={headingId}
        title={COMING_UP_TITLE}
        sub={COMING_UP_SUB}
        aside={
          first ? (
            <Link
              href={calendarWeekHref(orgId, first.publishDate)}
              className={buttonVariants({ variant: 'secondary', size: 'sm' })}
            >
              View Calendar
            </Link>
          ) : null
        }
      />
      {first ? (
        <>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {data.items.map((item) => (
              <li key={`${item.group}:${item.clip.id}`}>
                <ComingUpRow
                  item={item}
                  orgId={orgId}
                  onOpen={(element) => {
                    opened.current = element;
                  }}
                />
              </li>
            ))}
          </ul>
          {more ? <p className="m-0 font-sans text-sm text-ink type-muted">{more}</p> : null}
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-3" data-testid="clips-coming-up-empty">
          <p className="m-0 min-w-0 flex-1 font-sans text-sm text-ink type-muted">
            {COMING_UP_EMPTY}
          </p>
          <Button variant="secondary" size="sm" onClick={onSendAClip}>
            Send A Clip
          </Button>
        </div>
      )}
    </AnalyticsPanel>
  );
}

function ComingUpRow({
  item,
  orgId,
  onOpen,
}: {
  item: ComingUpItem;
  orgId: string;
  onOpen: (element: HTMLElement) => void;
}) {
  const when = comingUpWhen(item.publishDate);
  const marks = item.channels.slice(0, MARKS);
  const extra = item.channels.length - marks.length;
  const channelNames = item.channels.map((channel) => channel.name).join(', ');
  return (
    <Link
      href={composerHref(orgId, item.group)}
      onClick={(event) => onOpen(event.currentTarget)}
      aria-label={`${item.clip.title}, ${when}, on ${channelNames}. Open in the composer.`}
      className="flex items-center gap-3 rounded-md border-2 border-outline bg-inset p-2 outline-none hover:bg-secondary focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
      data-testid="clips-coming-up-row"
    >
      {/* A size container: the poster box fits its shape inside it. */}
      <span
        className="flex h-14 w-14 shrink-0 items-center justify-center"
        style={{ containerType: 'size' }}
      >
        <ClipPosterBox
          clip={{ ratio: item.clip.ratio, poster: item.clip.poster, preview: null }}
          previewing={false}
        />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate font-sans text-sm text-ink type-ui">{item.clip.title}</span>
        <span className="flex items-center gap-1.5" aria-hidden="true">
          {marks.map((channel) => (
            <PlatformIcon
              key={channel.id}
              platform={channel.providerIdentifier}
              title={channel.name}
              className="h-4 w-4"
            />
          ))}
          {extra > 0 ? (
            <span className="font-sans text-xs text-ink type-muted">+{extra}</span>
          ) : null}
          <span className="font-sans text-xs text-ink tabular-nums type-muted">
            {formatClipLength(item.clip.durationMs)}
          </span>
        </span>
      </span>
      <span className="shrink-0 font-sans text-sm text-ink tabular-nums type-ui">{when}</span>
    </Link>
  );
}
