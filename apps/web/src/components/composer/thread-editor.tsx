'use client';

/**
 * The reorderable list of a post's parts.
 *
 * Drag-and-drop through dnd-kit, with its keyboard sensor, so a part can be
 * picked up with Space and moved with the arrow keys — plus explicit "Move up"
 * and "Move down" buttons on every part, because a drag handle is not a
 * discoverable control for everyone and a button is.
 *
 * Only the handle starts a drag. The whole card cannot be a drag source: it
 * contains a text editor, and a drag that starts on a text selection is a
 * text selection.
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
import { Badge, Button, cn, Stack, Text } from '@postgear/ui';
import { ArrowDown, ArrowUp, GripVertical, ImagePlus, Plus, Trash2, X } from 'lucide-react';
import { type Dispatch, useId } from 'react';
import type { ChannelReport } from './channel-report';
import {
  type ComposerAction,
  type DraftPart,
  MAX_MEDIA_PER_PART,
  MAX_PARTS,
  type Scope,
} from './composer-state';
import { PostEditor } from './editor';

export function ThreadEditor({
  scope,
  scopeLabel,
  parts,
  reports,
  dispatch,
  onAttachMedia,
}: {
  scope: Scope;
  /** "the shared post", or a channel name — used in accessible labels. */
  scopeLabel: string;
  parts: DraftPart[];
  /** Reports for the channels that publish these parts. */
  reports: ChannelReport[];
  dispatch: Dispatch<ComposerAction>;
  onAttachMedia: (partKey: string) => void;
}) {
  // dnd-kit numbers its accessibility ids from a module-level counter, which
  // differs between the server render and the browser and makes React report
  // a hydration mismatch. A React id is the same on both sides.
  const dndId = useId();

  const sensors = useSensors(
    // A small distance, so a click on the handle is not read as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) {
      return;
    }

    const from = parts.findIndex((part) => part.key === active.id);
    const to = parts.findIndex((part) => part.key === over.id);
    dispatch({ type: 'movePart', scope, from, to });
  }

  return (
    <Stack gap="md">
      <DndContext
        id={dndId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={parts.map((part) => part.key)}
          strategy={verticalListSortingStrategy}
        >
          <ol
            aria-label={`Parts of ${scopeLabel}`}
            className="m-0 flex list-none flex-col gap-4 p-0"
          >
            {parts.map((part, index) => (
              <SortablePart
                key={part.key}
                part={part}
                index={index}
                total={parts.length}
                scope={scope}
                scopeLabel={scopeLabel}
                reports={reports}
                dispatch={dispatch}
                onAttachMedia={onAttachMedia}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>

      <div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => dispatch({ type: 'addPart', scope })}
          disabled={parts.length >= MAX_PARTS}
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Add to thread
        </Button>
      </div>
    </Stack>
  );
}

function SortablePart({
  part,
  index,
  total,
  scope,
  scopeLabel,
  reports,
  dispatch,
  onAttachMedia,
}: {
  part: DraftPart;
  index: number;
  total: number;
  scope: Scope;
  scopeLabel: string;
  reports: ChannelReport[];
  dispatch: Dispatch<ComposerAction>;
  onAttachMedia: (partKey: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: part.key });

  const label = `Part ${index + 1}`;
  const issues = reports.flatMap((report) =>
    report.issues
      .filter((issue) => issue.part === index)
      .map((issue) => ({
        key: `${report.channel.id}-${issue.code}`,
        text: `${report.channel.name}: ${issue.message}`,
      })),
  );

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      data-testid="thread-part"
      className={cn(
        'rounded-lg border-4 border-outline bg-secondary',
        isDragging ? 'relative z-10 shadow-brutalLg' : 'shadow-brutalMd',
      )}
    >
      <div className="flex flex-wrap items-center gap-2 border-b-2 border-outline px-3 py-2">
        <button
          type="button"
          ref={setActivatorNodeRef}
          aria-label={`Drag to reorder ${label}`}
          className="flex h-8 w-6 cursor-grab touch-none items-center justify-center rounded-sm text-ink outline-none active:cursor-grabbing focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4" strokeWidth={2.5} />
        </button>

        <span className="font-display text-sm uppercase tracking-wide text-ink">{label}</span>

        <div className="flex flex-wrap items-center gap-1.5">
          {reports.map((report) => {
            const rendered = report.parts[index];
            const max = report.provider?.rules.maxLength;

            if (!rendered || max === undefined) {
              return null;
            }

            const over = rendered.length > max;

            return (
              <Badge
                key={report.channel.id}
                variant={over ? 'danger' : 'outline'}
                title={`${report.channel.name}: ${rendered.length} of ${max} characters`}
              >
                {report.provider?.name ?? report.channel.providerName}{' '}
                {rendered.length.toLocaleString('en-US')}/{max.toLocaleString('en-US')}
              </Badge>
            );
          })}
        </div>

        <div className="ms-auto flex items-center gap-1">
          <IconButton
            label={`Move ${label} up`}
            disabled={index === 0}
            onClick={() => dispatch({ type: 'movePart', scope, from: index, to: index - 1 })}
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
          </IconButton>
          <IconButton
            label={`Move ${label} down`}
            disabled={index === total - 1}
            onClick={() => dispatch({ type: 'movePart', scope, from: index, to: index + 1 })}
          >
            <ArrowDown className="h-4 w-4" strokeWidth={2.5} />
          </IconButton>
          <IconButton
            label={`Remove ${label}`}
            disabled={total <= 1}
            onClick={() => dispatch({ type: 'removePart', scope, key: part.key })}
          >
            <Trash2 className="h-4 w-4" strokeWidth={2.5} />
          </IconButton>
        </div>
      </div>

      <div className="flex flex-col gap-3 p-3">
        <PostEditor
          initialContent={part.content}
          onChange={(content) => dispatch({ type: 'editContent', scope, key: part.key, content })}
          label={`${label} of ${scopeLabel}`}
          placeholder={index === 0 ? 'What do you want to share?' : 'Continue the thread…'}
        />

        <div className="flex flex-wrap items-center gap-2">
          {part.media.map((item) => (
            <div
              key={item.id}
              className="relative h-16 w-16 overflow-hidden rounded-md border-2 border-outline bg-primary"
            >
              {item.type === 'image' ? (
                // biome-ignore lint/performance/noImgElement: a thumbnail served from media storage
                <img
                  src={item.thumbnailUrl ?? item.url}
                  alt={item.name}
                  className="h-full w-full object-cover"
                />
              ) : (
                <video
                  src={item.url}
                  preload="metadata"
                  muted
                  className="h-full w-full object-cover"
                  aria-label={item.name}
                />
              )}
              <button
                type="button"
                aria-label={`Remove ${item.name} from ${label}`}
                onClick={() =>
                  dispatch({ type: 'detachMedia', scope, key: part.key, mediaId: item.id })
                }
                className="absolute end-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-outline bg-secondary text-ink outline-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-1 focus-visible:outline-focusRing"
              >
                <X className="h-3 w-3" strokeWidth={3} />
              </button>
            </div>
          ))}

          <Button
            variant="secondary"
            size="sm"
            onClick={() => onAttachMedia(part.key)}
            disabled={part.media.length >= MAX_MEDIA_PER_PART}
            aria-label={`Add media to ${label}`}
          >
            <ImagePlus className="h-4 w-4" strokeWidth={2.5} />
            Media
          </Button>
        </div>

        {part.removedMedia > 0 ? (
          <Text size="xs" muted>
            {part.removedMedia === 1
              ? 'An attachment was'
              : `${part.removedMedia} attachments were`}{' '}
            deleted from the media library since this was saved.
          </Text>
        ) : null}

        {issues.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label={`${label} issues`}>
            {issues.map((issue) => (
              <li key={issue.key} className="font-sans text-xs font-bold text-actionDanger">
                {issue.text}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-md border-2 border-transparent text-ink',
        'outline-none hover:border-outline hover:bg-actionPrimary/10',
        'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
        'disabled:pointer-events-none disabled:opacity-40',
      )}
    >
      {children}
    </button>
  );
}
