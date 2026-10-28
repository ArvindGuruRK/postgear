'use client';

/**
 * The Element tab of the editor's properties panel (Sprint 9, DS-4.2 and
 * DS-4.4 to DS-4.7): the element selected on the canvas, with only the
 * options its template gives it.
 *
 * - Nothing selected: the slide's elements as a list to pick from, each with
 *   its first words and a mark when its text is too long for its space.
 * - Text: a field that edits the same words as the canvas, with the length
 *   the slot is written for as a hint. A brand name or a handle is one line,
 *   the same on every slide; a slide number is counted, so it has no field.
 * - A list: one row per item, Add Item up to the slot's limit and a remove
 *   button per row. A list keeps at least one row.
 * - Size, alignment and colour where the slot offers them. A colour that does
 *   not read on its background says so, with Fix Contrast.
 * - Font, for an element with words (Sprint 9b): its own family over the
 *   design's, or Design Font to follow the design again.
 * - A picture: its preview and name, with Choose, Replace and Remove. A logo
 *   uses the brand kit's logo first. A picture deleted from the media library
 *   says so, with the way to choose another (section 5).
 * - Hide (optional elements), Reset Position (after a nudge), and Reset
 *   Style, which puts back the template's look and keeps the words and
 *   picture: an emptied headline is not what "reset" promises.
 *
 * While the brand kit locks the design's look (`useBrandLookLocked`), the
 * Font field, Custom's swatch and hex field and the logo's Choose From Media
 * are left out, and one sentence says what the kit keeps.
 *
 * Every edit is a function of the design as it is when it lands, and typing
 * is one undo step per burst, as on the canvas. A choice made here that
 * swaps the view (an element from the list, All Elements, Hide) takes the
 * keyboard focus along, so nobody is dropped back at the top of the page.
 */
import { AlignCenterIcon } from '@animateicons/react/lucide/align-center-icon';
import { AlignLeftIcon } from '@animateicons/react/lucide/align-left-icon';
import { AlignRightIcon } from '@animateicons/react/lucide/align-right-icon';
import { ArrowLeftIcon } from '@animateicons/react/lucide/arrow-left-icon';
import { ContrastIcon } from '@animateicons/react/lucide/contrast-icon';
import { EyeOffIcon } from '@animateicons/react/lucide/eye-off-icon';
import { ImagePlusIcon } from '@animateicons/react/lucide/image-plus-icon';
import { MoveIcon } from '@animateicons/react/lucide/move-icon';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { RotateCcwIcon } from '@animateicons/react/lucide/rotate-ccw-icon';
import { StampIcon } from '@animateicons/react/lucide/stamp-icon';
import { XIcon } from '@animateicons/react/lucide/x-icon';
import {
  type Align,
  type DesignDocument,
  type DesignSlide,
  findSlot,
  inkOf,
  logoPlacements,
  MAX_BRAND_NAME_LENGTH,
  MAX_HANDLE_LENGTH,
  MAX_TEXT_LENGTH,
  type SizeStep,
  type SlideLayout,
  type SlotDef,
  type SlotId,
  setElementFont,
  setLogoPlacement,
  slotPlacement,
  slotText,
  updateElement,
} from '@postgear/design-engine';
import {
  Alert,
  AlertDescription,
  Button,
  cn,
  FormField,
  FormHelperText,
  FormLabel,
  Input,
  MotionIcon,
  pressSm,
  Textarea,
  TooltipHint,
} from '@postgear/ui';
import { TriangleAlert } from 'lucide-react';
import { type RefObject, useEffect, useId, useRef } from 'react';
import type { StudioMediaRef } from '@/types/studio';
import { FOCUS } from './design-card';
import type { MediaPurpose } from './editor-panel';
import {
  alignOf,
  CUSTOM_COLOR,
  canResetElement,
  clip,
  colorChoiceOf,
  customColorOf,
  elementFontOf,
  elementLockNote,
  elementPreview,
  elementSwatches,
  findSlide,
  lengthHint,
  listHint,
  listLimit,
  listRows,
  logoView,
  mediaOf,
  overflowAdvice,
  PLACEMENT_LABELS,
  shownSlots,
  sizeOf,
  takesFont,
  textRows,
  withAlign,
  withColorChoice,
  withContrastFixed,
  withCustomColor,
  withElementReset,
  withItemAdded,
  withItemRemoved,
  withListItem,
  withShown,
  withSize,
} from './editor-panel-model';
import { type ApplyChange, withText } from './editor-state';
import { FontSelect } from './font-select';
import {
  CustomColorField,
  GroupLabel,
  NOTE,
  PictureMissing,
  PictureRow,
  Segmented,
  type SegmentOption,
  SwatchPicker,
  useBrandLookLocked,
} from './panel-ui';

