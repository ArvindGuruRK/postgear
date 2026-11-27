'use client';

/**
 * Send To Composer for a clip (Module 17 section 3; blueprint section 10).
 *
 * - **Channels**: every channel of the workspace, each checked in the
 *   browser with `videoFit` against the exported file's facts. One that
 *   cannot take the clip is greyed, cannot be ticked, and says why under its
 *   name ("This clip is 2 min 10 s. Facebook takes up to 90 seconds.").
 * - **Caption**: the starting text for every channel, with its count.
 *   Per-channel edits, the time and each platform's details stay the
 *   composer's.
 * - **Open In Composer** makes the draft (`POST /clips/:clipId/send`) and
 *   hands its group to `onSent`, which opens the composer on it.
 * - **Out of date**: a clip changed since its export opens on a first step,
 *   Export Again (its progress here; the dialog goes on when it is done) or
 *   Send The Old Version.
 * - **No channels**: an empty state with the way to the Channels page.
 *
 * In the editor the export is the editor's own (`exportRun`: it saves first
 * and asks about removed items); from a card the dialog starts one itself at
 * the last export's quality.
 */
import { SendIcon } from '@animateicons/react/lucide/send-icon';
import {
  Alert,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  Checkbox,
  cn,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  FormErrorMessage,
  MotionIcon,
  Progress,
  Skeleton,
  Textarea,
} from '@postgear/ui';
import { bestAllowedQuality, type ExportQuality, qualityAllowed } from '@postgear/video-engine';
import { Radio, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { PlatformIcon } from '@/components/platforms/platform-icon';
import { ApiError, api } from '@/lib/api';
import { cancelClipJob, exportClip, listClipExports, sendClip } from '@/lib/clips-api';
import { useEntitlements } from '@/lib/entitlements';
import type { ChannelsResponse, ProviderSummary } from '@/types/channel';
import type { ClipExportView, ClipJobView } from '@/types/clips';
import { isTerminalJob } from '../clip-job-model';
import { useClipJob } from '../use-clip-job';
import { EXPORT_FAILED_SENTENCE, timeLeft } from './export-model';
import {
  CAPTION_MAX,
  type ChannelChoice,
  captionCount,
  channelChoices,
  factsOf,
  SEND_CHANNELS_FAILED,
  SEND_FAILED,
  SEND_NO_CHANNELS,
  SEND_OUTDATED,
  SEND_PICK_ONE,
  SEND_TITLE,
  sentExport,
} from './send-model';

export interface SendClipTarget {
  id: string;
  title: string;
  durationMs: number;
  exportedMediaId: string | null;
  /**
   * Module 13: a sound in the clip was made by Text To Speech, so the draft
   * starts marked Made With AI (the API decides; this only says why).
   */
  usesAiVoice?: boolean;
}

/** Module 13: the note beside the description when the clip has a made-up voice. */
export const AI_VOICE_NOTE =
  'This clip uses a made-up voice, so the post starts marked Made With AI. You can turn it off in the composer.';

export interface SendClipDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgId: string;
  clip: SendClipTarget;
  /** The clip changed since its last export: the dialog opens on Export Again first. */
  outdated: boolean;
  /** The editor's own export; elsewhere the dialog starts one itself. */
  exportRun?: SendExportRun;
  /** The draft exists: open the composer on it. */
  onSent: (group: string) => void;
}

/** An export the dialog can start and follow: the editor's, or its own. */
export interface SendExportRun {
  start: () => void;
  cancel: () => void;
  /** The job followed now (it changes when a new export starts). */
  jobId: string | null;
  job: ClipJobView | null;
  /** Starting, or waiting on a question first (the editor's removed items). */
  busy: boolean;
  /** Why the last start did not go through; null when it did. */
  problem: string | null;
}

export function SendClipDialog(props: SendClipDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* Mounted only while open, so every opening reads the channels and the export again. */}
      {props.open ? <SendClipContent {...props} /> : null}
    </Dialog>
  );
}

interface Loaded {
  channels: ChannelsResponse['channels'];
  providers: ProviderSummary[];
  exports: ClipExportView[];
}

function useSendData(clipId: string) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the explicit reload trigger
  useEffect(() => {
    const abort = new AbortController();
    setError(null);
    Promise.all([
      api<ChannelsResponse>('/channels', { signal: abort.signal }),
      api<{ providers: ProviderSummary[] }>('/channels/providers', { signal: abort.signal }),
      listClipExports(clipId, { signal: abort.signal }),
    ])
      .then(([channels, providers, exports]) => {
        if (abort.signal.aborted) return;
        setData({ channels: channels.channels, providers: providers.providers, exports });
      })
      .catch((cause: unknown) => {
        if (abort.signal.aborted) return;
        setError(
          cause instanceof ApiError && cause.status !== 0 ? cause.message : SEND_CHANNELS_FAILED,
        );
      });
    return () => abort.abort();
  }, [clipId, attempt]);

  const reload = useCallback(() => setAttempt((count) => count + 1), []);
  return { data, error, reload };
}

