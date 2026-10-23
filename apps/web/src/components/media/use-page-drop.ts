'use client';

/**
 * Files dragged anywhere over the page (2026-10-23): the Media page takes a
 * drop wherever it lands, so the big drop box it used to open with is gone.
 *
 * Only a drag that carries files counts (dragging a tile's image or selected
 * text does not), and a drop inside a dialog is left to the dialog: the
 * composer opens as a modal over this page and has its own uploader. A
 * counter, not a flag, tracks the drag, because `dragleave` fires every time
 * the pointer crosses from one element into a child.
 */
import { useEffect, useRef, useState } from 'react';

export function carriesFiles(transfer: DataTransfer | null): boolean {
  return Boolean(transfer && Array.from(transfer.types).includes('Files'));
}

function insideDialog(target: EventTarget | null): boolean {
  return (
    target instanceof Element && target.closest('[role="dialog"], [role="alertdialog"]') !== null
  );
}

export function usePageDrop(onFiles: (files: File[]) => void): boolean {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const handler = useRef(onFiles);
  handler.current = onFiles;

  useEffect(() => {
    const enter = (event: DragEvent) => {
      if (!carriesFiles(event.dataTransfer) || insideDialog(event.target)) return;
      event.preventDefault();
      depth.current += 1;
      setDragging(true);
    };
    const over = (event: DragEvent) => {
      // Without this the browser opens the file instead of dropping it.
      if (carriesFiles(event.dataTransfer) && !insideDialog(event.target)) event.preventDefault();
    };
    const leave = (event: DragEvent) => {
      if (!carriesFiles(event.dataTransfer)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const drop = (event: DragEvent) => {
      depth.current = 0;
      setDragging(false);
      if (!carriesFiles(event.dataTransfer) || insideDialog(event.target)) return;
      // A drop zone on the page (the Media page's FileUpload) already took it.
      if (event.defaultPrevented) return;
      event.preventDefault();
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length > 0) handler.current(files);
    };

    window.addEventListener('dragenter', enter);
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, []);

  return dragging;
}
