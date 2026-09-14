/**
 * Document → the exact text a platform receives.
 *
 * One function, used by three callers that must agree to the character: the
 * live preview, the character counter, and (from Sprint 5) the publisher. If
 * the preview rendered text one way and the publisher another, the preview
 * would be a guess and the counter would be wrong precisely when it mattered.
 *
 * ## The rules
 *
 * - **Paragraphs are lines.** Enter in the editor is a new line in the post; an
 *   empty paragraph is a blank line. This is how people already write social
 *   posts, and it round-trips.
 * - **Bold and italic become Unicode styles** — see `unicode.ts` for the costs.
 * - **Headings become a bold line.** No platform has headings.
 * - **Lists become `•` or `1.` lines**, indented two spaces per level.
 * - **Links keep their words and their target.** A link whose text already is
 *   its URL renders once; a link on other words renders as `words (url)`,
 *   because every platform strips the hyperlink and a bare word would silently
 *   lose where it pointed.
 * - **Leading and trailing blank lines are dropped.** TipTap keeps a trailing
 *   empty paragraph so the cursor has somewhere to go; the post should not end
 *   in a newline because of it.
 */
import type { BlockNode, InlineNode, PostDocument } from './document';
import { styleText } from './unicode';

const LIST_INDENT = '  ';

export function renderPlainText(document: PostDocument): string {
  const lines = document.content.flatMap((block) => renderBlock(block, 0));
  return lines.join('\n').replace(/^\n+|\n+$/g, '');
}

function renderBlock(block: BlockNode, depth: number): string[] {
  switch (block.type) {
    case 'paragraph':
      return renderInline(block.content ?? [], false).split('\n');

    case 'heading':
      return renderInline(block.content ?? [], true).split('\n');

    case 'bulletList':
    case 'orderedList': {
      const start = block.type === 'orderedList' ? (block.attrs?.start ?? 1) : 1;
      const indent = LIST_INDENT.repeat(depth);
      const lines: string[] = [];

      block.content.forEach((item, index) => {
        const marker = block.type === 'bulletList' ? '• ' : `${start + index}. `;
        // Continuation lines line up under the item's text, not its marker.
        const hanging = indent + ' '.repeat(marker.length);
        let first = true;

        for (const child of item.content) {
          if (child.type === 'bulletList' || child.type === 'orderedList') {
            // A nested list carries its own, deeper indentation.
            lines.push(...renderBlock(child, depth + 1));
            continue;
          }

          for (const line of renderBlock(child, depth)) {
            lines.push(`${first ? `${indent}${marker}` : hanging}${line}`.trimEnd());
            first = false;
          }
        }
      });

      return lines;
    }
  }
}

/**
 * Renders a run of inline nodes.
 *
 * Links are grouped before their URL is appended. A link whose middle word is
 * bold arrives as three text nodes that share one href, and appending the URL
 * per node would print it three times.
 */
function renderInline(nodes: InlineNode[], forceBold: boolean): string {
  let output = '';
  let linkHref: string | null = null;
  let linkText = '';
  let linkRaw = '';

  const flushLink = () => {
    if (linkHref === null) {
      return;
    }

    output += linkText;

    if (!sameTarget(linkRaw, linkHref)) {
      output += ` (${linkHref})`;
    }

    linkHref = null;
    linkText = '';
    linkRaw = '';
  };

  for (const node of nodes) {
    if (node.type === 'hardBreak') {
      flushLink();
      output += '\n';
      continue;
    }

    const marks = node.marks ?? [];
    const bold = forceBold || marks.some((mark) => mark.type === 'bold');
    const italic = marks.some((mark) => mark.type === 'italic');
    const link = marks.find((mark) => mark.type === 'link');
    const styled = styleText(node.text, { bold, italic });

    if (link?.type === 'link') {
      if (linkHref !== null && linkHref !== link.attrs.href) {
        flushLink();
      }

      linkHref = link.attrs.href;
      linkText += styled;
      linkRaw += node.text;
      continue;
    }

    flushLink();
    output += styled;
  }

  flushLink();

  return output;
}

/**
 * Whether a link's visible text already says where it goes.
 *
 * Compared loosely — scheme, `www.` and a trailing slash are ignored — so that
 * `example.com` linked to `https://www.example.com/` is not rendered as
 * `example.com (https://www.example.com/)`.
 */
function sameTarget(text: string, href: string): boolean {
  const normalize = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
      .replace(/^www\./, '')
      .replace(/\/+$/, '');

  return normalize(text) === normalize(href);
}
