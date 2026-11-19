'use client';

/**
 * Send To Composer from a list of clips (Module 17 section 4): the Clips tab,
 * the video page and the Create tab's recent clips. One dialog for the list;
 * a clip changed since its export opens it on Export Again first. On success
 * the composer opens over the page, and when it closes focus goes back to the
 * menu the send came from.
 */
import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback, useRef, useState } from 'react';
import { useFocusAfterComposer } from '@/components/composer/composer-return';
import type { ClipSummary } from '@/types/clips';
import { SendClipDialog } from '../editor/send-dialog';
import { composerHref } from '../editor/send-model';

export interface ClipSender {
  open: (clip: ClipSummary, from: HTMLElement | null) => void;
  dialog: ReactNode;
}

export function useClipSender(orgId: string): ClipSender {
  const router = useRouter();
  const [clip, setClip] = useState<ClipSummary | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const from = useRef<HTMLElement | null>(null);
  useFocusAfterComposer(orgId, () => from.current);

  const open = useCallback((next: ClipSummary, origin: HTMLElement | null) => {
    from.current = origin;
    setClip(next);
    setIsOpen(true);
  }, []);

  const dialog = clip ? (
    <SendClipDialog
      open={isOpen}
      onOpenChange={setIsOpen}
      orgId={orgId}
      clip={{
        id: clip.id,
        title: clip.title,
        durationMs: clip.durationMs,
        exportedMediaId: clip.exportedMediaId,
      }}
      outdated={clip.exportedMediaId !== null && !clip.exported}
      onSent={(group) => {
        setIsOpen(false);
        router.push(composerHref(orgId, group));
      }}
    />
  ) : null;

  return { open, dialog };
}
