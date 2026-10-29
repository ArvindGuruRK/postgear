'use client';

/**
 * The data chip editor (Module 06, blueprint 5.3): a text field, one line
 * or several, where data from earlier steps sits as chips ("Post Published:
 * Post Link") and nobody ever sees curly braces.
 *
 * - Tiptap with three nodes: text, line breaks and the inline `dataChip`
 *   atom. The stored value is Module 02's template text; loading parses it
 *   with `parseTemplate`, saving writes it with `serializeSegments`, and an
 *   unchanged field is written back exactly as it was (`docToTemplate`).
 * - Insert Data: the button, or typing `{` (anywhere) or `/` (at the start
 *   or after a space, so links still type normally) opens the popover at
 *   the caret; choosing a field swaps the typed character for the chip.
 * - Drag to map: dropping an Input pane row (`DATA_DRAG_MIME`) puts a chip
 *   at the drop point; click to map writes at the last caret through
 *   `insertDataAtLastField`.
 * - Backspace and Delete remove a whole chip. No key press inside ever
 *   reaches the canvas, so Delete never deletes the step.
 * - Controlled: a new `value` from outside (undo, a template) replaces the
 *   content; typing reports up through `onChange`.
 */
import {
  type AutomationGraph,
  formatToken,
  type RunScope,
  type ValidationIssue,
} from '@postgear/automation';
import { cn } from '@postgear/ui';
import type { JSONContent } from '@tiptap/core';
import { Placeholder } from '@tiptap/extensions';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ChipKeys, DataChip } from './chip-extension';
import { chipCount, chipNode, docToTemplate, templateToDoc } from './chip-model';
import { DATA_DRAG_MIME } from './contract';
import { ChipFieldContext, type ChipFieldValue } from './data-chip';
import { useFieldEnv } from './field-env';
import { type AnchorRect, InsertDataButton, InsertDataPopover } from './insert-data';
import { type DataInsertTarget, forgetInsertTarget, registerInsertTarget } from './insert-target';

export interface ChipInputProps {
  /** The stored template text. */
  value: string;
  onChange: (value: string) => void;
  /** The field's accessible name, when no visible label names it (`labelId`). */
  label: string;
  /** The id of the visible label; the editor is `aria-labelledby` it. */
  labelId?: string;
  /** The id of the help or error line under the field. */
  describedBy?: string;
  /** The config path, so chips that validation names turn red. */
  fieldPath: string;
  multiline?: boolean;
  placeholder?: string;
  /** At most this many chips: a new one replaces the old (a rule's left side takes one). */
  maxChips?: number;
  invalid?: boolean;
  disabled?: boolean;
  /** `full` (under the field), `icon` (inside it) or `none`. */
  insertButton?: 'full' | 'icon' | 'none';
  /** Where the data comes from; the form's (`FieldEnvProvider`) when left out. */
  graph?: AutomationGraph;
  nodeKey?: string;
  issues?: readonly ValidationIssue[];
  scope?: RunScope;
  className?: string;
}

export interface ChipInputHandle {
  focus: () => void;
  /** Inserts a chip at the caret (or the last caret, if the field lost focus). */
  insertData: (tokenPath: string) => void;
}

/** True when typing `char` after `before` should open Insert Data. */
export function opensInsertData(before: string, char: string): boolean {
  if (char === '{') return true;
  if (char === '/') return before === '' || /\s/.test(before);
  return false;
}

const EXTENSIONS_OFF = {
  blockquote: false,
  bold: false,
  bulletList: false,
  code: false,
  codeBlock: false,
  gapcursor: false,
  heading: false,
  horizontalRule: false,
  italic: false,
  listItem: false,
  listKeymap: false,
  link: false,
  orderedList: false,
  strike: false,
  underline: false,
  trailingNode: false,
} as const;

function inlineOf(doc: JSONContent): JSONContent[] {
  return doc.content?.[0]?.content ?? [];
}

