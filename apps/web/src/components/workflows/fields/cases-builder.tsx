'use client';

import { GripVerticalIcon } from '@animateicons/react/lucide/grip-vertical-icon';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
/**
 * Paths' cases (blueprint 5.4): an ordered list of paths, each a name and
 * a condition, checked top to bottom; the first that matches wins and
 * Otherwise, fixed at the end, takes the rest. Drag a path by its handle
 * (or with the keyboard) to change the order.
 */
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button, FormErrorMessage, Input, Label, MotionIcon, Text } from '@postgear/ui';
import { useId } from 'react';
import { ConditionBuilder } from './condition-builder';
import {
  addCase,
  asCases,
  MAX_CASES,
  moveCase,
  type PathCase,
  removeCase,
} from './condition-model';
import { FIELD_PATH_ATTRIBUTE } from './contract';
import type { FieldControlProps } from './field-types';
import { errorsUnder } from './form-model';

export function CasesBuilder({ spec, value, onChange, errors, ids }: FieldControlProps) {
  const cases = asCases(value);
  const dndId = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const max = spec.max ?? MAX_CASES;
  const write = (next: PathCase[]) => onChange(spec.path, next);

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = cases.findIndex((entry) => entry.id === active.id);
    const to = cases.findIndex((entry) => entry.id === over.id);
    write(moveCase(cases, from, to));
  }

  return (
    // biome-ignore lint/a11y/useSemanticElements: the paths, named by the field's label
    <div role="group" aria-labelledby={ids.label} className="flex flex-col gap-3">
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={cases.map((entry) => entry.id)}
          strategy={verticalListSortingStrategy}
        >
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {cases.map((entry, index) => (
              <SortableCase
                key={entry.id}
                entry={entry}
                index={index}
                basePath={spec.path}
                lead={spec.lead}
                errors={errorsUnder(errors, String(index))}
                canRemove={cases.length > 1}
                onChange={(next) => write(cases.map((c) => (c.id === entry.id ? next : c)))}
                onRemove={() => write(removeCase(cases, entry.id))}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>

      <div className="flex flex-col gap-1 rounded-md border-2 border-dashed border-outline px-3 py-2">
        <span className="type-ui text-sm text-ink">Otherwise</span>
        <Text size="xs" muted>
          Runs that match no path above go this way.
        </Text>
      </div>

      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={cases.length >= max}
          onClick={() => write(addCase(cases))}
        >
          <MotionIcon icon={PlusIcon} className="h-4 w-4" />
          Add Path
        </Button>
      </div>
      {errors[''] ? <FormErrorMessage>{errors['']}</FormErrorMessage> : null}
    </div>
  );
}

function SortableCase({
  entry,
  index,
  basePath,
  lead,
  errors,
  canRemove,
  onChange,
  onRemove,
}: {
  entry: PathCase;
  index: number;
  basePath: string;
  lead?: string;
  errors: Readonly<Record<string, string>>;
  canRemove: boolean;
  onChange: (next: PathCase) => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.id });
  const ids = useId();
  const casePath = `${basePath}.${index}`;
  const label = entry.name.trim() || `Path ${index + 1}`;

  return (
    <li
      ref={setNodeRef}
      {...{ [FIELD_PATH_ATTRIBUTE]: casePath }}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={
        isDragging
          ? 'relative z-10 flex flex-col gap-3 rounded-lg border-2 border-outline bg-secondary p-3 shadow-brutalMd'
          : 'flex flex-col gap-3 rounded-lg border-2 border-outline bg-secondary p-3'
      }
    >
      <div className="flex items-end gap-2">
        <button
          type="button"
          ref={setActivatorNodeRef}
          aria-label={`Drag to reorder ${label}`}
          className="mb-2 flex h-7 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-ink opacity-60 outline-none hover:opacity-100 active:cursor-grabbing focus-visible:opacity-100 focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
          {...attributes}
          {...listeners}
        >
          <MotionIcon icon={GripVerticalIcon} className="h-4 w-4" />
        </button>
        <div
          {...{ [FIELD_PATH_ATTRIBUTE]: `${casePath}.name` }}
          className="flex min-w-0 flex-1 flex-col gap-1.5"
        >
          <Label htmlFor={`${ids}-name`}>Path name</Label>
          <Input
            id={`${ids}-name`}
            value={entry.name}
            maxLength={40}
            placeholder="Enter your path name"
            variant={errors.name ? 'error' : 'default'}
            aria-invalid={errors.name ? true : undefined}
            onChange={(event) => onChange({ ...entry, name: event.target.value })}
          />
        </div>
        {canRemove ? (
          <Button
            type="button"
            variant="danger"
            size="sm"
            className="h-11 w-11 shrink-0 px-0"
            onClick={onRemove}
          >
            <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
            <span className="sr-only">Remove {label}</span>
          </Button>
        ) : null}
      </div>
      {errors.name ? <FormErrorMessage>{errors.name}</FormErrorMessage> : null}
      <div {...{ [FIELD_PATH_ATTRIBUTE]: `${casePath}.condition` }}>
        <ConditionBuilder
          value={entry.condition}
          path={`${casePath}.condition`}
          lead={lead}
          errors={errorsUnder(errors, 'condition')}
          onChange={(condition) => onChange({ ...entry, condition })}
        />
      </div>
    </li>
  );
}
