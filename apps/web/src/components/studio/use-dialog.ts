'use client';

/**
 * A dialog opened from a control of the page's own rather than a Radix
 * trigger: a menu item, a card's button, the editor's action row.
 *
 * Radix gives focus back to a trigger only, so this remembers what had focus
 * as the dialog opened (a menu's button, for one of its items: `openerOf`)
 * and gives it back once the dialog has gone, unless focus has moved on
 * since. When the dialog took that control away with what it removed (a
 * deleted card), the same control on the card that moved into its place
 * takes focus instead, or, once the list is empty, the first control in the
 * `area` it names (`returnFocus`).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { type OpenerPlace, openerOf, placeOf, returnFocus } from './studio-editor-model';

export interface DialogHandle<T> {
  /** What the dialog is open for, or null while it is closed. */
  value: T | null;
  open: (value: T) => void;
  close: () => void;
  /** For the dialog's own `onOpenChange`: closing only. */
  onOpenChange: (open: boolean) => void;
}

export function useDialog<T>(area?: () => HTMLElement | null): DialogHandle<T> {
  const [value, setValue] = useState<T | null>(null);
  const opener = useRef<OpenerPlace | null>(null);
  const areaOf = useRef(area);
  const isOpen = value !== null;

  useLayoutEffect(() => {
    areaOf.current = area;
  });

  useEffect(() => {
    if (isOpen) return;

    const place = opener.current;
    opener.current = null;
    if (!place) return;

    // After Radix's own focus handling, which runs in a timeout as the dialog goes.
    const timer = setTimeout(() => {
      const page = place.element.ownerDocument;
      const active = page.activeElement;
      if (active === null || active === page.body) {
        returnFocus(place, areaOf.current?.() ?? null);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [isOpen]);

  const open = useCallback((next: T) => {
    const element = openerOf(window.document.activeElement);
    opener.current = element ? placeOf(element) : null;
    setValue(next);
  }, []);
  const close = useCallback(() => setValue(null), []);
  const onOpenChange = useCallback((next: boolean) => {
    if (!next) setValue(null);
  }, []);

  return { value, open, close, onOpenChange };
}
