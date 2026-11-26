'use client';

/**
 * The editor's tab rail (Module 08 section 5; redone 2026-11-19): the app's
 * own rail, so the editor reads as part of PostGear and not a second app. The
 * frame, the PG tile on top and every tile are shared with `sidebar.tsx`
 * (`RAIL_FRAME`, `TILE`): the open tab takes the primary fill and the small
 * shadow, a tile under the pointer takes the outline, labels are 10 px.
 *
 * Seven tabs in order (Captions since Sprint 13), then Keyboard Shortcuts pinned to the bottom, where the
 * app rail keeps Settings. The open tab is `aria-pressed`.
 */
import { AudioLinesIcon } from '@animateicons/react/lucide/audio-lines-icon';
import { CaptionsIcon } from '@animateicons/react/lucide/captions-icon';
import { DownloadIcon } from '@animateicons/react/lucide/download-icon';
import { KeyboardIcon } from '@animateicons/react/lucide/keyboard-icon';
import { LayoutDashboardIcon } from '@animateicons/react/lucide/layout-dashboard-icon';
import { ShapesIcon } from '@animateicons/react/lucide/shapes-icon';
import { TypeIcon } from '@animateicons/react/lucide/type-icon';
import { WandSparklesIcon } from '@animateicons/react/lucide/wand-sparkles-icon';
import { type AnimatedIcon, cn, useIconAnimation } from '@postgear/ui';
import { BrandTile } from '@/components/brand/brand-mark';
import { ANIMATED_TILE_ICON, RAIL_FRAME, TILE, TILE_LABEL } from '@/components/navigation/sidebar';
import { EDITOR_TAB_NAMES, EDITOR_TABS, type EditorTab } from './editor-state';

export const TAB_ICONS: Readonly<Record<EditorTab, AnimatedIcon>> = {
  layouts: LayoutDashboardIcon,
  elements: ShapesIcon,
  text: TypeIcon,
  effects: WandSparklesIcon,
  audio: AudioLinesIcon,
  captions: CaptionsIcon,
  export: DownloadIcon,
};

function RailButton({
  icon: Icon,
  label,
  active,
  testId,
  onClick,
  ariaPressed,
}: {
  icon: AnimatedIcon;
  label: string;
  active: boolean;
  testId: string;
  onClick: () => void;
  ariaPressed?: boolean;
}) {
  const icon = useIconAnimation();
  return (
    <button
      type="button"
      title={label}
      aria-pressed={ariaPressed}
      data-testid={testId}
      onClick={onClick}
      {...icon.triggers}
      className={TILE(active)}
    >
      <Icon ref={icon.ref} aria-hidden size={20} className={ANIMATED_TILE_ICON} />
      <span className={TILE_LABEL}>{label}</span>
    </button>
  );
}

export function TabRail({
  tab,
  onTab,
  onShortcuts,
}: {
  tab: EditorTab;
  onTab: (tab: EditorTab) => void;
  /** Opens the keyboard shortcuts sheet. */
  onShortcuts?: () => void;
}) {
  return (
    <aside aria-label="Editor" className={cn(RAIL_FRAME, 'h-full')}>
      <BrandTile label="PostGear" />
      <div
        role="toolbar"
        aria-label="Editor tabs"
        aria-orientation="vertical"
        className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto overflow-x-hidden pg-scrollbar-hidden"
      >
        {EDITOR_TABS.map((value) => (
          <RailButton
            key={value}
            icon={TAB_ICONS[value]}
            label={EDITOR_TAB_NAMES[value]}
            active={value === tab}
            ariaPressed={value === tab}
            testId={`clip-tab-${value}`}
            onClick={() => onTab(value)}
          />
        ))}
      </div>
      {onShortcuts ? (
        <RailButton
          icon={KeyboardIcon}
          label="Shortcuts"
          active={false}
          testId="clip-rail-shortcuts"
          onClick={onShortcuts}
        />
      ) : null}
    </aside>
  );
}
