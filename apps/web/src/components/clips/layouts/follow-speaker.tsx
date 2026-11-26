'use client';

/**
 * Follow The Speaker in the Layouts tab (Sprint 13, Module 08, blueprint
 * section 6), under the layout tiles, for Vertical, Portrait and Square
 * clips:
 *
 * - The **Follow The Speaker** switch, "Finding faces" (a `Progress`) while
 *   a job looks, and the line when nobody is found (the switch stays off).
 * - **Show Both** when two to four people were found.
 * - With many faces, a row of face thumbnails cut from the editor's own
 *   video in the browser (nothing is uploaded; a numbered tile when the
 *   picture at the playhead does not show that person), to pick who to follow.
 * - A lost stretch chosen on the Speaker strip: "We lost the speaker for N
 *   seconds here." and **Fix By Hand**; a fixed one: **Clear Fix**.
 * - **Follow Again** when the clip now plays past the faces found.
 *
 * The state lives in the editor (`use-follow-speaker.ts`); this only draws it.
 */
import { Alert, Button, cn, Progress, Toggle } from '@postgear/ui';
import type { Person } from '@postgear/video-engine';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { NOTE } from '@/components/studio/panel-ui';
import {
  CLEAR_FIX,
  FIX_BY_HAND,
  FIX_NOTE,
  FIXED_SENTENCE,
  FOLLOW_AGAIN,
  FOLLOW_FINDING,
  FOLLOW_HELP,
  FOLLOW_LABEL,
  FOLLOW_OFF_NOTE,
  lostSentence,
  MANY_FACES,
  NO_ONE_TO_FOLLOW,
  PAST_FACES,
  personName,
  SHOW_BOTH_LABEL,
  thumbBox,
} from './follow-model';
import type { FollowSpeakerController } from './use-follow-speaker';

const LABEL = 'font-sans text-sm font-bold text-ink';

/** The editor's front video, to cut thumbnails from; null before a picture shows. */
export type GrabPicture = () => HTMLVideoElement | null;

export function FollowSpeaker({
  follow,
  grabPicture,
}: {
  follow: FollowSpeakerController;
  grabPicture?: GrabPicture;
}) {
  const switchId = useId();
  const bothId = useId();
  if (!follow.shown) return null;
  const { phase, selected } = follow;
  const canTurnOn = follow.available || follow.following;

  return (
    <div className="flex flex-col gap-3" data-testid="clip-follow-speaker">
      <div className="flex items-center gap-3">
        <Toggle
          id={switchId}
          checked={follow.switchedOn}
          disabled={!canTurnOn}
          onCheckedChange={(on) => (on ? follow.turnOn() : follow.turnOff())}
          data-testid="clip-follow-switch"
        />
        <label htmlFor={switchId} className={cn(LABEL, 'flex-1')}>
          {FOLLOW_LABEL}
        </label>
        <span className="type-label text-xs text-ink type-muted">Free</span>
      </div>
      <p className={NOTE}>{canTurnOn ? FOLLOW_HELP : `${FOLLOW_HELP} ${FOLLOW_OFF_NOTE}`}</p>

      {phase.kind === 'finding' ? (
        <div className="flex flex-col gap-2" data-testid="clip-follow-finding">
          <Progress tone="ai" value={phase.progress} aria-label={FOLLOW_FINDING} />
          <p className={NOTE}>{FOLLOW_FINDING}</p>
        </div>
      ) : null}

      {follow.canShowBoth ? (
        <div className="flex items-center gap-3">
          <Toggle
            id={bothId}
            checked={follow.mode === 'both'}
            onCheckedChange={follow.setShowBoth}
            data-testid="clip-follow-both"
          />
          <label htmlFor={bothId} className={cn(LABEL, 'flex-1')}>
            {SHOW_BOTH_LABEL}
          </label>
        </div>
      ) : null}

      {phase.kind === 'many' ? (
        <div className="flex flex-col gap-2" data-testid="clip-follow-picker">
          <p className={NOTE}>{MANY_FACES}</p>
          <div className="flex flex-wrap gap-2">
            {phase.people.map((person, index) => (
              <FaceThumb
                key={person.id}
                person={person}
                index={index}
                grabPicture={grabPicture}
                onPick={() => follow.pick(person.id)}
              />
            ))}
          </div>
        </div>
      ) : null}

      {phase.kind === 'none' || phase.kind === 'failed' ? (
        <Alert variant="warning" className="items-center" data-testid="clip-follow-warning">
          <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">
            {phase.kind === 'none' ? NO_ONE_TO_FOLLOW : phase.message}
          </p>
        </Alert>
      ) : null}

      {follow.following && !follow.covered ? (
        <div className="flex flex-col gap-2" data-testid="clip-follow-past">
          <p className={NOTE}>{PAST_FACES}</p>
          <Button
            variant="secondary"
            className="w-full"
            disabled={!follow.available || phase.kind === 'finding'}
            onClick={follow.followAgain}
            data-testid="clip-follow-again"
          >
            {FOLLOW_AGAIN}
          </Button>
        </div>
      ) : null}

      {follow.following && selected && selected.kind !== 'person' ? (
        <div className="flex flex-col gap-2 rounded-md bg-inset p-3" data-testid="clip-follow-lost">
          <p className="m-0 font-sans text-sm text-ink">
            {selected.kind === 'fixed'
              ? FIXED_SENTENCE
              : lostSentence(selected.source.to - selected.source.from)}
          </p>
          {follow.fixing ? (
            <p className={NOTE}>{FIX_NOTE}</p>
          ) : follow.mode === 'speaker' ? (
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={follow.startFix}
                data-testid="clip-follow-fix"
              >
                {FIX_BY_HAND}
              </Button>
              {selected.kind === 'fixed' ? (
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={follow.clearFix}
                  data-testid="clip-follow-clear-fix"
                >
                  {CLEAR_FIX}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** One person in the picker: their face cut from the picture now, or their number. */
function FaceThumb({
  person,
  index,
  grabPicture,
  onPick,
}: {
  person: Person;
  index: number;
  grabPicture?: GrabPicture;
  onPick: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const node = canvas.current;
    const video = grabPicture?.() ?? null;
    if (!node || !video || !(video.videoWidth > 0) || !(video.videoHeight > 0)) return;
    const box = thumbBox(person, video.currentTime * 1000);
    if (!box) return;
    try {
      const context = node.getContext('2d');
      if (!context) return;
      context.drawImage(
        video,
        box.x * video.videoWidth,
        box.y * video.videoHeight,
        box.w * video.videoWidth,
        box.h * video.videoHeight,
        0,
        0,
        node.width,
        node.height,
      );
      node.dataset.drawn = 'true';
    } catch {
      // The picture is not drawable yet: the number shows.
    }
  }, [person, grabPicture]);

  const name = personName(index);
  return (
    <button
      type="button"
      aria-label={`Follow ${name}`}
      title={name}
      onClick={onPick}
      data-testid="clip-follow-person"
      className={cn(
        'relative h-14 w-14 overflow-hidden rounded-md border-2 border-outline bg-inset',
        'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing',
        'hover:ring-2 hover:ring-ink/25',
      )}
    >
      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center type-heading text-lg text-ink"
      >
        {index + 1}
      </span>
      <canvas ref={canvas} width={112} height={112} className="relative h-full w-full" />
    </button>
  );
}