function SendClipContent({ orgId, clip, outdated, exportRun, onSent }: SendClipDialogProps) {
  const id = useId();
  const { data, error: loadError, reload } = useSendData(clip.id);
  const [selected, setSelected] = useState<string[]>([]);
  const [caption, setCaption] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // The out-of-date step: answered by a fresh export or by Send The Old Version.
  const [oldVersion, setOldVersion] = useState(false);
  const [freshExport, setFreshExport] = useState(false);
  const [askExport, setAskExport] = useState(outdated);

  // After a fresh export the newest file is the one that posts.
  const row = data ? sentExport(data.exports, freshExport ? null : clip.exportedMediaId) : null;

  // Export Again: the editor's run, or the dialog's own at the last export's quality.
  const own = useOwnExport({
    orgId,
    clipId: clip.id,
    lastQuality: row?.quality ?? null,
    enabled: !exportRun,
  });
  const run = exportRun ?? own;
  const [clicked, setClicked] = useState<{ fromJobId: string | null; sawLive: boolean } | null>(
    null,
  );
  const job = run.job && run.job.id === run.jobId ? run.job : null;
  const live = job !== null && !isTerminalJob(job.status);
  const exporting =
    clicked !== null && (run.busy || live || (run.jobId !== clicked.fromJobId && job === null));

  useEffect(() => {
    if (!clicked) return;
    if (live) {
      if (!clicked.sawLive) setClicked({ ...clicked, sawLive: true });
      return;
    }
    if (run.busy) return;
    if (job && isTerminalJob(job.status) && (job.id !== clicked.fromJobId || clicked.sawLive)) {
      setClicked(null);
      if (job.status === 'DONE') {
        setFreshExport(true);
        setAskExport(false);
        reload();
      } else if (job.status === 'FAILED') {
        setProblem(EXPORT_FAILED_SENTENCE);
      }
    }
    // Nothing started (refused, or the editor's question declined): `exporting`
    // is false again, so the step offers its buttons; the next click starts over.
  }, [clicked, live, job, run.busy, reload]);

  const facts = useMemo(() => factsOf(row, clip.durationMs), [row, clip.durationMs]);
  const choices = useMemo(
    () => (data ? channelChoices(data.channels, data.providers, facts) : []),
    [data, facts],
  );

  // A ticked channel that can no longer take the clip is unticked.
  useEffect(() => {
    const allowed = new Set(choices.filter((choice) => !choice.reason).map((c) => c.channel.id));
    setSelected((current) => {
      const kept = current.filter((channelId) => allowed.has(channelId));
      return kept.length === current.length ? current : kept;
    });
  }, [choices]);

  const noChannels = data !== null && data.channels.length === 0;
  const pickError = attempted && selected.length === 0 && !noChannels ? SEND_PICK_ONE : null;

  function exportAgain() {
    setProblem(null);
    setClicked({ fromJobId: run.jobId, sawLive: false });
    run.start();
  }

  async function send() {
    setAttempted(true);
    if (selected.length === 0 || sending) return;
    setSending(true);
    setProblem(null);
    try {
      const { group } = await sendClip(clip.id, {
        channelIds: selected,
        caption,
        ...(oldVersion && !freshExport ? { oldVersion: true } : {}),
      });
      onSent(group);
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === 'clip_export_outdated') {
        setOldVersion(false);
        setFreshExport(false);
        setAskExport(true);
        return;
      }
      setProblem(cause instanceof ApiError && cause.status !== 0 ? cause.message : SEND_FAILED);
    } finally {
      setSending(false);
    }
  }

  const toggle = (channelId: string, on: boolean) =>
    setSelected((current) =>
      on
        ? [...current.filter((item) => item !== channelId), channelId]
        : current.filter((item) => item !== channelId),
    );

  const onExportStep = askExport && !oldVersion && !freshExport;
  const shownProblem = problem ?? (onExportStep && !exporting ? run.problem : null);

  return (
    <DialogContent
      className="max-h-[90vh] max-w-xl overflow-y-auto pg-scrollbar pg-scrollbar-secondary"
      data-testid="clip-send-dialog"
      onInteractOutside={(event) => {
        if (sending || exporting) event.preventDefault();
      }}
      // The channels are still loading as it opens: the dialog itself takes focus.
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        (event.currentTarget as HTMLElement | null)?.focus();
      }}
    >
      <DialogHeader>
        <DialogTitle>{SEND_TITLE}</DialogTitle>
        <DialogDescription className="break-words">
          {`${clip.title} becomes a draft post with your caption. You schedule it in the composer.`}
        </DialogDescription>
        {clip.usesAiVoice ? (
          <p className="m-0 font-sans text-sm text-ink" data-testid="clip-send-ai-voice">
            {AI_VOICE_NOTE}
          </p>
        ) : null}
      </DialogHeader>

      <div className="mt-5 flex flex-col gap-5">
        {shownProblem ? (
          <Alert variant="danger" className="items-center" data-testid="clip-send-problem">
            <TriangleAlert aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={2.5} />
            <p className="m-0 min-w-0 flex-1 break-words">{shownProblem}</p>
          </Alert>
        ) : null}

        {onExportStep ? (
          <ExportStep
            exporting={exporting}
            stageLabel={live ? job.stageLabel : null}
            progress={live ? job.progress : 0}
            etaSeconds={live ? job.etaSeconds : null}
            // From a card, the last export's quality is read first.
            canExport={exportRun !== undefined || data !== null}
            onExport={exportAgain}
            onCancel={run.cancel}
            onOld={() => setOldVersion(true)}
          />
        ) : (
          <>
            <section aria-labelledby={`${id}-channels`} className="flex flex-col gap-3">
              <h3 id={`${id}-channels`} className="m-0 type-heading text-base text-ink">
                Channels
              </h3>
              {loadError ? (
                <Alert variant="danger" className="items-center">
                  <TriangleAlert
                    aria-hidden="true"
                    className="h-5 w-5 shrink-0"
                    strokeWidth={2.5}
                  />
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
                    <span className="min-w-0 break-words">{loadError}</span>
                    <Button variant="secondary" size="sm" onClick={reload}>
                      Try Again
                    </Button>
                  </div>
                </Alert>
              ) : data === null ? (
                <div className="flex flex-col gap-2">
                  <p role="status" className="sr-only">
                    Loading your channels
                  </p>
                  {[0, 1, 2].map((index) => (
                    <Skeleton key={index} className="h-14 w-full" />
                  ))}
                </div>
              ) : noChannels ? (
                <div className="flex flex-col items-center" data-testid="clip-send-empty">
                  <EmptyState
                    icon={Radio}
                    title="No Channels Yet"
                    description={SEND_NO_CHANNELS}
                    className="p-6"
                  />
                  <Link
                    href={`/${encodeURIComponent(orgId)}/channels`}
                    className="font-sans text-sm text-ink underline type-ui"
                  >
                    Go To Channels
                  </Link>
                </div>
              ) : (
                <ChannelList choices={choices} selected={selected} onToggle={toggle} />
              )}
              {pickError ? <FormErrorMessage>{pickError}</FormErrorMessage> : null}
            </section>

            {noChannels ? null : (
              <section className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-3">
                  <label htmlFor={`${id}-caption`} className="type-heading text-base text-ink">
                    Caption
                  </label>
                  <span className="font-sans text-xs text-ink tabular-nums type-muted">
                    {captionCount(caption)}
                  </span>
                </div>
                <Textarea
                  id={`${id}-caption`}
                  value={caption}
                  maxLength={CAPTION_MAX}
                  rows={4}
                  placeholder="Enter your caption"
                  onChange={(event) => setCaption(event.target.value)}
                  data-testid="clip-send-caption"
                />
              </section>
            )}
          </>
        )}
      </div>

      {onExportStep ? null : (
        <DialogFooter className="flex-wrap">
          <DialogClose asChild>
            <Button variant="secondary" disabled={sending}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            onClick={() => void send()}
            disabled={sending || data === null || noChannels || selected.length === 0}
            data-testid="clip-send-open"
          >
            <MotionIcon icon={SendIcon} className="h-4 w-4" />
            {sending ? 'Opening' : 'Open In Composer'}
          </Button>
        </DialogFooter>
      )}
    </DialogContent>
  );
}

