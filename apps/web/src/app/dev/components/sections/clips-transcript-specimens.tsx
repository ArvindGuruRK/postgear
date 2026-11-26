'use client';

/**
 * Sprint 13's `TranscriptText`, checked here before the Transcript pane and
 * the video page's sheet use it (Module 04): a clip's words with the spoken
 * one marked, unsure words underlined, a cut run struck through (hover it
 * for Restore), and context outside the clip dimmed. Drag or Shift and the
 * arrows to select; Delete strikes the selection through.
 */
import { TranscriptText, type TranscriptTextParagraph } from '@postgear/ui';
import { useMemo, useState } from 'react';
import { Row, Spec } from '../shared';

const SAID: Array<[string, number]> = [
  ['We', 0],
  ['spent', 0],
  ['a', 0],
  ['whole', 0],
  ['year', 0],
  ['on', 0],
  ['this.', 0],
  ['So,', 1],
  ['um,', 1],
  ['here', 1],
  ['is', 1],
  ['what', 1],
  ['we', 1],
  ['learned.', 1],
  ['First,', 2],
  ['ship', 2],
  ['small', 2],
  ['and', 2],
  ['ship', 2],
  ['often.', 2],
];
const OUTSIDE = new Set([0, 1, 19]);
const UNSURE = new Set([16]);

export function ClipsTranscriptSpecimens() {
  const [removed, setRemoved] = useState<ReadonlySet<number>>(new Set([8]));
  const [spoken, setSpoken] = useState<number>(10);
  const paragraphs = useMemo<TranscriptTextParagraph[]>(() => {
    const list: TranscriptTextParagraph[] = [];
    SAID.forEach(([text, paragraph], id) => {
      if (!list[paragraph]) {
        list[paragraph] = {
          key: `p${paragraph}`,
          label: `0:${String(paragraph * 4).padStart(2, '0')}`,
          words: [],
        };
      }
      const current = list[paragraph] as TranscriptTextParagraph;
      (current.words as TranscriptTextParagraph['words'][number][]).push({
        id,
        text,
        state: OUTSIDE.has(id) ? 'outside' : removed.has(id) ? 'removed' : 'normal',
        unsure: UNSURE.has(id),
      });
    });
    return list;
  }, [removed]);

  return (
    <Row label="Transcript text (click a word, drag to select, Delete to cut, hover a cut for Restore)">
      <div className="w-80 rounded-md bg-chrome p-3">
        <TranscriptText
          label="Transcript"
          paragraphs={paragraphs}
          spokenId={spoken}
          onWordPress={setSpoken}
          onDelete={(ids) => setRemoved((current) => new Set([...current, ...ids]))}
          onRestore={(ids) =>
            setRemoved((current) => new Set([...current].filter((id) => !ids.includes(id))))
          }
        />
      </div>
      <Spec>
        TranscriptText: spoken bg-actionPrimary, selection a bg-actionPrimary/25 tint, cut
        line-through, unsure dotted underline, outside dimmed and not selectable
      </Spec>
    </Row>
  );
}
