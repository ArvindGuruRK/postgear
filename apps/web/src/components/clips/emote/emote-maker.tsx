'use client';

/**
 * Emote Maker (Sprint 13, Module 14): three seconds of a video made into
 * chat emotes. Desktop only, like every Clips screen.
 *
 * Left: Pick A Clip (the workspace's clips and ready videos), the light copy
 * playing the stretch on a loop with the square crop box over it, the trim
 * bar, Background (Keep It or Remove A Colour with the eyedropper and
 * Similarity), Flip and Still Frame, the three export buttons and the result
 * card. Right: the preview at 112, 56 and 28 px and the Chat Preview.
 *
 * One export press is one job and one of the day's downloads; no AI minutes.
 * The request waits up to 25 seconds; past that the card follows the job.
 * Nothing typed in the chat line leaves the page.
 */
import { ArrowLeftIcon } from '@animateicons/react/lucide/arrow-left-icon';
import { ArrowLeftRightIcon } from '@animateicons/react/lucide/arrow-left-right-icon';
import { PauseIcon } from '@animateicons/react/lucide/pause-icon';
import { PipetteIcon } from '@animateicons/react/lucide/pipette-icon';
import { PlayIcon } from '@animateicons/react/lucide/play-icon';
import {
  Alert,
  Button,
  Card,
  EmptyState,
  MotionIcon,
  PageActions,
  Segmented,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  Slider,
  Toggle,
} from '@postgear/ui';
import type { EmoteCrop, EmoteFrame, EmotePlatform } from '@postgear/video-engine';
import { Clapperboard, TriangleAlert } from 'lucide-react';
import { type MouseEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ActionLink } from '@/components/home/home-actions';
import { ApiError } from '@/lib/api';
import { getVideo } from '@/lib/clips-api';
import { exportEmote, getEmote, saveEmoteFile } from '@/lib/clips-emotes-api';
import type { ClipVideoDetail } from '@/types/clips';
import type { EmoteView } from '@/types/clips-emotes';
import { ChatPreview } from './chat-preview';
import { CropBox, CropNote } from './crop-box';
import {
  clampCrop,
  creatorToolsHref,
  DEFAULT_SIMILARITY,
  defaultCrop,
  EMOTE_CHECK_RULES_LINE,
  EMOTE_EXPORTS,
  EMOTE_OWN_STREAM_LINE,
  type EmoteSourceOption,
  KEY_EDGE_LINE,
  NO_SOURCE_LINE,
  NO_VIDEOS_LINE,
  rgbToHex,
  type Stretch,
  stretchFromRange,
} from './emote-model';
import { EmotePreview, type EmoteLook, pickColour } from './emote-preview';
import { EmoteResult } from './emote-result';
import { TrimBar } from './trim-bar';

const FOLLOW_EVERY_MS = 1_500;
const DEFAULT_KEY_COLOUR = '#00b140';

type Background = 'keep' | 'remove';
const BACKGROUND_OPTIONS = [
  { value: 'keep' as const, label: 'Keep It' },
  { value: 'remove' as const, label: 'Remove A Colour' },
];

interface Loaded {
  detail: ClipVideoDetail;
  frame: EmoteFrame;
  durationMs: number;
}

export interface EmoteMakerProps {
  orgId: string;
  sources: EmoteSourceOption[];
  initial: EmoteSourceOption | null;
}

