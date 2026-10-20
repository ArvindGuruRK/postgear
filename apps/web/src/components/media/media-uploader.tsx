'use client';

import { formatBytes } from '@postgear/social-core/composer';
import { FileUpload, Progress, Stack, Text } from '@postgear/ui';
import { useCallback, useState } from 'react';
import { ApiError, uploadFile } from '@/lib/api';
import type { MediaItem, UploadResult } from '@/types/media';
import { preflightUpload, UPLOAD_ACCEPT } from './media-limits';

export interface UploadRow {
  id: number;
  name: string;
  progress: number;
  status: 'uploading' | 'processing' | 'done' | 'failed';
  message: string | null;
}

let rowCounter = 0;

/**
 * Uploads files and tracks each one's progress, for any surface that starts
 * uploads: the Media page's drop zone, and the composer's Media Library with
 * its Upload button.
 *
 * Files go one at a time. Parallel uploads would finish sooner in theory and,
 * on a home connection, mostly just compete for the same upstream bandwidth
 * while making every progress bar crawl.
 *
 * A finished upload says how much compression saved: the number is the
 * visible proof that the server really did something to the file.
 */
export function useMediaUpload(onUploaded: (media: MediaItem) => void) {
  const [rows, setRows] = useState<UploadRow[]>([]);

  const upload = useCallback(
    async (files: File[]) => {
      const update = (id: number, patch: Partial<UploadRow>) =>
        setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));

      const queued = files.map((file) => ({
        file,
        row: {
          id: ++rowCounter,
          name: file.name,
          progress: 0,
          status: 'uploading' as const,
          message: preflightUpload(file),
        },
      }));

      setRows((current) =>
        [
          ...queued.map(({ row }) => (row.message ? { ...row, status: 'failed' as const } : row)),
          ...current,
        ].slice(0, 8),
      );

      for (const { file, row } of queued) {
        if (row.message) {
          continue;
        }

        try {
          const result = await uploadFile<UploadResult>('/media', file, (fraction) =>
            // The last stretch is the server compressing, not the network.
            update(
              row.id,
              fraction >= 1
                ? { progress: 100, status: 'processing' }
                : { progress: Math.round(fraction * 100) },
            ),
          );

          const saved = result.originalBytes - result.media.fileSize;

          update(row.id, {
            progress: 100,
            status: 'done',
            message:
              result.media.type === 'image' && saved > 0
                ? `Compressed ${formatBytes(result.originalBytes)} → ${formatBytes(result.media.fileSize)}`
                : `Uploaded ${formatBytes(result.media.fileSize)}`,
          });

          onUploaded(result.media);
        } catch (cause) {
          update(row.id, {
            status: 'failed',
            message:
              cause instanceof ApiError ? cause.message : 'The upload failed. Please try again.',
          });
        }
      }
    },
    [onUploaded],
  );

  return { rows, upload };
}

/** Each file's progress and outcome, newest first. */
export function UploadRows({ rows }: { rows: UploadRow[] }) {
  if (rows.length === 0) {
    return null;
  }

  return (
    <ul aria-live="polite" className="m-0 flex list-none flex-col gap-2 p-0">
      {rows.map((row) => (
        <li
          key={row.id}
          className="flex flex-col gap-1 rounded-md border-2 border-outline bg-secondary px-3 py-2"
        >
          <div className="flex items-center justify-between gap-3">
            <Text size="sm" weight="bold" className="truncate">
              {row.name}
            </Text>
            <Text
              size="xs"
              className={
                row.status === 'failed' ? 'shrink-0 text-dangerInk' : 'shrink-0 opacity-70'
              }
            >
              {row.status === 'uploading'
                ? `${row.progress}%`
                : row.status === 'processing'
                  ? 'Compressing…'
                  : row.status === 'done'
                    ? 'Done'
                    : 'Failed'}
            </Text>
          </div>
          {row.status === 'uploading' || row.status === 'processing' ? (
            <Progress value={row.progress} size="sm" animated={row.status === 'processing'} />
          ) : null}
          {row.message ? (
            <Text
              size="xs"
              className={row.status === 'failed' ? 'text-dangerInk' : undefined}
              muted={row.status !== 'failed'}
            >
              {row.message}
            </Text>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/** Drag-and-drop or pick files, and watch them upload: the Media page's drop zone. */
export function MediaUploader({
  onUploaded,
  compact,
}: {
  onUploaded: (media: MediaItem) => void;
  compact?: boolean;
}) {
  const { rows, upload } = useMediaUpload(onUploaded);

  return (
    <Stack gap="sm">
      <FileUpload
        accept={UPLOAD_ACCEPT}
        multiple
        onFilesSelected={(files) => void upload(files)}
        label={
          compact
            ? 'Drop files or click to upload'
            : 'Drop images or video here, or click to upload'
        }
        helperText="JPEG, PNG, GIF, WebP or AVIF images up to 20 MB, and MP4 or MOV video up to 250 MB. Images are resized and compressed automatically."
        className={compact ? '[&>button]:p-5' : undefined}
      />
      <UploadRows rows={rows} />
    </Stack>
  );
}
