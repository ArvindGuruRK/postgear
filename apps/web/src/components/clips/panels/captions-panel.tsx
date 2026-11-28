'use client';

/**
 * The Captions tab (Sprint 13, Module 03), between Audio and Export.
 *
 * **Before a clip has captions:** pick a style, pick the spoken language
 * (Detect Automatically by default), then Add Captions, which says its price
 * in AI minutes on the button (nothing when the clip's part of the video was
 * already listened to), or Upload A Captions File (SRT or VTT, free). While
 * the clip is being listened to the tab shows how far it is, and the rest of
 * the editor keeps working. With the AI service off the tab says so and the
 * file upload still works.
 *
 * **With captions:** the style tiles (the six built in and the workspace's
 * own, with Create A Style), Size, Words At Once, Letters, the Highlight
 * Colour, where the block sits (three named places and a slider) with the
 * Safe Area Guide, the words to fix in place (`caption-words.tsx`),
 * Translate, and Remove Captions.
 *
 * Like every tab, the panel never edits the document: each change goes up as
 * a new captions track and is one undo step; a slider passes a coalesce key
 * so its whole drag is one step.
 */
import { LanguagesIcon } from '@animateicons/react/lucide/languages-icon';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import { UploadIcon } from '@animateicons/react/lucide/upload-icon';
import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  ChoiceTiles,
  ColorPicker,
  MotionIcon,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Spinner,
  Toggle,
} from '@postgear/ui';
import {
  CAPTION_STYLES,
  type CaptionCase,
  type CaptionLayout,
  type CaptionLook,
  type CaptionsTrack,
  DEFAULT_CAPTION_STYLE,
  languageName,
  TRANSCRIPT_LANGUAGES,
} from '@postgear/video-engine';
import { Info, TriangleAlert } from 'lucide-react';
import { useId, useMemo, useRef, useState } from 'react';
import { GroupLabel, NOTE, PanelSection } from '@/components/studio/panel-ui';
import type { CaptionStyleView } from '@/types/clips';
import { WaitingNote } from '../waiting-note';
import { queuedOr } from '../waiting-words';
import { CaptionStyleDialog } from './caption-style-dialog';
import { CaptionStyleDrawing } from './caption-style-tile';
import { CaptionWords } from './caption-words';
import {
  CAPTION_EDITS_FULL,
  CAPTIONS_FILE_HINT,
  CAPTIONS_FILE_TYPES,
  CAPTIONS_GONE,
  CAPTIONS_LISTENING,
  CAPTIONS_OFF,
  CAPTIONS_PAGE_ONLY,
  CASE_OPTIONS,
  LANGUAGE_AUTO,
  LANGUAGE_AUTO_NAME,
  lookFromTrack,
  lookOf,
  PLACE_OPTIONS,
  placeOf,
  pricedLabel,
  SIZE_RANGE,
  styleIsGone,
  WORDS_RANGE,
  withCase,
  withMarkColour,
  withMaxWords,
  withPlace,
  withSize,
  withStyle,
  withWordEdit,
  wordGroups,
} from './captions-model';
import type { CaptionsState } from './use-captions';

/** A change to the clip's captions track, and the key that makes a drag one undo step. */
export type CaptionsEdit = (
  change: (track: CaptionsTrack) => CaptionsTrack,
  coalesceKey?: string,
  /**
   * Module 11: the one track a word edit is for (word indexes belong to a
   * transcript). Left out, the change reaches every track of a montage.
   */
  trackId?: string,
) => void;

export interface CaptionsPanelProps {
  /** The clip's captions track, or null when it has none. */
  track: CaptionsTrack | null;
  /** The captions as the engine laid them out; null without a track or its words. */
  layout: CaptionLayout | null;
  captions: CaptionsState;
  /** The clip's length in ms, for the Translate price. */
  translatePrice: number;
  /** Colours picked lately, newest first. */
  recent: readonly string[];
  onRecent: (hex: string) => void;
  safeArea: boolean;
  /** Null where the clip's shape has no guide (a wide clip). */
  onSafeArea: ((shown: boolean) => void) | null;
  onEdit: CaptionsEdit;
  onRemove: () => void;
  onSeek: (ms: number) => void;
  onNotice: (words: string) => void;
  /**
   * Module 11: a montage keeps the captions of its clips. Add, file and
   * Translate are off (the API refuses them); its style, size and place
   * still change through the document.
   */
  montage?: boolean;
}

