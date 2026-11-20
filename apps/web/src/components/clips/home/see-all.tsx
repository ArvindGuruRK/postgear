'use client';

/**
 * See All on a Clips home section (2026-11-19): opens that section's whole
 * list in place of the home. Its spoken name says which list ("See All
 * Videos"); the visible words are the start of it, so voice control still
 * finds it by what it shows.
 */
import { ArrowRightIcon } from '@animateicons/react/lucide/arrow-right-icon';
import { Button, MotionIcon } from '@postgear/ui';

export function SeeAll({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="secondary" size="sm" onClick={onClick} aria-label={label}>
      See All
      <MotionIcon icon={ArrowRightIcon} className="h-4 w-4" />
    </Button>
  );
}
