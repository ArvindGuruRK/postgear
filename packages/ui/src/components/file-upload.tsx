'use client';

import { Upload } from 'lucide-react';
import { forwardRef, useCallback, useId, useState } from 'react';
import { cn } from '../lib/utils';

export interface FileUploadProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onDrop'> {
  onFilesSelected?: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  label?: string;
  helperText?: string;
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
      ...props
    },
    ref,
  ) => {
    const [isDragging, setIsDragging] = useState(false);
    const inputId = useId();

    const handleFiles = useCallback(
      (fileList: FileList | null) => {
        if (!fileList) return;
        onFilesSelected?.(Array.from(fileList));
      },
      [onFilesSelected],
    );

    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop is a mouse-only enhancement — the nested button + file input already provide full keyboard access
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
          'rounded-md border-2 border-dashed border-outline bg-secondary transition-colors',
          isDragging && 'border-solid bg-actionPrimary/10',
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
            'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
            disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-actionPrimary/5',
          )}
        >
          <Upload className="h-8 w-8 text-ink" strokeWidth={2.5} />
          {/* Same treatment as Label (label.tsx) — this is a form control's
              label, so it follows the form-control typography rule in
              design-system-rules.md §1, not the display-face chrome rule.
              Written out rather than rendered as <Label> because it sits
              inside the drop-zone <button>, where a real <label> element
              would be nested-interactive markup. */}
          <p className="font-sans text-sm font-bold text-ink">{label}</p>
          {helperText && <p className="font-sans text-xs font-medium text-ink opacity-70">{helperText}</p>}
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
