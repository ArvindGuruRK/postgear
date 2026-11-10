'use client';

/**
 * The place chip: says where Discover is looking and how it knows (a Guess
 * badge for the time zone's guess), and opens the place popover.
 *
 * It is a dropdown's trigger, so it has a border and no shadow. While the
 * browser looks for a position it says "Finding your city…" and is disabled;
 * the popover stays open on its busy button until the city lands, then
 * closes. On a phone it shortens to the one most specific name.
 */
import { ChevronDownIcon } from '@animateicons/react/lucide/chevron-down-icon';
import { MapPinIcon } from '@animateicons/react/lucide/map-pin-icon';
import { Badge, MotionIcon, Popover, PopoverContent, PopoverTrigger } from '@postgear/ui';
import { useState } from 'react';
import type { Locality } from '@/types/discover';
import { type PlaceSource, placeChipText, placeShortText } from './discover-model';
import { CHIP } from './discover-ui';
import { PlacePopover } from './place-popover';
import type { PlaceStatus } from './use-place';

export interface PlaceChipProps {
  place: Locality | null;
  source: PlaceSource;
  status: PlaceStatus;
  message: string | null;
  geocoder: 'nominatim' | 'off';
  /** Resolves true once the browser's city is in. */
  onLocate: () => Promise<boolean>;
  onPick: (place: Locality) => void;
  onWorldwide: () => void;
  /** Opens on first render; the playground shows it that way. */
  defaultOpen?: boolean;
}

export function PlaceChip({
  place,
  source,
  status,
  message,
  geocoder,
  onLocate,
  onPick,
  onWorldwide,
  defaultOpen = false,
}: PlaceChipProps) {
  const [open, setOpen] = useState(defaultOpen);
  const resolving = status === 'resolving';
  const text = resolving ? 'Finding your city…' : place ? placeChipText(place, source) : '';
  const short = resolving ? 'Finding…' : place ? placeShortText(place) : '';
  const guess = !resolving && place !== null && source === 'guess' && place.countryCode !== null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={CHIP}
        disabled={resolving || place === null}
        aria-label={place ? `Place: ${text}. Change the place` : 'Place'}
        data-testid="discover-place-chip"
      >
        <MotionIcon icon={MapPinIcon} className="h-4 w-4 shrink-0" />
        <span className="hidden truncate sm:inline">{text}</span>
        <span className="truncate sm:hidden">{short}</span>
        {guess ? (
          <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
            Guess
          </Badge>
        ) : null}
        <MotionIcon icon={ChevronDownIcon} className="h-4 w-4 shrink-0" strokeWidth={3} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 max-w-[calc(100vw-2rem)]">
        <PlacePopover
          status={status}
          message={message}
          geocoder={geocoder}
          onLocate={() => {
            void onLocate().then((found) => {
              if (found) setOpen(false);
            });
          }}
          onPick={(picked) => {
            onPick(picked);
            setOpen(false);
          }}
          onWorldwide={() => {
            onWorldwide();
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
