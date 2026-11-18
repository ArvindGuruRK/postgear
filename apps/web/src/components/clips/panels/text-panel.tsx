'use client';

import { FONTS } from '@postgear/design-engine';
/**
 * The Text tab (Module 11 section 7): add a text, pick a ready style, and
 * change everything about the selected one (its words, font, size, colour,
 * backing, shadow, alignment, letter case, fade, opacity and when it shows).
 *
 * The panel never edits the document itself: each control hands a change to
 * the editor (`onEdit`), which applies it to the selected text as one undo
 * step. A slider or a colour drag passes a coalesce key, so the whole drag
 * is one step.
 */
import {
  Alert,
  Button,
  ChoiceTiles,
  ColorPicker,
  Segmented,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Textarea,
  Toggle,
} from '@postgear/ui';
import {
  applyTextStyle,
  FONT_MANIFEST,
  familyWeights,
  hasEmoji,
  matchingTextStyle,
  missingCharacters,
  nearestWeight,
  stripEmoji,
  TEXT_MAX,
  TEXT_STYLES,
  type TextItem,
  type TextStyle,
  type TextStyleId,
} from '@postgear/video-engine';
import { TriangleAlert } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { FontSelect } from '@/components/studio/font-select';
import { GroupLabel, NOTE, PanelSection, PercentSlider } from '@/components/studio/panel-ui';
import { CLIP_FONT_IDS, clipFontFamily, fontIdOf } from '../editor/clip-fonts';
import { WhenItShows } from './when-it-shows';

/** What the panel says when an emoji is left out of a text. */
export const EMOJI_SENTENCE = 'Emoji are stickers. Add one from Elements.';
const NOTHING_SELECTED = 'Select a text on the clip or its bar on the timeline to change it.';

/** The fades the panel offers, in and out alike. */
export const TEXT_FADES = { none: 0, short: 200, long: 500 } as const;
type FadeChoice = keyof typeof TEXT_FADES;

const WEIGHT_NAMES: Readonly<Record<number, string>> = {
  100: 'Thin',
  200: 'Extra Light',
  300: 'Light',
  400: 'Regular',
  500: 'Medium',
  600: 'Semi Bold',
  700: 'Bold',
  800: 'Extra Bold',
  900: 'Black',
};

type Backing = 'none' | 'outline' | 'box';

const SIZE_MIN = 16;
const SIZE_MAX = 240;

/** A change to the selected text, and the key that makes a drag one undo step. */
export type TextEdit = (change: (item: TextItem) => TextItem, coalesceKey?: string) => void;

export interface TextPanelProps {
  /** The selected text, or null. */
  item: TextItem | null;
  /** The clip's length (When It Shows keeps inside it). */
  totalMs: number;
  fps: number;
  /** Colours picked lately, newest first. */
  recent: readonly string[];
  /** A colour was chosen: it goes on the recent list. */
  onRecent: (hex: string) => void;
  /** Whether an emoji was just left out (typed on the clip or here). */
  emojiDropped: boolean;
  onEmoji: () => void;
  /** Add Text, or a ready style with nothing selected: a new text in that style at the playhead. */
  onAdd: (style: TextStyleId) => void;
  onEdit: TextEdit;
  onTiming: (startMs: number, durationMs: number) => void;
  onAnchor: (choice: 'moment' | 'whole') => void;
  onRemove: () => void;
}

function backingOf(style: TextStyle): Backing {
  return style.outline ? 'outline' : style.background ? 'box' : 'none';
}

function fadeOf(item: TextItem): FadeChoice {
  if (item.fadeInMs === TEXT_FADES.long && item.fadeOutMs === TEXT_FADES.long) return 'long';
  if (item.fadeInMs === TEXT_FADES.short && item.fadeOutMs === TEXT_FADES.short) return 'short';
  return 'none';
}

