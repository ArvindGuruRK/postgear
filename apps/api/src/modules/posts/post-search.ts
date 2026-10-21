/**
 * The text of a post that a search looks through (2026-10-21).
 *
 * Not `renderPlainText`: that one is for publishing, so it turns bold and
 * italic into styled Unicode letters and appends link URLs. A search for
 * "launch" has to find a post whose "launch" is bold, and what a person types
 * is plain letters, so this walks the document and keeps only the words.
 */
import type { BlockNode, InlineNode, PostDocument } from '@postgear/social-core';

/** The document's words, one block per line, in reading order. */
export function documentSearchText(document: PostDocument): string {
  return document.content.flatMap((block) => blockLines(block)).join('\n');
}

function blockLines(block: BlockNode): string[] {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
      return [inlineText(block.content ?? [])];

    case 'bulletList':
    case 'orderedList':
      return block.content.flatMap((item) => item.content.flatMap((child) => blockLines(child)));
  }
}

function inlineText(nodes: InlineNode[]): string {
  return nodes.map((node) => (node.type === 'hardBreak' ? ' ' : node.text)).join('');
}

/**
 * The JSON forms of a word, for matching it inside a stored document.
 *
 * A post's content is `JSON.stringify` of its document, so a word with a
 * quote or a backslash is stored escaped and a plain `contains` would not
 * find it. Both forms are searched; the exact check afterwards decides.
 */
export function storedForms(term: string): string[] {
  const escaped = JSON.stringify(term).slice(1, -1);
  return escaped === term ? [term] : [term, escaped];
}
