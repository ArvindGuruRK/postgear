'use client';

import { FONTS } from '@postgear/design-engine';
/**
 * Create A Style (Sprint 13, Module 03): a caption style of the workspace's
 * own, started from how the clip's captions look right now.
 *
 * The form offers only what the export can draw, and keeps a look drawable
 * as it changes (`editLook`): an outline or a box, never both; a box behind
 * the spoken word takes the place of both. The specimen on top is the same
 * drawing the style's tile will show.
 */
import {
  Button,
  ChoiceTiles,
  ColorPicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormErrorMessage,
  FormField,
  FormLabel,
  Input,
} from '@postgear/ui';
import {
  type CaptionCase,
  type CaptionLook,
  type CaptionMarkKind,
  FONT_MANIFEST,
  familyWeights,
  nearestWeight,
} from '@postgear/video-engine';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { FontSelect } from '@/components/studio/font-select';
import { GroupLabel, NOTE } from '@/components/studio/panel-ui';
import { CLIP_FONT_IDS, fontIdOf } from '../editor/clip-fonts';
import { CaptionStyleDrawing } from './caption-style-tile';
import {
  BACKING_OPTIONS,
  backingOf,
  CASE_OPTIONS,
  type CaptionBacking,
  editLook,
  lookProblem,
  MARK_OPTIONS,
  MAX_STYLE_NAME_LENGTH,
  STYLE_NAME_PLACEHOLDER,
  withBacking,
} from './captions-model';

export function CaptionStyleDialog({
  open,
  onOpenChange,
  initial,
  recent,
  onRecent,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** How the clip's captions look right now. */
  initial: CaptionLook;
  recent: readonly string[];
  onRecent: (hex: string) => void;
  /** Saves the style; resolves to one sentence when it was refused, or null. */
  onSubmit: (name: string, look: CaptionLook) => Promise<string | null>;
}) {
  const [name, setName] = useState('');
  const [look, setLook] = useState<CaptionLook>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameId = useId();
  const fontId = useId();
  const markId = useId();
  const backingId = useId();
  const caseId = useId();
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // Each opening starts from the clip's captions as they are.
  useEffect(() => {
    if (!open) return;
    setName('');
    setLook(initial);
    setError(null);
    setBusy(false);
  }, [open, initial]);

  const change = (next: Partial<CaptionLook>) => setLook((current) => editLook(current, next));
  const cleanName = name.replace(/\s+/g, ' ').trim();
  const problem = lookProblem(look);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || cleanName.length === 0 || problem) return;
    setBusy(true);
    setError(null);
    try {
      const refused = await onSubmit(cleanName, look);
      if (!live.current) return;
      if (refused) setError(refused);
      else onOpenChange(false);
    } finally {
      if (live.current) setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto pg-scrollbar"
        data-testid="clip-caption-style-dialog"
      >
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Create A Style</DialogTitle>
            <DialogDescription className="sr-only">
              Save how these captions look as a style your workspace can use on any clip.
            </DialogDescription>
          </DialogHeader>

          <CaptionStyleDrawing
            look={look}
            maxPx={30}
            className="h-20 w-full rounded-md border-2 border-outline"
          />

          <FormField>
            <FormLabel htmlFor={nameId}>Style name</FormLabel>
            <Input
              id={nameId}
              value={name}
              maxLength={MAX_STYLE_NAME_LENGTH}
              disabled={busy}
              aria-invalid={error ? true : undefined}
              placeholder={STYLE_NAME_PLACEHOLDER}
              onChange={(event) => setName(event.target.value)}
              autoFocus
            />
          </FormField>

          <div className="flex flex-col gap-1">
            <GroupLabel id={fontId}>Font</GroupLabel>
            <FontSelect
              label="Font"
              value={fontIdOf(look.font)}
              only={CLIP_FONT_IDS}
              disabled={busy}
              onChange={(next) => {
                if (!next) return;
                const family = FONTS[next].family;
                const weight =
                  nearestWeight(familyWeights(FONT_MANIFEST, family), look.weight) ?? look.weight;
                change({ font: family, weight });
              }}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <ColorPicker
              label="Text Colour"
              value={look.colour}
              recent={recent}
              onChange={(colour) => change({ colour })}
              onCommit={onRecent}
            />
            {look.mark.kind !== 'none' && look.mark.kind !== 'reveal' ? (
              <ColorPicker
                label="Highlight Colour"
                value={look.mark.colour}
                recent={recent}
                onChange={(colour) => change({ mark: { ...look.mark, colour } })}
                onCommit={onRecent}
              />
            ) : null}
            {look.outline ? (
              <ColorPicker
                label="Outline Colour"
                value={look.outline.colour}
                recent={recent}
                onChange={(colour) =>
                  look.outline && change({ outline: { ...look.outline, colour } })
                }
                onCommit={onRecent}
              />
            ) : null}
            {look.box ? (
              <ColorPicker
                label="Box Colour"
                value={look.box.colour}
                recent={recent}
                onChange={(colour) => look.box && change({ box: { ...look.box, colour } })}
                onCommit={onRecent}
              />
            ) : null}
          </div>

          <div className="flex flex-col gap-2">
            <GroupLabel id={markId}>Highlight</GroupLabel>
            <ChoiceTiles<CaptionMarkKind>
              labelledBy={markId}
              columns={3}
              value={look.mark.kind}
              onValueChange={(kind) =>
                change({ mark: { ...look.mark, kind, pop: kind === 'colour' && look.mark.pop } })
              }
              options={MARK_OPTIONS.map((option) => ({
                value: option.value,
                label: option.label,
              }))}
            />
            <p className={NOTE}>
              {MARK_OPTIONS.find((option) => option.value === look.mark.kind)?.line}.
            </p>
          </div>

          {look.mark.kind !== 'box' ? (
            <div className="flex flex-col gap-2">
              <GroupLabel id={backingId}>Behind The Words</GroupLabel>
              <ChoiceTiles<CaptionBacking>
                labelledBy={backingId}
                columns={3}
                value={backingOf(look)}
                onValueChange={(backing) => setLook((current) => withBacking(current, backing))}
                options={BACKING_OPTIONS.map((option) => ({ ...option }))}
              />
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <GroupLabel id={caseId}>Letters</GroupLabel>
            <ChoiceTiles<CaptionCase>
              labelledBy={caseId}
              columns={3}
              value={look.letterCase}
              onValueChange={(letterCase) => change({ letterCase })}
              options={CASE_OPTIONS.map((option) => ({ ...option }))}
            />
          </div>

          {error || problem ? <FormErrorMessage>{error ?? problem}</FormErrorMessage> : null}

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || cleanName.length === 0 || problem !== null}>
              {busy ? 'Saving...' : 'Save Style'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
