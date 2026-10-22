'use client';

/**
 * The rich text editor for one part of a post.
 *
 * TipTap, as the sprint plan names, configured down to what a post document
 * can hold: paragraphs, one heading level, bullet and numbered lists, bold,
 * italic, underline and links. Everything StarterKit offers beyond that is
 * switched off rather than left on and stripped later: a toolbar button for
 * strikethrough that silently disappears on save would be a lie.
 *
 * Underline (2026-10-19, after Postiz) posts the way Postiz posts it: each
 * letter followed by a combining low line, which every platform shows,
 * applied on top of bold or italic letters (social-core's `renderPlainText`).
 * Mod-U is the extension's own shortcut.
 *
 * ## Uncontrolled on purpose
 *
 * `initialContent` is read once, at mount. The editor reports changes up and is
 * never pushed content back while mounted; see `composer-state.ts` for why.
 *
 * ## Links
 *
 * Autolinking is off. Every platform turns a typed URL into a link on its own,
 * so an autolink mark adds nothing to the post and only makes the editor
 * disagree with the preview. A link is something a person adds on purpose,
 * through the toolbar, to words.
 */
import { BoldIcon } from '@animateicons/react/lucide/bold-icon';
import { Heading2Icon } from '@animateicons/react/lucide/heading-2-icon';
import { ItalicIcon } from '@animateicons/react/lucide/italic-icon';
import { LinkIcon } from '@animateicons/react/lucide/link-icon';
import { ListIcon } from '@animateicons/react/lucide/list-icon';
import { ListOrderedIcon } from '@animateicons/react/lucide/list-ordered-icon';
import { UnderlineIcon } from '@animateicons/react/lucide/underline-icon';
import { UnlinkIcon } from '@animateicons/react/lucide/unlink-icon';
import { isSafeHref } from '@postgear/social-core/composer';
import {
  Button,
  cn,
  Input,
  MotionIcon,
  Popover,
  PopoverContent,
  PopoverTrigger,
  TooltipHint,
} from '@postgear/ui';
import { Placeholder } from '@tiptap/extensions';
import { type Editor, EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { EmojiControl, SignatureControl } from './editor-inserts';
import { TOOL, TOOL_PRESSED } from './toolbar';

interface PostEditorProps {
  initialContent: unknown;
  onChange: (content: unknown) => void;
  /** Names the field for assistive technology, e.g. "Part 2 of the shared post". */
  label: string;
  placeholder?: string;
  /** The first part is the post itself and gets more room; replies get less. */
  tall?: boolean;
  /** Shown between the text and the toolbar: the part's attached media. */
  attachments?: ReactNode;
  /** The toolbar's leading controls, before formatting: Insert Media. */
  toolbarStart?: ReactNode;
  /** The toolbar's trailing end: the per-platform character counts. */
  toolbarEnd?: ReactNode;
  /** Settings > Signatures, where the Signature popover points when there are none. */
  signaturesHref: string;
  /**
   * Called with the editor once it exists, and with null as it goes: the
   * header's Templates writes into it at the cursor.
   */
  onEditor?: (editor: Editor | null) => void;
  /** The editor took focus, which makes it the one Templates writes into. */
  onFocus?: () => void;
}

/**
 * Layout (UI revamp, 2026-10-19), after the reference's editor: the text
 * first, the part's media under it, and one toolbar along the bottom with
 * Insert Media, the formatting, and the character counts at its far end.
 */
export function PostEditor({
  initialContent,
  onChange,
  label,
  placeholder,
  tall = false,
  attachments,
  toolbarStart,
  toolbarEnd,
  signaturesHref,
  onEditor,
  onFocus,
}: PostEditorProps) {
  const editor = useEditor({
    // Rendering on the server would produce markup the client then replaces,
    // which React reports as a hydration mismatch.
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        blockquote: false,
        code: false,
        codeBlock: false,
        horizontalRule: false,
        strike: false,
        heading: { levels: [2] },
        link: {
          autolink: false,
          openOnClick: false,
          linkOnPaste: true,
          defaultProtocol: 'https',
          // The document schema accepts http and https only; refusing anything
          // else here keeps a pasted `javascript:` link from ever appearing.
          isAllowedUri: (url) => isSafeHref(url),
        },
      }),
      Placeholder.configure({ placeholder: placeholder ?? 'What do you want to share?' }),
    ],
    content: initialContent as object,
    onUpdate: ({ editor: current }) => onChange(current.getJSON()),
    onFocus: () => onFocus?.(),
    editorProps: {
      attributes: {
        'aria-label': label,
        'aria-multiline': 'true',
        role: 'textbox',
        class: 'px-4 py-3',
      },
    },
  });

  // The latest callback, read when the editor arrives or goes, so a parent
  // re-rendering with a new function does not unregister and re-register it.
  const onEditorRef = useRef(onEditor);
  useEffect(() => {
    onEditorRef.current = onEditor;
  });

  useEffect(() => {
    if (!editor) {
      return;
    }
    onEditorRef.current?.(editor);
    return () => onEditorRef.current?.(null);
  }, [editor]);

  return (
    <div
      className={cn(
        'pg-editor flex flex-col rounded-lg border-2 border-outline bg-field shadow-surfaceSm',
        'focus-within:outline focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-focusRing',
        tall ? '[&_.ProseMirror]:min-h-48' : '[&_.ProseMirror]:min-h-20',
      )}
    >
      <EditorContent editor={editor} />
      {attachments}
      <EditorToolbar
        editor={editor}
        start={toolbarStart}
        end={toolbarEnd}
        signaturesHref={signaturesHref}
      />
    </div>
  );
}

/**
 * After the reference's toolbar: Insert Media, then the signature, the text
 * formatting, the link and the emoji, then the counts at the far end.
 */
