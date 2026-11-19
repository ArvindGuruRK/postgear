'use client';

/**
 * The first-open question (Module 08 section 7, blueprint section 10): "What
 * Do You Want To Make?" with Vertical, Horizontal and Square as tiles, each
 * with a small drawing of the shape and its line, and **Continue**.
 *
 * It has no corner close and no Cancel: the clip needs a shape. The way out
 * is the way back to the video (the editor's own back button sits behind the
 * dialog, so the dialog carries it too). Escape and a press outside do
 * nothing.
 */
import {
  Button,
  buttonVariants,
  ChoiceTiles,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@postgear/ui';
import { CANVASES, type Ratio } from '@postgear/video-engine';
import Link from 'next/link';
import { useState } from 'react';
import { SHAPE_LINES, shapeName } from './clip-editor-model';
import { FIRST_SHAPES, type FirstShape } from './editor-state';

/** The shape as a small outlined box, its longest side 40 px. */
export function ShapeDrawing({ ratio }: { ratio: Ratio }) {
  const { width, height } = CANVASES[ratio];
  const longest = Math.max(width, height);
  const w = Math.round((width / longest) * 40);
  const h = Math.round((height / longest) * 40);
  return (
    <span className="flex h-11 w-11 items-center justify-center">
      <span className="block rounded-sm border-2 border-current" style={{ width: w, height: h }} />
    </span>
  );
}

export function ShapeDialog({
  open,
  initial,
  backHref,
  backLabel,
  onChoose,
}: {
  open: boolean;
  /** The clip's shape now, picked to start with. */
  initial: Ratio;
  backHref: string;
  backLabel: string;
  onChoose: (ratio: FirstShape) => void;
}) {
  const [choice, setChoice] = useState<FirstShape>(() =>
    (FIRST_SHAPES as readonly Ratio[]).includes(initial) ? (initial as FirstShape) : '9:16',
  );

  return (
    <Dialog open={open}>
      <DialogContent
        hideClose
        className="max-w-xl"
        data-testid="clip-shape-dialog"
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          {/* No id of our own: the dialog is named by the title's own id. */}
          <DialogTitle>What Do You Want To Make?</DialogTitle>
          <DialogDescription>
            Pick the shape of your clip. You can change it later in Layouts.
          </DialogDescription>
        </DialogHeader>
        <ChoiceTiles
          label="Shape"
          value={choice}
          onValueChange={setChoice}
          className="mt-2"
          options={FIRST_SHAPES.map((ratio) => ({
            value: ratio,
            label: shapeName(ratio),
            line: SHAPE_LINES[ratio],
            drawing: <ShapeDrawing ratio={ratio} />,
          }))}
        />
        <DialogFooter className="mt-4 gap-2 sm:justify-between">
          <Link
            href={backHref}
            className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }))}
          >
            {backLabel}
          </Link>
          <Button size="sm" onClick={() => onChoose(choice)} data-testid="clip-shape-continue">
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
