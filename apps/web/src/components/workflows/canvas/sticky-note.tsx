'use client';

/**
 * A sticky note on the canvas (blueprint 4.5): one of five colours, light
 * markdown, resizable when selected. Double-click to write in it; it saves
 * when the text field loses focus. Notes are never validated and never run.
 * Moved by its top strip, so selecting text in it does not drag it.
 */
import { NOTE_COLOURS, type NoteColour } from '@postgear/automation';
import { cn } from '@postgear/ui';
import { type NodeProps, NodeResizer } from '@xyflow/react';
import { memo, useEffect, useRef, useState } from 'react';
import { useBuilder } from '../builder/builder-context';
import { NOTE_COLOUR_NAMES, NOTE_FILL, NOTE_TEXT, type NoteFlowNode } from './flow-model';
import { NoteText } from './note-text';

export const NOTE_MAX_CHARS = 2_000;

export const StickyNoteCard = memo(function StickyNoteCard({
  data,
  selected,
}: NodeProps<NoteFlowNode>) {
  const builder = useBuilder();
  const { note } = data;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note.text);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setDraft(note.text);
  }, [note.text, editing]);

  useEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);

  function save() {
    setEditing(false);
    if (draft !== note.text) {
      builder.dispatch({
        type: 'updateNote',
        id: note.id,
        patch: { text: draft },
        now: Date.now(),
      });
    }
  }

  function colour(next: NoteColour) {
    builder.dispatch({ type: 'updateNote', id: note.id, patch: { colour: next }, now: Date.now() });
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: double-click opens the editor; the note is focusable through React Flow
    <div
      className={cn(
        'flex h-full w-full flex-col overflow-hidden rounded-card border-2 border-outline shadow-brutalSm',
        NOTE_FILL[note.colour],
        NOTE_TEXT[note.colour],
        selected ? 'outline-solid outline-[3px] outline-offset-2 outline-focusRing' : '',
      )}
      onDoubleClick={() => setEditing(true)}
      onContextMenu={(event) => {
        event.preventDefault();
        builder.contextMenu({ kind: 'note', id: note.id }, { x: event.clientX, y: event.clientY });
      }}
    >
      <NodeResizer
        isVisible={selected && !builder.locked}
        minWidth={80}
        minHeight={40}
        maxWidth={2_000}
        maxHeight={2_000}
        lineClassName="border-focusRing!"
        handleClassName="h-2.5! w-2.5! rounded-sm! border-2! border-outline! bg-secondary!"
        onResizeEnd={(_event, params) =>
          builder.dispatch({
            type: 'updateNote',
            id: note.id,
            patch: {
              size: { w: Math.round(params.width), h: Math.round(params.height) },
              position: { x: Math.round(params.x), y: Math.round(params.y) },
            },
            now: Date.now(),
          })
        }
      />
      <div className="pg-note-handle flex h-6 shrink-0 cursor-grab items-center justify-end gap-1 border-b-2 border-outline px-1.5">
        {selected
          ? NOTE_COLOURS.map((option) => (
              <button
                key={option}
                type="button"
                aria-label={`${NOTE_COLOUR_NAMES[option]} note`}
                aria-pressed={note.colour === option}
                onClick={() => colour(option)}
                className={cn(
                  'nodrag h-3.5 w-3.5 rounded-full border-2 border-outline',
                  NOTE_FILL[option],
                  note.colour === option ? 'ring-2 ring-outline ring-offset-1' : '',
                )}
              />
            ))
          : null}
      </div>
      {editing ? (
        <textarea
          ref={field}
          value={draft}
          maxLength={NOTE_MAX_CHARS}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={save}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              save();
            }
          }}
          aria-label="Note text"
          placeholder="Enter your note"
          className="nodrag nowheel h-full w-full resize-none bg-transparent p-2 font-sans text-sm outline-none placeholder:opacity-70"
        />
      ) : (
        <div className="nowheel h-full overflow-auto p-2 font-sans text-sm">
          {note.text ? (
            <NoteText text={note.text} />
          ) : (
            <span className="opacity-70">Double-click to write a note.</span>
          )}
        </div>
      )}
    </div>
  );
});
