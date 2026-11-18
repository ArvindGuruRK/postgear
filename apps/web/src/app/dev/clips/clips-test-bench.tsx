'use client';

/**
 * The Clips test bench (Sprint 12, Module 05 section 5): the whole thin slice
 * on one page, against the real API, with no page of the product in between.
 *
 * 1. **Import Sample**: one of the three simulation links (`POST /clips/videos`).
 * 2. **Make A 20 Second Clip**: from 30 seconds in (`POST /clips`); the light
 *    copy then plays the clip's range in a plain `<video>`.
 * 3. **Export**: at the chosen quality (`POST /clips/:clipId/exports`), with
 *    Cancel while it runs; the exported file then plays in a second `<video>`.
 *
 * Five buttons seek both players to the same moment of the clip, so the
 * sample's burnt-in counter can be compared by eye. Each step shows its job
 * through `useClipJob` (the view, the live stream, polling as the fallback).
 */
import { ClapperboardIcon } from '@animateicons/react/lucide/clapperboard-icon';
import { ComponentIcon } from '@animateicons/react/lucide/component-icon';
import { MailIcon } from '@animateicons/react/lucide/mail-icon';
import { PaletteIcon } from '@animateicons/react/lucide/palette-icon';
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Checkbox,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@postgear/ui';
import { EXPORT_QUALITIES, QUALITY_LABELS } from '@postgear/video-engine';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isTerminalJob } from '@/components/clips/clip-job-model';
import { useClipJob } from '@/components/clips/use-clip-job';
import { AppShell } from '@/components/navigation/app-shell';
import type { SidebarItem } from '@/components/navigation/sidebar';
import { ApiError, api } from '@/lib/api';
import {
  cancelClipJob,
  createClip,
  exportClip,
  getClip,
  getClipVideo,
  importClipVideo,
} from '@/lib/clips-api';
import type { ClipDetail, ClipJobView, ClipVideoView, ExportQuality } from '@/types/clips';
import type { MediaItem } from '@/types/media';
import {
  benchClipRange,
  compareMoments,
  formatMoment,
  SAMPLE_LINKS,
  type SampleId,
} from './test-bench-model';

const NAV_ITEMS: SidebarItem[] = [
  { label: 'Design System', href: '/dev/components', animatedIcon: ComponentIcon },
  { label: 'Templates', href: '/dev/studio', animatedIcon: PaletteIcon },
  { label: 'Emails', href: '/dev/emails', animatedIcon: MailIcon },
  { label: 'Clips', href: '/dev/clips', animatedIcon: ClapperboardIcon, active: true },
];

const RIGHTS_TEXT = 'This video is mine, or I have permission to use it.';
const UNREACHABLE = 'The API could not be reached. Is it running?';

function sentenceOf(cause: unknown): string {
  if (cause instanceof ApiError) return cause.status === 0 ? UNREACHABLE : cause.message;
  return 'Something went wrong. Try again.';
}

/** The clip's range of the light copy, in the video's time, from its document. */
function rangeOf(detail: ClipDetail | null): { fromMs: number; toMs: number } | null {
  const segments = detail?.clip.document?.segments ?? [];
  if (segments.length === 0) return null;
  return {
    fromMs: Math.min(...segments.map((segment) => segment.sourceIn)),
    toMs: Math.max(...segments.map((segment) => segment.sourceOut)),
  };
}

