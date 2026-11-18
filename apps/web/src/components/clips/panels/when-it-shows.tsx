'use client';

/**
 * When It Shows (Module 11, shared with stickers in Module 12 and sounds in
 * Module 14, where it reads When It Plays): an item's start and length to
 * the frame, and whether it rides one moment or the whole clip.
 *
 * A sound effect plays once, so its For stops at its file's end
 * (`maxDurationMs`) and it has no Whole Clip (`whole: false`): only music
 * loops to fill the clip.
 */
import { TimeField } from '@postgear/ui';
import { ITEM_MIN_MS, isWholeClip, type TextItem } from '@postgear/video-engine';
import { useId } from 'react';
import { GroupLabel, PanelSection, Segmented } from '@/components/studio/panel-ui';

export function WhenItShows({
  item,
  totalMs,
  fps,
  onTiming,
  onAnchor,
  title = 'When It Shows',
  maxDurationMs,
  whole: wholeOffered = true,
}: {
  item: Pick<TextItem, 'start' | 'duration' | 'anchor'>;
  totalMs: number;
  fps: number;
  onTiming: (startMs: number, durationMs: number) => void;
  onAnchor: (choice: 'moment' | 'whole') => void;
  title?: string;
  /** The longest For may be (an effect's file); the clip's end otherwise. */
  maxDurationMs?: number;
  /** Whether On This Moment and Whole Clip are offered. */
  whole?: boolean;
}) {
  const whenId = useId();
  const whole = isWholeClip(item, totalMs);
  const room = Math.max(ITEM_MIN_MS, totalMs - item.start);
  const longest =
    maxDurationMs === undefined ? room : Math.max(ITEM_MIN_MS, Math.min(room, maxDurationMs));
  return (
    <PanelSection title={title} headingId={whenId}>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <GroupLabel>From</GroupLabel>
          <TimeField
            aria-label="From"
            valueMs={item.start}
            min={0}
            max={Math.max(0, totalMs - ITEM_MIN_MS)}
            fps={fps}
            onChange={(start) => onTiming(start, item.duration)}
          />
        </div>
        <div className="flex flex-col gap-1">
          <GroupLabel>For</GroupLabel>
          <TimeField
            aria-label="For"
            valueMs={item.duration}
            min={ITEM_MIN_MS}
            max={longest}
            fps={fps}
            onChange={(duration) => onTiming(item.start, duration)}
          />
        </div>
      </div>
      {wholeOffered ? (
        <Segmented<'moment' | 'whole'>
          labelledBy={whenId}
          value={whole ? 'whole' : 'moment'}
          onValueChange={onAnchor}
          options={[
            { value: 'moment', label: 'On This Moment' },
            { value: 'whole', label: 'Whole Clip' },
          ]}
        />
      ) : null}
    </PanelSection>
  );
}
