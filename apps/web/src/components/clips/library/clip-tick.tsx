'use client';

/**
 * A clip's tick box (Module 11, section 1). The design system's `Checkbox`,
 * driven by the selection: a click toggles the clip, a Shift-click ticks the
 * range from the last clicked clip (the click is ours, so Radix's own toggle
 * is stopped).
 */
import { Checkbox, cn } from '@postgear/ui';

export function ClipTick({
  title,
  ticked,
  onToggle,
  className,
}: {
  title: string;
  ticked: boolean;
  onToggle: (range: boolean) => void;
  className?: string;
}) {
  return (
    <Checkbox
      aria-label={`Select ${title}`}
      checked={ticked}
      data-testid="clip-tick"
      className={className}
      onClick={(event) => {
        event.preventDefault();
        onToggle(event.shiftKey);
      }}
    />
  );
}

/** The tick box's place on a card: top left, shown on hover or focus, and always once any is ticked. */
export function tickPlacement(anyTicked: boolean, ticked: boolean): string {
  return cn(
    'absolute top-2 left-2 z-10 transition-opacity motion-reduce:transition-none',
    anyTicked || ticked
      ? 'opacity-100'
      : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
  );
}
