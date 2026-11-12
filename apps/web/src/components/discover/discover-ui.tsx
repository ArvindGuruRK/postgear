/**
 * Small pieces the Discover page's parts share: the chip frame both chips
 * wear, the box a group's rows sit in, and the OpenStreetMap credit that sits
 * under the place chip and in its popover (the map data's licence asks for it
 * wherever a place we found through it is shown).
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

/**
 * A group's rows (Wikipedia articles, festivals): one box you read, so the
 * inset layer and no shadow, with a line between rows (blueprint section 2).
 * The same frame as the AI page's `INSET`, on a list.
 */
export const ROW_LIST =
  'm-0 flex list-none flex-col divide-y-2 divide-outline overflow-hidden rounded-lg border-2 border-outline bg-inset p-0';

/** One row of it: wraps on a phone, so the actions drop under the words. */
export const ROW = 'flex flex-wrap items-center gap-x-4 gap-y-2 p-3';

/**
 * A sentence in a group that has no rows to show ("Nothing new from Acme in
 * the last 30 days."): the same inset box the rows would have sat in.
 */
export const INSET_NOTE =
  'm-0 rounded-lg border-2 border-outline bg-inset p-4 font-sans text-sm text-ink type-muted';

export const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';
/** DB-IP's Lite database is CC BY 4.0: a page showing its guess links back (Module 10). */
export const DBIP_URL = 'https://db-ip.com';

export function PlacesCredit({
  className,
  ipGuess = false,
}: {
  className?: string;
  /** The place on screen was guessed from the network address, so DB-IP is credited too. */
  ipGuess?: boolean;
}) {
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
      {ipGuess ? (
        <>
          {', '}
          <a
            href={DBIP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="underline decoration-1 underline-offset-2 hover:opacity-100"
          >
            IP geolocation by DB-IP
          </a>
        </>
      ) : null}
    </p>
  );
}