/**
 * The dialog's own export, from a card: the last export's quality when the
 * plan still allows it, else the best one it does.
 */
function useOwnExport({
  orgId,
  clipId,
  lastQuality,
  enabled,
}: {
  orgId: string;
  clipId: string;
  lastQuality: ExportQuality | null;
  enabled: boolean;
}): SendExportRun {
  const { snapshot } = useEntitlements(orgId);
  const planValue = snapshot?.values['clips.export_max_quality'];
  const ceiling = typeof planValue === 'string' ? planValue : null;
  const [jobId, setJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const followed = useClipJob(enabled ? jobId : null);
  const { refresh } = followed;

  const quality: ExportQuality =
    ceiling === null
      ? (lastQuality ?? '1080p')
      : lastQuality && qualityAllowed(lastQuality, ceiling)
        ? lastQuality
        : bestAllowedQuality(ceiling);

  const start = useCallback(() => {
    setBusy(true);
    setProblem(null);
    exportClip(clipId, quality)
      .then((made) => setJobId(made.id))
      .catch((cause: unknown) =>
        setProblem(
          cause instanceof ApiError && cause.status !== 0 ? cause.message : EXPORT_FAILED_SENTENCE,
        ),
      )
      .finally(() => setBusy(false));
  }, [clipId, quality]);

  const cancel = useCallback(() => {
    if (!jobId) return;
    void cancelClipJob(jobId)
      .catch(() => undefined)
      .then(refresh);
  }, [jobId, refresh]);

  return { start, cancel, jobId, job: followed.job, busy, problem };
}

function ChannelList({
  choices,
  selected,
  onToggle,
}: {
  choices: readonly ChannelChoice[];
  selected: readonly string[];
  onToggle: (channelId: string, on: boolean) => void;
}) {
  return (
    <fieldset
      className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0"
      data-testid="clip-send-channels"
    >
      <legend className="sr-only">Channels</legend>
      {choices.map(({ channel, platform, reason }) => {
        const checkboxId = `clip-send-${channel.id}`;
        const reasonId = `${checkboxId}-reason`;
        const ticked = selected.includes(channel.id);
        return (
          <div
            key={channel.id}
            className={cn(
              'flex items-start gap-3 rounded-md border-2 border-outline bg-secondary p-2.5',
              reason ? 'opacity-60' : null,
            )}
            data-testid="clip-send-channel"
            data-disabled={reason ? 'true' : undefined}
          >
            <Checkbox
              id={checkboxId}
              checked={ticked}
              disabled={reason !== null}
              aria-describedby={reason ? reasonId : undefined}
              onCheckedChange={(value) => onToggle(channel.id, value === true)}
              className="mt-2"
            />
            <Avatar size="sm">
              {channel.picture ? <AvatarImage src={channel.picture} alt="" /> : null}
              <AvatarFallback colorSeed={channel.color ?? channel.id}>
                {channel.name.slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <label
                htmlFor={checkboxId}
                className={cn(
                  'flex min-w-0 items-center gap-2 font-sans text-sm text-ink type-ui',
                  reason ? 'cursor-not-allowed' : 'cursor-pointer',
                )}
              >
                <span className="truncate">{channel.name}</span>
                <PlatformIcon
                  platform={channel.providerIdentifier}
                  title={platform}
                  className="h-4 w-4 shrink-0"
                />
              </label>
              {reason ? (
                <span
                  id={reasonId}
                  className="font-sans text-xs text-ink type-muted"
                  data-testid="clip-send-reason"
                >
                  {reason}
                </span>
              ) : null}
            </span>
          </div>
        );
      })}
    </fieldset>
  );
}

function ExportStep({
  exporting,
  canExport,
  stageLabel,
  progress,
  etaSeconds,
  onExport,
  onCancel,
  onOld,
}: {
  exporting: boolean;
  canExport: boolean;
  stageLabel: string | null;
  progress: number;
  etaSeconds: number | null;
  onExport: () => void;
  onCancel: () => void;
  onOld: () => void;
}) {
  const left = timeLeft(etaSeconds);
  return (
    <section className="flex flex-col gap-4" data-testid="clip-send-outdated">
      <Alert variant="warning" className="items-center">
        <TriangleAlert aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={2.5} />
        <p className="m-0 min-w-0 flex-1">{SEND_OUTDATED}</p>
      </Alert>
      {exporting ? (
        <div className="flex flex-col gap-2" data-testid="clip-send-exporting">
          <div className="flex items-center justify-between gap-3 font-sans text-sm text-ink">
            <span className="type-ui">{stageLabel ?? 'Waiting for its turn'}</span>
            <span className="tabular-nums type-muted">{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} aria-label={stageLabel ?? 'Waiting for its turn'} />
          {left ? <p className="m-0 font-sans text-sm text-ink type-muted">{left}</p> : null}
          <Button variant="secondary" size="sm" className="w-fit" onClick={onCancel}>
            Cancel Export
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={onExport} disabled={!canExport} data-testid="clip-send-export-again">
            Export Again
          </Button>
          <Button variant="secondary" onClick={onOld} data-testid="clip-send-old">
            Send The Old Version
          </Button>
        </div>
      )}
    </section>
  );
}