export const ChipInput = forwardRef<ChipInputHandle, ChipInputProps>(function ChipInput(
  {
    value,
    onChange,
    label,
    labelId,
    describedBy,
    fieldPath,
    multiline = false,
    placeholder,
    maxChips,
    invalid = false,
    disabled = false,
    insertButton = 'full',
    graph: givenGraph,
    nodeKey: givenKey,
    issues: givenIssues,
    scope: givenScope,
    className,
  },
  ref,
) {
  const env = useFieldEnv();
  const graph = givenGraph ?? env?.graph;
  const nodeKey = givenKey ?? env?.nodeKey;
  const issues = givenIssues ?? env?.issues ?? [];
  const scope = givenScope ?? env?.context.scope;
  const acceptsData = graph !== undefined && nodeKey !== undefined;

  const lastValue = useRef(value);
  const onChangeRef = useRef(onChange);
  const optionsRef = useRef({
    multiline,
    maxChips,
    acceptsData,
    label,
    labelId,
    describedBy,
    invalid,
  });
  useEffect(() => {
    onChangeRef.current = onChange;
    optionsRef.current = { multiline, maxChips, acceptsData, label, labelId, describedBy, invalid };
  });

  const [insert, setInsert] = useState<{
    open: boolean;
    anchor: AnchorRect | null;
    /** The `/` or `{` typed to open it, and where, so a pick replaces it. */
    typed: { pos: number; char: string } | null;
  }>({ open: false, anchor: null, typed: null });

  const insertChipRef = useRef<(path: string, at?: { from: number; to: number }) => void>(
    () => undefined,
  );
  const openAtCaretRef = useRef<(pos: number, char: string) => void>(() => undefined);
  const target = useMemo<DataInsertTarget>(
    () => ({ insertData: (path) => insertChipRef.current(path) }),
    [],
  );
  useEffect(() => () => forgetInsertTarget(target), [target]);

  const editor = useEditor({
    // Rendering on the server would produce markup the client then replaces.
    immediatelyRender: false,
    editable: !disabled,
    extensions: [
      StarterKit.configure(EXTENSIONS_OFF),
      Placeholder.configure({ placeholder: placeholder ?? '' }),
      DataChip,
      ChipKeys.configure({ multiline }),
    ],
    content: templateToDoc(value),
    onUpdate: ({ editor: current }) => {
      const next = docToTemplate(current.getJSON(), lastValue.current);
      if (next === lastValue.current) return;
      lastValue.current = next;
      onChangeRef.current(next);
    },
    onFocus: () => registerInsertTarget(target),
    editorProps: {
      attributes: () => {
        const options = optionsRef.current;
        const attributes: Record<string, string> = {
          role: 'textbox',
          'aria-multiline': String(options.multiline),
          class: cn('outline-none', options.multiline ? 'min-h-20' : 'min-h-6'),
        };
        if (options.labelId) attributes['aria-labelledby'] = options.labelId;
        else attributes['aria-label'] = options.label;
        if (options.describedBy) attributes['aria-describedby'] = options.describedBy;
        if (options.invalid) attributes['aria-invalid'] = 'true';
        return attributes;
      },
      handleTextInput: (view, from, _to, text) => {
        if (!optionsRef.current.acceptsData) return false;
        if (text !== '/' && text !== '{') return false;
        const before = from > 1 ? view.state.doc.textBetween(from - 1, from, '\n', '￼') : '';
        if (!opensInsertData(before, text)) return false;
        // Let the character land first; a pick replaces it.
        setTimeout(() => openAtCaretRef.current(from, text), 0);
        return false;
      },
      handlePaste: (_view, event) => {
        const text = event.clipboardData?.getData('text/plain');
        if (!text) return false;
        const flat = optionsRef.current.multiline ? text : text.replace(/\r?\n/g, ' ');
        const content = inlineOf(templateToDoc(flat));
        if (content.length === 0) return true;
        editorRef.current?.chain().insertContent(content).run();
        return true;
      },
      handleDrop: (view, event) => {
        const path = event.dataTransfer?.getData(DATA_DRAG_MIME);
        if (!path || !optionsRef.current.acceptsData) return false;
        event.preventDefault();
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
        insertChipRef.current(path, at === undefined ? undefined : { from: at, to: at });
        return true;
      },
    },
  });

  const editorRef = useRef(editor);
  editorRef.current = editor;

  // A value from outside (undo, a reset, the same field in the other view)
  // replaces what the editor shows. Tiptap mounts chips with flushSync, which
  // React refuses mid-commit, so the swap waits for a microtask.
  useEffect(() => {
    if (!editor || value === lastValue.current) return;
    lastValue.current = value;
    queueMicrotask(() => {
      if (editor.isDestroyed || lastValue.current !== value) return;
      editor.commands.setContent(templateToDoc(value), { emitUpdate: false });
    });
  }, [editor, value]);

  useEffect(() => {
    editor?.setEditable(!disabled, false);
  }, [editor, disabled]);

  insertChipRef.current = (path, at) => {
    const current = editorRef.current;
    if (!current || !path) return;
    const node = chipNode({ path, filters: [], raw: formatToken({ path, filters: [] }) });
    const limit = optionsRef.current.maxChips;
    if (limit !== undefined && chipCount(current.getJSON()) >= limit) {
      current
        .chain()
        .focus()
        .setContent({ type: 'doc', content: [{ type: 'paragraph', content: [node] }] })
        .run();
      return;
    }
    const range = at ?? { from: current.state.selection.from, to: current.state.selection.to };
    current.chain().focus().insertContentAt(range, node).run();
  };

  openAtCaretRef.current = (pos, char) => {
    const current = editorRef.current;
    if (!current) return;
    const rect = (): DOMRect => {
      try {
        const coords = current.view.coordsAtPos(Math.min(pos + 1, current.state.doc.content.size));
        return new DOMRect(coords.left, coords.top, 1, Math.max(1, coords.bottom - coords.top));
      } catch {
        return current.view.dom.getBoundingClientRect();
      }
    };
    setInsert({ open: true, anchor: rect, typed: { pos, char } });
  };

  useImperativeHandle(
    ref,
    () => ({
      focus: () => editorRef.current?.commands.focus(),
      insertData: (path) => insertChipRef.current(path),
    }),
    [],
  );

  const pick = useCallback(
    (path: string) => {
      const current = editorRef.current;
      const typed = insert.typed;
      if (current && typed) {
        const end = typed.pos + typed.char.length;
        const still =
          end <= current.state.doc.content.size &&
          current.state.doc.textBetween(typed.pos, end, '', '') === typed.char;
        insertChipRef.current(path, still ? { from: typed.pos, to: end } : undefined);
      } else {
        insertChipRef.current(path);
      }
    },
    [insert.typed],
  );

  const chipField = useMemo<ChipFieldValue>(
    () => ({
      graph,
      nodeKey,
      fieldPath,
      issues,
      scope,
      scopeSource: env?.context.scopeSource,
      timeZone: env?.context.timeZone,
    }),
    [graph, nodeKey, fieldPath, issues, scope, env?.context.scopeSource, env?.context.timeZone],
  );

  const insertControl =
    acceptsData && insertButton !== 'none' && graph && nodeKey ? (
      <InsertDataPopover
        graph={graph}
        nodeKey={nodeKey}
        scope={scope}
        open={insert.open}
        anchor={insert.anchor}
        onOpenChange={(open) =>
          setInsert((current) =>
            open ? { ...current, open } : { open: false, anchor: null, typed: null },
          )
        }
        onCloseFocus={() => editorRef.current?.commands.focus()}
        onPick={pick}
        trigger={
          insertButton === 'icon' ? (
            <InsertDataButton iconOnly disabled={disabled} className="absolute end-1.5 top-1.5" />
          ) : (
            <InsertDataButton disabled={disabled} className="self-start" />
          )
        }
      />
    ) : null;

  return (
    <ChipFieldContext.Provider value={chipField}>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: keeps key presses inside the field away from the canvas shortcuts */}
      <div
        className={cn('flex min-w-0 flex-col gap-2', className)}
        data-chip-input=""
        onKeyDown={(event) => event.stopPropagation()}
      >
        <div
          className={cn(
            'pg-editor relative rounded-md border-2 bg-field px-3 py-2 shadow-surfaceSm',
            'transition-[border-color,box-shadow] duration-150 focus-within:ring-3',
            invalid
              ? 'border-actionDanger focus-within:border-actionDanger focus-within:ring-actionDanger/20'
              : 'border-outline focus-within:border-actionPrimary focus-within:ring-actionPrimary/20',
            insertButton === 'icon' && acceptsData && 'pe-10',
            disabled && 'cursor-not-allowed opacity-50 shadow-none',
            '[&_.ProseMirror]:text-sm',
          )}
        >
          <EditorContent editor={editor} />
          {insertButton === 'icon' ? insertControl : null}
        </div>
        {insertButton === 'full' ? insertControl : null}
      </div>
    </ChipFieldContext.Provider>
  );
});
