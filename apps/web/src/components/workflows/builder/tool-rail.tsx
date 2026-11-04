'use client';

/**
 * The tools down the canvas's right side (after n8n's rail, 2026-11-03): Add
 * Step, Search (the command palette), Add Note and Setup.
 */
import { ListChecksIcon } from '@animateicons/react/lucide/list-checks-icon';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { SearchIcon } from '@animateicons/react/lucide/search-icon';
import { StickyNoteIcon } from '@animateicons/react/lucide/sticky-note-icon';
import { Button, MotionIcon, TooltipHint } from '@postgear/ui';
import { Panel } from '@xyflow/react';
import type { ComponentProps } from 'react';
import { ShortcutKeys } from './shortcut-keys';

type AnimatedIcon = ComponentProps<typeof MotionIcon>['icon'];

function Tool({
  label,
  shortcut,
  icon,
  pressed,
  onClick,
  testId,
}: {
  label: string;
  shortcut?: readonly string[];
  icon: AnimatedIcon;
  pressed?: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <TooltipHint
      label={label}
      shortcut={shortcut ? <ShortcutKeys keys={shortcut} /> : undefined}
      side="left"
    >
      <Button
        variant="ghost"
        size="sm"
        className="h-9 w-9 px-0"
        aria-label={label}
        aria-pressed={pressed}
        data-testid={testId}
        onClick={onClick}
      >
        <MotionIcon icon={icon} className="h-4 w-4" />
      </Button>
    </TooltipHint>
  );
}

export function ToolRail({
  pickerOpen,
  setupOpen,
  onAddStep,
  onSearch,
  onAddNote,
  onSetup,
}: {
  pickerOpen: boolean;
  setupOpen: boolean;
  onAddStep: () => void;
  onSearch: () => void;
  onAddNote: () => void;
  onSetup: () => void;
}) {
  return (
    <Panel position="top-right" className="m-3!">
      <div
        role="toolbar"
        aria-label="Workflow tools"
        aria-orientation="vertical"
        className="flex flex-col items-center gap-1 rounded-md border-2 border-outline bg-secondary p-1 shadow-brutalSm"
      >
        <Tool
          label="Add Step"
          shortcut={['N']}
          icon={PlusIcon}
          pressed={pickerOpen}
          onClick={onAddStep}
          testId="rail-add-step"
        />
        <Tool
          label="Search"
          shortcut={['Ctrl', 'K']}
          icon={SearchIcon}
          onClick={onSearch}
          testId="rail-search"
        />
        <Tool
          label="Add Note"
          shortcut={['Shift', 'S']}
          icon={StickyNoteIcon}
          onClick={onAddNote}
          testId="rail-add-note"
        />
        <Tool
          label="Setup"
          icon={ListChecksIcon}
          pressed={setupOpen}
          onClick={onSetup}
          testId="rail-setup"
        />
      </div>
    </Panel>
  );
}