/** How much of an element's words its row in the list shows. */
const PREVIEW_CHARACTERS = 48;

/**
 * The comma that ends one part of a list row's name, so it reads "Brand
 * Name, Lotus Flow Yoga". Unseen, but inline in the text it follows: an
 * `sr-only` box is positioned, which counts as a block, and a name gets a
 * space before a block ("Brand Name , Lotus Flow Yoga").
 */
const NAME_COMMA = <span className="opacity-0">,</span>;

const SIZE_OPTIONS: readonly SegmentOption<SizeStep>[] = [
  { value: 'sm', label: 'Small', short: 'S' },
  { value: 'md', label: 'Medium', short: 'M' },
  { value: 'lg', label: 'Large', short: 'L' },
];

const ALIGN_OPTIONS: readonly SegmentOption<Align>[] = [
  { value: 'start', label: 'Left', icon: AlignLeftIcon },
  { value: 'center', label: 'Centre', icon: AlignCenterIcon },
  { value: 'end', label: 'Right', icon: AlignRightIcon },
];

const ICON = 'h-4 w-4';

export interface ElementPanelProps {
  document: DesignDocument;
  /** The slide on the canvas. */
  slideId: string;
  selected: SlotId | null;
  /** Elements on this slide still too long at their smallest size. */
  overflow: readonly SlotId[];
  /** Every picture the design draws, by media id; a missing id is a deleted picture. */
  media: Readonly<Record<string, StudioMediaRef>>;
  onSelect: (slot: SlotId | null) => void;
  onChange: ApplyChange;
  onPickMedia: (purpose: MediaPurpose) => void;
}

/** Where the keyboard focus goes once the panel has redrawn after a choice made in it. */
type FocusRequest = { to: 'editor' } | { to: 'list'; slot: SlotId | null };

/** The Element tab: the list of elements, or the one selected. */
export function ElementPanel({
  document,
  slideId,
  selected,
  overflow,
  media,
  onSelect,
  onChange,
  onPickMedia,
}: ElementPanelProps) {
  const request = useRef<FocusRequest | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLUListElement>(null);

  // After every render, cheap when nothing was asked for. Only the panel's
  // own choices ask: a selection made on the canvas leaves the focus there.
  useEffect(() => {
    const next = request.current;
    if (!next) return;
    request.current = null;

    if (next.to === 'editor') {
      heading.current?.focus();
      return;
    }
    const rows = Array.from(
      list.current?.querySelectorAll<HTMLButtonElement>('button[data-element]') ?? [],
    );
    (rows.find((row) => row.dataset.element === next.slot) ?? rows[0])?.focus();
  });

  const found = findSlide(document, slideId);
  if (!found) return <p className={NOTE}>This slide is no longer in the design.</p>;

  const { slide, index, layout } = found;
  if (!layout) {
    return (
      <p className={NOTE}>
        The layout of this slide is not available. Choose another one in the Slide tab.
      </p>
    );
  }

  const slot = selected ? findSlot(layout, selected) : null;

  if (!slot || slide.elements[slot.id]?.hidden) {
    return (
      <ElementList
        document={document}
        slide={slide}
        index={index}
        layout={layout}
        overflow={overflow}
        listRef={list}
        onPick={(slotId) => {
          request.current = { to: 'editor' };
          onSelect(slotId);
        }}
      />
    );
  }

  return (
    <ElementEditor
      key={`${slide.id}:${slot.id}`}
      document={document}
      slide={slide}
      index={index}
      slot={slot}
      tooLong={overflow.includes(slot.id)}
      media={media}
      headingRef={heading}
      onBack={() => {
        request.current = { to: 'list', slot: slot.id };
        onSelect(null);
      }}
      onHide={() => {
        request.current = { to: 'list', slot: null };
        onChange((latest) => withShown(latest, slide.id, slot.id, false), { select: null });
      }}
      onChange={onChange}
      onPickMedia={onPickMedia}
    />
  );
}

