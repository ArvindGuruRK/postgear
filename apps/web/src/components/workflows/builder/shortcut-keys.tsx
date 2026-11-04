'use client';

import { Kbd, KbdGroup } from '@postgear/ui';

/** The builder's shortcuts take Ctrl or Command alike, so a Mac reads its own key. */
function keyWord(key: string): string {
  const mac = typeof navigator !== 'undefined' && /mac/i.test(navigator.platform);
  return key === 'Ctrl' && mac ? '⌘' : key;
}

/** A shortcut as key caps, for `TooltipHint`'s `shortcut`: `['Ctrl', 'K']`. */
export function ShortcutKeys({ keys }: { keys: readonly string[] }) {
  if (keys.length === 1) return <Kbd>{keyWord(keys[0])}</Kbd>;
  return (
    <KbdGroup>
      {keys.map((key) => (
        <Kbd key={key}>{keyWord(key)}</Kbd>
      ))}
    </KbdGroup>
  );
}
