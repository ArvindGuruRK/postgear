'use client';

/**
 * The editor toolbar's two inserts (2026-10-19, after Postiz's editor): a
 * saved signature, first in the row, and an emoji, last. Both write at the
 * cursor and hand focus back to the editor, so the writing carries on where
 * it stopped.
 *
 * Both are modal popovers: inside the composer's dialog, a non-modal popover
 * portaled outside it could not scroll (see `DateTimePicker`), and the emoji
 * grid and a long signature list both scroll.
 */
import { SignatureIcon } from '@animateicons/react/lucide/signature-icon';
import { documentFromText } from '@postgear/social-core/composer';
import {
  Button,
  MotionIcon,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Skeleton,
  Spinner,
  TooltipHint,
} from '@postgear/ui';
import type { Editor } from '@tiptap/react';
import type { EmojiClickData, EmojiStyle, Theme } from 'emoji-picker-react';
import { Smile } from 'lucide-react';
import dynamic from 'next/dynamic';
import { type CSSProperties, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { Signature } from '@/types/signature';
import { TOOL } from './toolbar';

/**
 * Inserts plain text at the cursor, one paragraph per line: how a signature
 * and a template land in a post.
 */
export function insertParagraphs(editor: Editor, text: string) {
  editor.chain().focus().insertContent(documentFromText(text).content).run();
}

/**
 * Runs an insert once a modal popover has closed. While it is open its focus
 * trap would pull focus straight back out of the editor; Radix calls
 * `onCloseAutoFocus` after the trap is gone, so the insert runs there, and
 * focus stays in the editor instead of returning to the trigger.
 */
export function useAfterClose() {
  const pending = useRef<(() => void) | null>(null);

  return {
    later(run: () => void) {
      pending.current = run;
    },
    onCloseAutoFocus(event: Event) {
      const run = pending.current;
      if (run) {
        pending.current = null;
        event.preventDefault();
        run();
      }
    },
  };
}

/**
 * The workspace's signatures, each with "Insert". With none saved yet, a link
 * to Settings > Signatures, opened in a new tab so the post being written
 * stays as it is.
 */
export function SignatureControl({
  editor,
  settingsHref,
}: {
  editor: Editor | null;
  settingsHref: string;
}) {
  const [open, setOpen] = useState(false);
  const [signatures, setSignatures] = useState<Signature[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const afterClose = useAfterClose();

  function openWith(next: boolean) {
    if (next) {
      setError(null);
      // Fetched on every open, so one saved in Settings a moment ago is here.
      api<{ signatures: Signature[] }>('/signatures').then(
        (result) => setSignatures(result.signatures),
        (cause: unknown) =>
          setError(cause instanceof ApiError ? cause.message : 'Signatures could not be loaded.'),
      );
    }
    setOpen(next);
  }

  function insert(signature: Signature) {
    if (!editor) {
      return;
    }
    afterClose.later(() => insertParagraphs(editor, signature.content));
    setOpen(false);
  }

  return (
    <Popover modal open={open} onOpenChange={openWith}>
      <TooltipHint label="Insert signature" side="top">
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Insert signature"
            disabled={!editor}
            // Keeps the editor's selection, so the signature lands at the cursor.
            onMouseDown={(event) => event.preventDefault()}
            className={TOOL}
          >
            <MotionIcon icon={SignatureIcon} className="h-4 w-4" />
          </button>
        </PopoverTrigger>
      </TooltipHint>
      <PopoverContent
        side="top"
        align="start"
        aria-label="Signatures"
        className="flex max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-2rem)] flex-col p-0"
        onCloseAutoFocus={afterClose.onCloseAutoFocus}
      >
        {error ? (
          <p role="alert" className="m-0 p-4 font-sans text-sm text-dangerInk">
            {error}
          </p>
        ) : signatures === null ? (
          <div className="flex flex-col gap-2 p-4" aria-busy="true">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : signatures.length === 0 ? (
          <div className="flex flex-col items-start gap-2 p-4">
            <p className="m-0 font-sans text-sm text-ink">No signatures yet.</p>
            <a
              href={settingsHref}
              target="_blank"
              rel="noopener"
              className="type-ui text-sm text-ink underline underline-offset-2 outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing"
            >
              Add one in Settings
            </a>
          </div>
        ) : (
          <ul className="m-0 flex min-h-0 list-none flex-col gap-1 overflow-y-auto p-2 pg-scrollbar pg-scrollbar-secondary">
            {signatures.map((signature) => {
              const firstLine = signature.content.split('\n')[0] ?? '';
              return (
                <li
                  key={signature.id}
                  className="flex items-start gap-3 rounded-md p-2 hover:bg-actionPrimary/10"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <p className="m-0 line-clamp-3 whitespace-pre-line break-words font-sans text-sm text-ink">
                      {signature.content}
                    </p>
                    {signature.autoAdd ? (
                      <span className="font-sans text-xs text-ink opacity-70">
                        Added to new posts
                      </span>
                    ) : null}
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="shrink-0"
                    aria-label={`Insert signature: ${firstLine}`}
                    onClick={() => insert(signature)}
                  >
                    Insert
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * The picker carries every emoji's data with its code, so it is loaded the
 * first time the popover opens, never with the composer.
 */
const EmojiPicker = dynamic(() => import('emoji-picker-react'), {
  ssr: false,
  loading: () => (
    <div className="flex h-[26rem] w-80 max-w-full items-center justify-center">
      <Spinner />
    </div>
  ),
});

/**
 * The picker's own palette, mapped onto the theme's tokens so it sits in any
 * of the light and dark themes like the rest of the popover. Anything left
 * unset falls back to the picker's light or dark default, chosen by `theme`.
 */
const PICKER_STYLE = {
  '--epr-bg-color': 'var(--color-secondary)',
  '--epr-category-label-bg-color': 'var(--color-secondary)',
  '--epr-emoji-variation-picker-bg-color': 'var(--color-secondary)',
  '--epr-text-color': 'var(--color-ink)',
  '--epr-search-input-bg-color': 'var(--color-field)',
  '--epr-search-input-bg-color-active': 'var(--color-field)',
  '--epr-search-input-text-color': 'var(--color-ink)',
  '--epr-search-border-color': 'var(--color-outline)',
  '--epr-search-border-color-active': 'var(--color-actionPrimary)',
  '--epr-highlight-color': 'var(--color-actionPrimary)',
  '--epr-category-icon-active-color': 'var(--color-actionPrimary)',
  '--epr-hover-bg-color': 'color-mix(in srgb, var(--color-actionPrimary) 15%, transparent)',
  '--epr-focus-bg-color': 'color-mix(in srgb, var(--color-actionPrimary) 25%, transparent)',
  '--epr-picker-border-color': 'transparent',
  '--epr-picker-border-radius': '0',
  // The picker counts a row's emoji from the list's full width and then
  // indents the grid by this padding, so at this width the last column ran
  // off the edge. Without it every column fits; each emoji keeps its own
  // padding, so the grid still clears the edge.
  '--epr-category-padding': '0',
  // The popover around it is the surface: no second border or rounding.
  borderWidth: 0,
} as CSSProperties;

export function EmojiControl({ editor }: { editor: Editor | null }) {
  const [open, setOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const afterClose = useAfterClose();

  function openWith(next: boolean) {
    if (next) {
      // The app's scheme is a class on <body> (design-system-rules §12),
      // read as the picker opens: it follows a switch made since.
      setDark(document.body.classList.contains('dark'));
    }
    setOpen(next);
  }

  function pick(data: EmojiClickData) {
    if (!editor) {
      return;
    }
    afterClose.later(() => editor.chain().focus().insertContent(data.emoji).run());
    setOpen(false);
  }

  return (
    <Popover modal open={open} onOpenChange={openWith}>
      <TooltipHint label="Insert emoji" side="top">
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Insert emoji"
            disabled={!editor}
            onMouseDown={(event) => event.preventDefault()}
            className={TOOL}
          >
            {/* Static: the animated set has no smiley. */}
            <Smile className="h-4 w-4" strokeWidth={2.5} aria-hidden />
          </button>
        </PopoverTrigger>
      </TooltipHint>
      <PopoverContent
        side="top"
        align="start"
        aria-label="Emoji"
        className="w-auto max-w-[calc(100vw-2rem)] overflow-hidden p-0"
        onCloseAutoFocus={afterClose.onCloseAutoFocus}
      >
        <EmojiPicker
          onEmojiClick={pick}
          // String values of the picker's enums: importing the enums
          // themselves would pull the whole picker into the composer bundle.
          theme={(dark ? 'dark' : 'light') as Theme}
          // The device's own emoji, as the post will show them, rather than
          // images fetched from a CDN.
          emojiStyle={'native' as EmojiStyle}
          lazyLoadEmojis
          autoFocusSearch
          previewConfig={{ showPreview: false }}
          width={320}
          height={416}
          style={PICKER_STYLE}
        />
      </PopoverContent>
    </Popover>
  );
}
