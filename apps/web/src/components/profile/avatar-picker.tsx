'use client';

import { cn, FormErrorMessage, pressSm, Spinner, Stack, Text } from '@postgear/ui';
import { Check, ImagePlus } from 'lucide-react';
import { type ChangeEvent, useEffect, useId, useRef, useState } from 'react';
import { ApiError, api, uploadFile } from '@/lib/api';
import { AVATAR_PRESETS, presetSrc } from '@/lib/avatars';
import type { SessionAvatar } from '@/lib/session';
import { UserAvatar } from './user-avatar';

/** Mirrors the API's `MAX_AVATAR_UPLOAD_BYTES`; checked here only to fail fast. */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

interface AvatarResponse {
  avatar: SessionAvatar;
}

/**
 * The avatar chooser: a large preview, a grid of preset avatars, the user's
 * own photo when they have one, and an "Upload a photo" tile.
 *
 * Built for the onboarding profile step and kept free of onboarding logic so a
 * profile settings page can drop it in as-is.
 *
 * ## Saves on pick, not on submit
 *
 * Every choice calls the avatar API straight away and the preview updates
 * optimistically: there is no "save avatar" button to forget. Presets are a
 * real radio group (visually hidden inputs, the tiles are their labels, as in
 * onboarding's `ChoiceGroup`), so arrow keys move the selection and screen
 * readers announce it. Because arrow keys select as they move, requests are
 * **serialized**: a burst of picks sends at most one request at a time and
 * always ends on the last pick, so the server can never be left holding an
 * earlier choice that happened to arrive late.
 *
 * Choosing a preset discards an uploaded photo (the API deletes it), so the
 * "Your photo" tile disappears once a preset is picked.
 */