// ---------------------------------------------------------------------------
// Nothing selected
// ---------------------------------------------------------------------------

/** The slide's elements, to pick one from: the panel's way in for a keyboard or a screen reader. */
function ElementList({
  document,
  slide,
  index,
  layout,
  overflow,
  listRef,
  onPick,
}: {
  document: DesignDocument;
  slide: DesignSlide;
  index: number;
  layout: SlideLayout;
  overflow: readonly SlotId[];
  listRef: RefObject<HTMLUListElement | null>;
  onPick: (slot: SlotId) => void;
}) {
  const slots = shownSlots(layout, slide);

  return (
    <div className="flex flex-col gap-3">
      <p className={NOTE}>Select an element on the slide to edit it.</p>
      {slots.length > 0 ? (
        <ul ref={listRef} aria-label="Elements" className="m-0 flex list-none flex-col gap-2 p-0">
          {slots.map((slot) => {
            const preview = clip(elementPreview(document, index, slot), PREVIEW_CHARACTERS);
            const tooLong = overflow.includes(slot.id);

            return (
              <li key={slot.id}>
                <button
                  type="button"
                  data-element={slot.id}
                  onClick={() => onPick(slot.id)}
                  className={cn(
                    'flex w-full min-w-0 items-center gap-3 rounded-md border-2 border-outline bg-secondary px-3 py-2 text-left',
                    pressSm,
                    FOCUS,
                  )}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="type-ui text-sm text-ink">
                      {slot.label}
                      {preview || tooLong ? NAME_COMMA : null}
                    </span>
                    {preview ? (
                      <span className="truncate font-sans text-xs text-ink type-muted">
                        {preview}
                        {tooLong ? NAME_COMMA : null}
                      </span>
                    ) : null}
                  </span>
                  {tooLong ? (
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-outline bg-actionAccent text-onActionLight">
                      <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.5} />
                      <span className="sr-only">too long for its space</span>
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={NOTE}>Every element on this slide is hidden. Show one in the Slide tab.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One element
// ---------------------------------------------------------------------------

interface EditorProps {
  document: DesignDocument;
  slide: DesignSlide;
  index: number;
  slot: SlotDef;
  tooLong: boolean;
  media: Readonly<Record<string, StudioMediaRef>>;
  headingRef: RefObject<HTMLHeadingElement | null>;
  onBack: () => void;
  onHide: () => void;
  onChange: ApplyChange;
  onPickMedia: (purpose: MediaPurpose) => void;
}

/** The selected element: its name, then only the options its slot offers. */
function ElementEditor({
  document,
  slide,
  index,
  slot,
  tooLong,
  media,
  headingRef,
  onBack,
  onHide,
  onChange,
  onPickMedia,
}: EditorProps) {
  const sizeId = useId();
  const alignId = useId();
  const fontId = useId();
  const locked = useBrandLookLocked();
  const slideId = slide.id;
  const slotId = slot.id;
  const state = slide.elements[slotId];
  const hasWords = takesFont(slot);
  const resettable = canResetElement(state);
  const lockNote = locked ? elementLockNote(slot) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3
          ref={headingRef}
          tabIndex={-1}
          className={cn('m-0 min-w-0 type-heading text-base text-ink', FOCUS)}
        >
          {slot.label}
        </h3>
        <Button variant="secondary" size="sm" onClick={onBack}>
          <MotionIcon icon={ArrowLeftIcon} className={ICON} />
          All Elements
        </Button>
      </div>

      {slot.kind === 'text' ? (
        <TextField
          document={document}
          slide={slide}
          index={index}
          slot={slot}
          onChange={onChange}
        />
      ) : null}
      {slot.kind === 'list' ? <ListField slide={slide} slot={slot} onChange={onChange} /> : null}

      {hasWords && tooLong ? (
        <Alert variant="warning" role="status" className="flex-col gap-1">
          <AlertDescription>This text is too long for this space.</AlertDescription>
          <AlertDescription>{overflowAdvice(slot, state)}</AlertDescription>
        </Alert>
      ) : null}

      {slot.kind === 'image' ? (
        <ImageField
          slide={slide}
          slot={slot}
          media={media}
          onChange={onChange}
          onPickMedia={onPickMedia}
        />
      ) : null}
      {slot.kind === 'logo' ? (
        <LogoField
          document={document}
          slide={slide}
          slot={slot}
          media={media}
          onChange={onChange}
          onPickMedia={onPickMedia}
        />
      ) : null}

      {slot.resizable ? (
        <div className="flex flex-col gap-2">
          <GroupLabel id={sizeId}>Size</GroupLabel>
          <Segmented
            labelledBy={sizeId}
            options={SIZE_OPTIONS}
            value={sizeOf(state)}
            onValueChange={(size) => onChange((latest) => withSize(latest, slideId, slotId, size))}
          />
        </div>
      ) : null}

      {slot.alignable ? (
        <div className="flex flex-col gap-2">
          <GroupLabel id={alignId}>Alignment</GroupLabel>
          <Segmented
            labelledBy={alignId}
            options={ALIGN_OPTIONS}
            value={alignOf(slot, state)}
            onValueChange={(align) =>
              onChange((latest) => withAlign(latest, slideId, slotId, align))
            }
          />
        </div>
      ) : null}

      {hasWords && !locked ? (
        <FormField>
          <FormLabel htmlFor={fontId}>Font</FormLabel>
          <FontSelect
            id={fontId}
            value={elementFontOf(state)}
            defaultLabel="Design Font"
            onChange={(font) => onChange((latest) => setElementFont(latest, slideId, slotId, font))}
          />
        </FormField>
      ) : null}

      {slot.colorable && hasWords ? (
        <ColorChoice document={document} slide={slide} slot={slot} onChange={onChange} />
      ) : null}

      {lockNote ? <p className={NOTE}>{lockNote}</p> : null}

      <div className="flex flex-wrap gap-2">
        {slot.optional ? (
          <Button variant="secondary" size="sm" onClick={onHide}>
            <MotionIcon icon={EyeOffIcon} className={ICON} />
            Hide
          </Button>
        ) : null}
        {state?.offset ? (
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              onChange((latest) => updateElement(latest, slideId, slotId, { offset: undefined }))
            }
          >
            <MotionIcon icon={MoveIcon} className={ICON} />
            Reset Position
          </Button>
        ) : null}
        <TooltipHint
          label={
            resettable
              ? 'Puts back the font, size, alignment, colour and place its template gives it. The words stay.'
              : 'This element already looks the way its template draws it.'
          }
          disabled={!resettable}
        >
          <Button
            variant="secondary"
            size="sm"
            disabled={!resettable}
            onClick={() => onChange((latest) => withElementReset(latest, slideId, slotId))}
          >
            <MotionIcon icon={RotateCcwIcon} className={ICON} />
            Reset Style
          </Button>
        </TooltipHint>
      </div>
    </div>
  );
}

/**
 * The words of a text element. A brand name or a handle is one line shared
 * by every slide; a slide number is counted, so there is nothing to type.
 */
function TextField({
  document,
  slide,
  index,
  slot,
  onChange,
}: {
  document: DesignDocument;
  slide: DesignSlide;
  index: number;
  slot: SlotDef;
  onChange: ApplyChange;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const slideId = slide.id;
  const slotId = slot.id;

  if (slot.bind === 'slideNumber') {
    return <p className={NOTE}>Slide numbers are counted for you.</p>;
  }

  const value = slotText(document, index, slot);
  const type = (text: string) =>
    onChange((latest) => withText(latest, slideId, slotId, text), {
      coalesceKey: `text:${slideId}:${slotId}`,
    });

  if (slot.bind === 'brandName' || slot.bind === 'handle') {
    const handle = slot.bind === 'handle';
    return (
      <FormField>
        <FormLabel htmlFor={id}>{handle ? 'Handle' : 'Brand name'}</FormLabel>
        <Input
          id={id}
          value={value}
          onChange={(event) => type(event.target.value)}
          maxLength={handle ? MAX_HANDLE_LENGTH : MAX_BRAND_NAME_LENGTH}
          placeholder={handle ? 'Enter your handle' : 'Enter your brand name'}
          autoComplete="off"
          spellCheck={!handle}
          aria-describedby={hintId}
        />
        <FormHelperText id={hintId}>The same on every slide.</FormHelperText>
      </FormField>
    );
  }

  const recommended = slot.recommendedChars;
  return (
    <FormField>
      <FormLabel htmlFor={id}>Text</FormLabel>
      <Textarea
        id={id}
        value={value}
        rows={textRows(recommended)}
        maxLength={MAX_TEXT_LENGTH}
        onChange={(event) => type(event.target.value)}
        placeholder="Enter your text"
        aria-describedby={recommended ? hintId : undefined}
        className="resize-y"
      />
      {recommended ? (
        <FormHelperText id={hintId}>{lengthHint(value, recommended)}</FormHelperText>
      ) : null}
    </FormField>
  );
}

/**
 * A list's items, one row each (DS-4.2). Add Item stops at the slot's limit
 * and says why; the last row cannot be removed. Typing in a row is one undo
 * step per burst; adding or removing a row is a step of its own.
 */
function ListField({
  slide,
  slot,
  onChange,
}: {
  slide: DesignSlide;
  slot: SlotDef;
  onChange: ApplyChange;
}) {
  const labelId = useId();
  const hintId = useId();
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const focusRow = useRef<number | null>(null);
  const slideId = slide.id;
  const slotId = slot.id;
  const rows = listRows(slide.elements[slotId]);
  const limit = listLimit(slot);
  const full = rows.length >= limit;
  const single = rows.length <= 1;
  const recommended = slot.recommendedChars;

  // A row just added, or the one that took a removed row's place, takes the focus.
  useEffect(() => {
    if (focusRow.current === null) return;
    inputs.current[focusRow.current]?.focus();
    focusRow.current = null;
  });

  return (
    <div className="flex flex-col gap-2">
      <GroupLabel id={labelId}>Items</GroupLabel>
      {recommended ? <FormHelperText id={hintId}>{listHint(recommended)}</FormHelperText> : null}
      <ol aria-labelledby={labelId} className="m-0 flex list-none flex-col gap-2 p-0">
        {rows.map((row, at) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: items have no ids of their own; a row is its place in the list
          <li key={at} className="flex min-w-0 items-center gap-2">
            <Input
              ref={(node) => {
                inputs.current[at] = node;
              }}
              value={row}
              aria-label={`Item ${at + 1}`}
              aria-describedby={recommended ? hintId : undefined}
              maxLength={MAX_TEXT_LENGTH}
              placeholder="Enter your item"
              onChange={(event) => {
                const text = event.target.value;
                onChange((latest) => withListItem(latest, slideId, slotId, at, text), {
                  coalesceKey: `list:${slideId}:${slotId}`,
                });
              }}
              className="min-w-0 flex-1"
            />
            <TooltipHint label="A list keeps at least one item." hidden={!single} disabled={single}>
              <Button
                variant="secondary"
                size="sm"
                aria-label={`Remove item ${at + 1}`}
                disabled={single}
                onClick={() => {
                  focusRow.current = Math.min(at, rows.length - 2);
                  onChange((latest) => withItemRemoved(latest, slideId, slotId, at));
                }}
                className="h-11 w-11 shrink-0 px-0"
              >
                <MotionIcon icon={XIcon} className={ICON} />
              </Button>
            </TooltipHint>
          </li>
        ))}
      </ol>
      <TooltipHint
        label={`This list can have up to ${limit} items.`}
        hidden={!full}
        disabled={full}
        triggerClassName="self-start"
      >
        <Button
          variant="secondary"
          size="sm"
          disabled={full}
          onClick={() => {
            focusRow.current = rows.length;
            onChange((latest) => withItemAdded(latest, slideId, slotId));
          }}
          className="self-start"
        >
          <MotionIcon icon={PlusIcon} className={ICON} />
          Add Item
        </Button>
      </TooltipHint>
    </div>
  );
}

/**
 * An element's colour (DS-4.5): Auto, the brand's five, Custom (a hex, one
 * click deeper), and the theme's light or dark text when Fix Contrast chose
 * one. Below readable contrast the panel says so and offers the fix.
 */
function ColorChoice({
  document,
  slide,
  slot,
  onChange,
}: {
  document: DesignDocument;
  slide: DesignSlide;
  slot: SlotDef;
  onChange: ApplyChange;
}) {
  const labelId = useId();
  const locked = useBrandLookLocked();
  const slideId = slide.id;
  const slotId = slot.id;
  const state = slide.elements[slotId];
  const choice = colorChoiceOf(state);
  const ink = inkOf(document, slide, slotId);

  return (
    <div className="flex flex-col gap-3">
      <GroupLabel id={labelId}>Colour</GroupLabel>
      <SwatchPicker
        labelledBy={labelId}
        options={elementSwatches(document, slide, slot, { custom: !locked })}
        value={choice}
        onValueChange={(next) =>
          onChange((latest) => withColorChoice(latest, slideId, slotId, next))
        }
      />
      {choice === CUSTOM_COLOR && !locked ? (
        <CustomColorField
          value={customColorOf(state)}
          onApply={(hex) =>
            onChange((latest) => withCustomColor(latest, slideId, slotId, hex), {
              coalesceKey: `color:${slideId}:${slotId}`,
            })
          }
        />
      ) : null}
      {ink && !ink.readable ? (
        <Alert variant="warning" role="status" className="flex-wrap items-center justify-between">
          <AlertDescription>This text is hard to read on this background.</AlertDescription>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onChange((latest) => withContrastFixed(latest, slideId, slotId))}
          >
            <MotionIcon icon={ContrastIcon} className={ICON} />
            Fix Contrast
          </Button>
        </Alert>
      ) : null}
    </div>
  );
}

/** A picture slot: the picture with its name, or the way to choose one (DS-4.6). */
function ImageField({
  slide,
  slot,
  media,
  onChange,
  onPickMedia,
}: {
  slide: DesignSlide;
  slot: SlotDef;
  media: Readonly<Record<string, StudioMediaRef>>;
  onChange: ApplyChange;
  onPickMedia: (purpose: MediaPurpose) => void;
}) {
  const slideId = slide.id;
  const slotId = slot.id;
  const mediaId = slide.elements[slotId]?.mediaId ?? null;
  const picture = mediaOf(media, mediaId);
  const choose = () => onPickMedia({ kind: 'image', slideId, slot: slotId });

  if (mediaId && !picture) {
    return (
      <PictureMissing>
        <Button variant="secondary" size="sm" onClick={choose}>
          <MotionIcon icon={ImagePlusIcon} className={ICON} />
          Choose Image
        </Button>
      </PictureMissing>
    );
  }

  if (!picture) {
    return (
      <div className="flex flex-col gap-3">
        <p className={NOTE}>No picture yet. Choose one from your media library.</p>
        <Button variant="secondary" size="sm" onClick={choose} className="self-start">
          <MotionIcon icon={ImagePlusIcon} className={ICON} />
          Choose Image
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <PictureRow url={picture.thumbnailUrl ?? picture.url} name={picture.name} />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={choose}>
          <MotionIcon icon={ImagePlusIcon} className={ICON} />
          Replace Image
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            onChange((latest) => updateElement(latest, slideId, slotId, { mediaId: null }))
          }
        >
          <MotionIcon icon={XIcon} className={ICON} />
          Remove Image
        </Button>
      </div>
    </div>
  );
}

/**
 * The logo (DS-4.6): the brand kit's logo first, then the media library, and
 * header, centre or footer where the template has room for it.
 */
function LogoField({
  document,
  slide,
  slot,
  media,
  onChange,
  onPickMedia,
}: {
  document: DesignDocument;
  slide: DesignSlide;
  slot: SlotDef;
  media: Readonly<Record<string, StudioMediaRef>>;
  onChange: ApplyChange;
  onPickMedia: (purpose: MediaPurpose) => void;
}) {
  const placementId = useId();
  // A kit that locks the look keeps its own logo: no other is offered.
  const locked = useBrandLookLocked();
  const slideId = slide.id;
  const slotId = slot.id;
  const state = slide.elements[slotId];
  const view = logoView(document, state);
  const picture = mediaOf(media, view.mediaId);
  const missing = view.mediaId !== null && !picture;
  const placements = logoPlacements(slot);
  const placement = slotPlacement(slot, state).placement;
  const choose = () => onPickMedia({ kind: 'logo', slideId });

  const chooseButton = locked ? null : (
    <Button variant="secondary" size="sm" onClick={choose}>
      <MotionIcon icon={ImagePlusIcon} className={ICON} />
      Choose From Media
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      {view.mediaId === null ? (
        <p className={NOTE}>
          {locked
            ? 'This brand kit has no logo yet.'
            : 'There is no logo yet. Apply a brand kit with a logo in the Design tab, or choose one from your media library.'}
        </p>
      ) : picture ? (
        <PictureRow
          url={picture.thumbnailUrl ?? picture.url}
          name={picture.name}
          fit="contain"
          note={view.fromBrand ? 'Your brand logo' : undefined}
        />
      ) : (
        <PictureMissing>{chooseButton}</PictureMissing>
      )}

      {view.canUseBrand || (!missing && chooseButton) ? (
        <div className="flex flex-wrap gap-2">
          {view.canUseBrand ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                onChange((latest) => updateElement(latest, slideId, slotId, { mediaId: undefined }))
              }
            >
              <MotionIcon icon={StampIcon} className={ICON} />
              Use Brand Logo
            </Button>
          ) : null}
          {missing ? null : chooseButton}
        </div>
      ) : null}

      {placements.length > 1 && placement ? (
        <div className="flex flex-col gap-2">
          <GroupLabel id={placementId}>Placement</GroupLabel>
          <Segmented
            labelledBy={placementId}
            options={placements.map((value) => ({ value, label: PLACEMENT_LABELS[value] }))}
            value={placement}
            onValueChange={(next) => onChange((latest) => setLogoPlacement(latest, slideId, next))}
          />
        </div>
      ) : null}
    </div>
  );
}
