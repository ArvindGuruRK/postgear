'use client';

/**
 * Sprint 13's caption style tiles, checked here before the Captions tab uses
 * them (Module 03): the six built-in styles as `ChoiceTiles`, each with its
 * own small drawing in the style's font, colours and backing, and the spoken
 * word marked the way that style marks it.
 */
import { ChoiceTiles } from '@postgear/ui';
import { CAPTION_STYLES } from '@postgear/video-engine';
import { useId, useState } from 'react';
import { CaptionStyleDrawing } from '@/components/clips/panels/caption-style-tile';
import { Row, Spec } from '../shared';

export function ClipsCaptionSpecimens() {
  const labelId = useId();
  const [styleId, setStyleId] = useState<string>(CAPTION_STYLES[0]?.id ?? '');
  const chosen = CAPTION_STYLES.find((style) => style.id === styleId);

  return (
    <Row label="Caption style tiles (the spoken word is the second one)">
      <div className="w-80">
        <span id={labelId} className="sr-only">
          Caption Style
        </span>
        <ChoiceTiles<string>
          labelledBy={labelId}
          columns={2}
          value={styleId}
          onValueChange={setStyleId}
          options={CAPTION_STYLES.map((style) => ({
            value: style.id,
            label: style.name,
            drawing: <CaptionStyleDrawing look={style.look} className="w-28 rounded-sm" />,
          }))}
        />
      </div>
      <Spec>
        {`ChoiceTiles + CaptionStyleDrawing (a video-grey backdrop, the style's own font): ${chosen?.hint ?? ''}`}
      </Spec>
    </Row>
  );
}
