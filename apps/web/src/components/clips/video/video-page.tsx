'use client';

/**
 * One video's page (Module 07, section 3; Demo 2): play it with our own
 * controls, move around a timeline with pictures and the sound's shape, mark
 * a part with I and O, and press Create Clip. Edit Whole Video makes a clip
 * of the whole video (up to 30 minutes) and opens it in one press.
 *
 * Layout (desktop only): the actions row (back to Videos, the title, the
 * platform and length, Edit Whole Video); then the player with its bar and
 * the timeline on the left, and on the right Find Clips (Module 16,
 * `find-clips.tsx`) over this video's clips, AI picks first, with "How this
 * was found" under them. Each AI pick has a small flag on the timeline that
 * plays it.
 *
 * A video that is not ready shows its card (coming in, or failed) and the
 * way back. The light copy's signed address is renewed before it expires
 * without losing the place.
 */
import { ArrowLeftIcon } from '@animateicons/react/lucide/arrow-left-icon';
import { ScissorsIcon } from '@animateicons/react/lucide/scissors-icon';
import {
  Alert,
  Badge,
  Button,
  MotionIcon,
  PageActions,
  ToastAction,
  TooltipHint,
  toast,
  VideoPlayerBar,
} from '@postgear/ui';
import { CLIP_MAX_MS, formatVideoLength } from '@postgear/video-engine';
import { TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AnalyticsPanel, PanelHeader } from '@/components/analytics/analytics-ui';
import { ActionLink } from '@/components/home/home-actions';
import { createClip, createWholeClip, getVideo } from '@/lib/clips-api';
import type { ClipSummary, ClipVideoDetail, ClipView } from '@/types/clips';
import { PLATFORM_LABELS } from '../home/home-model';
import { EDIT_WHOLE_TOO_LONG, VideoCard } from '../home/video-card';
import { clipActions, clipErrorSentence } from '../library/clip-actions';
import { useClipSender } from '../library/use-clip-sender';
import { FindClips } from './find-clips';
import { foundByLine } from './find-clips-model';
import {
  type SourcePlayerStore,
  useFreshAddress,
  usePlayerSnapshot,
  useSourcePlayer,
} from './source-player';
import { SourceTimeline, type TimelineControls } from './source-timeline';
import { clipEditHref, VideoClipList } from './video-clip-list';
import {
  checkRange,
  JUMP_MS,
  LARGE_STEP_MS,
  type MarkedRange,
  markIn,
  markOut,
  NO_MARK,
  playerTimeText,
  STEP_MS,
  stepMs,
} from './video-page-model';
import { isTyping, videoShortcutFor } from './video-shortcuts';

export const PLAYBACK_FAILED =
  'The video stopped loading. Try again, and if it keeps happening reload the page.';
const NO_PLAYBACK = 'The preview of this video is not ready yet. Try again in a moment.';

/** A list row for a clip the API just answered with, and the part it plays. */
export function summaryOf(clip: ClipView, range: ClipSummary['range']): ClipSummary {
  return {
    id: clip.id,
    title: clip.title,
    status: clip.status,
    state: clip.state,
    origin: clip.origin,
    ratio: clip.ratio,
    durationMs: clip.durationMs,
    score: clip.score,
    reasons: clip.reasons,
    revision: clip.revision,
    exported: clip.exported,
    exportedMediaId: clip.exportedMediaId,
    // The clip answer does not carry it; a row that had a running export keeps its own.
    exportProgress: null,
    createdAt: clip.createdAt,
    updatedAt: clip.updatedAt,
    range,
  };
}

