'use client';

/**
 * Sprint 12's Clips pieces from `@postgear/ui`, checked here before the video
 * page and the editor use them (Modules 07 and 09): the player bar on the
 * video page and as the editor's transport, a ruler with a playhead over three
 * rows (Video with two parts, an empty slim Overlay row, Sound), and the time
 * field. They are presentational and work in px; the maths here is a stand-in
 * for the engine's `timeline/scale.ts` and `ruler.ts`.
 *
 * Module 06's pieces (LinkCard, VideoCard, StorageMeter, AiMinutesChip and
 * My Channels) follow at the end, from `clips-home-specimens.tsx`.
 */
import { SkipBackIcon } from '@animateicons/react/lucide/skip-back-icon';
import { SkipForwardIcon } from '@animateicons/react/lucide/skip-forward-icon';
import {
  Button,
  formatTimeText,
  Kbd,
  Playhead,
  TIMELINE_LABEL_WIDTH_PX,
  TimeField,
  TimelineBar,
  TimelineBarChip,
  TimelineRow,
  TimeRuler,
  type TimeRulerTick,
  TooltipHint,
  VideoPlayerBar,
} from '@postgear/ui';
import { type PointerEvent, useMemo, useState } from 'react';
import { Row, Section, Spec } from '../shared';
import { ClipsHomeSpecimens } from './clips-home-specimens';

/** A 42 second clip at 16 px a second, 30 frames a second. */
const CLIP_MS = 42_000;
const PX_PER_MS = 16 / 1000;
const FPS = 30;
const WIDTH_PX = CLIP_MS * PX_PER_MS;

const msToPx = (ms: number) => ms * PX_PER_MS;
const clampMs = (ms: number) => Math.min(CLIP_MS, Math.max(0, Math.round(ms)));

/** A label every 5 seconds (80 px apart, past the 64 px minimum), a short tick every second. */
function demoTicks(): TimeRulerTick[] {
  const ticks: TimeRulerTick[] = [];
  for (let second = 0; second <= CLIP_MS / 1000; second += 1) {
    const major = second % 5 === 0;
    ticks.push({
      px: msToPx(second * 1000),
      major,
      label: major ? `0:${String(second).padStart(2, '0')}` : undefined,
    });
  }
  return ticks;
}

function seconds(ms: number) {
  const value = Math.round(ms / 100) / 10;
  return `${value} ${value === 1 ? 'second' : 'seconds'}`;
}

type BarId = 'part-1' | 'part-2' | 'music';

