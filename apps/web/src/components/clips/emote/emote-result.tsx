'use client';

/**
 * An emote export's card (Sprint 13, Module 14): the job while it runs, our
 * sentence when it failed (a too-big emote is a warning naming the site and
 * the size), and once done the files table: each file's size in pixels, its
 * size on disk and whether it is under the site's limit, with Download All
 * (the zip) and one Download per file.
 */
import { DownloadIcon } from '@animateicons/react/lucide/download-icon';
import {
  Alert,
  Button,
  MotionIcon,
  Progress,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@postgear/ui';
import {
  EMOTE_PROFILES,
  EMOTE_UNDER_LIMIT,
  emoteBytesLabel,
  emoteFormatName,
  emoteOverReason,
} from '@postgear/video-engine';
import { TriangleAlert } from 'lucide-react';
import type { EmoteView } from '@/types/clips-emotes';
import { EXPIRED_LINE, keptLine, madeAtLine } from './emote-model';

export interface EmoteResultProps {
  view: EmoteView;
  /** Saves the zip or one file; resolves false when it has expired. */
  onSave: (name: string) => void;
  saving?: string | null;
}

export function EmoteResult({ view, onSave, saving }: EmoteResultProps) {
  const { job, emote } = view;

  if (job.status === 'FAILED' || job.status === 'CANCELLED') {
    return (
      <Alert variant="warning" className="items-center" data-testid="emote-failed">
        <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
        <p className="m-0 min-w-0 flex-1">
          {job.error?.message ?? 'We could not make this emote.'}
        </p>
      </Alert>
    );
  }

  if (job.status !== 'DONE' || !emote) {
    return (
      <div className="flex flex-col gap-2" data-testid="emote-running" aria-live="polite">
        <p className="m-0 font-sans text-sm text-ink">{job.stageLabel}</p>
        <Progress value={job.progress} aria-label="Making the emote" />
      </div>
    );
  }

  const profile = EMOTE_PROFILES[emote.platform];
  const made = madeAtLine(emote.files);

  return (
    <div className="flex flex-col gap-3" data-testid="emote-files">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="m-0 font-sans text-sm text-ink">{keptLine(emote.files)}</p>
          {made ? <p className="m-0 font-sans text-sm text-ink type-muted">{made}</p> : null}
          {emote.expired ? (
            <p className="m-0 font-sans text-sm text-ink type-muted">{EXPIRED_LINE}</p>
          ) : null}
        </div>
        <Button
          variant="primary"
          size="sm"
          disabled={emote.expired || emote.zip.url === null || saving === emote.zip.name}
          onClick={() => onSave(emote.zip.name)}
          data-testid="emote-download-all"
        >
          <MotionIcon icon={DownloadIcon} className="h-4 w-4" />
          Download All
        </Button>
      </div>
      <div className="overflow-x-auto rounded-md border-2 border-outline">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>File</TableHead>
              <TableHead>Kind</TableHead>
              <TableHead>Picture</TableHead>
              <TableHead>File Size</TableHead>
              <TableHead>Frames</TableHead>
              <TableHead>Limit</TableHead>
              <TableHead>
                <span className="sr-only">Download</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {emote.files.map((file) => {
              const reason = emoteOverReason({
                bytes: file.bytes,
                maxBytes: file.maxBytes,
                frames: file.frames,
                maxFrames: file.format === 'png' ? 1 : profile.maxFrames,
              });
              return (
                <TableRow key={file.name} data-testid="emote-file-row">
                  <TableCell className="font-mono text-xs">{file.name}</TableCell>
                  <TableCell>{emoteFormatName(file.format)}</TableCell>
                  <TableCell className="tabular-nums">{`${file.size} px`}</TableCell>
                  <TableCell className="tabular-nums">{emoteBytesLabel(file.bytes)}</TableCell>
                  <TableCell className="tabular-nums">{file.frames}</TableCell>
                  <TableCell>{reason ?? EMOTE_UNDER_LIMIT}</TableCell>
                  <TableCell className="text-right">
                    {file.fits ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={emote.expired || file.url === null || saving === file.name}
                        onClick={() => onSave(file.name)}
                        aria-label={`Download ${file.name}`}
                      >
                        <MotionIcon icon={DownloadIcon} className="h-4 w-4" />
                        Download
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
