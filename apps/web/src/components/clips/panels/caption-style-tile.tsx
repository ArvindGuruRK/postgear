'use client';

import { cn } from '@postgear/ui';
/**
 * A caption style's small specimen (Sprint 13, Module 03): two words drawn in
 * the style's own font, colours and backing, the second one marked the way
 * the style marks the spoken word. Used on the Captions tab's style tiles
 * and in Create A Style, so what a person picks is what the clip gets.
 *
 * The words sit on a fixed grey that stands in for video (captions are mostly
 * white, and a theme's pale surface would hide them), and shrink with the
 * tile so a wide style never runs off its edge.
 *
 * Decorative: the tile's label names the style.
 */
import { type CaptionLook, displayWord } from '@postgear/video-engine';
import type { CSSProperties } from 'react';
import { clipFontFamily } from '../editor/clip-fonts';

const WORDS = ['Your', 'words'] as const;
/** Stands in for the video behind the words: white, black and bright colours all read on it. */
const BACKDROP = '#5B6472';
/** The words' size as a share of the tile's width, so the widest built-in style fits. */
const FIT_CQW = 10.5;

function wordStyle(look: CaptionLook, spoken: boolean): CSSProperties {
  const { mark } = look;
  if (!spoken) {
    // Reveal: the word not said yet is there, faint, so the tile still reads.
    return mark.kind === 'reveal' ? { opacity: 0.25 } : {};
  }
  if (mark.kind === 'colour' || mark.kind === 'fill') return { color: mark.colour };
  if (mark.kind === 'box') {
    return { background: mark.colour, boxShadow: `0 0 0 0.2em ${mark.colour}` };
  }
  return {};
}

export function CaptionStyleDrawing({
  look,
  className,
  maxPx = 15,
}: {
  look: CaptionLook;
  /** Its size and frame. A width is needed: the words are sized from it (default: the full row). */
  className?: string;
  /** The largest the words are drawn, in px; a narrow tile draws them smaller. */
  maxPx?: number;
}) {
  const stroke = look.outline
    ? `${Math.max(1, look.outline.width / 3)}px ${look.outline.colour}`
    : undefined;
  // Fill colours the words said so far: on the tile, the first word.
  const said = look.mark.kind === 'fill' || look.mark.kind === 'reveal' ? 0 : 1;
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-12 w-full shrink-0 items-center justify-center overflow-hidden',
        className,
      )}
      style={{
        background: BACKDROP,
        containerType: 'inline-size',
        fontFamily: clipFontFamily(look.font),
        fontWeight: look.weight,
        fontStyle: look.italic ? 'italic' : 'normal',
        lineHeight: 1,
      }}
    >
      <span
        style={{
          fontSize: `min(${maxPx}px, ${FIT_CQW}cqw)`,
          color: look.colour,
          WebkitTextStroke: stroke,
          paintOrder: 'stroke fill',
          background: look.box?.colour,
          padding: look.box ? '0.2em 0.4em' : undefined,
          textShadow: look.shadow && !look.box ? '1px 1px 0 rgba(0, 0, 0, 0.6)' : undefined,
          whiteSpace: 'nowrap',
        }}
      >
        {WORDS.map((word, index) => (
          <span key={word}>
            {index > 0 ? ' ' : null}
            <span style={wordStyle(look, index === said)}>
              {displayWord(word, look.letterCase)}
            </span>
          </span>
        ))}
      </span>
    </span>
  );
}
