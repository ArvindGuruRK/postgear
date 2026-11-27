/**
 * The small drawing beside the logo's place on the kit page: a tall frame
 * (a vertical clip) with the logo as a dot in the chosen corner, or no dot
 * when the logo is off. Decorative: the toggle bar beside it says the place.
 */
import { cn } from '@postgear/ui';
import type { LogoPosition } from '@postgear/video-engine';

const CORNER: Readonly<Record<LogoPosition, string>> = {
  'top-left': 'left-1 top-1',
  'top-right': 'right-1 top-1',
  'bottom-left': 'bottom-1 left-1',
  'bottom-right': 'bottom-1 right-1',
};

export function LogoCornerDrawing({ position }: { position: LogoPosition | null }) {
  return (
    <span
      aria-hidden="true"
      data-testid="clip-kit-logo-drawing"
      data-position={position ?? 'off'}
      className="relative block h-16 w-9 shrink-0 rounded-md border-2 border-outline bg-inset"
    >
      {position ? (
        <span
          className={cn(
            'absolute h-2.5 w-2.5 rounded-full border-2 border-outline bg-actionPrimary',
            CORNER[position],
          )}
        />
      ) : null}
    </span>
  );
}
