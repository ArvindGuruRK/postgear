/**
 * Small pieces the Discover page's parts share: the chip frame both chips
 * wear, and the OpenStreetMap credit that sits under the place chip and in
 * its popover (the map data's licence asks for it wherever a place we found
 * through it is shown).
 */
import { cn, FIELD_FOCUS } from '@postgear/ui';

/**
 * The place and language chips: a dropdown's trigger, so a border and no
 * shadow (CLAUDE.md, dropdowns), on the frame colour like the analytics
 * channel picker, focused by the field's 2px blue line.
 */
export const CHIP = cn(
  'inline-flex h-10 min-w-0 max-w-full items-center gap-2 rounded-lg border-2 border-outline bg-chrome px-3',
  'font-sans text-sm text-ink',
  FIELD_FOCUS,
  'disabled:cursor-not-allowed disabled:opacity-60',
);

export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';

export function PlacesCredit({ className }: { className?: string }) {
  return (
    <p className={cn('m-0 font-sans text-xs text-ink type-muted', className)}>
      Places by{' '}
      <a
        href={OSM_COPYRIGHT_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="underline decoration-1 underline-offset-2 hover:opacity-100"
      >
        OpenStreetMap contributors
      </a>
    </p>
  );
}