export function ClipsSection() {
  const [playing, setPlaying] = useState(false);
  const [playheadMs, setPlayheadMs] = useState(12_400);
  const [selected, setSelected] = useState<BarId | null>('part-1');
  const [fieldMs, setFieldMs] = useState(4000);
  const ticks = useMemo(demoTicks, []);

  const seekFromRuler = (event: PointerEvent<HTMLDivElement>) => {
    const left = event.currentTarget.getBoundingClientRect().left;
    setPlayheadMs(clampMs((event.clientX - left) / PX_PER_MS));
  };

  const step = (direction: -1 | 1, large: boolean) =>
    setPlayheadMs((ms) => clampMs(ms + direction * (large ? 1000 : 1000 / FPS)));

  const timeText = `${formatTimeText(playheadMs)} / ${formatTimeText(CLIP_MS)}`;

  return (
    <Section
      title="Clips"
      description="Sprint 12's player bar, timeline pieces and time field. Presentational and placed in px: the screen does the time maths. Desktop only, like Studio and Workflows."
    >
      <Row label="Player bar on the video page (paused)">
        <div className="w-full max-w-3xl rounded-md border-2 border-outline bg-inset">
          <VideoPlayerBar
            playing={playing}
            onTogglePlay={() => setPlaying((was) => !was)}
            onBack={() => setPlayheadMs((ms) => clampMs(ms - 5000))}
            onForward={() => setPlayheadMs((ms) => clampMs(ms + 5000))}
            timeText="12:04 / 3:42:10"
          >
            <TooltipHint label="Mark Start" shortcut={<Kbd>I</Kbd>}>
              <Button variant="secondary" size="sm" aria-label="Mark Start" className="w-9 px-0">
                I
              </Button>
            </TooltipHint>
            <TooltipHint label="Mark End" shortcut={<Kbd>O</Kbd>}>
              <Button variant="secondary" size="sm" aria-label="Mark End" className="w-9 px-0">
                O
              </Button>
            </TooltipHint>
            <span className="font-sans text-sm font-bold tabular-nums text-ink">0:42</span>
            <Button size="sm">Create Clip</Button>
          </VideoPlayerBar>
        </div>
        <Spec>VideoPlayerBar: ghost buttons + TooltipHint with keys, no shadow, children slot</Spec>
      </Row>

      <Row label="As the editor's transport (playing, one-frame steps)">
        <div className="w-full max-w-3xl rounded-md border-2 border-outline bg-inset">
          <VideoPlayerBar
            playing
            onTogglePlay={() => undefined}
            onBack={() => step(-1, false)}
            onForward={() => step(1, false)}
            timeText={timeText}
            backLabel="Back One Frame"
            forwardLabel="Forward One Frame"
            backShortcut={['←']}
            forwardShortcut={['→']}
            backIcon={SkipBackIcon}
            forwardIcon={SkipForwardIcon}
          />
        </div>
      </Row>

      <Row label="Disabled (the video is still loading)">
        <div className="w-full max-w-3xl rounded-md border-2 border-outline bg-inset">
          <VideoPlayerBar
            playing={false}
            disabled
            onTogglePlay={() => undefined}
            onBack={() => undefined}
            onForward={() => undefined}
            timeText="0:00 / 0:00"
          />
        </div>
      </Row>

      <Row label="Ruler, playhead and rows (click the ruler, drag the grip, Tab to a bar)">
        <div className="w-full overflow-x-auto rounded-md border-2 border-outline bg-chrome p-3">
          <div className="relative" style={{ width: TIMELINE_LABEL_WIDTH_PX + WIDTH_PX }}>
            <div className="flex">
              <div
                className="sticky left-0 z-10 shrink-0 bg-chrome"
                style={{ width: TIMELINE_LABEL_WIDTH_PX }}
              />
              <TimeRuler
                ticks={ticks}
                widthPx={WIDTH_PX}
                onPointerDown={seekFromRuler}
                onPointerMove={(event) => {
                  if (event.buttons === 1) seekFromRuler(event);
                }}
              />
            </div>
            <div className="mt-2 flex flex-col gap-1.5">
              <TimelineRow
                label="Video"
                tall
                widthPx={WIDTH_PX}
                className="bg-chrome"
                onTrackPointerDown={() => setSelected(null)}
              >
                <TimelineBar
                  aria-label="Part 1, from 0 seconds, 16 seconds long"
                  leftPx={msToPx(0)}
                  widthPx={msToPx(16_000)}
                  selected={selected === 'part-1'}
                  onBodyPointerDown={(event) => {
                    event.stopPropagation();
                    setSelected('part-1');
                  }}
                >
                  <span className="truncate font-sans text-xs font-bold">Part 1</span>
                </TimelineBar>
                <TimelineBar
                  aria-label="Part 2, from 16 seconds, 26 seconds long, at 2x"
                  leftPx={msToPx(16_000)}
                  widthPx={msToPx(26_000)}
                  hatchFromPx={msToPx(19_000)}
                  selected={selected === 'part-2'}
                  onBodyPointerDown={(event) => {
                    event.stopPropagation();
                    setSelected('part-2');
                  }}
                >
                  <span className="truncate font-sans text-xs font-bold">Part 2</span>
                  <TimelineBarChip>2x</TimelineBarChip>
                </TimelineBar>
              </TimelineRow>
              <TimelineRow label="Overlay" slim widthPx={WIDTH_PX} className="bg-chrome" />
              <TimelineRow
                label="Sound"
                widthPx={WIDTH_PX}
                className="bg-chrome"
                onTrackPointerDown={() => setSelected(null)}
              >
                <TimelineBar
                  aria-label="Sound, soft music, from 0 seconds, 42 seconds long"
                  tone="success"
                  movable
                  leftPx={0}
                  widthPx={WIDTH_PX}
                  selected={selected === 'music'}
                  onBodyPointerDown={(event) => {
                    event.stopPropagation();
                    setSelected('music');
                  }}
                >
                  <span className="truncate font-sans text-xs font-bold">Soft music</span>
                </TimelineBar>
              </TimelineRow>
            </div>
            <div
              className="pointer-events-none absolute inset-y-0"
              style={{ left: TIMELINE_LABEL_WIDTH_PX, width: WIDTH_PX }}
            >
              <Playhead
                px={msToPx(playheadMs)}
                valueMs={playheadMs}
                maxMs={CLIP_MS}
                valueText={`${seconds(playheadMs)} of ${seconds(CLIP_MS)}`}
                onDrag={(px) => setPlayheadMs(clampMs(px / PX_PER_MS))}
                onStep={step}
                onJump={(to) => setPlayheadMs(to === 'start' ? 0 : CLIP_MS)}
              />
            </div>
          </div>
        </div>
        <Spec>
          TimeRuler + Playhead (2 px line, grip, slider) + TimelineRow (bg-inset, slim when empty) +
          TimelineBar (border, no shadow, ring-2 when selected, bg-stripes tail)
        </Spec>
      </Row>

      <Row label="Time field (arrows step a frame, Shift a second; Enter or leave to commit)">
        <TimeField
          aria-label="Playhead Time"
          valueMs={fieldMs}
          onChange={setFieldMs}
          max={CLIP_MS}
          fps={FPS}
        />
        <TimeField
          aria-label="Disabled Time"
          valueMs={62_300}
          onChange={() => undefined}
          disabled
        />
        <Spec>{`TimeField: Input sm, tabular-nums, valueMs ${fieldMs}`}</Spec>
      </Row>

      <ClipsHomeSpecimens />
    </Section>
  );
}
