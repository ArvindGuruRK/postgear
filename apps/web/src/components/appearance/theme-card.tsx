'use client';

import { Badge, cn } from '@postgear/ui';
import { Check, Lock } from 'lucide-react';
import type { AppearanceTheme } from '@/lib/appearance';

/**
 * One theme, light or dark, in the Appearance grids: a miniature of the app
 * drawn from the catalog's swatch, and the theme's name.
 *
 * The miniature paints with inline colours from the API's catalog rather
 * than the theme CSS, so every card shows its own theme whatever the page is
 * currently wearing (a dark theme on a light page and the other way round).
 * Those hexes are data, not styling choices made here: the CSS blocks in
 * colors.css are their source, and a unit test on the catalog keeps the two
 * equal. Layers, top to bottom: the frame strip (chrome), the page, a card on
 * it, and inside the card a field and a blue button chip. Edges use the
 * theme's outline and the dots its ink, as the real app does, so a dark
 * theme's preview has the same dark borders as the theme itself.
 *
 * A pressable tile (`shadow-brutalSm`, the press translate), selected like
 * the other choice tiles in the app: an `actionPrimary` border plus a
 * "Current" badge, so the state never rests on colour alone.
 */
export function ThemeCard({
  theme,
  selected,
  locked,
  busy,
  onChoose,
}: {
  theme: AppearanceTheme;
  selected: boolean;
  /** Premium without a paid workspace: choosing it previews, it does not save. */
  locked: boolean;
  busy: boolean;
  onChoose: (theme: AppearanceTheme) => void;
}) {
  const { swatch } = theme;
  const edge = { borderColor: swatch.outline };

  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${theme.name}${theme.premium ? ', premium' : ''}${locked ? ', locked' : ''}`}
      aria-busy={busy || undefined}
      data-testid={`theme-${theme.mode}-${theme.id}`}
      onClick={() => onChoose(theme)}
      className={cn(
        'group flex flex-col gap-2 rounded-md border-2 border-outline bg-secondary p-2 text-left text-ink',
        'shadow-brutalSm transition-[transform,box-shadow] duration-100',
        'active:translate-x-[1px] active:translate-y-[1px] active:shadow-brutalPressed',
        'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
        selected && 'border-actionPrimary',
      )}
    >
      <span
        aria-hidden="true"
        className="flex h-20 w-full flex-col overflow-hidden rounded-sm border-2"
        style={{ ...edge, backgroundColor: swatch.page }}
      >
        <span
          className="flex h-4 shrink-0 items-center gap-1 border-b-2 px-1.5"
          style={{ ...edge, backgroundColor: swatch.chrome }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: swatch.ink }} />
          <span
            className="h-1 w-6 rounded-full opacity-60"
            style={{ backgroundColor: swatch.ink }}
          />
        </span>
        <span className="flex flex-1 items-center p-2">
          <span
            className="flex w-full flex-col gap-1.5 rounded-sm border-2 p-1.5"
            style={{ ...edge, backgroundColor: swatch.card }}
          >
            <span
              className="h-2.5 w-full rounded-[2px] border"
              style={{ ...edge, backgroundColor: swatch.field }}
            />
            <span
              className="h-2.5 w-8 self-end rounded-[2px] border"
              style={{ ...edge, backgroundColor: swatch.accent }}
            />
          </span>
        </span>
      </span>

      <span className="flex min-h-6 items-center justify-between gap-2 px-0.5">
        <span className="type-ui truncate text-sm">{theme.name}</span>
        {selected ? (
          <Badge variant="primary" className="px-2 py-0.5">
            <Check className="h-3 w-3" strokeWidth={3} aria-hidden="true" />
            Current
          </Badge>
        ) : theme.premium ? (
          <Badge variant="outline" className="px-2 py-0.5">
            {locked ? <Lock className="h-3 w-3" strokeWidth={3} aria-hidden="true" /> : null}
            Premium
          </Badge>
        ) : null}
      </span>
    </button>
  );
}