export function AvatarPicker({
  name,
  value,
  onChange,
  onPendingChange,
}: {
  /** For the preview's initials and alt text. */
  name: string;
  value: SessionAvatar;
  onChange: (avatar: SessionAvatar) => void;
  /** Lets a parent hold its own submit until the avatar is saved. */
  onPendingChange?: (pending: boolean) => void;
}) {
  const groupName = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** The last avatar the server confirmed, to roll back to on failure. */
  const confirmed = useRef<SessionAvatar>(value);
  /** The preset most recently picked, which the sync loop works towards. */
  const wanted = useRef<string | null>(null);
  const syncing = useRef(false);

  const pending = saving || uploading;

  useEffect(() => {
    onPendingChange?.(pending);
  }, [pending, onPendingChange]);

  function fail(caught: unknown, fallback: string) {
    setError(caught instanceof ApiError ? caught.message : fallback);
    onChange(confirmed.current);
  }

  async function pickPreset(id: string) {
    setError(null);
    wanted.current = id;
    onChange({ kind: 'preset', id });

    if (syncing.current) return;
    syncing.current = true;
    setSaving(true);

    try {
      let sent: string | null = null;

      while (wanted.current !== null && wanted.current !== sent) {
        sent = wanted.current;
        const { avatar } = await api<AvatarResponse>('/users/me/avatar/preset', {
          method: 'PUT',
          body: { id: sent },
        });
        confirmed.current = avatar;
      }

      onChange(confirmed.current);
    } catch (caught) {
      fail(caught, 'That avatar could not be saved. Please try again.');
    } finally {
      wanted.current = null;
      syncing.current = false;
      setSaving(false);
    }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset so choosing the same file again still fires `change`.
    event.target.value = '';

    if (!file) return;
    setError(null);

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Upload a JPEG, PNG or WebP image.');
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      setError('Photos can be at most 5 MB.');
      return;
    }

    setUploading(true);

    try {
      const { avatar } = await uploadFile<AvatarResponse>('/users/me/avatar/upload', file);
      confirmed.current = avatar;
      onChange(avatar);
    } catch (caught) {
      fail(caught, 'The photo could not be uploaded. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  async function clearAvatar() {
    setError(null);
    setSaving(true);
    onChange(null);

    try {
      await api<AvatarResponse>('/users/me/avatar', { method: 'DELETE' });
      confirmed.current = null;
    } catch (caught) {
      fail(caught, 'The avatar could not be removed. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  const selectedPreset = value?.kind === 'preset' ? value.id : null;

  return (
    <Stack gap="md">
      <div className="flex items-center gap-4">
        <UserAvatar
          name={name}
          avatar={value}
          className="h-24 w-24 shadow-surfaceSm sm:h-32 sm:w-32"
          initialsClassName="text-3xl"
        />
        <Stack gap="xs">
          <Text weight="bold">{name}</Text>
          <Text size="sm" muted>
            {pending ? 'Saving…' : value ? 'Looking good.' : 'No avatar yet. Pick one below.'}
          </Text>
          {value && !pending ? (
            <button
              type="button"
              onClick={clearAvatar}
              className="w-fit rounded-sm font-sans text-sm font-bold text-ink underline underline-offset-2 outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
            >
              Use my initials instead
            </button>
          ) : null}
        </Stack>
      </div>

      <fieldset>
        <legend className="mb-3 type-heading text-lg text-ink">Pick an avatar</legend>

        <div className="grid grid-cols-4 gap-3">
          {AVATAR_PRESETS.map((preset) => (
            <Tile
              key={preset.id}
              name={groupName}
              value={preset.id}
              label={preset.label}
              src={presetSrc(preset.id)}
              selected={selectedPreset === preset.id}
              onSelect={() => pickPreset(preset.id)}
            />
          ))}

          {value?.kind === 'image' ? (
            <Tile
              name={groupName}
              value="photo"
              label="Your photo"
              src={value.url}
              selected
              onSelect={() => undefined}
            />
          ) : null}

          {/* A button, not a radio: it opens the file picker rather than
              selecting anything, and the photo it produces becomes the
              "Your photo" tile above. Dashed and shadowless like FileUpload
              (§6): it reads as a slot to fill, not a choice. */}
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={uploading}
            className={cn(
              'flex aspect-square flex-col items-center justify-center gap-1 rounded-md border-2 border-dashed border-outline bg-secondary p-1 text-center text-ink',
              'outline-none hover:bg-actionPrimary/10 focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            {uploading ? (
              <Spinner size="sm" />
            ) : (
              <ImagePlus className="h-5 w-5" strokeWidth={2.5} aria-hidden />
            )}
            <span className="font-sans text-xs font-bold leading-tight">
              {uploading ? 'Uploading…' : 'Upload a photo'}
            </span>
          </button>
        </div>

        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          onChange={upload}
          className="hidden"
          data-testid="avatar-upload-input"
        />

        <Text size="sm" muted className="mt-3">
          Or upload a JPEG, PNG or WebP photo, up to 5 MB. We crop it to a square.
        </Text>
      </fieldset>

      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
    </Stack>
  );
}

/**
 * One selectable avatar. The `<label>` is the tile, the radio inside it is
 * visually hidden, and `has-[:focus-visible]` puts the keyboard focus ring on
 * the tile the hidden input belongs to.
 */
function Tile({
  name,
  value,
  label,
  src,
  selected,
  onSelect,
}: {
  name: string;
  value: string;
  label: string;
  src: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <label
      className={cn(
        'relative block aspect-square cursor-pointer rounded-md border-2 border-outline',
        pressSm,
        'has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focusRing',
        // The selection ring is the action colour, offset from the tile by
        // the page colour so it reads as a ring rather than a thicker border.
        selected && 'ring-4 ring-actionPrimary ring-offset-2 ring-offset-primary',
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={selected}
        onChange={onSelect}
        aria-label={label}
        className="sr-only"
      />
      {/* biome-ignore lint/performance/noImgElement: static SVGs and storage URLs; see user-avatar.tsx */}
      <img src={src} alt="" draggable={false} className="h-full w-full rounded-sm object-cover" />
      {selected ? (
        <span
          aria-hidden
          className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-outline bg-actionPrimary text-onActionPrimary"
        >
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
        </span>
      ) : null}
    </label>
  );
}