/** A ready style's small specimen on its tile. */
function StyleDrawing({ style }: { style: TextStyle }) {
  const stroke = style.outline
    ? `${Math.max(1, style.outline.width / 2.5)}px ${style.outline.colour}`
    : undefined;
  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-full items-center justify-center bg-inset"
      style={{
        fontFamily: clipFontFamily(style.font),
        fontWeight: style.weight,
        fontSize: 20,
        lineHeight: 1,
      }}
    >
      <span
        style={{
          color: style.colour,
          WebkitTextStroke: stroke,
          paintOrder: 'stroke fill',
          background: style.background?.colour,
          padding: style.background ? '2px 6px' : undefined,
          textShadow: style.shadow ? '2px 2px 0 rgba(0, 0, 0, 0.6)' : undefined,
        }}
      >
        Aa
      </span>
    </span>
  );
}

/** A slider in canvas pixels with its name and value shown. */
function PixelSlider({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <GroupLabel id={id}>{label}</GroupLabel>
        <span aria-hidden="true" className="font-sans text-xs tabular-nums text-ink type-muted">
          {value} px
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={1}
        thumbs={[{ 'aria-labelledby': id, 'aria-valuetext': `${value} px` }]}
        onValueChange={([next]) => {
          if (next !== undefined) onChange(next);
        }}
      />
    </div>
  );
}

export function TextPanel({
  item,
  totalMs,
  fps,
  recent,
  onRecent,
  emojiDropped,
  onEmoji,
  onAdd,
  onEdit,
  onTiming,
  onAnchor,
  onRemove,
}: TextPanelProps) {
  const stylesId = useId();
  const id = item?.id ?? 'none';
  const chosenStyle = item ? matchingTextStyle(item.style) : null;

  return (
    <div className="flex flex-col gap-6 pt-1" data-testid="clip-text-panel">
      <Button className="w-full" onClick={() => onAdd(chosenStyle ?? 'bold-outline')}>
        Add Text
      </Button>

      <div className="flex flex-col gap-2">
        <GroupLabel id={stylesId}>Styles</GroupLabel>
        <ChoiceTiles<TextStyleId | ''>
          labelledBy={stylesId}
          columns={3}
          value={chosenStyle ?? ''}
          onValueChange={(next) => {
            if (next === '') return;
            if (item) onEdit((current) => applyTextStyle(current, next));
            else onAdd(next);
          }}
          options={TEXT_STYLES.map((preset) => ({
            value: preset.id,
            label: preset.name,
            drawing: <StyleDrawing style={preset.style} />,
          }))}
        />
        {item ? null : (
          <p className={NOTE} data-testid="clip-text-none">
            {NOTHING_SELECTED}
          </p>
        )}
      </div>

      {item ? (
        <SelectedText
          key={item.id}
          item={item}
          idKey={id}
          totalMs={totalMs}
          fps={fps}
          recent={recent}
          onRecent={onRecent}
          emojiDropped={emojiDropped}
          onEmoji={onEmoji}
          onEdit={onEdit}
          onTiming={onTiming}
          onAnchor={onAnchor}
          onRemove={onRemove}
        />
      ) : null}
    </div>
  );
}

