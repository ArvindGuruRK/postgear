'use client';

/**
 * The rich text editor for one part of a post.
 *
 * TipTap, as the sprint plan names, configured down to what a post document
 * can hold: paragraphs, one heading level, bullet and numbered lists, bold,
 * italic and links. Everything StarterKit offers beyond that is switched off
 * rather than left on and stripped later — a toolbar button for strikethrough
 * that silently disappears on save would be a lie.
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
import { isSafeHref } from '@postgear/social-core/composer';
import { Button, cn, Input, Popover, PopoverContent, PopoverTrigger, Text } from '@postgear/ui';
import { Placeholder } from '@tiptap/extensions';
import { type Editor, EditorContent, useEditor, useEditorState } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Bold, Heading2, Italic, Link2, List, ListOrdered, Unlink } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';

interface PostEditorProps {
  initialContent: unknown;
  onChange: (content: unknown) => void;
  /** Names the field for assistive technology, e.g. "Part 2 of the shared post". */
  label: string;
  placeholder?: string;
}

export function PostEditor({ initialContent, onChange, label, placeholder }: PostEditorProps) {
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
        underline: false,
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
    editorProps: {
      attributes: {
        'aria-label': label,
        'aria-multiline': 'true',
        role: 'textbox',
        class: 'px-4 py-3',
      },
    },
  });

  return (
    <div className="pg-editor rounded-md border-2 border-outline bg-secondary focus-within:outline focus-within:outline-[3px] focus-within:outline-offset-2 focus-within:outline-focusRing">
      <EditorToolbar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

function EditorToolbar({ editor }: { editor: Editor | null }) {
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current?.isActive('bold') ?? false,
      italic: current?.isActive('italic') ?? false,
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
      className="flex flex-wrap items-center gap-1 border-b-2 border-outline px-2 py-1.5"
    >
      <ToolbarButton
        label="Bold"
        pressed={active?.bold}
        disabled={!editor}
        onClick={() => editor?.chain().focus().toggleBold().run()}
      >
        <Bold className="h-4 w-4" strokeWidth={2.5} />
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        pressed={active?.italic}
        disabled={!editor}
        onClick={() => editor?.chain().focus().toggleItalic().run()}
      >
        <Italic className="h-4 w-4" strokeWidth={2.5} />
      </ToolbarButton>
      <ToolbarButton
        label="Heading"
        pressed={active?.heading}
        disabled={!editor}
        onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 className="h-4 w-4" strokeWidth={2.5} />
      </ToolbarButton>
      <ToolbarButton
        label="Bulleted list"
        pressed={active?.bulletList}
        disabled={!editor}
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
      >
        <List className="h-4 w-4" strokeWidth={2.5} />
      </ToolbarButton>
      <ToolbarButton
        label="Numbered list"
        pressed={active?.orderedList}
        disabled={!editor}
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered className="h-4 w-4" strokeWidth={2.5} />
      </ToolbarButton>

      <span className="mx-1 h-5 w-0.5 bg-outline" aria-hidden="true" />

      <LinkControl editor={editor} active={active?.link ?? false} />

      <Text size="xs" muted className="ms-auto hidden pe-1 sm:block">
        Bold and italic post as styled Unicode letters.
      </Text>
    </div>
  );
}

function ToolbarButton({
  label,
  pressed,
  disabled,
  onClick,
  children,
}: {
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed ?? false}
      disabled={disabled}
      // Keeps the selection in the editor: a mousedown on a button would
      // otherwise blur the editor before the command runs against it.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-md border-2 border-transparent text-ink',
        'outline-none hover:border-outline hover:bg-actionPrimary/10',
        'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
        'disabled:pointer-events-none disabled:opacity-50',
        pressed && 'border-outline bg-actionPrimary text-onActionPrimary hover:bg-actionPrimary',
      )}
    >
      {children}
    </button>
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
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={active ? 'Edit link' : 'Add link'}
            title={active ? 'Edit link' : 'Add link'}
            aria-pressed={active}
            disabled={!editor}
            onMouseDown={(event) => event.preventDefault()}
            className={cn(
              'flex h-8 w-8 items-center justify-center rounded-md border-2 border-transparent text-ink',
              'outline-none hover:border-outline hover:bg-actionPrimary/10',
              'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
              'disabled:pointer-events-none disabled:opacity-50',
              active &&
                'border-outline bg-actionPrimary text-onActionPrimary hover:bg-actionPrimary',
            )}
          >
            <Link2 className="h-4 w-4" strokeWidth={2.5} />
          </button>
        </PopoverTrigger>
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
              <p role="alert" className="font-sans text-xs font-medium text-actionDanger">
                {error}
              </p>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="submit" size="sm">
                {active ? 'Update link' : 'Add link'}
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
          <Unlink className="h-4 w-4" strokeWidth={2.5} />
        </ToolbarButton>
      ) : null}
    </>
  );
}
