'use client';

import { UploadIcon } from '@animateicons/react/lucide/upload-icon';
import { forwardRef, useCallback, useId, useState } from 'react';
import { cn } from '../lib/utils';
import { MotionIcon } from './motion-icon';

export interface FileUploadProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onDrop'> {
  onFilesSelected?: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  label?: string;
  helperText?: string;
  /**
   * Shown as a drop target from outside, for a page that takes a drop
   * anywhere (the Media page): the zone lights up as if dragged over.
   */
  active?: boolean;
  /** The label while files are dragged over it (or `active`), e.g. "Drop files to upload". */
  activeLabel?: string;
}

export const FileUpload = forwardRef<HTMLDivElement, FileUploadProps>(
  (
    {
      className,
      onFilesSelected,
      accept,
      multiple,
      disabled,
      label = 'Drop files here or click to upload',
      helperText,
      active = false,
      activeLabel,
      ...props
    },
    ref,
  ) => {
    const [isDragging, setIsDragging] = useState(false);
    const inputId = useId();
    const lit = (isDragging || active) && !disabled;

    const handleFiles = useCallback(
      (fileList: FileList | null) => {
        if (!fileList) return;
        onFilesSelected?.(Array.from(fileList));
      },
      [onFilesSelected],
    );

    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop is a mouse-only enhancement; the nested button + file input already provide full keyboard access
      <div
        ref={ref}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          if (!disabled) handleFiles(event.dataTransfer.files);
        }}
        className={cn(
          // A drop target says so in the primary blue, at rest too (2026-10-23,
          // the owner's pick): a dashed blue border and a light blue wash.
          // With files over it the border turns solid and the wash deepens.
          'rounded-md border-2 border-dashed border-actionPrimary bg-actionPrimary/10 transition-colors',
          lit && 'border-solid bg-actionPrimary/20',
          disabled && 'cursor-not-allowed opacity-50',
          className,
        )}
        {...props}
      >
        <button
          type="button"
          disabled={disabled}
          onClick={() => document.getElementById(inputId)?.click()}
          className={cn(
            'flex w-full flex-col items-center justify-center gap-2 p-8 text-center outline-none',
            'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
            disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-actionPrimary/5',
          )}
        >
          <span className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-outline bg-actionPrimary text-onActionPrimary">
            <MotionIcon icon={UploadIcon} size={24} className="h-6 w-6" />
          </span>
          {/* Same treatment as Label (label.tsx): this is a form control's
              label, so it follows the form-control typography rule in
              design-system-rules.md §1, not the display-face chrome rule.
              Written out rather than rendered as <Label> because it sits
              inside the drop-zone <button>, where a real <label> element
              would be nested-interactive markup. */}
          <p className="font-sans text-base font-bold text-ink">
            {lit && activeLabel ? activeLabel : label}
          </p>
          {helperText && !(lit && activeLabel) && (
            <p className="font-sans text-sm font-medium text-ink muted-tone">{helperText}</p>
          )}
        </button>
        <input
          id={inputId}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          className="sr-only"
          onChange={(event) => handleFiles(event.target.files)}
        />
      </div>
    );
  },
);
FileUpload.displayName = 'FileUpload';
