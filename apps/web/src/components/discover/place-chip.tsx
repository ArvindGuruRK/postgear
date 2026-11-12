'use client';

/**
 * The place chip: says where Discover is looking and how it knows (a Guess
 * badge for the time zone's guess, a Workspace badge for the place an admin
 * saved for everyone), and opens the place popover.
 *
 * It is a dropdown's trigger, so it has a border and no shadow. While the
 * browser looks for a position it says "Finding your city…" and is disabled;
 * the popover stays open on its busy button until the city lands, then
 * closes. On a phone it shortens to the one most specific name.
 *
 * Save For This Workspace keeps the popover open: the line above the button
 * is where the person sees the new default.
 */
import { ChevronDownIcon } from '@animateicons/react/lucide/chevron-down-icon';
import { MapPinIcon } from '@animateicons/react/lucide/map-pin-icon';
import { Badge, MotionIcon, Popover, PopoverContent, PopoverTrigger } from '@postgear/ui';
import { useState } from 'react';
import type { Locality } from '@/types/discover';
import { type PlaceSource, placeChipText, placeShortText } from './discover-model';
import { CHIP } from './discover-ui';
import { PlacePopover, type WorkspaceDefaultProps } from './place-popover';
import type { PlaceStatus } from './use-place';

export interface PlaceChipProps {
  place: Locality | null;
  source: PlaceSource;
  status: PlaceStatus;
  message: string | null;
  geocoder: 'nominatim' | 'off';
  /** Module 10: the city field suggests places as someone types. */
  typeahead?: boolean;
  /** Resolves true once the browser's city is in. */
  onLocate: () => Promise<boolean>;
  onPick: (place: Locality) => void;
  onWorldwide: () => void;
  /** The workspace's saved place and Save For This Workspace, at the foot of the popover. */
  workspace?: WorkspaceDefaultProps;
  /** Opens on first render; the playground shows it that way. */
  defaultOpen?: boolean;
}

export function PlaceChip({
  place,
  source,
  status,
  message,
  geocoder,
  typeahead = false,
  onLocate,
  onPick,
  onWorldwide,
  workspace,
  defaultOpen = false,
}: PlaceChipProps) {
  const [open, setOpen] = useState(defaultOpen);
  const resolving = status === 'resolving';
  const text = resolving ? 'Finding your city…' : place ? placeChipText(place, source) : '';
  const short = resolving ? 'Finding…' : place ? placeShortText(place) : '';
  const known = !resolving && place !== null;
  const guess = known && source === 'guess' && place.countryCode !== null;
  const fromWorkspace = known && source === 'workspace';

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
        {fromWorkspace ? (
          <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
            Workspace
          </Badge>
        ) : null}
        <MotionIcon icon={ChevronDownIcon} className="h-4 w-4 shrink-0" strokeWidth={3} />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 max-w-[calc(100vw-2rem)]">
        <PlacePopover
          status={status}
          message={message}
          geocoder={geocoder}
          typeahead={typeahead}
          workspace={workspace}
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
