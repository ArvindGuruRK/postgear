'use client';

/**
 * A brand kit's logo: the one chosen now, and Upload Logo (DS-2.1).
 *
 * Picking a file only chooses it: the browser checks the type and size with
 * the stories' sentence, so a 40 MB photo is refused before anything is sent,
 * and the preview is drawn from the file itself. The upload happens when the
 * kit is saved (`uploadLogo`), so a kit that is never saved leaves nothing
 * behind in the media library. The API checks again on the bytes themselves
 * (an SVG with a script in it, a PNG that is not one) and its sentence comes
 * back through `error`.
 */
import { UploadIcon } from '@animateicons/react/lucide/upload-icon';
import { XIcon } from '@animateicons/react/lucide/x-icon';
import { Button, cn, FormErrorMessage, MotionIcon, Progress } from '@postgear/ui';
import { ImageOff } from 'lucide-react';
import { useRef, useState } from 'react';
import { ApiError, uploadFile } from '@/lib/api';
import type { MediaItem } from '@/types/media';

export const LOGO_ACCEPT = 'image/png,image/jpeg,image/svg+xml,image/webp';
export const LOGO_RULE = 'Logos can be PNG, JPG, SVG or WebP, up to 5 MB.';

const LOGO_TYPES = new Set(LOGO_ACCEPT.split(','));
const MAX_LOGO_BYTES = 5 * 1024 * 1024;

/** Why a file cannot be a logo, or null when it is worth sending. */
export function logoProblem(file: Pick<File, 'type' | 'size'>): string | null {
  // Some systems label a good file with no type; the API's own check decides.
  const typed = file.type === '' || LOGO_TYPES.has(file.type);
  return typed && file.size > 0 && file.size <= MAX_LOGO_BYTES ? null : LOGO_RULE;
}

/** Sends one logo to the API, which stores it in the media library. */
export async function uploadLogo(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<MediaItem> {
  const problem = logoProblem(file);
  if (problem) throw new ApiError(problem, 400);

  const { media } = await uploadFile<{ media: MediaItem }>(
    '/studio/brand-kits/logo',
    file,
    onProgress,
  );
  return media;
}

/** A logo drawn on the halftone tile every logo in Studio sits on. */
export function LogoTile({
  url,
  alt,
  className,
}: {
  url: string | null;
  /** Empty where something beside the tile already names the logo. */
  alt: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-md border-2 border-outline bg-inset bg-halftone p-2',
        className ?? 'h-20 w-32',
      )}
    >
      {url ? (
        // biome-ignore lint/performance/noImgElement: a local file, a found logo or the API's storage, never Next's optimizer
        <img src={url} alt={alt} className="max-h-full max-w-full object-contain" />
      ) : (
        <ImageOff aria-hidden="true" className="h-6 w-6 text-ink" strokeWidth={2.5} />
      )}
    </span>
  );
}

export function LogoField({
  previewUrl,
  name,
  disabled,
  progress = null,
  error = null,
  onPick,
  onRemove,
}: {
  /** The logo chosen now, if any. */
  previewUrl: string | null;
  /** The brand's name, for the logo's description. */
  name: string;
  disabled?: boolean;
  /** How far the upload has gone while the kit saves, 0 to 1. */
  progress?: number | null;
  /** Why the API refused the logo when the kit was saved. */
  error?: string | null;
  onPick: (file: File) => void;
  onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const shown = problem ?? error;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <LogoTile url={previewUrl} alt={name.trim() ? `${name.trim()} logo` : 'Logo'} />

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled}
            onClick={() => input.current?.click()}
          >
            <MotionIcon icon={UploadIcon} className="h-4 w-4" />
            {previewUrl ? 'Replace Logo' : 'Upload Logo'}
          </Button>
          {previewUrl ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={disabled}
              onClick={() => {
                setProblem(null);
                onRemove();
              }}
            >
              <MotionIcon icon={XIcon} className="h-4 w-4" />
              Remove Logo
            </Button>
          ) : null}
        </div>

        <input
          ref={input}
          type="file"
          accept={LOGO_ACCEPT}
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose a logo"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Cleared, so choosing the same file again still counts.
            event.target.value = '';
            if (!file) return;

            const reason = logoProblem(file);
            setProblem(reason);
            if (!reason) onPick(file);
          }}
        />
      </div>

      {/* One sentence under the field: the upload's progress, or why the logo
          was refused (which says what a logo can be), or else the rule. */}
      {progress !== null ? (
        <Progress value={Math.round(progress * 100)} size="sm" aria-label="Uploading the logo" />
      ) : shown ? null : (
        <p className="m-0 font-sans text-xs text-ink type-muted">{LOGO_RULE}</p>
      )}
      {shown ? <FormErrorMessage>{shown}</FormErrorMessage> : null}
    </div>
  );
}
