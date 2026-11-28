'use client';

/**
 * Download Transcript (Sprint 13, Module 17 item 10): a small menu that saves
 * the words as a plain text file or as subtitles (SRT).
 *
 * Used twice: on the video page's transcript (the video's own words, on the
 * video's clock) and in the editor's Transcript pane (the words the clip's
 * captions show, on the clip's clock). The API writes the file and names it;
 * a refusal ("This part of the video has not been listened to yet.") is
 * handed to `onError` in the API's own words.
 */
import { CaptionsIcon } from '@animateicons/react/lucide/captions-icon';
import { DownloadIcon } from '@animateicons/react/lucide/download-icon';
import { FileTextIcon } from '@animateicons/react/lucide/file-text-icon';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  MotionIcon,
  Spinner,
  TooltipHint,
} from '@postgear/ui';
import { useState } from 'react';
import { ApiError, downloadFile } from '@/lib/api';

export type TranscriptFileFormat = 'txt' | 'srt';

const CHOICES = [
  { format: 'txt', label: 'Text File', icon: FileTextIcon },
  { format: 'srt', label: 'Subtitles (SRT)', icon: CaptionsIcon },
] as const;

const DOWNLOAD_FAILED = 'The download did not work. Check your connection and try again.';

export interface TranscriptDownloadMenuProps {
  /** `/clips/videos/:videoId/transcript/download` or `/clips/:clipId/transcript/download`. */
  path: string;
  /** The saved file's name when the API sends none. */
  title: string;
  disabled?: boolean;
  onError: (message: string) => void;
  /** For a language other than the video's own (the video's route only). */
  language?: string;
}

export function TranscriptDownloadMenu({
  path,
  title,
  disabled = false,
  onError,
  language,
}: TranscriptDownloadMenuProps) {
  const [busy, setBusy] = useState(false);

  async function save(format: TranscriptFileFormat) {
    setBusy(true);
    const query = new URLSearchParams({ format });
    if (language) query.set('language', language);
    try {
      await downloadFile(`${path}?${query.toString()}`, `${title}.${format}`);
    } catch (cause) {
      onError(cause instanceof ApiError && cause.status !== 0 ? cause.message : DOWNLOAD_FAILED);
    } finally {
      setBusy(false);
    }
  }

  return (
    <DropdownMenu>
      <TooltipHint label="Download Transcript" side="bottom">
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Download Transcript"
            className="h-9 w-9 shrink-0 px-0"
            disabled={disabled || busy}
            data-testid="clip-transcript-download"
          >
            {busy ? <Spinner /> : <MotionIcon icon={DownloadIcon} className="h-4 w-4" />}
          </Button>
        </DropdownMenuTrigger>
      </TooltipHint>
      <DropdownMenuContent align="end">
        {CHOICES.map(({ format, label, icon }) => (
          <DropdownMenuItem
            key={format}
            onSelect={() => void save(format)}
            data-testid={`clip-transcript-download-${format}`}
          >
            <MotionIcon icon={icon} className="h-4 w-4" />
            {label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
