'use client';

import { MusicIcon } from '@animateicons/react/lucide/music-icon';
import { StarIcon } from '@animateicons/react/lucide/star-icon';
import { UploadIcon } from '@animateicons/react/lucide/upload-icon';
/**
 * The Audio tab (Module 14 section 8).
 *
 * - At the top, always: **Video Volume** (0% to 200%) with a mute button and
 *   a small level meter that moves while the clip plays (the preview's
 *   analyser: a hint, not a measurement). With a part selected it sets that
 *   part; with none, every part.
 * - **Sound Effects**, **Music**, **Favourites**: a search that runs as you
 *   type, category chips with counts, rows 24 at a time (`sound-rows.tsx`).
 *   One preview plays at a time. Add puts the sound at the playhead.
 * - **Uploaded**: `uploaded-sounds.tsx`.
 * - **The selected sound**: its name (a warning when it left the library),
 *   Volume, Fade In and Fade Out (one second each), When It Plays, and
 *   Remove Sound. An effect plays once, so its For stops at its file's end
 *   and it has no Whole Clip; music loops, so Whole Clip fills the clip.
 *
 * Like the other tabs, the panel never edits the document itself: each
 * change goes to the editor as one undo step; a slider passes a coalesce
 * key so its whole drag is one step.
 */
