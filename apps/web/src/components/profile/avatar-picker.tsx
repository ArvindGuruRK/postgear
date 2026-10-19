'use client';

import { ImagePlusIcon } from '@animateicons/react/lucide/image-plus-icon';
import { cn, MotionIcon, pressSm, Spinner, Stack, Text, toast } from '@postgear/ui';
import { Check } from 'lucide-react';
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

/** Every problem (a wrong file, a failed save) is a danger toast (2026-10-20). */
function warn(title: string, description: string) {
  toast({ title, description, variant: 'danger' });
}

/**
 * The avatar chooser: a large preview, then the preset avatars nine to a row,
 * two rows, with one more card at the end: "Upload a photo", or the user's
 * own photo once they have one (2026-10-20). A file the API would refuse, or
 * any save that fails, is reported in a danger toast rather than in text
 * under the grid.
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
  centered = false,
}: {
  /** For the preview's initials and alt text. */
  name: string;
  /** Centres the preview and the "Pick an avatar" label over the grid. */
  centered?: boolean;
  value: SessionAvatar;
  onChange: (avatar: SessionAvatar) => void;
  /** Lets a parent hold its own submit until the avatar is saved. */
  onPendingChange?: (pending: boolean) => void;
}) {
  const groupName = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  /** The last avatar the server confirmed, to roll back to on failure. */
  const confirmed = useRef<SessionAvatar>(value);
  /** The preset most recently picked, which the sync loop works towards. */
  const wanted = useRef<string | null>(null);
  const syncing = useRef(false);

  const pending = saving || uploading;

  useEffect(() => {
    onPendingChange?.(pending);
  }, [pending, onPendingChange]);

  /** Puts the last saved avatar back and says what went wrong, in a toast. */
  function fail(caught: unknown, title: string) {
    warn(title, caught instanceof ApiError ? caught.message : 'Please try again.');
    onChange(confirmed.current);
  }

  async function pickPreset(id: string) {
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
      fail(caught, 'That avatar could not be saved');
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

    if (!ACCEPTED_TYPES.includes(file.type)) {
      warn("That file can't be used", 'Upload a JPEG, PNG or WebP image.');
      return;
    }

    if (file.size > MAX_UPLOAD_BYTES) {
      warn('That photo is too big', 'Photos can be at most 5 MB.');
      return;
    }

    setUploading(true);

    try {
      const { avatar } = await uploadFile<AvatarResponse>('/users/me/avatar/upload', file);
      confirmed.current = avatar;
      onChange(avatar);
    } catch (caught) {
      fail(caught, 'The photo could not be uploaded');
    } finally {
      setUploading(false);
    }
  }

  async function clearAvatar() {
    setSaving(true);
    onChange(null);

    try {
      await api<AvatarResponse>('/users/me/avatar', { method: 'DELETE' });
      confirmed.current = null;
    } catch (caught) {
      fail(caught, 'The avatar could not be removed');
    } finally {
      setSaving(false);
    }
  }

  const selectedPreset = value?.kind === 'preset' ? value.id : null;

  return (
    <Stack gap="md">
      <div className={cn('flex items-center gap-4', centered && 'justify-center')}>
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
        <legend
          className={cn('mb-3 type-heading text-lg text-ink', centered && 'w-full text-center')}
        >
          Pick an avatar
        </legend>

        {/* The 17 presets, then the photo slot as the last card: nine to a
            row from `lg`, two rows (2026-10-20). Each card keeps the size it
            had four to a row (about 100px) as long as the parent is wide
            enough (onboarding gives it 64rem); below `lg` there is not room
            for nine at that size, so it is six to a row, and four on a phone. */}
        <div className="grid grid-cols-4 gap-3 sm:grid-cols-6 lg:grid-cols-9">
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
            // The photo takes the upload card's place, with a small button in
            // its corner to swap it for another. Picking a preset deletes the
            // photo (the API does), and the upload card comes back.
            <div className="relative">
              <Tile
                name={groupName}
                value="photo"
                label="Your photo"
                src={value.url}
                selected
                onSelect={() => undefined}
              />
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={uploading}
                aria-label="Upload a different photo"
                className={cn(
                  'absolute -bottom-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-outline bg-secondary text-ink',
                  'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
                  'disabled:opacity-50',
                )}
              >
                {uploading ? (
                  <Spinner size="sm" className="h-3 w-3" />
                ) : (
                  <MotionIcon icon={ImagePlusIcon} size={12} className="h-3 w-3" />
                )}
              </button>
            </div>
          ) : (
            // A button, not a radio: it opens the file picker rather than
            // selecting anything, and the photo it produces takes this card's
            // place. Dashed and shadowless like FileUpload (§6): it reads as a
            // slot to fill, not a choice. The file rules are not spelled out
            // here (the user's call); a file that breaks them gets a toast.
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
                <MotionIcon icon={ImagePlusIcon} size={20} className="h-5 w-5" />
              )}
              <span className="font-sans text-xs font-bold leading-tight">
                {uploading ? 'Uploading…' : 'Upload a photo'}
              </span>
            </button>
          )}
        </div>

        <input
          ref={fileInput}
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          onChange={upload}
          className="hidden"
          data-testid="avatar-upload-input"
        />
      </fieldset>
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