export function EmoteMaker({ orgId, sources, initial }: EmoteMakerProps) {
  const [source, setSource] = useState<EmoteSourceOption | null>(initial);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [stretch, setStretch] = useState<Stretch>({ startMs: 0, lengthMs: 3_000 });
  const [crop, setCrop] = useState<EmoteCrop>({ x: 0, y: 0, size: 16 });
  const [background, setBackground] = useState<Background>('keep');
  const [keyColour, setKeyColour] = useState(DEFAULT_KEY_COLOUR);
  const [similarity, setSimilarity] = useState(DEFAULT_SIMILARITY);
  const [picking, setPicking] = useState(false);
  const [flip, setFlip] = useState(false);
  const [still, setStill] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [playheadMs, setPlayheadMs] = useState<number | null>(null);
  const [exporting, setExporting] = useState<EmotePlatform | null>(null);
  const [result, setResult] = useState<EmoteView | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const mirrors = useRef(new Set<HTMLCanvasElement>());
  const follow = useRef<AbortController | null>(null);
  const sourceId = useId();
  const flipId = useId();
  const stillId = useId();
  const similarityId = useId();

  // ---- The video ---------------------------------------------------------------------

  useEffect(() => {
    if (!source) return;
    const controller = new AbortController();
    setLoaded(null);
    setLoadError(null);
    setResult(null);
    setRefusal(null);
    getVideo(source.videoId, { signal: controller.signal })
      .then((detail) => {
        const durationMs = detail.video.durationMs ?? 0;
        if (!detail.playback || !detail.proxy || durationMs <= 0) {
          setLoadError('This video is still being prepared. Try again when it is ready.');
          return;
        }
        const frame = { width: detail.proxy.width, height: detail.proxy.height };
        setLoaded({ detail, frame, durationMs });
        setStretch(stretchFromRange(source.fromMs, source.toMs, durationMs));
        setCrop(defaultCrop(frame));
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof ApiError ? error.message : 'We could not open this video.');
      });
    return () => controller.abort();
  }, [source]);

  const endMs = stretch.startMs + stretch.lengthMs;

  // Seek to the start whenever the stretch moves.
  useEffect(() => {
    const element = video.current;
    if (!element || !loaded) return;
    element.currentTime = stretch.startMs / 1_000;
  }, [stretch.startMs, loaded]);

  // Loop the stretch while it plays.
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const element = video.current;
      if (!element) return;
      const nowMs = element.currentTime * 1_000;
      if (nowMs >= endMs || nowMs < stretch.startMs - 100) {
        element.currentTime = stretch.startMs / 1_000;
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, stretch.startMs, endMs]);

  const togglePlay = () => {
    const element = video.current;
    if (!element) return;
    if (element.paused) {
      void element.play().then(
        () => setPlaying(true),
        () => setPlaying(false),
      );
    } else {
      element.pause();
      setPlaying(false);
    }
  };

  const onPick = (event: MouseEvent<HTMLButtonElement>) => {
    const element = video.current;
    if (!element || !loaded) return;
    const box = event.currentTarget.getBoundingClientRect();
    const point = {
      x: ((event.clientX - box.left) / box.width) * loaded.frame.width,
      y: ((event.clientY - box.top) / box.height) * loaded.frame.height,
    };
    const colour = pickColour(element, loaded.frame, point);
    setPicking(false);
    if (colour) setKeyColour(rgbToHex(colour[0], colour[1], colour[2]));
  };

  // ---- The preview -------------------------------------------------------------------

  const key = useMemo(
    () => (background === 'remove' ? { color: keyColour, similarity } : null),
    [background, keyColour, similarity],
  );
  const look: EmoteLook | null = useMemo(
    () => (loaded ? { crop, frame: loaded.frame, flip, key } : null),
    [loaded, crop, flip, key],
  );

  const mirrorRef = useCallback((element: HTMLCanvasElement | null) => {
    if (!element) return;
    mirrors.current.add(element);
    return () => {
      mirrors.current.delete(element);
    };
  }, []);

  const renderEmote = useCallback(
    (index: number) => (
      <canvas key={index} ref={mirrorRef} width={56} height={56} className="h-7 w-7 align-middle" />
    ),
    [mirrorRef],
  );

  // ---- Export ------------------------------------------------------------------------

  useEffect(() => () => follow.current?.abort(), []);

  const followJob = (jobId: string) => {
    follow.current?.abort();
    const controller = new AbortController();
    follow.current = controller;
    const check = () => {
      if (controller.signal.aborted) return;
      getEmote(jobId, { signal: controller.signal })
        .then((view) => {
          if (controller.signal.aborted) return;
          setResult(view);
          if (['DONE', 'FAILED', 'CANCELLED'].includes(view.job.status)) {
            setExporting(null);
            return;
          }
          setTimeout(check, FOLLOW_EVERY_MS);
        })
        .catch(() => {
          if (!controller.signal.aborted) setTimeout(check, FOLLOW_EVERY_MS * 2);
        });
    };
    setTimeout(check, FOLLOW_EVERY_MS);
  };

  const runExport = async (platform: EmotePlatform) => {
    if (!loaded || !source) return;
    follow.current?.abort();
    setExporting(platform);
    setRefusal(null);
    setResult(null);
    const stillAt = video.current
      ? Math.round((video.current.currentTime * 1_000) / 100) * 100
      : stretch.startMs;
    try {
      const outcome = await exportEmote({
        videoId: source.videoId,
        platform,
        startMs: stretch.startMs,
        endMs,
        crop: clampCrop(crop, loaded.frame),
        key,
        flip,
        still,
        stillAtMs: still ? Math.min(Math.max(stillAt, stretch.startMs), endMs) : null,
      });
      setResult(outcome);
      if (outcome.finished) setExporting(null);
      else followJob(outcome.job.id);
    } catch (error) {
      setExporting(null);
      setRefusal(
        error instanceof ApiError ? error.message : 'We could not make this emote. Try again.',
      );
    }
  };

  const save = async (name: string) => {
    if (!result) return;
    setSaving(name);
    try {
      const saved = await saveEmoteFile(result.job.id, name);
      if (!saved) setResult(await getEmote(result.job.id));
    } catch (error) {
      setRefusal(
        error instanceof ApiError ? error.message : 'We could not get this file. Try again.',
      );
    } finally {
      setSaving(null);
    }
  };

  // ---- Layout ------------------------------------------------------------------------

  const pickSource = (value: string) => {
    const next = sources.find((option) => option.value === value) ?? null;
    setPlaying(false);
    setSource(next);
  };

  const clips = sources.filter((option) => option.kind === 'clip');
  const videos = sources.filter((option) => option.kind === 'video');

  return (
    <div className="flex flex-col gap-4" data-testid="emote-maker">
      <PageActions className="justify-start">
        <ActionLink href={creatorToolsHref(orgId)} data-testid="emote-back">
          <MotionIcon icon={ArrowLeftIcon} className="h-4 w-4" />
          Back To Creator Tools
        </ActionLink>
      </PageActions>

      {sources.length === 0 ? (
        <EmptyState icon={Clapperboard} title={NO_VIDEOS_LINE} />
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_22rem] gap-6">
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex items-center gap-3">
              <label htmlFor={sourceId} className="shrink-0 font-sans text-sm font-bold text-ink">
                Clip or video
              </label>
              <Select value={source?.value ?? ''} onValueChange={pickSource}>
                <SelectTrigger id={sourceId} className="max-w-md" data-testid="emote-source">
                  <SelectValue placeholder="Pick A Clip" />
                </SelectTrigger>
                <SelectContent>
                  {clips.length > 0 ? (
                    <SelectGroup>
                      <SelectLabel>Clips</SelectLabel>
                      {clips.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ) : null}
                  {videos.length > 0 ? (
                    <SelectGroup>
                      <SelectLabel>Videos</SelectLabel>
                      {videos.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  ) : null}
                </SelectContent>
              </Select>
            </div>

            {!source ? (
              <p className="m-0 font-sans text-sm text-ink type-muted">{NO_SOURCE_LINE}</p>
            ) : loadError ? (
              <Alert variant="warning" className="items-center">
                <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
                <p className="m-0 min-w-0 flex-1">{loadError}</p>
              </Alert>
            ) : !loaded ? (
              <div className="aspect-video w-full animate-pulse rounded-card border-2 border-outline bg-inset" />
            ) : (
              <>
                <div
                  className="relative w-full overflow-hidden rounded-card border-2 border-outline bg-inset"
                  style={{ aspectRatio: `${loaded.frame.width} / ${loaded.frame.height}` }}
                >
                  <video
                    ref={video}
                    src={loaded.detail.playback?.url}
                    crossOrigin="anonymous"
                    muted
                    playsInline
                    preload="auto"
                    className="absolute inset-0 h-full w-full"
                    onTimeUpdate={(event) => setPlayheadMs(event.currentTarget.currentTime * 1_000)}
                    onPause={() => setPlaying(false)}
                    data-testid="emote-video"
                  />
                  <CropBox frame={loaded.frame} crop={crop} onChange={setCrop} disabled={picking} />
                  {picking ? (
                    <button
                      type="button"
                      aria-label="Pick The Colour Here"
                      className="absolute inset-0 cursor-crosshair"
                      onClick={onPick}
                      data-testid="emote-eyedropper-layer"
                    />
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={togglePlay}
                    data-testid="emote-play"
                  >
                    <MotionIcon icon={playing ? PauseIcon : PlayIcon} className="h-4 w-4" />
                    {playing ? 'Pause' : 'Play'}
                  </Button>
                  <CropNote crop={crop} />
                </div>
                <TrimBar
                  durationMs={loaded.durationMs}
                  stretch={stretch}
                  onChange={setStretch}
                  playheadMs={playheadMs}
                />

                <Card className="flex flex-col gap-3 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-sans text-sm font-bold text-ink">Background</span>
                    <Segmented
                      label="Background"
                      value={background}
                      onValueChange={(value) => {
                        setBackground(value);
                        if (value === 'keep') setPicking(false);
                      }}
                      options={BACKGROUND_OPTIONS}
                      tight
                    />
                  </div>
                  {background === 'remove' ? (
                    <>
                      <div className="flex flex-wrap items-center gap-3">
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setPicking((value) => !value)}
                          aria-pressed={picking}
                          data-testid="emote-eyedropper"
                        >
                          <MotionIcon icon={PipetteIcon} className="h-4 w-4" />
                          {picking ? 'Click The Video' : 'Pick A Colour'}
                        </Button>
                        <span
                          className="h-7 w-7 rounded-md border-2 border-outline"
                          style={{ backgroundColor: keyColour }}
                          aria-label={`Colour ${keyColour}`}
                          role="img"
                        />
                        <label
                          htmlFor={similarityId}
                          className="font-sans text-sm font-bold text-ink"
                        >
                          Similarity
                        </label>
                        <Slider
                          id={similarityId}
                          className="w-48"
                          min={0.01}
                          max={1}
                          step={0.01}
                          value={[similarity]}
                          aria-label="Similarity"
                          onValueChange={([value]) => setSimilarity(value ?? DEFAULT_SIMILARITY)}
                        />
                        <span className="font-sans text-sm tabular-nums text-ink">
                          {similarity.toFixed(2)}
                        </span>
                      </div>
                      <p className="m-0 font-sans text-sm text-ink type-muted">{KEY_EDGE_LINE}</p>
                    </>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-6">
                    <div className="flex items-center gap-2">
                      <Toggle id={flipId} checked={flip} onCheckedChange={setFlip} />
                      <label
                        htmlFor={flipId}
                        className="flex items-center gap-1 font-sans text-sm font-bold text-ink"
                      >
                        <MotionIcon icon={ArrowLeftRightIcon} className="h-4 w-4" />
                        Flip
                      </label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Toggle id={stillId} checked={still} onCheckedChange={setStill} />
                      <label htmlFor={stillId} className="font-sans text-sm font-bold text-ink">
                        Still frame for Twitch
                      </label>
                    </div>
                  </div>
                  {still ? (
                    <p className="m-0 font-sans text-sm text-ink type-muted">
                      The still is the picture under the playhead, as 112, 56 and 28 px PNG files.
                    </p>
                  ) : null}
                </Card>

                <Card className="flex flex-col gap-3 p-4">
                  <div className="flex flex-wrap gap-3">
                    {EMOTE_EXPORTS.map((entry) => (
                      <Button
                        key={entry.platform}
                        variant="secondary"
                        disabled={exporting !== null}
                        onClick={() => void runExport(entry.platform)}
                        data-testid={`emote-export-${entry.platform}`}
                      >
                        {entry.label}
                      </Button>
                    ))}
                  </div>
                  <div>
                    <p className="m-0 font-sans text-sm text-ink type-muted">
                      {EMOTE_OWN_STREAM_LINE}
                    </p>
                    <p className="m-0 font-sans text-sm text-ink type-muted">
                      {EMOTE_CHECK_RULES_LINE}
                    </p>
                  </div>
                  {refusal ? (
                    <Alert variant="warning" className="items-center" data-testid="emote-refusal">
                      <TriangleAlert
                        className="h-5 w-5 shrink-0"
                        strokeWidth={2.5}
                        aria-hidden="true"
                      />
                      <p className="m-0 min-w-0 flex-1">{refusal}</p>
                    </Alert>
                  ) : null}
                  {result ? (
                    <EmoteResult view={result} onSave={(name) => void save(name)} saving={saving} />
                  ) : null}
                </Card>
              </>
            )}
          </div>

          <aside className="flex flex-col gap-4">
            <Card className="flex flex-col gap-3 p-4">
              <h3 className="m-0 font-sans text-lg text-ink type-heading">Preview</h3>
              <EmotePreview video={video} look={look} mirrors={mirrors} />
            </Card>
            <Card className="p-4">
              <ChatPreview renderEmote={renderEmote} />
            </Card>
          </aside>
        </div>
      )}
    </div>
  );
}