import { Volume2Icon } from '@animateicons/react/lucide/volume-2-icon';
import { VolumeXIcon } from '@animateicons/react/lucide/volume-x-icon';
import { ZapIcon } from '@animateicons/react/lucide/zap-icon';
import {
  Alert,
  type AnimatedIcon,
  Button,
  ChoiceTiles,
  cn,
  EmptyState,
  MotionIcon,
  SearchInput,
  Slider,
  Spinner,
  Toggle,
  TooltipHint,
} from '@postgear/ui';
import {
  type AudioItem,
  type LibrarySoundView,
  SOUND_FADE_MS,
  type SoundCategory,
  type SoundKind,
  type SoundPatch,
  type SoundUploadView,
} from '@postgear/video-engine';
import { AudioLines, Music, Star, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { GroupLabel, NOTE, PanelSection, PercentSlider } from '@/components/studio/panel-ui';
import type { PlaybackStore } from '../editor/playback';
import {
  AUDIO_TABS,
  type AudioTab,
  MIXED_VOLUME,
  meterPercent,
  meterWarns,
  REMOVED_SOUND,
  SOUND_FAVOURITES_EMPTY,
  SOUND_UPLOAD_GONE,
  type SoundFileInfo,
  volumePercent,
} from './audio-model';
import { noMatchSentence, SEARCH_PLACEHOLDER } from './elements-model';
import { SoundRow } from './sound-rows';
import { CategoryChips } from './sticker-tiles';
import { UploadedSounds } from './uploaded-sounds';
import {
  type SoundPreview,
  useSoundCategories,
  useSoundPreview,
  useSoundSearch,
  useSoundUploads,
} from './use-sound-library';
import { WhenItShows } from './when-it-shows';

export interface AudioPanelProps {
  /** The selected sound, or null. */
  selected: AudioItem | null;
  /** What the editor knows of its file (null while it is being looked up). */
  selectedFile: SoundFileInfo | null;
  totalMs: number;
  fps: number;
  /** Video Volume: the selected part's, every part's, or null when the parts differ. */
  videoVolume: number | null;
  /** Whether Video Volume sets the selected part or the whole clip. */
  videoTarget: 'part' | 'clip';
  onVideoVolume: (volume: number, coalesceKey?: string) => void;
  /** Whether the clip is playing (the meter moves, a row's preview stops). */
  playback: Pick<PlaybackStore, 'usePlaying'>;
  /** The mix's loudest sample now (the preview's analyser). */
  readLevel: () => number;
  onAddLibrary: (sound: LibrarySoundView) => void;
  onAddUpload: (sound: SoundUploadView) => void;
  onEdit: (patch: SoundPatch, coalesceKey?: string) => void;
  onTiming: (startMs: number, durationMs: number) => void;
  onAnchor: (choice: 'moment' | 'whole') => void;
  onRemove: () => void;
}

/** Module 17 item 9: what Lower Under Speech does, and what it needs. */
export const DUCK_HELP =
  'The music drops while someone talks. It follows the transcript, so listen to the clip first.';

const AUDIO_TAB_ICONS: Readonly<Record<AudioTab, AnimatedIcon>> = {
  effects: ZapIcon,
  music: MusicIcon,
  favourites: StarIcon,
  uploaded: UploadIcon,
};

export function AudioPanel({
  selected,
  selectedFile,
  totalMs,
  fps,
  videoVolume,
  videoTarget,
  onVideoVolume,
  playback,
  readLevel,
  onAddLibrary,
  onAddUpload,
  onEdit,
  onTiming,
  onAnchor,
  onRemove,
}: AudioPanelProps) {
  const playing = playback.usePlaying();
  const [tab, setTab] = useState<AudioTab>('effects');
  const uploads = useSoundUploads(tab === 'uploaded');
  const preview = useSoundPreview();
  const { stop } = preview;

  // Pressing Play on the clip stops a row's preview, so two sounds never overlap.
  useEffect(() => {
    if (playing) stop();
  }, [playing, stop]);

  return (
    <div className="flex flex-col gap-5 pt-1" data-testid="clip-audio-panel">
      <VideoVolume
        volume={videoVolume}
        target={videoTarget}
        onVolume={onVideoVolume}
        playing={playing}
        readLevel={readLevel}
      />

      {selected ? (
        <SelectedSound
          key={selected.id}
          item={selected}
          file={selectedFile}
          totalMs={totalMs}
          fps={fps}
          onEdit={onEdit}
          onTiming={onTiming}
          onAnchor={onAnchor}
          onRemove={onRemove}
        />
      ) : null}

      <div className="flex flex-col gap-3">
        {/* Tiles, not a tab bar (2026-11-19): four names in a quarter of the panel each did
            not fit ("Sound Effects"), and the owner asked for no more tab bars. */}
        <ChoiceTiles<AudioTab>
          label="Sounds"
          columns={2}
          value={tab}
          onValueChange={setTab}
          options={AUDIO_TABS.map((choice) => ({ ...choice, icon: AUDIO_TAB_ICONS[choice.value] }))}
        />
        {tab === 'uploaded' ? (
          <UploadedSounds uploads={uploads} preview={preview} onAdd={onAddUpload} />
        ) : (
          <SoundBrowser key={tab} tab={tab} preview={preview} onAdd={onAddLibrary} />
        )}
      </div>

      {preview.error ? (
        <Alert variant="warning" className="items-center" data-testid="clip-sound-preview-failed">
          <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">{preview.error}</p>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-1 border-t-2 border-outline pt-3">
        <Link
          href="/credits/clips"
          target="_blank"
          rel="noopener"
          className="w-fit font-sans text-sm text-ink underline underline-offset-2 type-ui hover:text-actionPrimary"
        >
          Credits
        </Link>
      </div>
    </div>
  );
}

/** Video Volume: the slider, the mute button and the level meter. */
function VideoVolume({
  volume,
  target,
  onVolume,
  playing,
  readLevel,
}: {
  volume: number | null;
  target: 'part' | 'clip';
  onVolume: (volume: number, coalesceKey?: string) => void;
  playing: boolean;
  readLevel: () => number;
}) {
  const id = useId();
  // The level Unmute brings back.
  const before = useRef(1);
  const percent = volume === null ? 100 : volumePercent(volume);
  const muted = volume === 0;
  useEffect(() => {
    if (volume !== null && volume > 0) before.current = volume;
  }, [volume]);

  return (
    <PanelSection
      title="Video Volume"
      headingId={id}
      aside={
        <span className="font-sans text-xs tabular-nums text-ink type-muted">
          {volume === null ? MIXED_VOLUME : `${percent}%`}
        </span>
      }
    >
      <div className="flex items-center gap-2">
        <TooltipHint label={muted ? 'Unmute' : 'Mute'} side="top">
          <Button
            variant="ghost"
            size="sm"
            className="w-8 shrink-0 px-0"
            aria-label={muted ? 'Unmute' : 'Mute'}
            aria-pressed={muted}
            onClick={() => onVolume(muted ? before.current : 0)}
          >
            <MotionIcon icon={muted ? VolumeXIcon : Volume2Icon} className="h-4 w-4" />
          </Button>
        </TooltipHint>
        <Slider
          className="min-w-0 flex-1"
          value={[percent]}
          min={0}
          max={200}
          step={5}
          thumbs={[{ 'aria-labelledby': id, 'aria-valuetext': `${percent}%` }]}
          onValueChange={([next]) => {
            if (next !== undefined) onVolume(next / 100, 'video-volume');
          }}
        />
        <LevelMeter playing={playing} readLevel={readLevel} />
      </div>
      <p className={NOTE}>{target === 'part' ? 'For the selected part.' : 'For the whole clip.'}</p>
    </PanelSection>
  );
}

/** The level hint: fills with the mix while the clip plays, warning colour when it peaks. */
function LevelMeter({ playing, readLevel }: { playing: boolean; readLevel: () => number }) {
  const fill = useRef<HTMLSpanElement>(null);
  const [warn, setWarn] = useState(false);

  useEffect(() => {
    const el = fill.current;
    if (!el) return;
    if (!playing) {
      el.style.height = '0%';
      setWarn(false);
      return;
    }
    let frame = 0;
    let holdUntil = 0;
    const tick = () => {
      const level = readLevel();
      el.style.height = `${meterPercent(level)}%`;
      const now = performance.now();
      if (meterWarns(level)) {
        // Held a little, so a short peak is seen.
        holdUntil = now + 700;
        setWarn(true);
      } else if (now > holdUntil) {
        setWarn(false);
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [playing, readLevel]);

  return (
    <span
      className="relative flex h-8 w-2.5 shrink-0 overflow-hidden rounded-sm border-2 border-outline bg-inset"
      data-testid="clip-level-meter"
      data-warn={warn ? 'true' : undefined}
      aria-hidden="true"
    >
      <span
        ref={fill}
        className={cn(
          'absolute right-0 bottom-0 left-0 transition-[background-color]',
          warn ? 'bg-actionAccent' : 'bg-actionSuccess',
        )}
        style={{ height: '0%' }}
      />
    </span>
  );
}

function SoundBrowser({
  tab,
  preview,
  onAdd,
}: {
  tab: 'effects' | 'music' | 'favourites';
  preview: SoundPreview;
  onAdd: (sound: LibrarySoundView) => void;
}) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<SoundCategory | null>(null);
  const search = useSoundSearch({ tab, query, category });
  const categories = useSoundCategories(tab);
  const typed = search.query.trim();
  const nothing = !search.loading && !search.error && search.items.length === 0;
  const name = tab === 'music' ? 'Music' : tab === 'favourites' ? 'Favourites' : 'Sound Effects';

  return (
    <div className="flex flex-col gap-3">
      <SearchInput
        aria-label={`Search ${name}`}
        placeholder={SEARCH_PLACEHOLDER}
        value={query}
        maxLength={80}
        onChange={(event) => setQuery(event.target.value)}
        onClear={() => setQuery('')}
      />
      <CategoryChips<SoundCategory>
        categories={categories}
        value={category}
        onChange={setCategory}
        label="Categories"
      />

      {search.error ? (
        <Alert variant="danger" className="items-center" data-testid="clip-sounds-failed">
          <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">{search.error}</p>
          <Button variant="secondary" size="sm" onClick={search.retry}>
            Try Again
          </Button>
        </Alert>
      ) : null}

      {search.loading && search.items.length === 0 ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : null}

      {nothing && tab === 'favourites' && typed === '' ? (
        <EmptyState icon={Star} title={SOUND_FAVOURITES_EMPTY} />
      ) : nothing ? (
        <div className="flex flex-col gap-2" data-testid="clip-sounds-none">
          <p className={NOTE}>{noMatchSentence(typed)}</p>
          {search.suggest ? (
            <CategoryChips<SoundCategory>
              categories={search.suggest}
              value={null}
              onChange={(next) => {
                setQuery('');
                setCategory(next);
              }}
              label="Nearest Categories"
            />
          ) : null}
        </div>
      ) : null}

      {search.items.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="clip-sound-list">
          {search.items.map((sound) => (
            <SoundRow
              key={sound.id}
              sound={sound}
              playing={preview.playingId === sound.id}
              onPreview={(row) => preview.toggle(row.id, row.previewUrl)}
              onFavourite={search.setFavourite}
              onAdd={onAdd}
            />
          ))}
        </ul>
      ) : null}

      {search.hasMore ? (
        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          disabled={search.loadingMore}
          onClick={search.loadMore}
        >
          {search.loadingMore ? 'Loading' : 'Show More'}
        </Button>
      ) : null}
    </div>
  );
}

function kindName(kind: SoundKind): string {
  return kind === 'music' ? 'Music' : 'Sound Effect';
}

function SelectedSound({
  item,
  file,
  totalMs,
  fps,
  onEdit,
  onTiming,
  onAnchor,
  onRemove,
}: {
  item: AudioItem;
  file: SoundFileInfo | null;
  totalMs: number;
  fps: number;
  onEdit: (patch: SoundPatch, coalesceKey?: string) => void;
  onTiming: (startMs: number, durationMs: number) => void;
  onAnchor: (choice: 'moment' | 'whole') => void;
  onRemove: () => void;
}) {
  const fadeInId = useId();
  const fadeOutId = useId();
  const duckId = useId();
  const music = item.type === 'music';
  const Icon = music ? Music : AudioLines;
  // An effect plays once: For stops where its file ends.
  const fileLeft =
    !music && file?.durationMs ? Math.max(0, file.durationMs - item.offsetMs) : undefined;

  return (
    <div className="flex flex-col gap-5" data-testid="clip-selected-sound">
      <div className="flex items-center gap-3 rounded-md border-2 border-outline bg-inset p-2">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-sm text-ink">
          <Icon className="h-5 w-5" strokeWidth={2.25} aria-hidden="true" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-sans text-sm text-ink type-heading">
            {file?.name ?? kindName(item.type)}
          </span>
          <span className="font-sans text-xs text-ink type-muted">{kindName(item.type)}</span>
        </span>
      </div>

      {file?.missing ? (
        <Alert variant="warning" className="items-center" data-testid="clip-sound-missing">
          <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">
            {'asset' in item.ref ? SOUND_UPLOAD_GONE : REMOVED_SOUND}
          </p>
        </Alert>
      ) : null}

      <PanelSection title="Sound">
        <PercentSlider
          label="Volume"
          max={200}
          value={volumePercent(item.volume)}
          onValueChange={(percent) => onEdit({ volume: percent / 100 }, `sound-volume:${item.id}`)}
        />
        <div className="flex items-center justify-between gap-3">
          <GroupLabel id={fadeInId}>Fade In</GroupLabel>
          <Toggle
            aria-labelledby={fadeInId}
            checked={item.fadeInMs > 0}
            onCheckedChange={(on) => onEdit({ fadeInMs: on ? SOUND_FADE_MS : 0 })}
          />
        </div>
        <div className="flex items-center justify-between gap-3">
          <GroupLabel id={fadeOutId}>Fade Out</GroupLabel>
          <Toggle
            aria-labelledby={fadeOutId}
            checked={item.fadeOutMs > 0}
            onCheckedChange={(on) => onEdit({ fadeOutMs: on ? SOUND_FADE_MS : 0 })}
          />
        </div>
        {music ? (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3">
              <GroupLabel id={duckId}>Lower Under Speech</GroupLabel>
              <Toggle
                aria-labelledby={duckId}
                checked={item.duck}
                onCheckedChange={(on) => onEdit({ duck: on })}
                data-testid="clip-sound-duck"
              />
            </div>
            <p className="m-0 font-sans text-xs text-ink type-muted">{DUCK_HELP}</p>
          </div>
        ) : null}
      </PanelSection>

      <WhenItShows
        item={item}
        totalMs={totalMs}
        fps={fps}
        title="When It Plays"
        maxDurationMs={fileLeft}
        whole={music}
        onTiming={onTiming}
        onAnchor={onAnchor}
      />

      <Button variant="danger" className="w-full" onClick={onRemove}>
        Remove Sound
      </Button>
    </div>
  );
}
