'use client';

/**
 * The Audio tab's Uploaded list (Module 14 sections 4 and 8): the
 * workspace's own sounds.
 *
 * Upload A Sound sends an MP3, WAV, M4A or AAC file; it shows as Checking at
 * once and becomes a row when ready. A file that is not a sound, or is too
 * big or too long, is refused with one sentence. A ready row plays its
 * preview and adds at the playhead; its menu has Delete Sound, which asks
 * first and is refused (with the sentence) while a clip uses it.
 */
import { EllipsisIcon } from '@animateicons/react/lucide/ellipsis-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import { UploadIcon } from '@animateicons/react/lucide/upload-icon';
import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  MotionIcon,
  Spinner,
} from '@postgear/ui';
import type { SoundUploadView } from '@postgear/video-engine';
import { FileAudio, TriangleAlert } from 'lucide-react';
import { useRef, useState } from 'react';
import { NOTE } from '@/components/studio/panel-ui';
import {
  DELETE_SOUND_SENTENCE,
  lengthLabel,
  SOUND_UPLOAD_NOTE,
  SOUND_UPLOADS_EMPTY,
} from './audio-model';
import { CHECKING } from './elements-model';
import { PreviewButton, SoundShape } from './sound-rows';
import type { SoundPreview, SoundUploads } from './use-sound-library';

const ACCEPT =
  'audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/x-m4a,audio/aac,.mp3,.wav,.m4a,.aac';

export function UploadedSounds({
  uploads,
  preview,
  onAdd,
}: {
  uploads: SoundUploads;
  preview: SoundPreview;
  onAdd: (sound: SoundUploadView) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [deleting, setDeleting] = useState<SoundUploadView | null>(null);
  const [busy, setBusy] = useState(false);
  const empty = !uploads.loading && uploads.sounds.length === 0 && uploads.sending.length === 0;

  return (
    <div className="flex flex-col gap-3" data-testid="clip-uploaded-sounds">
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="hidden"
        data-testid="clip-sound-file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void uploads.upload(file);
        }}
      />
      <Button variant="secondary" className="w-full" onClick={() => input.current?.click()}>
        <MotionIcon icon={UploadIcon} className="h-4 w-4" />
        Upload A Sound
      </Button>
      <p className={NOTE}>{SOUND_UPLOAD_NOTE}</p>

      {uploads.error ? (
        <Alert variant="danger" className="items-center" data-testid="clip-sound-refused">
          <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">{uploads.error}</p>
        </Alert>
      ) : null}

      {empty ? <EmptyState icon={FileAudio} title={SOUND_UPLOADS_EMPTY} /> : null}
      {uploads.loading && uploads.sounds.length === 0 ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : null}

      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {uploads.sending.map((row) => (
          <li
            key={row.id}
            className="flex items-center gap-3 rounded-md border-2 border-outline bg-inset p-2"
          >
            <Spinner size="sm" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-sans text-sm text-ink type-ui">{row.name}</span>
              <span className="font-sans text-xs text-ink type-muted">{CHECKING}</span>
            </span>
          </li>
        ))}
        {uploads.sounds.map((sound) => {
          const ready = sound.status === 'ready' && sound.fileUrl !== null;
          return (
            <li
              key={sound.id}
              className="flex items-center gap-1 rounded-md border-2 border-outline bg-inset p-1.5"
              data-testid="clip-uploaded-sound"
            >
              {sound.status === 'checking' ? (
                <span className="flex w-8 shrink-0 justify-center">
                  <Spinner size="sm" />
                </span>
              ) : (
                <PreviewButton
                  name={sound.name}
                  playing={preview.playingId === sound.id}
                  disabled={!ready}
                  onToggle={() => preview.toggle(sound.id, sound.fileUrl)}
                />
              )}
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate font-sans text-sm text-ink type-ui">
                    {sound.name}
                  </span>
                  {ready ? (
                    <span className="shrink-0 font-sans text-xs tabular-nums text-ink type-muted">
                      {lengthLabel(sound.durationMs)}
                    </span>
                  ) : null}
                </span>
                {sound.status === 'checking' ? (
                  <span className="font-sans text-xs text-ink type-muted">{CHECKING}</span>
                ) : sound.status === 'failed' ? (
                  <span className="font-sans text-xs text-dangerInk">{sound.error}</span>
                ) : (
                  <SoundShape peaks={sound.peaks} className="h-4 w-full text-ink opacity-50" />
                )}
              </span>
              {ready ? (
                <Button
                  variant="secondary"
                  size="sm"
                  className="shrink-0"
                  aria-label={`Add ${sound.name}`}
                  onClick={() => onAdd(sound)}
                >
                  Add
                </Button>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-8 shrink-0 px-0"
                    aria-label={`More For ${sound.name}`}
                  >
                    <MotionIcon icon={EllipsisIcon} className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setDeleting(sound)}>
                    <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
                    Delete Sound
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </li>
          );
        })}
      </ul>

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(open) => !busy && !open && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Sound</AlertDialogTitle>
            <AlertDialogDescription>{DELETE_SOUND_SENTENCE}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                const target = deleting;
                if (!target) return;
                setBusy(true);
                if (preview.playingId === target.id) preview.stop();
                void uploads.remove(target.id).finally(() => {
                  setBusy(false);
                  setDeleting(null);
                });
              }}
            >
              {busy ? 'Deleting' : 'Delete Sound'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