export function VideoPage({
  orgId,
  initial,
  initialClipId = null,
}: {
  orgId: string;
  initial: ClipVideoDetail;
  /** `?clip=`: the clip to open on (the editor's way back), selected with the player at its start. */
  initialClipId?: string | null;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState(initial);
  const [clips, setClips] = useState<ClipSummary[]>(initial.clips);
  const [mark, setMark] = useState<MarkedRange>(NO_MARK);
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    initial.clips.some((clip) => clip.id === initialClipId) ? initialClipId : null,
  );
  const [creating, setCreating] = useState(false);
  const [wholeBusy, setWholeBusy] = useState(false);
  const { video } = detail;
  const durationMs = video.durationMs ?? 0;
  const fps = detail.proxy?.fps ?? video.fps ?? 30;
  const store = useSourcePlayer(durationMs);
  const controls = useRef<TimelineControls | null>(null);
  const clipsId = useId();
  const videosHref = `/${encodeURIComponent(orgId)}/clips?tab=videos`;

  // Renew the signed addresses before they expire, keeping the place.
  const latestUrl = useRef(initial.playback?.url ?? null);
  latestUrl.current = detail.playback?.url ?? null;
  const refetch = useCallback(async () => {
    try {
      const next = await getVideo(video.id);
      // Only a new address reloads the element; keep the place across it.
      if (next.playback?.url !== latestUrl.current) store.holdPosition();
      setDetail(next);
      setClips(next.clips);
    } catch (cause) {
      toast({ title: clipErrorSentence(cause), variant: 'danger' });
    }
  }, [store, video.id]);
  useFreshAddress(store, detail.playback?.expiresAt ?? null, () => void refetch());
  const settleRun = useCallback(() => void refetch(), [refetch]);
  const foundBy = foundByLine(detail.highlights?.run ?? null);

  // Back from the editor: the player opens at the clip's start.
  const openedFrom = useRef(initial.clips.find((clip) => clip.id === initialClipId)?.range ?? null);
  useEffect(() => {
    if (openedFrom.current) store.startAt(openedFrom.current.fromMs);
  }, [store]);

  const sender = useClipSender(orgId);
  const actions = clipActions({
    onChanged: (clip) =>
      setClips((current) =>
        current.map((one) =>
          one.id === clip.id
            ? { ...summaryOf(clip, one.range), exportProgress: one.exportProgress }
            : one,
        ),
      ),
    onAdded: (clip, source) => setClips((current) => [summaryOf(clip, source.range), ...current]),
    onRemoved: (clipId) => setClips((current) => current.filter((one) => one.id !== clipId)),
    onStale: () => void refetch(),
    send: sender.open,
  });

  const check = checkRange(mark);

  const create = useCallback(async () => {
    const range = checkRange(mark);
    if (!range.ok || creating) return;
    setCreating(true);
    try {
      const { clip } = await createClip(video.id, range.fromMs, range.toMs);
      setClips((current) => [
        summaryOf(clip, { fromMs: range.fromMs, toMs: range.toMs }),
        ...current,
      ]);
      setSelectedId(clip.id);
      setMark(NO_MARK);
      toast({
        title: 'Clip created.',
        action: (
          <ToastAction altText="Edit" onClick={() => router.push(clipEditHref(orgId, clip.id))}>
            Edit
          </ToastAction>
        ),
      });
    } catch (cause) {
      toast({ title: clipErrorSentence(cause), variant: 'warning' });
    } finally {
      setCreating(false);
    }
  }, [creating, mark, orgId, router, video.id]);

  const tooLongForWhole = durationMs > CLIP_MAX_MS;
  const editWhole = async () => {
    if (tooLongForWhole || wholeBusy) return;
    setWholeBusy(true);
    try {
      const { clip } = await createWholeClip(video.id);
      router.push(clipEditHref(orgId, clip.id));
    } catch (cause) {
      toast({ title: clipErrorSentence(cause), variant: 'warning' });
      setWholeBusy(false);
    }
  };

  // One keyboard table for the page; nothing fires while typing or in a dialog.
  const latest = useRef({ mark, create, durationMs });
  latest.current = { mark, create, durationMs };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTyping(event.target)) return;
      const command = videoShortcutFor(event);
      if (!command) return;
      const target = event.target as HTMLElement | null;
      // A focused button, link or slider keeps its own Space, Enter and arrows.
      if (
        target?.closest?.('button, a, [role="slider"], [role="button"], [role="tab"]') &&
        (event.key === ' ' || event.key === 'Enter' || event.key.startsWith('Arrow'))
      ) {
        return;
      }
      const { mark: current, durationMs: length } = latest.current;
      const at = store.getCurrentMs();
      event.preventDefault();
      switch (command) {
        case 'togglePlay':
          store.toggle();
          break;
        case 'pause':
          store.pause();
          break;
        case 'back':
          store.seek(stepMs(at, -JUMP_MS, length));
          break;
        case 'forward':
          store.seek(stepMs(at, JUMP_MS, length));
          break;
        case 'stepBack':
          store.seek(stepMs(at, -STEP_MS, length));
          break;
        case 'stepForward':
          store.seek(stepMs(at, STEP_MS, length));
          break;
        case 'stepBackLarge':
          store.seek(stepMs(at, -LARGE_STEP_MS, length));
          break;
        case 'stepForwardLarge':
          store.seek(stepMs(at, LARGE_STEP_MS, length));
          break;
        case 'markIn':
          setMark(markIn(current, at, length));
          break;
        case 'markOut':
          setMark(markOut(current, at, length));
          break;
        case 'createClip':
          void latest.current.create();
          break;
        case 'zoomIn':
          controls.current?.zoomIn();
          break;
        case 'zoomOut':
          controls.current?.zoomOut();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);

  const header = (
    <PageActions className="justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <ActionLink href={videosHref}>
          <MotionIcon icon={ArrowLeftIcon} className="h-4 w-4" />
          Videos
        </ActionLink>
        <p
          className="m-0 min-w-0 truncate font-sans text-lg text-ink type-heading"
          title={video.title}
        >
          {video.title}
        </p>
        <Badge variant="outline">{PLATFORM_LABELS[video.platform]}</Badge>
        {durationMs > 0 ? (
          <span className="shrink-0 font-sans text-sm text-ink type-muted">
            {formatVideoLength(durationMs)}
          </span>
        ) : null}
      </div>
      {video.status === 'READY' ? (
        <TooltipHint
          label={EDIT_WHOLE_TOO_LONG}
          hidden={!tooLongForWhole}
          disabled={tooLongForWhole}
        >
          <Button
            variant="secondary"
            size="sm"
            disabled={tooLongForWhole || wholeBusy}
            onClick={() => void editWhole()}
          >
            <MotionIcon icon={ScissorsIcon} className="h-4 w-4" />
            {wholeBusy ? 'Making The Clip' : 'Edit Whole Video'}
          </Button>
        </TooltipHint>
      ) : null}
    </PageActions>
  );

  if (video.status !== 'READY') {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <ul className="m-0 grid max-w-sm list-none p-0">
          <VideoCard
            card={{ video, job: detail.job, clipCount: clips.length }}
            orgId={orgId}
            actions={{
              onCancel: async () => router.push(videosHref),
              onRetry: async () => router.push(videosHref),
              onDelete: async () => router.push(videosHref),
              onSettled: () => void refetch(),
            }}
          />
        </ul>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {header}
      <div className="grid grid-cols-[minmax(0,1fr)_380px] items-start gap-5">
        <div className="flex min-w-0 flex-col gap-5">
          <AnalyticsPanel className="flex flex-col gap-3 p-4">
            <PlayerArea
              store={store}
              src={detail.playback?.url ?? null}
              onRetry={() => void refetch()}
            />
            <PlayerBar store={store} durationMs={durationMs}>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setMark(markIn(mark, store.getCurrentMs(), durationMs))}
              >
                Mark Start
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setMark(markOut(mark, store.getCurrentMs(), durationMs))}
              >
                Mark End
              </Button>
              <TooltipHint
                label={check.ok ? 'Create Clip' : check.reason}
                shortcut={['Enter']}
                disabled={!check.ok}
              >
                <Button size="sm" disabled={!check.ok || creating} onClick={() => void create()}>
                  {creating ? 'Creating' : 'Create Clip'}
                </Button>
              </TooltipHint>
            </PlayerBar>
            {!check.ok && check.lengthMs !== null ? (
              <p className="m-0 font-sans text-sm text-ink" role="status">
                {check.reason}
              </p>
            ) : null}
          </AnalyticsPanel>
          <AnalyticsPanel className="p-4">
            <SourceTimeline
              store={store}
              durationMs={durationMs}
              fps={fps}
              filmstrip={detail.filmstrip}
              waveform={detail.waveform}
              mark={mark}
              onMarkChange={setMark}
              clips={clips}
              selectedClipId={selectedId}
              onSelectClip={(clip) => {
                setSelectedId(clip.id);
                if (clip.range) store.seek(clip.range.fromMs);
              }}
              onPlayClip={(clip) => {
                setSelectedId(clip.id);
                if (clip.range) store.playRange(clip.range.fromMs, clip.range.toMs);
              }}
              controlRef={controls}
            />
          </AnalyticsPanel>
        </div>

        <AnalyticsPanel aria-labelledby={clipsId} className="flex flex-col gap-4 p-4">
          <FindClips
            orgId={orgId}
            videoId={video.id}
            highlights={detail.highlights}
            clips={clips}
            onSettled={settleRun}
          />
          <PanelHeader
            id={clipsId}
            title="Clips"
            sub={clips.length === 1 ? '1 clip' : `${clips.length} clips`}
          />
          <VideoClipList
            orgId={orgId}
            clips={clips}
            selectedId={selectedId}
            actions={actions}
            onSelect={(clip) => {
              setSelectedId(clip.id);
              if (clip.range) store.seek(clip.range.fromMs);
            }}
            onPlay={(clip) => {
              setSelectedId(clip.id);
              if (clip.range) store.playRange(clip.range.fromMs, clip.range.toMs);
            }}
          />
          {foundBy ? (
            <p
              className="m-0 font-sans text-xs text-ink type-muted"
              data-testid="find-clips-found-by"
            >
              {foundBy}
            </p>
          ) : null}
        </AnalyticsPanel>
      </div>
      {sender.dialog}
    </div>
  );
}