export const MONTAGE_CAPTIONS_FIXED =
  'A montage keeps the captions of its clips. Change them in a clip, then make the montage again.';

/** The built-in styles as the API lists them, for before the list has loaded. */
const BUILT_IN: readonly CaptionStyleView[] = CAPTION_STYLES.map((style) => ({
  id: style.id,
  name: style.name,
  hint: style.hint,
  builtIn: true,
  look: style.look,
}));

function LabelledSlider({
  label,
  value,
  unit,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const id = useId();
  const text = unit ? `${value} ${unit}` : String(value);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <GroupLabel id={id}>{label}</GroupLabel>
        <span aria-hidden="true" className="font-sans text-xs tabular-nums text-ink type-muted">
          {text}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={1}
        thumbs={[{ 'aria-labelledby': id, 'aria-valuetext': text }]}
        onValueChange={([next]) => {
          if (next !== undefined) onChange(next);
        }}
      />
    </div>
  );
}

export function LanguageSelect({
  value,
  onChange,
  labelledBy,
  languages,
  auto,
  disabled,
}: {
  value: string;
  onChange: (code: string) => void;
  labelledBy: string;
  languages: ReadonlyArray<{ code: string; name: string }>;
  /** Offer Detect Automatically first. */
  auto: boolean;
  disabled?: boolean;
}) {
  return (
    <Select value={value} disabled={disabled} onValueChange={onChange}>
      <SelectTrigger aria-labelledby={labelledBy}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {auto ? <SelectItem value={LANGUAGE_AUTO}>{LANGUAGE_AUTO_NAME}</SelectItem> : null}
        {languages.map((language) => (
          <SelectItem key={language.code} value={language.code}>
            {language.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function StyleTiles({
  styles,
  value,
  labelledBy,
  onPick,
}: {
  styles: readonly CaptionStyleView[];
  value: string;
  labelledBy: string;
  onPick: (style: CaptionStyleView) => void;
}) {
  return (
    <ChoiceTiles<string>
      labelledBy={labelledBy}
      columns={2}
      value={value}
      onValueChange={(next) => {
        const style = styles.find((candidate) => candidate.id === next);
        if (style) onPick(style);
      }}
      options={styles.map((style) => ({
        value: style.id,
        label: style.name,
        // A fixed width: the tile wraps its drawing, and the words are sized from it.
        drawing: <CaptionStyleDrawing look={style.look} className="w-28 rounded-sm" />,
      }))}
    />
  );
}

export function CaptionsPanel({
  track,
  layout,
  captions,
  translatePrice,
  recent,
  onRecent,
  safeArea,
  onSafeArea,
  onEdit,
  onRemove,
  onSeek,
  onNotice,
  montage = false,
}: CaptionsPanelProps) {
  const stylesId = useId();
  const languageId = useId();
  const caseId = useId();
  const placeId = useId();
  const guideId = useId();
  const translateId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [pickedStyle, setPickedStyle] = useState<string>(DEFAULT_CAPTION_STYLE);
  const [language, setLanguage] = useState<string>(LANGUAGE_AUTO);
  const [target, setTarget] = useState<string>('');
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<CaptionStyleView | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const styles = captions.styles.length > 0 ? captions.styles : BUILT_IN;
  const languages = captions.ai?.languages ?? TRANSCRIPT_LANGUAGES;
  const serviceOn = captions.ai?.captions === true;
  const listening = captions.job !== null;
  const working = captions.busy !== null || listening;
  const options = { styleId: track?.styleId ?? pickedStyle, language };

  const look: CaptionLook | null = track ? lookOf(track.styleId, styles) : null;
  const groups = useMemo(
    () =>
      track && layout && captions.transcript ? wordGroups(layout, track, captions.transcript) : [],
    [track, layout, captions.transcript],
  );
  const shownLanguage = track?.language ?? '';
  const others = languages.filter((candidate) => candidate.code !== shownLanguage);
  const translateTo = others.some((candidate) => candidate.code === target)
    ? target
    : (others[0]?.code ?? '');

  const fileButton = (
    <>
      <input
        ref={fileInput}
        type="file"
        accept={CAPTIONS_FILE_TYPES}
        className="hidden"
        data-testid="clip-captions-file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) captions.upload(file, options);
        }}
      />
      <Button
        variant="secondary"
        className="w-full"
        disabled={working}
        onClick={() => fileInput.current?.click()}
      >
        <MotionIcon icon={UploadIcon} className="h-4 w-4" />
        {captions.busy === 'file' ? 'Reading The File...' : 'Upload A Captions File'}
      </Button>
      <p className={NOTE}>{CAPTIONS_FILE_HINT}</p>
    </>
  );

  const messages = (
    <>
      {captions.problem ? (
        <Alert variant="danger" className="items-center" data-testid="clip-captions-problem">
          <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">{captions.problem}</p>
          <Button variant="secondary" size="sm" onClick={captions.dismiss}>
            Close
          </Button>
        </Alert>
      ) : null}
      {captions.note ? (
        <Alert variant="info" className="items-center" data-testid="clip-captions-note">
          <Info className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">{captions.note}</p>
        </Alert>
      ) : null}
    </>
  );

  const montageLine = (
    <p className="m-0 font-sans text-sm text-ink type-muted" data-testid="clip-captions-montage">
      {MONTAGE_CAPTIONS_FIXED}
    </p>
  );

  // ---- No captions yet ---------------------------------------------------------------
  if (!track && montage) {
    return (
      <div className="flex flex-col gap-6 pt-1" data-testid="clip-captions-panel">
        {montageLine}
      </div>
    );
  }
  if (!track) {
    return (
      <div className="flex flex-col gap-6 pt-1" data-testid="clip-captions-panel">
        {messages}
        {captions.ai !== null && !serviceOn ? (
          <Alert variant="warning" className="items-center" data-testid="clip-captions-off">
            <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            <p className="m-0 min-w-0 flex-1">{CAPTIONS_OFF}</p>
          </Alert>
        ) : null}

        <div className="flex flex-col gap-2">
          <GroupLabel id={stylesId}>Style</GroupLabel>
          <StyleTiles
            styles={styles}
            value={pickedStyle}
            labelledBy={stylesId}
            onPick={(style) => setPickedStyle(style.id)}
          />
        </div>

        <div className="flex flex-col gap-1">
          <GroupLabel id={languageId}>Spoken Language</GroupLabel>
          <LanguageSelect
            value={language}
            onChange={setLanguage}
            labelledBy={languageId}
            languages={languages}
            auto
            disabled={working}
          />
        </div>

        {listening && captions.job ? (
          <div className="flex flex-col gap-2" data-testid="clip-captions-listening">
            <Progress tone="ai" value={captions.job.progress} aria-label="Listening to this clip" />
            <p className={NOTE} role="status">
              {queuedOr(captions.job, CAPTIONS_LISTENING)}
            </p>
            <WaitingNote job={captions.job} className={NOTE} />
            <Button variant="secondary" size="sm" onClick={captions.cancelListening}>
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="highlight"
            className="w-full"
            disabled={working || !serviceOn}
            data-testid="clip-captions-add"
            onClick={() => captions.add(options)}
          >
            {captions.busy === 'add' ? (
              <>
                <Spinner />
                Adding Captions...
              </>
            ) : (
              pricedLabel('Add Captions', captions.price ?? 0)
            )}
          </Button>
        )}

        <div className="flex flex-col gap-2 border-t-2 border-outline pt-4">{fileButton}</div>
      </div>
    );
  }

  // ---- Captions ----------------------------------------------------------------------
  const activeLook = look as CaptionLook;
  const markShown =
    layout !== null && layout.mark !== 'none' && layout.mark !== 'reveal'
      ? (track.markColour ?? activeLook.mark.colour)
      : null;
  const edit = (change: (current: CaptionsTrack) => CaptionsTrack, key?: string) =>
    onEdit(change, key);
  /** This clip's own change to one word; says so when the clip keeps as many as it can. */
  const changeWord = (
    index: number,
    change: (word: { i: number; text: string }) => { text?: string; hidden?: boolean },
  ) => {
    const word = captions.transcript?.words.find((candidate) => candidate.i === index);
    if (!word) return;
    if (!withWordEdit(track, word, change(word))) {
      onNotice(CAPTION_EDITS_FULL);
      return;
    }
    onEdit((current) => withWordEdit(current, word, change(word)) ?? current, undefined, track.id);
  };

  return (
    <div className="flex flex-col gap-6 pt-1" data-testid="clip-captions-panel">
      {messages}
      {captions.missing ? (
        <Alert variant="danger" className="items-center" data-testid="clip-captions-gone">
          <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">{CAPTIONS_GONE}</p>
        </Alert>
      ) : null}

      <PanelSection
        title="Style"
        headingId={stylesId}
        aside={
          <Button variant="secondary" size="sm" onClick={() => setCreating(true)}>
            <MotionIcon icon={PlusIcon} className="h-4 w-4" />
            Create A Style
          </Button>
        }
      >
        <StyleTiles
          styles={styles}
          value={styleIsGone(track.styleId, styles) ? '' : track.styleId}
          labelledBy={stylesId}
          onPick={(style) => edit((current) => withStyle(current, style))}
        />
        {(() => {
          const own = styles.find((style) => style.id === track.styleId && !style.builtIn);
          return own ? (
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              onClick={() => setDeleting(own)}
            >
              <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
              {`Delete "${own.name}"`}
            </Button>
          ) : null;
        })()}
        {layout && layout.mark === 'none' && activeLook.mark.kind !== 'none' ? (
          <p className={NOTE}>{CAPTIONS_PAGE_ONLY}</p>
        ) : null}
      </PanelSection>

      <PanelSection title="Look">
        <LabelledSlider
          label="Size"
          value={Math.round(track.sizePx)}
          unit="px"
          min={SIZE_RANGE.min}
          max={SIZE_RANGE.max}
          onChange={(size) => edit((current) => withSize(current, size), 'captions:size')}
        />
        <LabelledSlider
          label="Words At Once"
          value={track.maxWords}
          unit=""
          min={WORDS_RANGE.min}
          max={WORDS_RANGE.max}
          onChange={(count) => edit((current) => withMaxWords(current, count), 'captions:words')}
        />
        <div className="flex flex-col gap-2">
          <GroupLabel id={caseId}>Letters</GroupLabel>
          <ChoiceTiles<CaptionCase>
            labelledBy={caseId}
            columns={3}
            value={track.letterCase ?? activeLook.letterCase}
            onValueChange={(next) => edit((current) => withCase(current, next, activeLook))}
            options={CASE_OPTIONS.map((option) => ({ ...option }))}
          />
        </div>
        {markShown ? (
          <ColorPicker
            label="Highlight Colour"
            value={markShown}
            recent={recent}
            onChange={(hex) =>
              edit((current) => withMarkColour(current, hex, activeLook), 'captions:mark')
            }
            onCommit={onRecent}
          />
        ) : null}
      </PanelSection>

      <PanelSection title="Place">
        <ChoiceTiles<string>
          labelledBy={placeId}
          columns={3}
          value={placeOf(track)}
          onValueChange={(next) => {
            const place = PLACE_OPTIONS.find((candidate) => candidate.value === next);
            if (place) edit((current) => withPlace(current, place.y));
          }}
          options={PLACE_OPTIONS.map((place) => ({ value: place.value, label: place.label }))}
        />
        <span id={placeId} className="sr-only">
          Where the captions sit
        </span>
        <LabelledSlider
          label="Up And Down"
          value={Math.round(track.position.y * 100)}
          unit="%"
          min={8}
          max={92}
          onChange={(percent) =>
            edit((current) => withPlace(current, percent / 100), 'captions:place')
          }
        />
        {onSafeArea ? (
          <div className="flex items-center justify-between gap-3">
            <GroupLabel id={guideId}>Safe Area Guide</GroupLabel>
            <Toggle aria-labelledby={guideId} checked={safeArea} onCheckedChange={onSafeArea} />
          </div>
        ) : null}
      </PanelSection>

      <PanelSection title="Words">
        {captions.transcript?.fileName ? (
          <p className={NOTE}>{`From your file: ${captions.transcript.fileName}`}</p>
        ) : null}
        {captions.loading && groups.length === 0 ? (
          <div className="flex justify-center py-6">
            <Spinner />
          </div>
        ) : (
          <CaptionWords
            groups={groups}
            canReplaceEverywhere={captions.transcript?.source === 'listened'}
            busy={captions.busy !== null}
            onSeek={onSeek}
            onText={(index, text) => changeWord(index, (word) => ({ text: text || word.text }))}
            onHidden={(index, hidden) => changeWord(index, () => ({ hidden }))}
            onReplaceEverywhere={captions.replaceEverywhere}
          />
        )}
      </PanelSection>

      {montage ? montageLine : null}

      {others.length > 0 && !montage ? (
        <PanelSection title="Translate" headingId={translateId}>
          <LanguageSelect
            value={translateTo}
            onChange={setTarget}
            labelledBy={translateId}
            languages={others}
            auto={false}
            disabled={working}
          />
          <Button
            variant="secondary"
            className="h-auto min-h-11 w-full whitespace-normal py-2"
            disabled={working || translateTo === ''}
            data-testid="clip-captions-translate"
            onClick={() => captions.translate(translateTo)}
          >
            {captions.busy === 'translate' ? (
              <>
                <Spinner />
                Translating...
              </>
            ) : (
              <>
                <MotionIcon icon={LanguagesIcon} className="h-4 w-4 shrink-0" />
                {pricedLabel(`Translate To ${languageName(translateTo)}`, translatePrice)}
              </>
            )}
          </Button>
        </PanelSection>
      ) : null}

      <div className="flex flex-col gap-2 border-t-2 border-outline pt-4">
        {montage ? null : fileButton}
        <Button variant="danger" className="w-full" disabled={working} onClick={onRemove}>
          Remove Captions
        </Button>
      </div>

      <CaptionStyleDialog
        open={creating}
        onOpenChange={setCreating}
        initial={lookFromTrack(track, activeLook)}
        recent={recent}
        onRecent={onRecent}
        onSubmit={async (name, styleLook) => {
          const saved = await captions.saveStyle(name, styleLook);
          if (typeof saved === 'string') return saved;
          edit((current) => withStyle(current, saved));
          return null;
        }}
      />

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next && !deleteBusy) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Style</AlertDialogTitle>
            <AlertDialogDescription>
              {`"${deleting?.name ?? ''}" will be deleted for your whole workspace. Clips that use it switch to the first style.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
              disabled={deleteBusy}
              onClick={async (event) => {
                event.preventDefault();
                if (!deleting) return;
                setDeleteBusy(true);
                const refused = await captions.removeStyle(deleting.id);
                setDeleteBusy(false);
                if (refused) {
                  onNotice(refused);
                } else if (track.styleId === deleting.id) {
                  const first = styles[0];
                  if (first) edit((current) => withStyle(current, first));
                }
                setDeleting(null);
              }}
            >
              {deleteBusy ? 'Deleting...' : 'Delete Style'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
