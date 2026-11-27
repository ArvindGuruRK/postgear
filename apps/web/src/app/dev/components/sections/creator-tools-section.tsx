'use client';

/**
 * Sprint 13 Module 14's Emote Maker pieces: the Chat Preview (light and dark
 * chat, with a made-up emote and the typed line that never leaves the page)
 * and the crop box over a stand-in picture, at a sharp size and under 112
 * source pixels (the soft note). Nothing here loads a video or calls the API.
 */
import type { EmoteCrop } from '@postgear/video-engine';
import { useState } from 'react';
import { ChatPreview } from '@/components/clips/emote/chat-preview';
import { CropBox, CropNote } from '@/components/clips/emote/crop-box';
import { Row, Section, Spec } from '../shared';

const FRAME = { width: 1280, height: 720 };

/** A drawn stand-in for an emote: a face made of plain shapes, so no picture is loaded. */
function SampleEmote() {
  return (
    <svg viewBox="0 0 28 28" className="h-7 w-7" aria-hidden="true">
      <circle cx="14" cy="14" r="12" fill="currentColor" opacity="0.9" />
      <circle cx="10" cy="11" r="2" fill="white" />
      <circle cx="18" cy="11" r="2" fill="white" />
      <path d="M8 17 Q14 23 20 17" stroke="white" strokeWidth="2.5" fill="none" />
    </svg>
  );
}

function CropSpecimen({ start }: { start: EmoteCrop }) {
  const [crop, setCrop] = useState(start);
  return (
    <div className="flex w-full max-w-md flex-col gap-2">
      <div
        className="relative w-full overflow-hidden rounded-card border-2 border-outline bg-inset"
        style={{ aspectRatio: `${FRAME.width} / ${FRAME.height}` }}
      >
        <CropBox frame={FRAME} crop={crop} onChange={setCrop} />
      </div>
      <CropNote crop={crop} />
    </div>
  );
}

export function CreatorToolsSection() {
  return (
    <Section
      title="Creator Tools"
      description="The Emote Maker's chat preview and crop box (Sprint 13, Module 14). Drag the box or use the arrow keys; plus and minus resize it."
    >
      <Row label="Chat Preview">
        <ChatPreview
          className="w-full max-w-sm"
          renderEmote={(index) => <SampleEmote key={index} />}
        />
        <ChatPreview className="w-full max-w-sm" initialGround="light" />
      </Row>
      <Spec>ChatPreview renderEmote initialGround</Spec>
      <Row label="Crop Box">
        <CropSpecimen start={{ x: 424, y: 144, size: 432 }} />
        <CropSpecimen start={{ x: 600, y: 300, size: 96 }} />
      </Row>
      <Spec>CropBox frame crop onChange, CropNote</Spec>
    </Section>
  );
}
