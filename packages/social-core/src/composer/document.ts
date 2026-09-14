/**
 * The post document — what a user wrote, before any platform has had a say.
 *
 * ## Why a JSON tree and not HTML
 *
 * The composer is TipTap, and TipTap can emit either. The reference stores the
 * editor's HTML in `Post.content` and then renders it back through
 * `dangerouslySetInnerHTML` in every one of its preview components, which makes
 * the post body a stored-XSS surface guarded only by whatever sanitizer ran on
 * the way in. Sanitizing untrusted HTML on a Node server without a DOM is
 * exactly the kind of code that is wrong in ways nobody notices.
 *
 * A JSON tree sidesteps the problem rather than defending against it. The API
 * validates the shape against a closed allowlist (`dto/posts.schema.ts`), there
 * is no markup to parse, and every consumer — preview, character counter,
 * publisher — walks the same small set of node types and renders text nodes as
 * text. Nothing in PostGear ever turns a post into HTML.
 *
 * ## Why only these node types
 *
 * Every platform PostGear publishes to accepts plain text. Formatting survives
 * only as far as `render.ts` can express it in Unicode, so the document admits
 * exactly what that renderer can honour: paragraphs, one heading style, bullet
 * and numbered lists, bold, italic, links and line breaks. A node the renderer
 * could not express would be a lie the preview tells.
 *
 * This file must stay free of Node imports. The web app bundles it for the
 * browser, which is why it lives under `composer/` rather than beside the
 * providers that pull in `node:crypto`.
 */

export type HeadingLevel = 1 | 2 | 3;

export interface BoldMark {
  type: 'bold';
}

export interface ItalicMark {
  type: 'italic';
}

export interface LinkMark {
  type: 'link';
  attrs: { href: string };
}

export type Mark = BoldMark | ItalicMark | LinkMark;

export interface TextNode {
  type: 'text';
  text: string;
  marks?: Mark[];
}

export interface HardBreakNode {
  type: 'hardBreak';
}

export type InlineNode = TextNode | HardBreakNode;

export interface ParagraphNode {
  type: 'paragraph';
  content?: InlineNode[];
}

export interface HeadingNode {
  type: 'heading';
  attrs: { level: HeadingLevel };
  content?: InlineNode[];
}

export interface ListItemNode {
  type: 'listItem';
  content: BlockNode[];
}

export interface BulletListNode {
  type: 'bulletList';
  content: ListItemNode[];
}

export interface OrderedListNode {
  type: 'orderedList';
  attrs?: { start: number };
  content: ListItemNode[];
}

export type BlockNode = ParagraphNode | HeadingNode | BulletListNode | OrderedListNode;

export interface PostDocument {
  type: 'doc';
  content: BlockNode[];
}

/**
 * How deeply lists may nest.
 *
 * A real limit rather than a courtesy: the API validates documents with a
 * schema built to this depth, so an attacker cannot send a thousand-level
 * nesting and walk a recursive validator off the end of the stack.
 */
export const MAX_LIST_DEPTH = 3;

/** The largest ordered-list start number worth honouring. */
const MAX_LIST_START = 10_000;

const MARK_ORDER: Record<Mark['type'], number> = { bold: 0, italic: 1, link: 2 };

