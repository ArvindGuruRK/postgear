'use client';

/**
 * The emote's live preview (Sprint 13, Module 14): the cropped square drawn
 * from the playing video at 112, 56 and 28 pixels on `bg-inset` squares,
 * flipped and keyed the way the export will be. Each canvas is the emote's
 * true size in pixels, so the 28 px one looks as small as it will in chat.
 *
 * The drawing runs once per animation frame while the page is open. The
 * chat's emotes are "mirrors": canvases that copy the 56 px picture each
 * frame (the 2x picture at 28 css pixels, as a sharp screen shows it).
 *
 * Remove A Colour reads the pixels back, which a browser allows only when
 * the video came with CORS; if it did not, the preview shows the picture
 * unkeyed and says so, and the export still keys it.
 */
import type { EmoteCrop, EmoteFrame, EmoteKey } from '@postgear/video-engine';
import { type RefObject, useEffect, useRef, useState } from 'react';
import { applyKey, PREVIEW_SIZES } from './emote-model';

export interface EmoteLook {
  crop: EmoteCrop;
  frame: EmoteFrame;
  flip: boolean;
  key: EmoteKey | null;
}

/** Draws the crop of the video's current picture into `canvas` (its own width is the size). */
export function drawEmote(
  canvas: HTMLCanvasElement,
  video: HTMLVideoElement,
  look: EmoteLook,
): 'drawn' | 'unkeyed' | 'empty' {
  const context = canvas.getContext('2d', { willReadFrequently: look.key !== null });
  if (!context || video.readyState < 2 || video.videoWidth === 0) return 'empty';
  const size = canvas.width;
  const scale = video.videoWidth / look.frame.width;
  context.save();
  context.clearRect(0, 0, size, size);
  if (look.flip) {
    context.translate(size, 0);
    context.scale(-1, 1);
  }
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    video,
    look.crop.x * scale,
    look.crop.y * scale,
    look.crop.size * scale,
    look.crop.size * scale,
    0,
    0,
    size,
    size,
  );
  context.restore();
  if (!look.key) return 'drawn';
  try {
    const pixels = context.getImageData(0, 0, size, size);
    applyKey(pixels.data, look.key.color, look.key.similarity);
    context.putImageData(pixels, 0, 0);
    return 'drawn';
  } catch {
    // A video without CORS taints the canvas: show it unkeyed.
    return 'unkeyed';
  }
}

/** The colour under a point of the video's picture, or null when the browser will not tell. */
export function pickColour(
  video: HTMLVideoElement,
  frame: EmoteFrame,
  point: { x: number; y: number },
): [number, number, number] | null {
  if (video.readyState < 2 || video.videoWidth === 0) return null;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  const scale = video.videoWidth / frame.width;
  context.drawImage(video, point.x * scale, point.y * scale, 1, 1, 0, 0, 1, 1);
  try {
    const data = context.getImageData(0, 0, 1, 1).data;
    return [data[0] as number, data[1] as number, data[2] as number];
  } catch {
    return null;
  }
}

export interface EmotePreviewProps {
  video: RefObject<HTMLVideoElement | null>;
  look: EmoteLook | null;
  /** Canvases that copy the 56 px picture each frame (the chat's emotes). */
  mirrors: RefObject<Set<HTMLCanvasElement>>;
}

export function EmotePreview({ video, look, mirrors }: EmotePreviewProps) {
  const canvases = useRef<Array<HTMLCanvasElement | null>>([]);
  const lookRef = useRef(look);
  lookRef.current = look;
  const [unkeyed, setUnkeyed] = useState(false);

  useEffect(() => {
    let frame = 0;
    let lastUnkeyed = false;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const current = lookRef.current;
      const element = video.current;
      if (!current || !element) return;
      let tainted = false;
      for (const canvas of canvases.current) {
        if (canvas && drawEmote(canvas, element, current) === 'unkeyed') tainted = true;
      }
      const source = canvases.current[1];
      if (source) {
        for (const mirror of mirrors.current) {
          const context = mirror.getContext('2d');
          if (!context) continue;
          context.clearRect(0, 0, mirror.width, mirror.height);
          context.drawImage(source, 0, 0, mirror.width, mirror.height);
        }
      }
      if (tainted !== lastUnkeyed) {
        lastUnkeyed = tainted;
        setUnkeyed(tainted);
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [video, mirrors]);

  return (
    <div className="flex flex-col gap-2" data-testid="emote-preview">
      <div className="flex items-end gap-4">
        {PREVIEW_SIZES.map((size, index) => (
          <figure key={size} className="m-0 flex flex-col items-center gap-1">
            <div className="flex items-center justify-center rounded-md border-2 border-outline bg-inset p-2">
              <canvas
                ref={(element) => {
                  canvases.current[index] = element;
                }}
                width={size}
                height={size}
                aria-label={`The emote at ${size} pixels`}
                role="img"
              />
            </div>
            <figcaption className="font-sans text-xs text-ink type-muted">{`${size} px`}</figcaption>
          </figure>
        ))}
      </div>
      {unkeyed && look?.key ? (
        <p className="m-0 font-sans text-sm text-ink type-muted">
          This preview cannot remove the colour here. The export still removes it.
        </p>
      ) : null}
    </div>
  );
}
