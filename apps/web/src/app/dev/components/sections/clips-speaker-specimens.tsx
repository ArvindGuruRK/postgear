'use client';

/**
 * Sprint 13's `SpeakerStrip`, checked here before the timeline uses it
 * (Module 08): the thin row under the Video row while Follow The Speaker is
 * on. A coloured stretch per person (the crop boxes' four colours, by the
 * person's place), hatched where the speaker was lost, a hand mark where a
 * lost stretch was placed by hand. Press a hatched or fixed stretch to
 * select it.
 */
import { SpeakerStrip, type SpeakerStripStretch } from '@postgear/ui';
import { useState } from 'react';
import { Row, Spec } from '../shared';

const STRETCHES: SpeakerStripStretch[] = [
  { key: 'p1', kind: 'person', person: 0, leftPx: 0, widthPx: 140, label: 'Person 1' },
  { key: 'p2', kind: 'person', person: 1, leftPx: 140, widthPx: 90, label: 'Person 2' },
  {
    key: 'lost',
    kind: 'lost',
    leftPx: 230,
    widthPx: 60,
    label: 'We lost the speaker for 3 seconds here.',
  },
  { key: 'p1b', kind: 'person', person: 0, leftPx: 290, widthPx: 110, label: 'Person 1' },
  { key: 'p3', kind: 'person', person: 2, leftPx: 400, widthPx: 60, label: 'Person 3' },
  {
    key: 'fixed',
    kind: 'fixed',
    leftPx: 460,
    widthPx: 50,
    label: 'You placed the frame by hand here.',
  },
  { key: 'p4', kind: 'person', person: 3, leftPx: 510, widthPx: 70, label: 'Person 4' },
];

export function ClipsSpeakerSpecimens() {
  const [selected, setSelected] = useState<string | null>('lost');
  const chosen = STRETCHES.find((s) => s.key === selected);
  return (
    <Row label="Speaker strip (press a hatched or a hand-marked stretch)">
      <div className="flex flex-col gap-2 rounded-md bg-chrome p-3">
        <SpeakerStrip
          className="bg-chrome"
          widthPx={580}
          stretches={STRETCHES.map((s) => ({ ...s, selected: s.key === selected }))}
          onSelect={setSelected}
        />
        <p className="m-0 font-sans text-sm text-ink type-muted">
          {chosen ? chosen.label : 'Nothing selected.'}
        </p>
      </div>
      <Spec>
        SpeakerStrip: h-5 bg-inset track; people bg-actionPrimary, bg-actionSuccess,
        bg-actionAccent, bg-actionSecondary by place; lost bg-stripes with dashed edges; fixed
        bg-secondary with a lucide Hand; selected ring-2 ring-actionPrimary
      </Spec>
    </Row>
  );
}