function SelectedText({
  item,
  idKey,
  totalMs,
  fps,
  recent,
  onRecent,
  emojiDropped,
  onEmoji,
  onEdit,
  onTiming,
  onAnchor,
  onRemove,
}: Omit<TextPanelProps, 'item' | 'onAdd'> & { item: TextItem; idKey: string }) {
  const { style } = item;
  const weightId = useId();
  const backingId = useId();
  const alignId = useId();
  const caseId = useId();
  const fadeId = useId();
  const shadowId = useId();
  const fontId = useId();
  const wordsId = useId();

  // The words as typed here: an emptied box is kept on screen without emptying the text.
  const [words, setWords] = useState(item.text);
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    if (!typing) setWords(item.text);
  }, [item.text, typing]);

  const weights = familyWeights(FONT_MANIFEST, style.font);
  const missing = missingCharacters(item.text, style.font, style.weight, FONT_MANIFEST);
  const scale = item.transform.scale;
  const shownSize = Math.round(style.size * scale);
  const backing = backingOf(style);

  const editStyle = (change: Partial<TextStyle>, key?: string) =>
    onEdit((current) => ({ ...current, style: { ...current.style, ...change } }), key);

  const chooseBacking = (next: Backing) => {
    if (next === 'none') editStyle({ outline: null, background: null });
    else if (next === 'outline')
      editStyle({ outline: { colour: '#111111', width: 5 }, background: null });
    else
      editStyle({
        outline: null,
        background: { colour: '#FFFFFF', opacity: 1, radius: 0, pad: 18 },
      });
  };

  return (
    <>
      <PanelSection title="Words">
        <Textarea
          id={wordsId}
          aria-label="Words"
          placeholder="Enter your text"
          value={words}
          maxLength={TEXT_MAX}
          rows={3}
          onFocus={() => setTyping(true)}
          onBlur={() => {
            setTyping(false);
            setWords(item.text);
          }}
          onChange={(event) => {
            let next = event.target.value;
            if (hasEmoji(next)) {
              next = stripEmoji(next);
              onEmoji();
            }
            setWords(next);
            if (next.trim() !== '' && next !== item.text) {
              onEdit((current) => ({ ...current, text: next }), `words:${idKey}`);
            }
          }}
        />
        {emojiDropped ? (
          <p className={NOTE} role="status" data-testid="clip-text-emoji">
            {EMOJI_SENTENCE}
          </p>
        ) : null}
        {missing.length > 0 ? (
          <Alert variant="warning" className="items-start" data-testid="clip-text-missing">
            <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            <p className="m-0 min-w-0 flex-1">
              {`This font cannot draw ${missing.join(' ')}. Choose another font or take ${missing.length === 1 ? 'it' : 'them'} out.`}
            </p>
          </Alert>
        ) : null}
      </PanelSection>

      <PanelSection title="Font">
        <div className="flex flex-col gap-3">
          <FontSelect
            id={fontId}
            label="Font"
            value={fontIdOf(style.font)}
            only={CLIP_FONT_IDS}
            onChange={(next) => {
              if (!next) return;
              const family = FONTS[next].family;
              const weight =
                nearestWeight(familyWeights(FONT_MANIFEST, family), style.weight) ?? style.weight;
              editStyle({ font: family, weight });
            }}
          />
          <div className="flex flex-col gap-1">
            <GroupLabel id={weightId}>Weight</GroupLabel>
            <Select
              value={String(nearestWeight(weights, style.weight) ?? style.weight)}
              disabled={weights.length < 2}
              onValueChange={(next) => editStyle({ weight: Number(next) })}
            >
              <SelectTrigger aria-labelledby={weightId}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(weights.length > 0 ? weights : [style.weight]).map((weight) => (
                  <SelectItem key={weight} value={String(weight)}>
                    {WEIGHT_NAMES[weight] ?? String(weight)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <PixelSlider
            label="Size"
            value={shownSize}
            min={SIZE_MIN}
            max={SIZE_MAX}
            onChange={(next) =>
              editStyle(
                { size: Math.min(400, Math.max(8, Math.round((next / scale) * 100) / 100)) },
                `size:${idKey}`,
              )
            }
          />
          <ColorPicker
            label="Text Colour"
            value={style.colour}
            recent={recent}
            onChange={(hex) => editStyle({ colour: hex }, `colour:${idKey}`)}
            onCommit={(hex) => {
              editStyle({ colour: hex }, `colour:${idKey}`);
              onRecent(hex);
            }}
          />
        </div>
      </PanelSection>

      <PanelSection title="Backing" headingId={backingId}>
        <Segmented<Backing>
          labelledBy={backingId}
          value={backing}
          onValueChange={chooseBacking}
          options={[
            { value: 'none', label: 'None' },
            { value: 'outline', label: 'Outline' },
            { value: 'box', label: 'Box' },
          ]}
        />
        {style.outline ? (
          <div className="flex flex-col gap-3">
            <ColorPicker
              label="Outline Colour"
              value={style.outline.colour}
              recent={recent}
              onChange={(hex) =>
                onEdit(
                  (current) =>
                    current.style.outline
                      ? {
                          ...current,
                          style: {
                            ...current.style,
                            outline: { ...current.style.outline, colour: hex },
                          },
                        }
                      : current,
                  `outline:${idKey}`,
                )
              }
              onCommit={onRecent}
            />
            <PixelSlider
              label="Outline Width"
              value={Math.round(style.outline.width)}
              min={1}
              max={20}
              onChange={(width) =>
                onEdit(
                  (current) =>
                    current.style.outline
                      ? {
                          ...current,
                          style: { ...current.style, outline: { ...current.style.outline, width } },
                        }
                      : current,
                  `outline-width:${idKey}`,
                )
              }
            />
          </div>
        ) : null}
        {style.background ? (
          <div className="flex flex-col gap-3">
            <ColorPicker
              label="Box Colour"
              value={style.background.colour}
              recent={recent}
              opacity={style.background.opacity}
              onChange={(hex) =>
                onEdit(
                  (current) =>
                    current.style.background
                      ? {
                          ...current,
                          style: {
                            ...current.style,
                            background: { ...current.style.background, colour: hex },
                          },
                        }
                      : current,
                  `box:${idKey}`,
                )
              }
              onCommit={onRecent}
              onOpacityChange={(opacity) =>
                onEdit(
                  (current) =>
                    current.style.background
                      ? {
                          ...current,
                          style: {
                            ...current.style,
                            background: { ...current.style.background, opacity },
                          },
                        }
                      : current,
                  `box-opacity:${idKey}`,
                )
              }
            />
            <PixelSlider
              label="Padding"
              value={Math.round(style.background.pad ?? 18)}
              min={0}
              max={60}
              onChange={(pad) =>
                onEdit(
                  (current) =>
                    current.style.background
                      ? {
                          ...current,
                          style: {
                            ...current.style,
                            background: { ...current.style.background, pad },
                          },
                        }
                      : current,
                  `box-pad:${idKey}`,
                )
              }
            />
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <GroupLabel id={shadowId}>Shadow</GroupLabel>
          <Toggle
            aria-labelledby={shadowId}
            checked={style.shadow}
            onCheckedChange={(shadow) => editStyle({ shadow })}
          />
        </div>
      </PanelSection>

      <PanelSection title="Layout">
        <div className="flex flex-col gap-2">
          <GroupLabel id={alignId}>Alignment</GroupLabel>
          <Segmented<TextStyle['align']>
            labelledBy={alignId}
            value={style.align}
            onValueChange={(align) => editStyle({ align })}
            options={[
              { value: 'left', label: 'Left' },
              { value: 'center', label: 'Centre' },
              { value: 'right', label: 'Right' },
            ]}
          />
        </div>
        <div className="flex flex-col gap-2">
          <GroupLabel id={caseId}>Letter Case</GroupLabel>
          <Segmented<'typed' | 'upper'>
            labelledBy={caseId}
            value={style.uppercase ? 'upper' : 'typed'}
            onValueChange={(next) => editStyle({ uppercase: next === 'upper' })}
            options={[
              { value: 'typed', label: 'As Typed' },
              { value: 'upper', label: 'Upper Case' },
            ]}
          />
        </div>
        <div className="flex flex-col gap-2">
          <GroupLabel id={fadeId}>Fade</GroupLabel>
          <Segmented<FadeChoice>
            labelledBy={fadeId}
            value={fadeOf(item)}
            onValueChange={(choice) =>
              onEdit((current) => ({
                ...current,
                fadeInMs: TEXT_FADES[choice],
                fadeOutMs: TEXT_FADES[choice],
              }))
            }
            options={[
              { value: 'none', label: 'None' },
              { value: 'short', label: 'Short' },
              { value: 'long', label: 'Long' },
            ]}
          />
        </div>
        <PercentSlider
          label="Opacity"
          value={Math.round(item.transform.opacity * 100)}
          onValueChange={(percent) =>
            onEdit(
              (current) => ({
                ...current,
                transform: { ...current.transform, opacity: percent / 100 },
              }),
              `opacity:${idKey}`,
            )
          }
        />
      </PanelSection>

      <WhenItShows
        item={item}
        totalMs={totalMs}
        fps={fps}
        onTiming={onTiming}
        onAnchor={onAnchor}
      />

      <Button variant="danger" className="w-full" onClick={onRemove}>
        Remove Text
      </Button>
    </>
  );
}
