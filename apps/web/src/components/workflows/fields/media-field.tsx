'use client';

/**
 * A post's media in a step form (Module 10, `kind: 'media'`):
 *
 * - the chip input for media from earlier steps (Generate Image's Image),
 *   stored at the field's `path` as template text;
 * - **Pick From Media**, the composer's own Media library dialog, whose
 *   picks are stored as library ids at the field's `libraryPath` (at most
 *   10), shown as small thumbnails, each with a remove button.
 *
 * Only ids are stored, so after a reload the thumbnails are looked up one by
 * one (`GET /media/:id`); an item deleted from the library shows as removed.
 */
import { ImagePlusIcon } from '@animateicons/react/lucide/image-plus-icon';
import { XIcon } from '@animateicons/react/lucide/x-icon';
import { Button, MotionIcon, Text } from '@postgear/ui';
import { ImageOff, Video } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MediaPickerDialog } from '@/components/composer/media-picker-dialog';
import { ApiError, api } from '@/lib/api';
import type { MediaItem } from '@/types/media';
import { ChipInput } from './chip-input';
import { FIELD_PATH_ATTRIBUTE } from './contract';
import { asText, type FieldControlProps } from './field-types';
import { getAtPath } from './form-model';
import {
  addLibraryPicks,
  libraryIds,
  MAX_LIBRARY_MEDIA,
  removeLibraryPick,
  slotsLeft,
  storedPicks,
} from './media-model';

type Known = MediaItem | 'missing';

function Thumb({
  id,
  item,
  onRemove,
}: {
  id: string;
  item: Known | undefined;
  onRemove: () => void;
}) {
  const name = item && item !== 'missing' ? item.name : 'Removed item';
  const picture =
    item && item !== 'missing'
      ? (item.thumbnailUrl ?? (item.type === 'image' ? item.url : null))
      : null;
  return (
    <li
      className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md border-2 border-outline bg-secondary"
      data-media-id={id}
    >
      {picture ? (
        // biome-ignore lint/performance/noImgElement: library thumbnails come from the storage backend, not next/image
        <img src={picture} alt={name} className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center" title={name}>
          {item === 'missing' ? (
            <ImageOff aria-hidden="true" className="h-5 w-5 text-dangerInk" strokeWidth={2.5} />
          ) : item ? (
            <Video aria-hidden="true" className="h-5 w-5 text-ink" strokeWidth={2.5} />
          ) : null}
          <span className="sr-only">{name}</span>
        </span>
      )}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="absolute top-0.5 right-0.5 h-6 w-6 px-0"
        aria-label={`Remove ${name}`}
        onClick={onRemove}
      >
        <MotionIcon icon={XIcon} className="h-3 w-3" />
      </Button>
    </li>
  );
}

export function MediaField({ spec, config, value, onChange, errors, ids }: FieldControlProps) {
  const libraryPath = spec.libraryPath;
  const picks = libraryPath ? libraryIds(getAtPath(config, libraryPath)) : [];
  const [open, setOpen] = useState(false);
  const [known, setKnown] = useState<Record<string, Known>>({});
  const asked = useRef(new Set<string>());

  const pickKey = picks.join(',');
  // Thumbnails for picks this page has not seen yet (after a reload, an undo).
  // biome-ignore lint/correctness/useExhaustiveDependencies: `pickKey` stands for `picks`, a new array each render
  useEffect(() => {
    const unknown = picks.filter((id) => !asked.current.has(id));
    if (unknown.length === 0) return;
    for (const id of unknown) asked.current.add(id);
    for (const id of unknown) {
      api<{ media: MediaItem }>(`/media/${encodeURIComponent(id)}`)
        .then((result) => setKnown((current) => ({ ...current, [id]: result.media })))
        .catch((cause: unknown) => {
          if (cause instanceof ApiError && cause.status === 404) {
            setKnown((current) => ({ ...current, [id]: 'missing' }));
          }
        });
    }
  }, [pickKey]);

  const write = (next: string[]) => {
    if (libraryPath) onChange(libraryPath, storedPicks(next));
  };
  const left = slotsLeft(picks);
  const missing = picks.filter((id) => known[id] === 'missing').length;

  return (
    // biome-ignore lint/a11y/useSemanticElements: the field's two parts, named by its label
    <div role="group" aria-labelledby={ids.label} className="flex flex-col gap-3">
      <ChipInput
        value={asText(value)}
        onChange={(next) => onChange(spec.path, next)}
        label={spec.label}
        labelId={ids.label}
        describedBy={ids.message}
        fieldPath={spec.path}
        placeholder={spec.placeholder}
        invalid={errors[''] !== undefined}
        insertButton="icon"
      />
      {libraryPath ? (
        <div {...{ [FIELD_PATH_ATTRIBUTE]: libraryPath }} className="flex flex-col gap-2">
          {picks.length > 0 ? (
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0" aria-label="Picked from Media">
              {picks.map((id) => (
                <Thumb
                  key={id}
                  id={id}
                  item={known[id]}
                  onRemove={() => write(removeLibraryPick(picks, id))}
                />
              ))}
            </ul>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={left === 0}
              onClick={() => setOpen(true)}
            >
              <MotionIcon icon={ImagePlusIcon} className="h-4 w-4" />
              Pick From Media
            </Button>
            <Text size="xs" muted as="span">
              {picks.length === 0
                ? `Up to ${MAX_LIBRARY_MEDIA} items from your library.`
                : `${picks.length} of ${MAX_LIBRARY_MEDIA} picked.`}
            </Text>
          </div>
          {missing > 0 ? (
            <Text size="xs" className="text-dangerInk">
              {missing === 1
                ? 'A picked item was deleted from Media. Remove it or pick another.'
                : `${missing} picked items were deleted from Media. Remove them or pick others.`}
            </Text>
          ) : null}
          <MediaPickerDialog
            open={open}
            onOpenChange={setOpen}
            alreadyAttached={picks}
            remaining={left}
            title="Pick From Media"
            description="Choose items from the Media library for this step's post."
            confirmLabel="Add Selected Media"
            onAttach={(items) => {
              setKnown((current) => {
                const next = { ...current };
                for (const item of items) {
                  next[item.id] = item;
                  asked.current.add(item.id);
                }
                return next;
              });
              write(
                addLibraryPicks(
                  picks,
                  items.map((item) => item.id),
                ),
              );
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
