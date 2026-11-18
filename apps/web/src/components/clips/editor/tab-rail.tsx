'use client';

/**
 * The editor's tab rail (Module 08 section 5): six buttons in the workflow
 * builder's `Tool` pattern, each an animated icon over its name. The open
 * tab is `aria-pressed` with the pressed look; no shadow.
 */
import { AudioLinesIcon } from '@animateicons/react/lucide/audio-lines-icon';
import { DownloadIcon } from '@animateicons/react/lucide/download-icon';
import { LayoutDashboardIcon } from '@animateicons/react/lucide/layout-dashboard-icon';
import { ShapesIcon } from '@animateicons/react/lucide/shapes-icon';
import { TypeIcon } from '@animateicons/react/lucide/type-icon';
import { WandSparklesIcon } from '@animateicons/react/lucide/wand-sparkles-icon';
import { type AnimatedIcon, cn, MotionIcon } from '@postgear/ui';
import { EDITOR_TAB_NAMES, EDITOR_TABS, type EditorTab } from './editor-state';

export const TAB_ICONS: Readonly<Record<EditorTab, AnimatedIcon>> = {
  layouts: LayoutDashboardIcon,
  elements: ShapesIcon,
  text: TypeIcon,
  effects: WandSparklesIcon,
  audio: AudioLinesIcon,
  export: DownloadIcon,
};

export function TabRail({ tab, onTab }: { tab: EditorTab; onTab: (tab: EditorTab) => void }) {
  return (
    <nav aria-label="Editor tabs" className="flex shrink-0">
      <div
        role="toolbar"
        aria-label="Editor tabs"
        aria-orientation="vertical"
        className="flex w-20 flex-col gap-1 rounded-card border-2 border-outline bg-chrome p-1.5 shadow-surfaceSm"
      >
        {EDITOR_TABS.map((value) => {
          const open = value === tab;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={open}
              data-testid={`clip-tab-${value}`}
              onClick={() => onTab(value)}
              className={cn(
                'flex w-full flex-col items-center gap-1 rounded-md border-2 px-1 py-2',
                'font-sans text-xs text-ink type-ui transition-colors duration-100',
                'outline-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-focusRing',
                open
                  ? 'border-outline bg-actionPrimary text-onActionPrimary'
                  : 'border-transparent hover:border-outline hover:bg-secondary',
              )}
            >
              <MotionIcon icon={TAB_ICONS[value]} className="h-5 w-5" />
              {EDITOR_TAB_NAMES[value]}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
