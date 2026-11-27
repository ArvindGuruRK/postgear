'use client';

/**
 * Pick From Google Drive (Sprint 13 Module 12, D13-09).
 *
 * `useDrivePicker` gives the home's button its action. With the real keys it
 * opens Google's own picker (`lib/google-drive-picker.ts`); under Clips
 * simulation it opens `SimulatedDriveDialog`, a stand-in that hands out the
 * made-up files the API knows (they copy a local sample; no Google address is
 * ever reached). Either way the picked file goes to `POST /clips/videos/drive`
 * and comes in like an upload. Absent keys, no button.
 */
import {
  Button,
  ChoiceTiles,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
} from '@postgear/ui';
import { useCallback, useState } from 'react';
import { importFromDrive } from '@/lib/clips-api';
import { pickFromGoogleDrive } from '@/lib/google-drive-picker';
import type { ClipDriveStatus, ClipImportOutcome } from '@/types/clips';
import { clipErrorSentence } from '../library/clip-actions';

/** The made-up Drive files (`SIMULATED_DRIVE_FILES` in media-tools). */
export const SIMULATED_DRIVE_CHOICES = [
  { value: 'sim-drive-talk-0001', label: 'Sample Talk', line: 'The local talk sample.' },
  { value: 'sim-drive-stream-0001', label: 'Sample Stream', line: 'The local stream sample.' },
  {
    value: 'sim-drive-denied-0001',
    label: 'Not Shared With You',
    line: 'Drive refuses it, as for a file from another account.',
  },
  { value: 'sim-drive-document-01', label: 'A Google Doc', line: 'Not a video.' },
] as const;

type SimulatedFileId = (typeof SIMULATED_DRIVE_CHOICES)[number]['value'];

/** The token the stand-in picker hands out. The simulated Drive only checks it is well formed. */
const SIMULATED_TOKEN = 'simulated-drive-token';

export function SimulatedDriveDialog({
  open,
  busy,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (fileId: string) => void;
}) {
  const [fileId, setFileId] = useState<SimulatedFileId>(SIMULATED_DRIVE_CHOICES[0].value);
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-w-xl" data-testid="clips-drive-simulated">
        <DialogHeader>
          <DialogTitle>Pick From Google Drive</DialogTitle>
          <DialogDescription>
            Simulation: these files are made up and come from the local samples. Google Drive is
            never reached.
          </DialogDescription>
        </DialogHeader>
        <ChoiceTiles
          label="File"
          columns={2}
          value={fileId}
          disabled={busy}
          onValueChange={setFileId}
          options={SIMULATED_DRIVE_CHOICES.map((choice) => ({ ...choice }))}
        />
        <DialogFooter>
          <Button
            type="button"
            variant="secondary"
            disabled={busy}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="button" disabled={busy} onClick={() => onPick(fileId)}>
            {busy ? 'Bringing It In' : 'Pick This File'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The button's action and the stand-in dialog. `onPick` is absent when Drive
 * is not offered (or the video tools are off).
 */
export function useDrivePicker(
  drive: ClipDriveStatus | undefined,
  disabled: boolean,
  onImported: (outcome: ClipImportOutcome) => void,
): { onPick?: () => void; dialog: React.ReactNode } {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const bringIn = useCallback(
    async (fileId: string, accessToken: string) => {
      setBusy(true);
      try {
        const answer = await importFromDrive(fileId, accessToken);
        setOpen(false);
        onImported({ ...answer, existing: false });
      } catch (cause) {
        toast({ title: clipErrorSentence(cause), variant: 'warning' });
      } finally {
        setBusy(false);
      }
    },
    [onImported],
  );

  const openPicker = useCallback(async () => {
    if (!drive?.available) return;
    if (drive.simulated) {
      setOpen(true);
      return;
    }
    try {
      const picked = await pickFromGoogleDrive(drive);
      if (picked) await bringIn(picked.fileId, picked.accessToken);
    } catch (cause) {
      toast({
        title: cause instanceof Error ? cause.message : 'Google Drive could not be opened.',
        variant: 'warning',
      });
    }
  }, [drive, bringIn]);

  const offered = drive?.available === true && !disabled;
  return {
    onPick: offered ? () => void openPicker() : undefined,
    dialog:
      drive?.available && drive.simulated ? (
        <SimulatedDriveDialog
          open={open}
          busy={busy}
          onOpenChange={setOpen}
          onPick={(fileId) => void bringIn(fileId, SIMULATED_TOKEN)}
        />
      ) : null,
  };
}
