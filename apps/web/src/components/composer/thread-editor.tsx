'use client';

import { ArrowDownIcon } from '@animateicons/react/lucide/arrow-down-icon';
import { ArrowUpIcon } from '@animateicons/react/lucide/arrow-up-icon';
import { GripVerticalIcon } from '@animateicons/react/lucide/grip-vertical-icon';
import { ImagePlusIcon } from '@animateicons/react/lucide/image-plus-icon';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import { XIcon } from '@animateicons/react/lucide/x-icon';
/**
 * The reorderable list of a post's parts (UI revamp, 2026-10-19, after the
 * reference's editor): one editor for a single post, and for a thread, each
 * further part as its own editor under it, added with "Add to thread".
 *
 * Inside each editor: the text, the part's media, and a toolbar with Insert
 * Media first and each selected platform's character count at the far end,
 * red once the text runs past that platform's limit.
 *
 * Drag-and-drop through dnd-kit, with its keyboard sensor, so a part can be
 * picked up with Space and moved with the arrow keys, plus explicit "Move up"
 * and "Move down" buttons on every part, because a drag handle is not a
 * discoverable control for everyone and a button is. Only the handle starts a
 * drag: the part contains a text editor, and a drag that starts on a text
 * selection is a text selection.
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
import {
  ANIMATED_ICON_CLASS,
  type AnimatedIcon,
  Button,
  cn,
  MotionIcon,
  TooltipHint,
  useIconAnimation,
} from '@postgear/ui';
import type { Editor } from '@tiptap/react';
import { type Dispatch, useId } from 'react';
import { PlatformIcon } from '@/components/platforms/platform-icon';
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
  disabled = false,
  signaturesHref,
  onEditor,
  onEditorFocus,
}: {
  scope: Scope;
  /** "the shared post", or a channel name: used in accessible labels. */
  scopeLabel: string;
  parts: DraftPart[];
  /** Reports for the channels that publish these parts. */
  reports: ChannelReport[];
  dispatch: Dispatch<ComposerAction>;
  onAttachMedia: (partKey: string) => void;
  /** A published post: readable, not changeable. */
  disabled?: boolean;
  /** Settings > Signatures, for the toolbar's Signature popover. */
  signaturesHref: string;
  /** Each part's editor as it mounts (null as it goes), by part key: see `PostEditor`. */
  onEditor?: (partKey: string, editor: Editor | null) => void;
  /** A part's editor took focus. */
  onEditorFocus?: (partKey: string) => void;
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
    // The reference's group card: every part of the post in one surface,
    // with "Add to thread" under the last.
    <div className="flex flex-col gap-3 rounded-xl border-2 border-outline bg-chrome p-3">
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
            className="m-0 flex list-none flex-col gap-3 p-0"
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
                disabled={disabled}
                signaturesHref={signaturesHref}
                onEditor={onEditor}
                onEditorFocus={onEditorFocus}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>

      {disabled ? null : (
        <div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => dispatch({ type: 'addPart', scope })}
            disabled={parts.length >= MAX_PARTS}
          >
            <MotionIcon icon={PlusIcon} className="h-4 w-4" />
            Add To Thread
          </Button>
        </div>
      )}
    </div>
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
  disabled,
  signaturesHref,
  onEditor,
  onEditorFocus,
}: {
  part: DraftPart;
  index: number;
  total: number;
  scope: Scope;
  scopeLabel: string;
  reports: ChannelReport[];
  dispatch: Dispatch<ComposerAction>;
  onAttachMedia: (partKey: string) => void;
  disabled: boolean;
  signaturesHref: string;
  onEditor?: (partKey: string, editor: Editor | null) => void;
  onEditorFocus?: (partKey: string) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: part.key, disabled });

  const label = `Part ${index + 1}`;
  const thread = total > 1;
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
      className={cn('flex gap-2', isDragging && 'relative z-10 opacity-90')}
    >
      {/* A reply hangs off the part above it, as the reference draws a thread. */}
      {index > 0 ? (
        <span
          aria-hidden="true"
          className="ms-3 h-9 w-4 shrink-0 rounded-es-lg border-s-2 border-b-2 border-ink/25"
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <PostEditor
          initialContent={part.content}
          onChange={(content) => dispatch({ type: 'editContent', scope, key: part.key, content })}
          label={`${label} of ${scopeLabel}`}
          placeholder={index === 0 ? 'Write something…' : 'Continue the thread…'}
          tall={index === 0}
          signaturesHref={signaturesHref}
          onEditor={(editor) => onEditor?.(part.key, editor)}
          onFocus={() => onEditorFocus?.(part.key)}
          attachments={
            part.media.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
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
                    {disabled ? null : (
                      <button
                        type="button"
                        aria-label={`Remove ${item.name} from ${label}`}
                        onClick={() =>
                          dispatch({ type: 'detachMedia', scope, key: part.key, mediaId: item.id })
                        }
                        className="absolute end-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 border-outline bg-secondary text-ink outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-1 focus-visible:outline-focusRing"
                      >
                        <MotionIcon icon={XIcon} size={12} strokeWidth={3} className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : null
          }
          toolbarStart={
            disabled ? null : (
              <TooltipHint
                label={
                  part.media.length >= MAX_MEDIA_PER_PART
                    ? 'This part has as many attachments as a post can take'
                    : 'Add Images Or Video From The Media Library'
                }
                side="top"
                disabled={part.media.length >= MAX_MEDIA_PER_PART}
              >
                <button
                  type="button"
                  onClick={() => onAttachMedia(part.key)}
                  disabled={part.media.length >= MAX_MEDIA_PER_PART}
                  aria-label={`Add media to ${label}`}
                  className={cn(
                    'flex h-8 items-center gap-1.5 rounded-md border-2 border-outline bg-secondary px-2.5 type-ui text-xs text-ink',
                    'outline-none hover:bg-actionPrimary/10',
                    'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
                    'disabled:opacity-50',
                  )}
                >
                  <MotionIcon icon={ImagePlusIcon} className="h-4 w-4" />
                  Insert Media
                </button>
              </TooltipHint>
            )
          }
          toolbarEnd={<Counts reports={reports} index={index} />}
        />

        {part.removedMedia > 0 ? (
          <p className="m-0 font-sans text-xs text-ink opacity-70">
            {part.removedMedia === 1
              ? 'An attachment was'
              : `${part.removedMedia} attachments were`}{' '}
            deleted from the media library since this was saved.
          </p>
        ) : null}

        {issues.length > 0 ? (
          <ul className="m-0 flex list-none flex-col gap-1 p-0" aria-label={`${label} issues`}>
            {issues.map((issue) => (
              <li key={issue.key} className="font-sans text-xs font-bold text-dangerInk">
                {issue.text}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {thread && !disabled ? (
        <div className="flex shrink-0 flex-col items-center gap-0.5 pt-1">
          <TooltipHint label="Drag To Reorder" side="left">
            <button
              type="button"
              ref={setActivatorNodeRef}
              aria-label={`Drag to reorder ${label}`}
              className="flex h-7 w-7 cursor-grab touch-none items-center justify-center rounded-md text-ink opacity-60 outline-none hover:opacity-100 active:cursor-grabbing focus-visible:opacity-100 focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
              {...attributes}
              {...listeners}
            >
              <MotionIcon icon={GripVerticalIcon} className="h-4 w-4" />
            </button>
          </TooltipHint>
          <PartAction
            label={`Move ${label} up`}
            disabled={index === 0}
            icon={ArrowUpIcon}
            onClick={() => dispatch({ type: 'movePart', scope, from: index, to: index - 1 })}
          />
          <PartAction
            label={`Move ${label} down`}
            disabled={index === total - 1}
            icon={ArrowDownIcon}
            onClick={() => dispatch({ type: 'movePart', scope, from: index, to: index + 1 })}
          />
          <PartAction
            label={`Remove ${label}`}
            danger
            icon={Trash2Icon}
            onClick={() => dispatch({ type: 'removePart', scope, key: part.key })}
          />
        </div>
      ) : null}
    </li>
  );
}

/**
 * Each selected platform's count for this part, as the platform measures it:
 * its logo and `used/limit`, red once over.
 */
function Counts({ reports, index }: { reports: ChannelReport[]; index: number }) {
  const counts = reports.flatMap((report) => {
    const rendered = report.parts[index];
    const max = report.provider?.rules.maxLength;
    return rendered && max !== undefined ? [{ report, length: rendered.length, max }] : [];
  });

  if (counts.length === 0) {
    return null;
  }

  return (
    <ul aria-label="Character counts" className="m-0 flex list-none flex-wrap gap-1.5 p-0">
      {counts.map(({ report, length, max }) => {
        const over = length > max;
        return (
          <TooltipHint
            key={report.channel.id}
            label={`${report.channel.name}: ${length.toLocaleString('en-US')} of ${max.toLocaleString('en-US')} characters`}
            side="top"
          >
            <li
              className={cn(
                'flex h-7 items-center gap-1 rounded-md border-2 px-1.5 font-sans text-[11px] tabular-nums',
                over
                  ? 'border-outline bg-actionDanger text-onActionLight'
                  : 'border-ink/15 text-ink',
              )}
            >
              <PlatformIcon platform={report.channel.providerIdentifier} className="h-3.5 w-3.5" />
              <span className="sr-only">{report.channel.name}: </span>
              {length.toLocaleString('en-US')}/{max.toLocaleString('en-US')}
              <span className="sr-only"> characters</span>
            </li>
          </TooltipHint>
        );
      })}
    </ul>
  );
}

function PartAction({
  label,
  disabled,
  danger = false,
  icon: Icon,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  danger?: boolean;
  /** Animated, played from the whole button: see `useIconAnimation`. */
  icon: AnimatedIcon;
  onClick: () => void;
}) {
  const icon = useIconAnimation();

  return (
    <TooltipHint label={label} side="left" hidden={disabled}>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onClick={onClick}
        {...icon.triggers}
        className={cn(
          'flex h-7 w-7 items-center justify-center rounded-md border-2 border-transparent',
          danger ? 'text-dangerInk' : 'text-ink',
          'outline-none hover:border-outline hover:bg-actionPrimary/10',
          'focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
          'disabled:pointer-events-none disabled:opacity-30',
        )}
      >
        <Icon ref={icon.ref} aria-hidden size={16} className={cn('h-4 w-4', ANIMATED_ICON_CLASS)} />
      </button>
    </TooltipHint>
  );
}