/** The `<video>` itself: a click plays or pauses; a failure says so with Try Again. */
function PlayerArea({
  store,
  src,
  onRetry,
}: {
  store: SourcePlayerStore;
  src: string | null;
  onRetry: () => void;
}) {
  const { failed } = usePlayerSnapshot(store);
  if (!src) {
    return (
      <Alert variant="warning" className="items-center">
        <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
        <p className="m-0 min-w-0 flex-1">{NO_PLAYBACK}</p>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try Again
        </Button>
      </Alert>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {/* biome-ignore lint/a11y/useMediaCaption: a person's own video, with no captions to give */}
      <video
        ref={store.attach}
        src={src}
        preload="metadata"
        playsInline
        data-testid="source-player"
        onClick={store.toggle}
        className="aspect-video w-full rounded-md border-2 border-outline bg-black object-contain"
      />
      {failed ? (
        <Alert variant="danger" className="items-center">
          <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">{PLAYBACK_FAILED}</p>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try Again
          </Button>
        </Alert>
      ) : null}
    </div>
  );
}

/** The bar under the player: it alone follows the clock for its time text. */
function PlayerBar({
  store,
  durationMs,
  children,
}: {
  store: SourcePlayerStore;
  durationMs: number;
  children: React.ReactNode;
}) {
  const { playing, currentMs, ready } = usePlayerSnapshot(store);
  return (
    <VideoPlayerBar
      playing={playing}
      disabled={!ready}
      onTogglePlay={store.toggle}
      onBack={() => store.seek(stepMs(currentMs, -JUMP_MS, durationMs))}
      onForward={() => store.seek(stepMs(currentMs, JUMP_MS, durationMs))}
      timeText={playerTimeText(currentMs, durationMs)}
      backLabel="Back 5 Seconds"
      forwardLabel="Forward 5 Seconds"
      playLabel="Play"
      pauseLabel="Pause"
      backShortcut={['J']}
      forwardShortcut={['L']}
      playShortcut={['Space']}
    >
      {children}
    </VideoPlayerBar>
  );
}