function EditorToolbar({
  editor,
  start,
  end,
  signaturesHref,
}: {
  editor: Editor | null;
  start?: ReactNode;
  end?: ReactNode;
  signaturesHref: string;
}) {
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive('bold') ?? false,
      italic: current?.isActive('italic') ?? false,
      underline: current?.isActive('underline') ?? false,
      heading: current?.isActive('heading', { level: 2 }) ?? false,
      bulletList: current?.isActive('bulletList') ?? false,
      orderedList: current?.isActive('orderedList') ?? false,
      link: current?.isActive('link') ?? false,
    }),
  });

  return (
    <div
      role="toolbar"
      aria-label="Formatting"
      className="flex flex-wrap items-center gap-1 border-t-2 border-outline px-2 py-1.5"
    >
      {start ? <div className="me-1 flex items-center gap-1">{start}</div> : null}
      <SignatureControl editor={editor} settingsHref={signaturesHref} />
      <ToolbarButton
        label="Bold"
        hint="Bold: posts as styled Unicode letters"
        pressed={active?.bold}
        disabled={!editor}
        onClick={() => editor?.chain().focus().toggleBold().run()}
      >
        <MotionIcon icon={BoldIcon} className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        hint="Italic: posts as styled Unicode letters"
        pressed={active?.italic}
        disabled={!editor}
        onClick={() => editor?.chain().focus().toggleItalic().run()}
      >
        <MotionIcon icon={ItalicIcon} className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Underline"
        hint="Underline: posts as underlined Unicode letters"
        pressed={active?.underline}
        disabled={!editor}
        onClick={() => editor?.chain().focus().toggleUnderline().run()}
      >
        <MotionIcon icon={UnderlineIcon} className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Heading"
        pressed={active?.heading}
        disabled={!editor}
        onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <MotionIcon icon={Heading2Icon} className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Bulleted list"
        pressed={active?.bulletList}
        disabled={!editor}
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
      >
        <MotionIcon icon={ListIcon} className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        pressed={active?.orderedList}
        disabled={!editor}
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
      >
        <MotionIcon icon={ListOrderedIcon} className="h-4 w-4" />
      </ToolbarButton>

      <LinkControl editor={editor} active={active?.link ?? false} />
      <EmojiControl editor={editor} />

      {end ? <div className="ms-auto flex flex-wrap items-center gap-1.5 ps-2">{end}</div> : null}
    </div>
  );
}

function ToolbarButton({
  label,
  hint,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  /** The hover text, when it says more than the name. */
  hint?: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <TooltipHint label={hint ?? label} side="top">
      <button
        type="button"
        aria-label={label}
        aria-pressed={pressed ?? false}
        disabled={disabled}
        // Keeps the selection in the editor: a mousedown on a button would
        // otherwise blur the editor before the command runs against it.
        onMouseDown={(event) => event.preventDefault()}
        onClick={onClick}
        className={cn(TOOL, pressed && TOOL_PRESSED)}
      >
        {children}
      </button>
    </TooltipHint>
  );
}

/**
 * Adds, edits or removes a link on the selection.
 *
 * A popover with a real input rather than `window.prompt`, which cannot be
 * styled, validated inline, or reliably tested.
 */
function LinkControl({ editor, active }: { editor: Editor | null; active: boolean }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  function openWith(nextOpen: boolean) {
    if (nextOpen && editor) {
      setValue((editor.getAttributes('link').href as string | undefined) ?? '');
      setError(null);
    }
    setOpen(nextOpen);
  }

  function apply(event: FormEvent) {
    event.preventDefault();

    if (!editor) {
      return;
    }

    const trimmed = value.trim();

    if (!trimmed) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      setOpen(false);
      return;
    }

    // "postgear.io" means https://postgear.io; nobody types the scheme.
    const href = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;

    if (!isSafeHref(href)) {
      setError('Links must start with http:// or https://');
      return;
    }

    const chain = editor.chain().focus().extendMarkRange('link');

    // With nothing selected, the URL itself becomes the linked text.
    if (editor.state.selection.empty && !active) {
      chain
        .insertContent({ type: 'text', text: href, marks: [{ type: 'link', attrs: { href } }] })
        .run();
    } else {
      chain.setLink({ href }).run();
    }

    setOpen(false);
  }

  return (
    <>
      <Popover open={open} onOpenChange={openWith}>
        <TooltipHint label={active ? 'Edit Link' : 'Add Link'} side="top">
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={active ? 'Edit link' : 'Add link'}
              aria-pressed={active}
              disabled={!editor}
              onMouseDown={(event) => event.preventDefault()}
              className={cn(TOOL, active && TOOL_PRESSED)}
            >
              <MotionIcon icon={LinkIcon} className="h-4 w-4" />
            </button>
          </PopoverTrigger>
        </TooltipHint>
        <PopoverContent align="start" className="w-80">
          <form onSubmit={apply} className="flex flex-col gap-2">
            <label htmlFor="composer-link-url" className="font-sans text-sm font-bold text-ink">
              Link address
            </label>
            <Input
              id="composer-link-url"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder="https://"
              size="sm"
              variant={error ? 'error' : 'default'}
              // Opening the link popover is itself the request to type a URL.
              autoFocus
            />
            {error ? (
              <p role="alert" className="font-sans text-xs font-medium text-dangerInk">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="submit" size="sm">
                {active ? 'Update Link' : 'Add Link'}
              </Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>

      {active ? (
        <ToolbarButton
          label="Remove link"
          disabled={!editor}
          onClick={() => editor?.chain().focus().extendMarkRange('link').unsetLink().run()}
        >
          <MotionIcon icon={UnlinkIcon} className="h-4 w-4" />
        </ToolbarButton>
      ) : null}
    </>
  );
}
