'use client';

/**
 * The editor's panel (Module 08 section 5; redone 2026-11-19 after the
 * StreamLadder reference): the open tab's controls in a `w-80` chrome panel
 * (`w-96` from 1536 px, so sound and sticker names have room on a wide
 * screen), running the full height beside the rail.
 *
 * - **Head**: the tab's name, one sentence on what it is for, and Hide Panel,
 *   which folds the panel away so the stage has the room (any rail tile opens
 *   it again).
 * - **Foot**: the way through the tabs in order, each button naming where it
 *   goes ("Layouts", "Effects"), as StreamLadder's do. The first tab has no
 *   way back; on Export the forward button is **Export Clip**.
 */
import { ArrowLeftIcon } from '@animateicons/react/lucide/arrow-left-icon';
import { ArrowRightIcon } from '@animateicons/react/lucide/arrow-right-icon';
import { DownloadIcon } from '@animateicons/react/lucide/download-icon';
import { PanelLeftCloseIcon } from '@animateicons/react/lucide/panel-left-close-icon';
import { Button, EmptyState, MotionIcon, TooltipHint } from '@postgear/ui';
import {
  AudioLines,
  Download,
  LayoutDashboard,
  type LucideIcon,
  Shapes,
  Type,
  WandSparkles,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { LATER_PANEL_SENTENCE } from './clip-editor-model';
import { EDITOR_TAB_LINES, EDITOR_TAB_NAMES, type EditorTab, stepTab } from './editor-state';

/** The placeholder's mark: the rail's picture, still (decorative). */
const PLACEHOLDER_ICONS: Readonly<Record<EditorTab, LucideIcon>> = {
  layouts: LayoutDashboard,
  elements: Shapes,
  text: Type,
  effects: WandSparkles,
  audio: AudioLines,
  export: Download,
};

/** The id of the panel's heading, which a tab's main choice can take as its name. */
export function panelHeadingId(tab: EditorTab): string {
  return `clip-panel-${tab}`;
}

export function EditorPanel({
  tab,
  onTab,
  children,
  onExport,
  exportBusy,
  onHide,
}: {
  tab: EditorTab;
  onTab: (tab: EditorTab) => void;
  /** The open tab's body; left out, the placeholder. */
  children?: ReactNode;
  /** The forward button on the Export tab. */
  onExport: () => void;
  exportBusy: boolean;
  /** Folds the panel away; absent, the panel cannot be hidden. */
  onHide?: () => void;
}) {
  const back = stepTab(tab, -1);
  const next = stepTab(tab, 1);
  const headingId = panelHeadingId(tab);
  const lineId = `${headingId}-line`;

  return (
    <section
      aria-labelledby={headingId}
      aria-describedby={lineId}
      data-testid="clip-editor-panel"
      className="flex h-full w-80 shrink-0 flex-col overflow-hidden rounded-2xl border-2 border-outline bg-chrome shadow-surfaceMd 2xl:w-96"
    >
      <div className="flex shrink-0 items-start gap-2 px-4 pt-4 pb-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 id={headingId} className="m-0 font-sans text-lg text-ink type-heading">
            {EDITOR_TAB_NAMES[tab]}
          </h2>
          <p id={lineId} className="m-0 font-sans text-sm text-ink type-muted">
            {EDITOR_TAB_LINES[tab]}
          </p>
        </div>
        {onHide ? (
          <TooltipHint label="Hide Panel" side="bottom">
            <Button
              variant="ghost"
              size="sm"
              aria-label="Hide Panel"
              className="-me-1 h-9 w-9 shrink-0 px-0"
              onClick={onHide}
              data-testid="clip-panel-hide"
            >
              <MotionIcon icon={PanelLeftCloseIcon} className="h-4 w-4" />
            </Button>
          </TooltipHint>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pg-scrollbar">
        {children ?? (
          <div className="pt-6">
            <EmptyState icon={PLACEHOLDER_ICONS[tab]} title={LATER_PANEL_SENTENCE} />
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 border-t-2 border-outline px-4 py-3">
        {back ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onTab(back)}
            data-testid="clip-panel-back"
          >
            <MotionIcon icon={ArrowLeftIcon} className="h-4 w-4" />
            {EDITOR_TAB_NAMES[back]}
          </Button>
        ) : (
          <span />
        )}
        {next ? (
          <Button size="sm" onClick={() => onTab(next)} data-testid="clip-panel-next">
            {EDITOR_TAB_NAMES[next]}
            <MotionIcon icon={ArrowRightIcon} className="h-4 w-4" />
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={onExport}
            disabled={exportBusy}
            data-testid="clip-panel-export"
          >
            <MotionIcon icon={DownloadIcon} className="h-4 w-4" />
            Export Clip
          </Button>
        )}
      </div>
    </section>
  );
}
