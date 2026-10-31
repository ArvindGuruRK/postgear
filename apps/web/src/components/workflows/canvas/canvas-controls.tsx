'use client';

/**
 * The canvas's control bar, bottom left (blueprint 4.5): zoom out, zoom
 * in, Fit To Screen, Undo, Redo, Tidy Up and the lock that stops steps
 * from moving by accident.
 */
import { LockIcon } from '@animateicons/react/lucide/lock-icon';
import { LockOpenIcon } from '@animateicons/react/lucide/lock-open-icon';
import { RedoIcon } from '@animateicons/react/lucide/redo-icon';
import { ScanIcon } from '@animateicons/react/lucide/scan-icon';
import { UndoIcon } from '@animateicons/react/lucide/undo-icon';
import { WandSparklesIcon } from '@animateicons/react/lucide/wand-sparkles-icon';
import { ZoomInIcon } from '@animateicons/react/lucide/zoom-in-icon';
import { ZoomOutIcon } from '@animateicons/react/lucide/zoom-out-icon';
import { Button, MotionIcon, TooltipHint } from '@postgear/ui';
import { Panel, useReactFlow } from '@xyflow/react';
import type { ComponentProps } from 'react';

type AnimatedIcon = ComponentProps<typeof MotionIcon>['icon'];

function Control({
  label,
  shortcut,
  icon,
  onClick,
  disabled,
  pressed,
}: {
  label: string;
  shortcut?: string;
  icon: AnimatedIcon;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
}) {
  return (
    <TooltipHint label={label} shortcut={shortcut} disabled={disabled}>
      <Button
        variant="ghost"
        size="sm"
        className="h-9 w-9 px-0"
        aria-label={label}
        aria-pressed={pressed}
        onClick={onClick}
        disabled={disabled}
      >
        <MotionIcon icon={icon} className="h-4 w-4" />
      </Button>
    </TooltipHint>
  );
}

export function CanvasControls({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onTidy,
  locked,
  onLock,
  hasSteps,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onTidy: () => void;
  locked: boolean;
  onLock: () => void;
  hasSteps: boolean;
}) {
  const flow = useReactFlow();
  return (
    <Panel position="bottom-left" className="m-3!">
      <div
        role="toolbar"
        aria-label="Canvas controls"
        className="flex flex-wrap items-center gap-1 rounded-md border-2 border-outline bg-secondary p-1 shadow-brutalSm"
      >
        <Control
          label="Zoom Out"
          icon={ZoomOutIcon}
          onClick={() => void flow.zoomOut({ duration: 200 })}
        />
        <Control
          label="Zoom In"
          icon={ZoomInIcon}
          onClick={() => void flow.zoomIn({ duration: 200 })}
        />
        <Control
          label="Fit To Screen"
          shortcut="1"
          icon={ScanIcon}
          onClick={() => void flow.fitView({ duration: 200, padding: 0.2 })}
        />
        <span aria-hidden="true" className="mx-0.5 h-6 w-0.5 bg-outline" />
        <Control
          label="Undo"
          shortcut="Ctrl+Z"
          icon={UndoIcon}
          onClick={onUndo}
          disabled={!canUndo}
        />
        <Control
          label="Redo"
          shortcut="Ctrl+Shift+Z"
          icon={RedoIcon}
          onClick={onRedo}
          disabled={!canRedo}
        />
        <Control
          label="Tidy Up"
          icon={WandSparklesIcon}
          onClick={onTidy}
          disabled={!hasSteps || locked}
        />
        <Control
          label={locked ? 'Unlock Steps' : 'Lock Steps'}
          icon={locked ? LockIcon : LockOpenIcon}
          onClick={onLock}
          pressed={locked}
        />
      </div>
    </Panel>
  );
}