export function emptyDocument(): PostDocument {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

/**
 * A document from plain text — one paragraph per line.
 *
 * Used for content that did not come from the editor: seeds, AI output from
 * Sprint 6, and legacy rows. An empty line becomes an empty paragraph, which
 * renders back as the blank line it was.
 */
export function documentFromText(text: string): PostDocument {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  return {
    type: 'doc',
    content: lines.map((line) =>
      line.length > 0
        ? { type: 'paragraph', content: [{ type: 'text', text: line }] }
        : { type: 'paragraph' },
    ),
  };
}

/**
 * Whether a link target is safe to keep.
 *
 * `http:` and `https:` only. The obvious threat is `javascript:`, but the rule
 * is an allowlist rather than a blocklist on purpose — `data:`, `vbscript:` and
 * whatever a browser invents next are refused without being named.
 */
export function isSafeHref(href: string): boolean {
  try {
    const url = new URL(href);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Coerces anything shaped roughly like editor output into a valid document.
 *
 * Lenient where the API schema is strict, and deliberately so: this runs in the
 * browser on TipTap's own JSON, which carries attributes the schema does not
 * accept (`target`, `rel`, `class`, nulls) and, if an extension is ever added
 * without updating this file, node types it does not know. Unknown containers
 * are unwrapped so their text survives; unknown leaves are dropped; unsafe
 * links lose the link but keep the words.
 *
 * The API never trusts that this ran — it validates the result independently.
 */
export function normalizeDocument(input: unknown): PostDocument {
  if (!isRecord(input) || input.type !== 'doc' || !Array.isArray(input.content)) {
    return emptyDocument();
  }

  const content = normalizeBlocks(input.content, 0);

  return { type: 'doc', content: content.length > 0 ? content : [{ type: 'paragraph' }] };
}

/**
 * Reads a stored `Post.content` value.
 *
 * Tolerates what might be there rather than what should be: a row written by
 * the composer is a JSON document, but a row written by a script, a seed, or a
 * future integration may be plain text. Plain text becomes a document instead
 * of a crash or an empty post.
 */
export function parseDocument(raw: string | null | undefined): PostDocument {
  if (!raw) {
    return emptyDocument();
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (isRecord(parsed) && parsed.type === 'doc') {
      return normalizeDocument(parsed);
    }
  } catch {
    // Not JSON — fall through to treating it as text.
  }

  return documentFromText(raw);
}

/** True when the document contains no visible text at all. */
export function isDocumentEmpty(document: PostDocument): boolean {
  return !document.content.some(blockHasText);
}

function blockHasText(block: BlockNode): boolean {
  switch (block.type) {
    case 'paragraph':
    case 'heading':
      return (block.content ?? []).some(
        (node) => node.type === 'text' && node.text.trim().length > 0,
      );
    case 'bulletList':
    case 'orderedList':
      return block.content.some((item) => item.content.some(blockHasText));
  }
}

function normalizeBlocks(nodes: unknown[], depth: number): BlockNode[] {
  return nodes.flatMap((node) => normalizeBlock(node, depth));
}

function normalizeBlock(node: unknown, depth: number): BlockNode[] {
  if (!isRecord(node) || typeof node.type !== 'string') {
    return [];
  }

  const children = Array.isArray(node.content) ? node.content : [];

  switch (node.type) {
    case 'paragraph':
      return [paragraph(normalizeInline(children))];

    case 'heading': {
      const attrs = isRecord(node.attrs) ? node.attrs : {};
      const rawLevel = typeof attrs.level === 'number' ? Math.trunc(attrs.level) : 2;
      const level = Math.min(3, Math.max(1, rawLevel)) as HeadingLevel;
      const content = normalizeInline(children);

      return [
        content.length > 0
          ? { type: 'heading', attrs: { level }, content }
          : { type: 'heading', attrs: { level } },
      ];
    }

    case 'bulletList':
    case 'orderedList': {
      const items = normalizeListItems(children, depth + 1);

      if (items.length === 0) {
        return [];
      }

      // Past the depth limit the list flattens into its own paragraphs rather
      // than vanishing — the words matter more than the indentation.
      if (depth + 1 > MAX_LIST_DEPTH) {
        return items.flatMap((item) => item.content);
      }

      if (node.type === 'bulletList') {
        return [{ type: 'bulletList', content: items }];
      }

      const attrs = isRecord(node.attrs) ? node.attrs : {};
      const start =
        typeof attrs.start === 'number' && Number.isFinite(attrs.start)
          ? Math.min(MAX_LIST_START, Math.max(0, Math.trunc(attrs.start)))
          : 1;

      return [
        start === 1
          ? { type: 'orderedList', content: items }
          : { type: 'orderedList', attrs: { start }, content: items },
      ];
    }

    default: {
      // An unknown container (a blockquote, a code block from pasted content)
      // is unwrapped. Its children are either blocks, which are kept, or
      // inline content, which becomes a paragraph.
      if (children.length === 0) {
        return [];
      }

      const looksInline = children.every(
        (child) => isRecord(child) && (child.type === 'text' || child.type === 'hardBreak'),
      );

      return looksInline
        ? [paragraph(normalizeInline(children))]
        : normalizeBlocks(children, depth);
    }
  }
}

function normalizeListItems(nodes: unknown[], depth: number): ListItemNode[] {
  return nodes.flatMap((node): ListItemNode[] => {
    if (!isRecord(node) || node.type !== 'listItem') {
      return [];
    }

    const blocks = normalizeBlocks(Array.isArray(node.content) ? node.content : [], depth);

    // TipTap's list item schema is `paragraph block*`. A document that breaks
    // that rule is rejected when loaded back into the editor, so the first
    // child is forced to be a paragraph.
    if (blocks[0]?.type !== 'paragraph') {
      blocks.unshift({ type: 'paragraph' });
    }

    return [{ type: 'listItem', content: blocks }];
  });
}

function normalizeInline(nodes: unknown[]): InlineNode[] {
  return nodes.flatMap((node): InlineNode[] => {
    if (!isRecord(node)) {
      return [];
    }

    if (node.type === 'hardBreak') {
      return [{ type: 'hardBreak' }];
    }

    if (node.type === 'text' && typeof node.text === 'string' && node.text.length > 0) {
      const marks = normalizeMarks(node.marks);
      return [
        marks.length > 0
          ? { type: 'text', text: node.text, marks }
          : { type: 'text', text: node.text },
      ];
    }

    // An unknown inline node (a mention from a future extension) keeps its
    // visible label as text rather than disappearing mid-sentence.
    if (isRecord(node.attrs) && typeof node.attrs.label === 'string' && node.attrs.label) {
      return [{ type: 'text', text: node.attrs.label }];
    }

    return [];
  });
}

function normalizeMarks(raw: unknown): Mark[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const byType = new Map<Mark['type'], Mark>();

  for (const mark of raw) {
    if (!isRecord(mark)) {
      continue;
    }

    if (mark.type === 'bold' || mark.type === 'italic') {
      byType.set(mark.type, { type: mark.type });
    } else if (mark.type === 'link' && isRecord(mark.attrs)) {
      const href = typeof mark.attrs.href === 'string' ? mark.attrs.href.trim() : '';

      if (isSafeHref(href)) {
        byType.set('link', { type: 'link', attrs: { href } });
      }
    }
  }

  // A stable order, so the same formatting always serializes identically and
  // an unchanged post never looks edited.
  return [...byType.values()].sort((a, b) => MARK_ORDER[a.type] - MARK_ORDER[b.type]);
}

function paragraph(content: InlineNode[]): ParagraphNode {
  return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
