'use client';

/**
 * The editor's panel (Module 08 section 5): the open tab's controls in a
 * `w-80` chrome panel, with **Back** and **Next** at its foot walking the
 * tabs in order, as StreamLadder does. On Export, Next is **Export Clip**.
 *
 * Until each tab's module lands (10 to 14) its body is one placeholder
 * sentence; Export shows Module 05's export.
 */
import { Button, EmptyState } from '@postgear/ui';
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
import { EDITOR_TAB_NAMES, type EditorTab, stepTab } from './editor-state';

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
}: {
  tab: EditorTab;
  onTab: (tab: EditorTab) => void;
  /** The open tab's body; left out, the placeholder. */
  children?: ReactNode;
  /** Next on the Export tab. */
  onExport: () => void;
  exportBusy: boolean;
}) {
  const back = stepTab(tab, -1);
  const next = stepTab(tab, 1);
  const headingId = panelHeadingId(tab);

  return (
    <section
      aria-labelledby={headingId}
      data-testid="clip-editor-panel"
      className="flex w-80 shrink-0 flex-col overflow-hidden rounded-card border-2 border-outline bg-chrome shadow-surfaceSm"
    >
      <h2
        id={headingId}
        className="m-0 shrink-0 px-4 pt-4 pb-2 font-sans text-base text-ink type-heading"
      >
        {EDITOR_TAB_NAMES[tab]}
      </h2>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pg-scrollbar">
        {children ?? (
          <div className="pt-6">
            <EmptyState icon={PLACEHOLDER_ICONS[tab]} title={LATER_PANEL_SENTENCE} />
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 border-t-2 border-outline px-4 py-3">
        <Button
          variant="secondary"
          size="sm"
          disabled={back === null}
          onClick={() => back && onTab(back)}
          data-testid="clip-panel-back"
        >
          Back
        </Button>
        {next ? (
          <Button size="sm" onClick={() => onTab(next)} data-testid="clip-panel-next">
            Next
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={onExport}
            disabled={exportBusy}
            data-testid="clip-panel-export"
          >
            Export Clip
          </Button>
        )}
      </div>
    </section>
  );
}