export function ClipsTestBench() {
  // Step 1
  const [sample, setSample] = useState<SampleId>('twitch');
  const [rights, setRights] = useState(false);
  const [video, setVideo] = useState<ClipVideoView | null>(null);
  const [importJobId, setImportJobId] = useState<string | null>(null);
  // Step 2
  const [clip, setClip] = useState<ClipDetail | null>(null);
  const [segmentJobId, setSegmentJobId] = useState<string | null>(null);
  // Step 3
  const [quality, setQuality] = useState<ExportQuality>('1080p');
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const [exported, setExported] = useState<MediaItem | null>(null);

  const [busy, setBusy] = useState<'import' | 'clip' | 'export' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const importJob = useClipJob(importJobId);
  const segmentJob = useClipJob(segmentJobId);
  const exportJob = useClipJob(exportJobId);

  const proxyPlayer = useRef<HTMLVideoElement>(null);
  const exportPlayer = useRef<HTMLVideoElement>(null);
  const [moment, setMoment] = useState<number | null>(null);

  // The import ended: read the video again for its length and READY status.
  // Keyed on the id only: this effect sets the video itself.
  const importStatus = importJob.job?.status;
  const videoId = video?.id ?? null;
  useEffect(() => {
    if (!videoId || !importStatus || !isTerminalJob(importStatus)) return;
    const controller = new AbortController();
    getClipVideo(videoId, { signal: controller.signal })
      .then(({ video: fresh }) => setVideo(fresh))
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(sentenceOf(cause));
      });
    return () => controller.abort();
  }, [importStatus, videoId]);

  // The sharp range arrived: read the clip again, so "sharp" says so.
  const segmentStatus = segmentJob.job?.status;
  const clipId = clip?.clip.id ?? null;
  useEffect(() => {
    if (!clipId || !segmentStatus || !isTerminalJob(segmentStatus)) return;
    const controller = new AbortController();
    getClip(clipId, { signal: controller.signal })
      .then(setClip)
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) setError(sentenceOf(cause));
      });
    return () => controller.abort();
  }, [clipId, segmentStatus]);

  // The export ended: find its Media row and play it.
  const exportStatus = exportJob.job?.status;
  useEffect(() => {
    if (!clipId || exportStatus !== 'DONE') return;
    const controller = new AbortController();
    (async () => {
      const detail = await getClip(clipId, { signal: controller.signal });
      setClip(detail);
      const mediaId = detail.clip.exportedMediaId;
      if (!mediaId) throw new Error('The export finished without a Media row.');
      const { media } = await api<{ media: MediaItem }>(`/media/${encodeURIComponent(mediaId)}`, {
        signal: controller.signal,
      });
      setExported(media);
    })().catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(sentenceOf(cause));
    });
    return () => controller.abort();
  }, [clipId, exportStatus]);

  const run = useCallback(async (step: NonNullable<typeof busy>, work: () => Promise<void>) => {
    setBusy(step);
    setError(null);
    try {
      await work();
    } catch (cause) {
      setError(sentenceOf(cause));
    } finally {
      setBusy(null);
    }
  }, []);

  const importSample = () =>
    run('import', async () => {
      const link = SAMPLE_LINKS.find((entry) => entry.id === sample) ?? SAMPLE_LINKS[0];
      const outcome = await importClipVideo(link.url, rights);
      setClip(null);
      setSegmentJobId(null);
      setExportJobId(null);
      setExported(null);
      setVideo(outcome.video);
      setImportJobId(outcome.job?.id ?? null);
    });

  const range = benchClipRange(video?.durationMs ?? null);
  const makeClip = () =>
    run('clip', async () => {
      if (!video || !range) return;
      const made = await createClip(video.id, range.fromMs, range.toMs);
      setExportJobId(null);
      setExported(null);
      setSegmentJobId(made.job?.id ?? null);
      setClip(await getClip(made.clip.id));
    });

  const startExport = () =>
    run('export', async () => {
      if (!clipId) return;
      setExported(null);
      const job = await exportClip(clipId, quality);
      setExportJobId(job.id);
    });

  const cancelExport = () =>
    run('cancel', async () => {
      if (!exportJobId) return;
      await cancelClipJob(exportJobId);
      exportJob.refresh();
    });

  // The proxy plays only the clip's range: it starts at the range and stops at its end.
  const clipRange = rangeOf(clip);
  const toStart = () => {
    const player = proxyPlayer.current;
    if (player && clipRange) player.currentTime = clipRange.fromMs / 1000;
  };
  const stopAtEnd = () => {
    const player = proxyPlayer.current;
    if (player && clipRange && player.currentTime * 1000 >= clipRange.toMs) {
      player.pause();
      player.currentTime = clipRange.toMs / 1000;
    }
  };

  const compareAt = (atMs: number) => {
    setMoment(atMs);
    const proxy = proxyPlayer.current;
    const output = exportPlayer.current;
    if (proxy && clipRange) {
      proxy.pause();
      proxy.currentTime = (clipRange.fromMs + atMs) / 1000;
    }
    if (output) {
      output.pause();
      output.currentTime = atMs / 1000;
    }
  };

  const videoReady = video?.status === 'READY';
  const importRunning = importJob.job ? !isTerminalJob(importJob.job.status) : false;
  const exportRunning = exportJob.job ? !isTerminalJob(exportJob.job.status) : false;

  return (
    <AppShell navItems={NAV_ITEMS} pageTitle="Clips Test Bench" saveThemeToAccount={false}>
      <div className="flex flex-col gap-6 pb-16">
        <p className="m-0 font-sans text-sm text-ink type-muted">
          Runs the real API as you, in the workspace you opened last. The sample links answer only
          when the API and the worker run with CLIPS_SIMULATION=true.
        </p>

        {error && (
          <Alert variant="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-6 xl:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle>1. Import Sample</CardTitle>
              <CardDescription>One of the three simulation videos.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Select value={sample} onValueChange={(value) => setSample(value as SampleId)}>
                <SelectTrigger aria-label="Sample video">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SAMPLE_LINKS.map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label htmlFor="bench-rights" className="flex items-start gap-2">
                <Checkbox
                  id="bench-rights"
                  checked={rights}
                  onCheckedChange={(checked) => setRights(checked === true)}
                />
                <span className="font-sans text-sm text-ink type-muted">{RIGHTS_TEXT}</span>
              </label>
              <Button onClick={importSample} disabled={busy !== null || importRunning}>
                {busy === 'import' ? 'Importing...' : 'Import Sample'}
              </Button>
              <JobLine job={importJob.job} error={importJob.error} />
              {video && (
                <p className="m-0 font-sans text-sm text-ink">
                  {video.title}
                  {video.durationMs !== null && ` (${formatMoment(video.durationMs)})`}
                  {videoReady ? ', ready.' : video.status === 'FAILED' ? ', failed.' : ''}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>2. Make A 20 Second Clip</CardTitle>
              <CardDescription>From 30 seconds in, or earlier on a short video.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Button onClick={makeClip} disabled={busy !== null || !videoReady || range === null}>
                {busy === 'clip' ? 'Making...' : 'Make A 20 Second Clip'}
              </Button>
              {videoReady && range === null && (
                <p className="m-0 font-sans text-sm text-ink type-muted">
                  This video is shorter than 20 seconds.
                </p>
              )}
              <JobLine job={segmentJob.job} error={segmentJob.error} />
              {clip && (
                <p className="m-0 font-sans text-sm text-ink">
                  {clip.clip.title}. Sharp video:{' '}
                  {clip.sharp === 'ready'
                    ? 'stored.'
                    : clip.sharp === 'fetching'
                      ? 'still coming.'
                      : 'gone, exports use the light copy.'}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>3. Export</CardTitle>
              <CardDescription>Renders the clip and saves it to Media.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Select value={quality} onValueChange={(value) => setQuality(value as ExportQuality)}>
                <SelectTrigger aria-label="Export quality">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPORT_QUALITIES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {QUALITY_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex flex-wrap gap-3">
                <Button onClick={startExport} disabled={busy !== null || !clipId || exportRunning}>
                  {busy === 'export' ? 'Starting...' : 'Export'}
                </Button>
                {exportRunning && (
                  <Button variant="secondary" onClick={cancelExport} disabled={busy !== null}>
                    {busy === 'cancel' ? 'Cancelling...' : 'Cancel'}
                  </Button>
                )}
              </div>
              <JobLine job={exportJob.job} error={exportJob.error} />
              {exported && (
                <p className="m-0 font-sans text-sm text-ink">
                  In Media as {exported.name}
                  {exported.width && exported.height
                    ? `, ${exported.width} by ${exported.height}.`
                    : '.'}
                </p>
              )}
            </CardContent>
          </Card>
        </div>

        {clip && (
          <Card>
            <CardHeader>
              <CardTitle>Compare</CardTitle>
              <CardDescription>
                Both players jump to the same moment of the clip. The counters should match.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                {compareMoments(clip.clip.durationMs).map((entry) => (
                  <Button
                    key={entry.label}
                    variant="secondary"
                    size="sm"
                    onClick={() => compareAt(entry.atMs)}
                    disabled={!clip.playback}
                  >
                    {entry.label}
                  </Button>
                ))}
                {moment !== null && (
                  <span className="font-sans text-sm text-ink type-muted">
                    At {formatMoment(moment)} of the clip
                  </span>
                )}
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                <figure className="m-0 flex flex-col gap-2">
                  <figcaption className="font-sans text-sm text-ink type-muted">
                    Light copy, the clip's range
                  </figcaption>
                  {clip.playback ? (
                    // biome-ignore lint/a11y/useMediaCaption: a silent test sample with no words to caption.
                    <video
                      ref={proxyPlayer}
                      src={clip.playback.url}
                      controls
                      preload="auto"
                      onLoadedMetadata={toStart}
                      onTimeUpdate={stopAtEnd}
                      className="aspect-video w-full rounded-sm border-2 border-ink bg-inset"
                    />
                  ) : (
                    <p className="m-0 font-sans text-sm text-ink type-muted">
                      The light copy is not available.
                    </p>
                  )}
                </figure>
                <figure className="m-0 flex flex-col gap-2">
                  <figcaption className="font-sans text-sm text-ink type-muted">
                    Exported file
                  </figcaption>
                  {exported ? (
                    // biome-ignore lint/a11y/useMediaCaption: a silent test sample with no words to caption.
                    <video
                      ref={exportPlayer}
                      src={exported.url}
                      controls
                      preload="auto"
                      className="aspect-video w-full rounded-sm border-2 border-ink bg-inset"
                    />
                  ) : (
                    <p className="m-0 font-sans text-sm text-ink type-muted">
                      Export the clip to compare it here.
                    </p>
                  )}
                </figure>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

/** One job's progress under its step: the step in words, the bar, and the outcome. */
function JobLine({ job, error }: { job: ClipJobView | null; error: string | null }) {
  if (error) {
    return (
      <Alert variant="danger">
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }
  if (!job) return null;
  if (job.status === 'FAILED') {
    return (
      <Alert variant="danger">
        <AlertDescription>{job.error?.message ?? 'This step failed.'}</AlertDescription>
      </Alert>
    );
  }
  if (job.status === 'CANCELLED') {
    return <p className="m-0 font-sans text-sm text-ink type-muted">Cancelled.</p>;
  }
  if (job.status === 'DONE') {
    return <p className="m-0 font-sans text-sm text-ink">Done.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 font-sans text-sm text-ink">
        <span>{job.stageLabel}</span>
        <span className="type-muted">{Math.round(job.progress)}%</span>
      </div>
      <Progress value={job.progress} aria-label={job.stageLabel} />
    </div>
  );
}
