/**
 * Light markdown for sticky notes (blueprint 4.5): **bold**, *italic*,
 * [links](https://...) and "- " lists, nothing else. Rendered to React
 * elements, never to HTML, so a note cannot inject markup; links open only
 * for http and https addresses.
 */
import type { ReactNode } from 'react';

const INLINE = /(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)\s]+\))/g;

export function safeLink(href: string): string | null {
  try {
    const url = new URL(href);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function inline(text: string, keyBase: string): ReactNode[] {
  const parts = text.split(INLINE).filter((part) => part !== '');
  return parts.map((part, index) => {
    const key = `${keyBase}-${index}`;
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={key}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
      return <em key={key}>{part.slice(1, -1)}</em>;
    }
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(part);
    if (link) {
      const href = safeLink(link[2]);
      return href ? (
        <a
          key={key}
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="nodrag underline underline-offset-2"
        >
          {link[1]}
        </a>
      ) : (
        <span key={key}>{link[1]}</span>
      );
    }
    return <span key={key}>{part}</span>;
  });
}

export function NoteText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const lines = text.split('\n');
  const flush = (index: number) => {
    if (list.length === 0) return;
    blocks.push(
      <ul key={`list-${index}`} className="list-disc ps-4">
        {list.map((item, itemIndex) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: note lines have no ids
          <li key={itemIndex}>{inline(item, `li-${index}-${itemIndex}`)}</li>
        ))}
      </ul>,
    );
    list = [];
  };
  lines.forEach((line, index) => {
    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    if (item) {
      list.push(item[1]);
      return;
    }
    flush(index);
    // biome-ignore lint/suspicious/noArrayIndexKey: note lines have no ids
    if (line.trim()) blocks.push(<p key={`p-${index}`}>{inline(line, `p-${index}`)}</p>);
  });
  flush(lines.length);
  return <div className="flex flex-col gap-1 break-words">{blocks}</div>;
}
