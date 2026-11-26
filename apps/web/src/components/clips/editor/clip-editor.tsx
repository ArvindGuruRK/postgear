'use client';

/**
 * The clip editor (Sprint 12, Module 08): the whole window, its own top bar,
 * the tab rail, the panel, the clip playing on the stage with the transport
 * under it, and the timeline dock.
 *
 * - **One store** (`editor-state.ts`): every edit goes through `apply`, the
 *   name through `rename`; Undo and Redo walk both. The selection and the
 *   open tab stay out of history.
 * - **The picture** is the `PreviewEngine` drawing the document over the
 *   light copy; `PlaybackStore` gives the small clock readers (the transport,
 *   the playhead) the time without re-rendering the editor on every frame.
 * - **Saving** is `ClipAutosave` under the revision lock: a conflict stops
 *   saving and offers Reload, and nothing is ever overwritten.
 * - **Leaving** with something unsaved asks first: links on the page through
 *   a capturing click handler, and the app's other moves through the leave
 *   guard (`lib/leave-guard.ts`), both as Studio does.
 * - **First open** asks the shape ("What Do You Want To Make?"), once per
 *   clip (`meta.shapeChosen`), as one undo step.
 * - **The timeline** (Module 09) edits through the same store: a drag shows
 *   its result on the stage while it lasts (`draft`) and is applied once on
 *   release; split, remove, duplicate and the keys go through `apply` too,
 *   always against the document as it is when they run.
 * - **Layouts** (Module 10): the panel picks the shape, the layout, the
 *   Crop Ratio and saved layouts; while it is open the stage splits into the
 *   whole video with its crop boxes ("Video") and the clip ("Clip"). The
 *   clip's stage stays mounted across tabs, so playback never stops on a
 *   tab change. A crop drag is a draft like a timeline drag.
 * - **More Video**: whenever the clip reaches past the sharp stretch we hold
 *   (`held`), the whole clip range is asked for (`MoreVideoRequester`:
 *   debounced, one at a time, waits out the API's limit), and the clip is
 *   read again every few seconds while the fetch runs, until the hatching
 *   fills in.
 * - **Text** (Module 11): the preview draws texts as DOM (`DomOverlayLayer`)
 *   and reports their heights; the handles over the stage (`TransformLayer`)
 *   select, move, scale, widen and turn them, and typing happens on the clip
 *   (`InPlaceText`). The Text tab edits the selected one. Arrows nudge a
 *   selected text, Enter types into it.
 * - **Stickers** (Module 12): the Elements tab adds library stickers, the
 *   workspace's own and the Follow Badge at the playhead. The editor keeps
 *   what it knows of each sticker file (`stickerFilesKnown`): a tile hands
 *   its own on add, the rest are looked up once (`GET /clips/stickers/files`)
 *   and a removed one is remembered as missing. The preview draws from that
 *   map; the handles move, scale and turn stickers like texts.
 * - **Sound** (Module 14): the Audio tab adds library and uploaded sounds at
 *   the playhead and sets Video Volume. Sound files are known the same way
 *   (`soundFilesKnown`, `GET /clips/sounds/files`) and handed to the
 *   preview's `WebAudioLayer`, which plays them beside the picture; the
 *   videos carry `crossOrigin` so their own sound can go up to 200%.
 */
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
  cn,
  pushRecent,
  ToastAction,
  toast,
} from '@postgear/ui';
import {
  type AudioItem,
  addItem,
  addZoom,
  type BadgePlatform,
  type ClipDocument,
  countSounds,
  defaultBadgeItem,
  defaultSoundItem,
  defaultStickerItem,
  defaultTextItem,
  documentRange,
  duplicateItem,
  type Fades,
  findItem,
  type LibrarySoundView,
  type LibraryStickerView,
  type Looks,
  MAX_SOUNDS,
  outputDuration,
  removeArea,
  removeItem,
  removeSound,
  removeZoom,
  type SoundPatch,
  type SoundUploadView,
  type SourceRange,
  type Speed,
  type StickerItem,
  type StickerUploadView,
  setItemAnchor,
  setItemTiming,
  setSegmentVolume,
  setSpeed,
  setVideoVolume,
  setZoomTiming,
  soundLoops,
  soundMaxDuration,
  type TextItem,
  type TextStyleId,
  type TimedItem,
  updateItem,
  updateSound,
  updateZoom,
  videoVolumeOf,
  WATERMARK_MARGIN_FRACTION,
  WATERMARK_OPACITY,
  WATERMARK_WIDTH_FRACTION,
  type Zoom,
  aiMinutesCost,
  type CaptionsTrack,
  captionLayout,
  captionsTrackOf,
  safeAreaGuide,
  updateCaptionsTrack,
  withCaptionsTrack,
  withoutCaptions,
} from '@postgear/video-engine';
import { DomOverlayLayer, usePreviewEngine, WebAudioLayer } from '@postgear/video-preview';
import { TriangleAlert } from 'lucide-react';
import { captionBars, lookOf } from '../panels/captions-model';
import { CaptionsPanel } from '../panels/captions-panel';
import { useCaptions } from '../panels/use-captions';
import type { ApplyCut } from '../transcript/cleanup-tools';
import { TranscriptPane } from '../transcript/transcript-pane';
import { cutRefusalSentence } from '../transcript/transcript-model';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useFocusAfterComposer } from '@/components/composer/composer-return';
import {
  editorShortcut,
  isApplePlatform,
  keyPlaceOf,
  LEAVE_WAIT_MS,
  leaveHref,
  linkOf,
  settleWithin,
} from '@/components/studio/studio-editor-model';
import { StudioFonts } from '@/components/studio/studio-fonts';
import { ApiError } from '@/lib/api';
import { getClip, openClip, requestMoreVideo, soundFiles, stickerFiles } from '@/lib/clips-api';
import { registerLeaveGuard } from '@/lib/leave-guard';
import type { ClipDetail } from '@/types/clips';
import { isTerminalJob } from '../clip-job-model';
import { CropStage } from '../layouts/crop-stage';
import { LAST_CROP_SENTENCE } from '../layouts/layouts-model';
import { type LayoutEdit, LayoutsPanel } from '../layouts/layouts-panel';
import {
  layerFiles,
  rowSoundInfo,
  rowSoundKey,
  type SoundFileInfo,
  soundInfoOf,
  soundInfoOfItem,
  TOO_MANY_SOUNDS,
  unknownSoundFiles,
} from '../panels/audio-model';
import { AudioPanel } from '../panels/audio-panel';
import {
  addZoomSentence,
  playheadAfterSpeed,
  speedSentence,
  ZOOM_ROOM_SENTENCE,
} from '../panels/effects-model';
import { EffectsPanel } from '../panels/effects-panel';
import {
  fileInfoOf,
  fileOfItem,
  previewPictures,
  type StickerFileInfo,
  tileFileInfo,
  tileKey,
  unknownFiles,
} from '../panels/elements-model';
import { ElementsPanel, type StickerEdit } from '../panels/elements-panel';
import { type TextEdit, TextPanel } from '../panels/text-panel';
import { MoreVideoRequester } from '../timeline/more-video';
import {
  addRefusalSentence,
  itemLabel,
  missingRange,
  removeProblem as removeProblemOf,
  removeSelection,
  splitAtPlayhead,
  tabForSelection,
} from '../timeline/timeline-model';
import {
  backHref as backHrefOf,
  CONFLICT_SENTENCE,
  clipsTabHref,
  LEAVE_SENTENCE,
  LEAVE_TITLE,
  NO_PREVIEW_SENTENCE,
  RELOAD_FAILED_SENTENCE,
  readTranscriptOpen,
  SHARP_GONE_SENTENCE,
  videoSizeOf,
  writeTranscriptOpen,
} from './clip-editor-model';
import { clipFontFamily } from './clip-fonts';
import { EditorPanel, panelHeadingId } from './editor-panel';
import { CONTROL_OWNED, clipShortcutFor, nudgeFor } from './editor-shortcuts';
import { EditorShortcutsSheet } from './editor-shortcuts-sheet';
import {
  chooseShape,
  createEditorState,
  type EditorSelection,
  type EditorTab,
  editorCanRedo,
  editorCanUndo,
  editorDocument,
  editorReducer,
  editorTitle,
  type FirstShape,
  needsShape,
} from './editor-state';
import { EditorTopBar } from './editor-top-bar';
import {
  changedSince,
  EXPORT_DONE_SENTENCE,
  goneItems,
  LEAVE_OUT_TITLE,
  latestDone,
  leaveOutSentence,
} from './export-model';
import { ExportPanel, useClipExport } from './export-panel';
import { usePlaybackStore } from './playback';
import { SendClipDialog, type SendExportRun } from './send-dialog';
import { composerHref } from './send-model';
import { ShapeDialog } from './shape-dialog';
import { Stage } from './stage';
import { TabRail } from './tab-rail';
import { TimelineDock } from './timeline-dock';
import { MeasuredHeights, TransformLayer } from './transform-layer';
import { centreToTransform, itemFrame, nudgeFrame, type StageItem } from './transform-model';
import { type DockControls, TransportBar } from './transport-bar';
import { useClipAutosave } from './use-clip-autosave';

const subscribeNever = () => () => undefined;

/** Whether shortcut hints show the Command key. The server and the first render say Ctrl. */
function useApplePlatform(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => isApplePlatform(navigator),
    () => false,
  );
}

/** Keys that belong to the focused control (a button's Space, a slider's arrows), not the transport. */
const OWN_KEYS =
  'button, a[href], [role="slider"], [role="tab"], [role="separator"], [role="menuitem"], [role="option"], [role="radio"], [role="checkbox"], [role="listbox"]';
/** The Transcript pane's words (Module 04): Delete there cuts words, never a timeline part. */
const TRANSCRIPT_KEYS = '[data-transcript-pane]';

/** Renews the signed address this long before it runs out. */
const RENEW_EARLY_MS = 5 * 60_000;
/** How often the clip is read again while its sharp video is being fetched. */
const SHARP_POLL_MS = 4_000;
/** How long a refused edit's sentence stays in the tools row. */
const NOTICE_MS = 4_000;
/** How long the Text panel says an emoji was left out. */
const EMOJI_NOTE_MS = 6_000;
/** The most sticker files one lookup asks for (the API's own limit). */
const STICKER_LOOKUP_MAX = 60;

const rangeKey = (range: SourceRange | null) => (range ? `${range.fromMs}-${range.toMs}` : '');

export function ClipEditor({
  orgId,
  initial,
  document: initialDocument,
  initialTab,
}: {
  orgId: string;
  initial: ClipDetail;
  /** The clip's document, read by the page (it never opens without one). */
  document: ClipDocument;
  /** The tab to open on (`?tab=export` from a ready export's notice). */
  initialTab?: EditorTab;
}) {
  const router = useRouter();
  const clipId = initial.clip.id;
  const [detail, setDetail] = useState(initial);
  const [state, dispatch] = useReducer(editorReducer, undefined, () =>
    createEditorState({ document: initialDocument, title: initial.clip.title }, initialTab),
  );
  const document = editorDocument(state);
  const title = editorTitle(state);
  const mac = useApplePlatform();
  const mod = mac ? '⌘' : 'Ctrl';
  const videoSize = useMemo(() => videoSizeOf(detail), [detail]);
  const fps = detail.proxy?.fps ?? detail.video?.fps ?? 30;
  // A trim can bring video back up to the video's ends; without the video, only what the clip uses.
  const videoDurationMs =
    detail.video?.durationMs ??
    documentRange(initialDocument)?.toMs ??
    outputDuration(initialDocument);

  const back = detail.video
    ? { href: backHrefOf(orgId, detail.video.id, clipId), label: 'Back To Video' }
    : { href: clipsTabHref(orgId), label: 'Back To Clips' };

  // ---- Opening: a new clip becomes a draft ------------------------------------

  useEffect(() => {
    openClip(clipId).catch(() => undefined);
  }, [clipId]);

  // ---- The picture --------------------------------------------------------------

  const source = useMemo(
    () =>
      detail.playback
        ? { url: detail.playback.url, expiresAt: detail.playback.expiresAt, offsetMs: 0, fps }
        : null,
    [detail.playback, fps],
  );
  // While a timeline drag lasts, the stage shows its result; the store keeps the document it began on.
  const [draft, setDraft] = useState<{ doc: ClipDocument; seekMs: number | null } | null>(null);
  const shownDocument = draft?.doc ?? document;
  // The texts' layer is made once; it reports each text's height to the handles.
  const [heights] = useState(() => new MeasuredHeights());
  const [overlayLayer] = useState(
    () => new DomOverlayLayer({ fontFamily: clipFontFamily, onMeasure: heights.set }),
  );
  // The sounds' layer is made once too; the engine hands it the two videos.
  const [audioLayer] = useState(() => new WebAudioLayer());
  const { engine, containerRef } = usePreviewEngine({
    document: shownDocument,
    source,
    overlayLayer,
    audioLayer,
    // The videos' own sound joins the sounds' graph (Video Volume to 200%); the bucket answers CORS.
    crossOrigin: 'anonymous',
  });
  const playback = usePlaybackStore(engine);
  const dock = useRef<DockControls | null>(null);

  // ---- Sticker files (Module 12) -----------------------------------------------------

  const [stickerFilesKnown, setStickerFilesKnown] = useState<ReadonlyMap<string, StickerFileInfo>>(
    () => new Map(),
  );
  const knowFiles = useCallback((entries: ReadonlyArray<readonly [string, StickerFileInfo]>) => {
    if (entries.length === 0) return;
    setStickerFilesKnown((current) => {
      const next = new Map(current);
      for (const [key, info] of entries) next.set(key, info);
      return next;
    });
  }, []);

  // The files the clip uses that are not known yet, looked up once each (60 at a time).
  const wanted = useMemo(
    () => unknownFiles(shownDocument, stickerFilesKnown),
    [shownDocument, stickerFilesKnown],
  );
  const wantedKey = [
    ...wanted.library.slice(0, STICKER_LOOKUP_MAX).map((id) => `library:${id}`),
    ...wanted.asset.slice(0, STICKER_LOOKUP_MAX).map((id) => `asset:${id}`),
  ].join(',');
  const lookingUp = useRef(new Set<string>());
  useEffect(() => {
    if (!wantedKey) return;
    const keys = wantedKey.split(',').filter((key) => !lookingUp.current.has(key));
    if (keys.length === 0) return;
    for (const key of keys) lookingUp.current.add(key);
    const library = keys.filter((key) => key.startsWith('library:')).map((key) => key.slice(8));
    const asset = keys.filter((key) => key.startsWith('asset:')).map((key) => key.slice(6));
    stickerFiles({ library, asset })
      .then((files) => knowFiles(files.map((file) => [file.key, fileInfoOf(file)] as const)))
      .catch(() => {
        // Not known yet: the stickers draw nothing until the next look (a later change asks again).
      })
      .finally(() => {
        for (const key of keys) lookingUp.current.delete(key);
      });
  }, [wantedKey, knowFiles]);

  const stickerPictures = useMemo(() => previewPictures(stickerFilesKnown), [stickerFilesKnown]);
  useEffect(() => {
    overlayLayer.setStickerPictures(stickerPictures);
  }, [overlayLayer, stickerPictures]);

  // ---- Sound files (Module 14) ---------------------------------------------------------

  const [soundFilesKnown, setSoundFilesKnown] = useState<ReadonlyMap<string, SoundFileInfo>>(
    () => new Map(),
  );
  const knowSounds = useCallback((entries: ReadonlyArray<readonly [string, SoundFileInfo]>) => {
    if (entries.length === 0) return;
    setSoundFilesKnown((current) => {
      const next = new Map(current);
      for (const [key, info] of entries) next.set(key, info);
      return next;
    });
  }, []);
  const wantedSounds = useMemo(
    () => unknownSoundFiles(shownDocument, soundFilesKnown),
    [shownDocument, soundFilesKnown],
  );
  const wantedSoundsKey = [
    ...wantedSounds.library.slice(0, STICKER_LOOKUP_MAX).map((id) => `library:${id}`),
    ...wantedSounds.asset.slice(0, STICKER_LOOKUP_MAX).map((id) => `asset:${id}`),
  ].join(',');
  const lookingUpSounds = useRef(new Set<string>());
  useEffect(() => {
    if (!wantedSoundsKey) return;
    const keys = wantedSoundsKey.split(',').filter((key) => !lookingUpSounds.current.has(key));
    if (keys.length === 0) return;
    for (const key of keys) lookingUpSounds.current.add(key);
    const library = keys.filter((key) => key.startsWith('library:')).map((key) => key.slice(8));
    const asset = keys.filter((key) => key.startsWith('asset:')).map((key) => key.slice(6));
    soundFiles({ library, asset })
      .then((files) => knowSounds(files.map((file) => [file.key, soundInfoOf(file)] as const)))
      .catch(() => {
        // Not known yet: the sound stays silent in the preview until a later change asks again.
      })
      .finally(() => {
        for (const key of keys) lookingUpSounds.current.delete(key);
      });
  }, [wantedSoundsKey, knowSounds]);
  useEffect(() => {
    audioLayer.setFiles(layerFiles(soundFilesKnown));
  }, [audioLayer, soundFilesKnown]);
  const readLevel = useCallback(() => audioLayer.level(), [audioLayer]);

  // After the engine has the draft (its effect runs first), show the frame being cut on.
  const draftSeek = draft?.seekMs ?? null;
  useEffect(() => {
    if (draftSeek !== null) playback.seekMs(draftSeek);
  }, [draftSeek, playback]);

  // A fresh signed address, swapped in before the old one runs out, or after a failure.
  const refreshing = useRef(false);
  const refreshAddress = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const fresh = await getClip(clipId);
      setDetail((current) => ({
        ...current,
        playback: fresh.playback,
        sharp: fresh.sharp,
        held: fresh.held,
        video: fresh.video,
      }));
    } catch {
      // The stage keeps its Try Again; the next press asks again.
    } finally {
      refreshing.current = false;
    }
  }, [clipId]);

  const expiresAt = detail.playback?.expiresAt ?? null;
  useEffect(() => {
    if (!expiresAt) return;
    const at = Date.parse(expiresAt);
    if (Number.isNaN(at)) return;
    const wait = Math.max(10_000, at - Date.now() - RENEW_EARLY_MS);
    const timer = window.setTimeout(() => void refreshAddress(), Math.min(wait, 2_147_000_000));
    return () => window.clearTimeout(timer);
  }, [expiresAt, refreshAddress]);

  // ---- Saving -------------------------------------------------------------------

  const autosave = useClipAutosave({
    orgId,
    clipId,
    initial: {
      document: initialDocument,
      title: initial.clip.title,
      revision: initial.clip.revision,
    },
    document,
    title,
  });
  const { status, refusal, flush, letGo } = autosave;

  const exporting = useClipExport({
    orgId,
    clipId,
    flush: autosave.flushRevision,
    sharp: detail.sharp,
  });
  const [leaveOut, setLeaveOut] = useState<{ stickers: string[]; sounds: string[] } | null>(null);
  const [exportQueued, setExportQueued] = useState(false);
  const startQueued = exporting.start;
  useEffect(() => {
    // Runs after the autosave's own effect has the new document, so the flush saves it.
    if (!exportQueued) return;
    setExportQueued(false);
    void startQueued();
  }, [exportQueued, startQueued]);

  // ---- Send To Composer (Module 17) ---------------------------------------------

  const [sendOpen, setSendOpen] = useState(false);
  const sendFrom = useRef<HTMLElement | null>(null);
  const sendOpenNow = useRef(false);
  sendOpenNow.current = sendOpen;
  const openSend = useCallback((from: HTMLElement | null) => {
    sendFrom.current = from;
    setSendOpen(true);
  }, []);
  // Back from the composer: the Send button that opened it (the toast's has gone).
  useFocusAfterComposer(
    orgId,
    () =>
      (sendFrom.current?.isConnected ? sendFrom.current : null) ??
      window.document.querySelector<HTMLElement>('[data-testid="clip-export-send"]'),
  );

  // An export this editor watched run is done: say so, with Send To Composer.
  const exportView = exporting.job.job;
  const watchedRun = useRef<string | null>(null);
  useEffect(() => {
    if (!exportView) return;
    if (!isTerminalJob(exportView.status)) {
      watchedRun.current = exportView.id;
      return;
    }
    if (watchedRun.current !== exportView.id) return;
    watchedRun.current = null;
    // The send dialog follows its own Export Again; no second word about it.
    if (exportView.status !== 'DONE' || sendOpenNow.current) return;
    toast({
      title: EXPORT_DONE_SENTENCE,
      action: (
        <ToastAction altText="Send To Composer" onClick={() => openSend(null)}>
          Send To Composer
        </ToastAction>
      ),
    });
  }, [exportView, openSend]);

  // A change the schema refused never reaches the server; say so for whoever is debugging.
  useEffect(() => {
    if (state.rejected) console.warn(`Clip editor: a change was dropped (${state.rejected}).`);
  }, [state.rejected]);

  // ---- Reload after a conflict ----------------------------------------------------

  const [reloading, setReloading] = useState(false);
  const [reloadProblem, setReloadProblem] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (reloading) return;
    setReloading(true);
    setReloadProblem(null);
    try {
      const fresh = await getClip(clipId);
      const freshDocument = fresh.clip.document;
      if (!freshDocument) {
        setReloadProblem(RELOAD_FAILED_SENTENCE);
        return;
      }
      const version = { document: freshDocument, title: fresh.clip.title };
      autosave.replace({ ...version, revision: fresh.clip.revision }, version);
      dispatch({ type: 'reset', version });
      setDetail(fresh);
    } catch (cause) {
      setReloadProblem(
        cause instanceof ApiError && cause.status !== 0 ? cause.message : RELOAD_FAILED_SENTENCE,
      );
    } finally {
      setReloading(false);
    }
  }, [autosave, clipId, reloading]);

  // ---- The shape question -----------------------------------------------------------

  const [shapeOpen, setShapeOpen] = useState(() => needsShape(initialDocument));
  const chooseFirstShape = useCallback(
    (ratio: FirstShape) => {
      dispatch({
        type: 'apply',
        change: (doc) => chooseShape(doc, ratio, videoSize),
        now: Date.now(),
      });
      setShapeOpen(false);
    },
    [videoSize],
  );

  // ---- More video ---------------------------------------------------------------------

  const [moreGone, setMoreGone] = useState(false);
  const [morePending, setMorePending] = useState(false);
  const requester = useRef<MoreVideoRequester | null>(null);
  useEffect(() => {
    const more = new MoreVideoRequester({
      send: (range) => requestMoreVideo(clipId, range.fromMs, range.toMs),
      onPending: setMorePending,
      onAnswer: (answer) => {
        if (answer.sharp === 'gone') setMoreGone(true);
        setDetail((current) =>
          current.sharp === answer.sharp ? current : { ...current, sharp: answer.sharp },
        );
        // Already held after all (another clip's stretch covers it): read the new range.
        if (answer.sharp === 'ready') {
          getClip(clipId)
            .then((fresh) =>
              setDetail((current) => ({ ...current, sharp: fresh.sharp, held: fresh.held })),
            )
            .catch(() => undefined);
        }
      },
    });
    requester.current = more;
    return () => {
      more.dispose();
      if (requester.current === more) requester.current = null;
    };
  }, [clipId]);

  // The clip reaches past what we hold: ask for its whole range (once per range; the first
  // fetch still running, or a copy that is gone, asks nothing).
  const missing = useMemo(() => missingRange(document, detail.held), [document, detail.held]);
  const missingFrom = missing?.fromMs ?? null;
  const missingTo = missing?.toMs ?? null;
  useEffect(() => {
    if (missingFrom === null || missingTo === null || moreGone) return;
    requester.current?.request({ fromMs: missingFrom, toMs: missingTo });
  }, [missingFrom, missingTo, moreGone]);

  // While the sharp video is coming, read the clip again now and then, so the hatching fills in.
  useEffect(() => {
    if (detail.sharp !== 'fetching') return;
    let live = true;
    const timer = window.setInterval(() => {
      if (window.document.visibilityState === 'hidden') return;
      getClip(clipId)
        .then((fresh) => {
          if (!live) return;
          setDetail((current) =>
            current.sharp === fresh.sharp && rangeKey(current.held) === rangeKey(fresh.held)
              ? current
              : { ...current, sharp: fresh.sharp, held: fresh.held },
          );
        })
        .catch(() => undefined);
    }, SHARP_POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [clipId, detail.sharp]);

  const gettingMore = missing !== null && !moreGone && (morePending || detail.sharp === 'fetching');

  // ---- Timeline commands --------------------------------------------------------------

  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);
  const [announcement, setAnnouncement] = useState('');

  // The keys and buttons read the store as it is when they run, never as it was at the last render.
  const latest = useRef({ document, selection: state.selection });
  latest.current = { document, selection: state.selection };

  // The panel can be folded away for room (2026-11-19); opening any tab opens it again.
  const [panelOpen, setPanelOpenState] = useState(true);
  // Sprint 13, Module 04: the Transcript pane. At most three columns at 1366 px: opening it
  // folds the panel to its rail, and opening the panel closes it (blueprint section 13).
  const [transcriptOpen, setTranscriptOpenState] = useState(false);
  useEffect(() => {
    if (readTranscriptOpen()) {
      setTranscriptOpenState(true);
      setPanelOpenState(false);
    }
  }, []);
  const setTranscriptOpen = useCallback((open: boolean) => {
    setTranscriptOpenState(open);
    writeTranscriptOpen(open);
    if (open) setPanelOpenState(false);
  }, []);
  const setPanelOpen = useCallback((open: boolean) => {
    setPanelOpenState(open);
    if (open) {
      setTranscriptOpenState(false);
      writeTranscriptOpen(false);
    }
  }, []);
  const setTab = useCallback(
    (tab: EditorTab) => {
      setPanelOpen(true);
      dispatch({ type: 'tab', tab });
    },
    [setPanelOpen],
  );

  const select = useCallback((selection: EditorSelection) => {
    dispatch({ type: 'select', selection });
    // An item or a zoom opens the panel that edits it; a part leaves the panel where it is.
    if (selection && selection.kind !== 'segment') {
      const tab = tabForSelection(latest.current.document, selection);
      if (tab) dispatch({ type: 'tab', tab });
    }
  }, []);

  const openSelection = useCallback((selection: NonNullable<EditorSelection>) => {
    const tab = tabForSelection(latest.current.document, selection);
    if (tab) dispatch({ type: 'tab', tab });
  }, []);

  const commit = useCallback(
    (
      start: ClipDocument,
      next: ClipDocument,
      options: { select?: EditorSelection; coalesceKey?: string } = {},
    ) => {
      dispatch({
        type: 'apply',
        // Applied only onto the document the edit began on; anything newer wins.
        change: (doc) => (doc === start ? next : doc),
        select: options.select,
        coalesceKey: options.coalesceKey,
        now: Date.now(),
      });
    },
    [],
  );

  // ---- Captions (Sprint 13, Module 03) ---------------------------------------------------
  // The words arrive from the API; the track goes into the document here, as one undo step.
  const captionsTrack = useMemo(() => captionsTrackOf(shownDocument), [shownDocument]);
  const putCaptionsTrack = useCallback(
    (track: CaptionsTrack) => {
      const { document: doc } = latest.current;
      commit(doc, withCaptionsTrack(doc, track));
      dispatch({ type: 'tab', tab: 'captions' });
    },
    [commit],
  );
  const captions = useCaptions({
    clipId,
    videoId: detail.video?.id ?? null,
    transcriptId: captionsTrack?.transcriptAssetId ?? null,
    onTrack: putCaptionsTrack,
  });
  const captionsTranscript = captions.transcript;
  const captionStyles = captions.styles;
  // The same layout the export's writer reads: the pages on screen are the pages in the file.
  const captionsLayout = useMemo(() => {
    if (!captionsTrack || !captionsTranscript) return null;
    return captionLayout({
      doc: shownDocument,
      track: captionsTrack,
      look: lookOf(captionsTrack.styleId, captionStyles),
      transcript: captionsTranscript,
      // Only words that were listened to have a real time each.
      wordTimed: captionsTranscript.source === 'listened',
    });
  }, [shownDocument, captionsTrack, captionsTranscript, captionStyles]);
  useEffect(() => {
    overlayLayer.setCaptions(captionsLayout);
  }, [overlayLayer, captionsLayout]);
  const captionRow = useMemo(
    () => (captionsLayout ? captionBars(captionsLayout) : null),
    [captionsLayout],
  );
  const editCaptions = useCallback(
    (change: (track: CaptionsTrack) => CaptionsTrack, coalesceKey?: string) => {
      const { document: doc } = latest.current;
      const next = updateCaptionsTrack(doc, change);
      commit(doc, next, { coalesceKey });
    },
    [commit],
  );
  const removeCaptions = useCallback(() => {
    const { document: doc } = latest.current;
    commit(doc, withoutCaptions(doc));
  }, [commit]);

  // ---- Cutting by words (Sprint 13, Module 04) ------------------------------------------
  // The Transcript pane's cuts, run on the latest document: one undo step each, the result
  // in a toast with Undo, a refusal in the timeline's notice line.
  const applyCut = useCallback<ApplyCut>(
    (make, describe) => {
      const { document: doc } = latest.current;
      const result = make(doc);
      if (!result.ok) {
        setNotice(cutRefusalSentence(result.code));
        return false;
      }
      commit(doc, result.doc);
      const sentence = describe(doc, result.doc);
      if (sentence) {
        toast({
          title: sentence,
          action: (
            <ToastAction altText="Undo" onClick={() => dispatch({ type: 'undo' })}>
              Undo
            </ToastAction>
          ),
        });
      }
      return true;
    },
    [commit],
  );
  const [safeAreaShown, setSafeAreaShown] = useState(false);
  const safeArea = useMemo(
    () => safeAreaGuide(shownDocument.canvas.ratio),
    [shownDocument.canvas.ratio],
  );

  const splitHere = useCallback(() => {
    const { document: doc } = latest.current;
    const at = playback.getCurrentMs();
    const result = splitAtPlayhead(doc, at);
    if (!result.ok) {
      setNotice(result.sentence);
      setAnnouncement(result.sentence);
      return;
    }
    commit(doc, result.doc);
    setNotice(null);
    setAnnouncement('Split at the playhead.');
  }, [commit, playback]);

  const removeSelected = useCallback(() => {
    const { document: doc, selection } = latest.current;
    if (selection?.kind === 'area') {
      const next = removeArea(doc, selection.id, videoSize);
      if (next === doc) {
        setNotice(LAST_CROP_SENTENCE);
        setAnnouncement(LAST_CROP_SENTENCE);
        return;
      }
      commit(doc, next, { select: null });
      setNotice(null);
      setAnnouncement('Crop removed.');
      return;
    }
    const result = removeSelection(doc, selection);
    if (!result) return;
    if (!result.ok) {
      setNotice(result.sentence);
      setAnnouncement(result.sentence);
      return;
    }
    commit(doc, result.doc, { select: null });
    setNotice(null);
    setAnnouncement(
      selection?.kind === 'segment'
        ? 'Part removed.'
        : selection?.kind === 'zoom'
          ? 'Zoom removed.'
          : 'Removed.',
    );
  }, [commit, videoSize]);

  // A layout change from the panel or the crop stage: one undo step, then its sentence.
  const editLayout = useCallback<LayoutEdit>(
    (change, spoken, options) => {
      const doc = latest.current.document;
      let next: ClipDocument;
      try {
        next = change(doc);
      } catch (cause) {
        console.warn(
          `Clip editor: a layout change was dropped (${cause instanceof Error ? cause.message : 'unknown'}).`,
        );
        return;
      }
      if (next === doc) return;
      const added = options?.selectArea === 'last' ? next.layout.areas.at(-1) : undefined;
      commit(doc, next, added ? { select: { kind: 'area', id: added.id } } : {});
      setAnnouncement(spoken);
    },
    [commit],
  );

  const duplicateSelected = useCallback((): boolean => {
    const { document: doc, selection } = latest.current;
    if (selection?.kind !== 'item') return false;
    const result = duplicateItem(doc, selection.id);
    if (!result.ok) {
      const sentence = addRefusalSentence(result.code);
      if (!sentence) return false;
      setNotice(sentence);
      setAnnouncement(sentence);
      return true;
    }
    if (!result.itemId) return false;
    commit(doc, result.doc, { select: { kind: 'item', id: result.itemId } });
    const copy = findItem(result.doc, result.itemId)?.item;
    if (copy) setAnnouncement(`Duplicated. ${itemLabel(copy)}.`);
    return true;
  }, [commit]);

  // ---- Text (Module 11) -----------------------------------------------------------------

  const [editingId, setEditingId] = useState<string | null>(null);
  const [emojiDropped, setEmojiDropped] = useState(false);
  const [recentColours, setRecentColours] = useState<string[]>([]);

  // The text being typed is drawn by the typing box, not the preview.
  useEffect(() => {
    overlayLayer.setHidden(editingId);
  }, [editingId, overlayLayer]);

  // Typing ends when its text goes (an undo, a delete from the timeline).
  useEffect(() => {
    if (editingId && !findItem(document, editingId)) setEditingId(null);
  }, [document, editingId]);

  useEffect(() => {
    if (!emojiDropped) return;
    const timer = window.setTimeout(() => setEmojiDropped(false), EMOJI_NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [emojiDropped]);

  const noteEmoji = useCallback(() => setEmojiDropped(true), []);

  const selectedText = useMemo((): TextItem | null => {
    if (state.selection?.kind !== 'item') return null;
    const found = findItem(document, state.selection.id);
    return found?.item.type === 'text' ? found.item : null;
  }, [document, state.selection]);

  /**
   * A new text or sticker made at the playhead goes on the clip, selected,
   * with its tab open; the id it got, or null when it was refused (the
   * refusal's sentence shows in the tools row).
   */
  const placeNew = useCallback(
    (make: (doc: ClipDocument, atMs: number) => TimedItem, tab: EditorTab): string | null => {
      const doc = latest.current.document;
      const at = playback.getCurrentMs();
      const result = addItem(doc, make(doc, at));
      if (!result.ok || !result.itemId) {
        const sentence = result.ok ? null : addRefusalSentence(result.code);
        if (sentence) {
          setNotice(sentence);
          setAnnouncement(sentence);
        }
        return null;
      }
      const added = findItem(result.doc, result.itemId)?.item;
      commit(doc, result.doc, { select: { kind: 'item', id: result.itemId } });
      dispatch({ type: 'tab', tab });
      // Placed before the playhead (near the clip's end): shown by moving there.
      if (added && !(at >= added.start && at < added.start + added.duration)) {
        playback.seekMs(added.start);
      }
      return result.itemId;
    },
    [commit, playback],
  );

  /** Add Text: a new text at the playhead, selected, with typing started on it. */
  const addText = useCallback(
    (styleId: TextStyleId) => {
      const id = placeNew((doc, at) => defaultTextItem(doc, at, styleId), 'text');
      if (!id) return;
      playback.pause();
      setEditingId(id);
      setAnnouncement('Text added. Type to change its words.');
    },
    [placeNew, playback],
  );

  // ---- Stickers (Module 12) ----------------------------------------------------------------

  /** A tile pressed: its sticker at the playhead, its file known at once so it shows straight away. */
  const addSticker = useCallback(
    (view: LibraryStickerView | StickerUploadView, from: 'library' | 'upload') => {
      const { width, height } = view;
      if (!width || !height) return;
      knowFiles([[tileKey(view, from), tileFileInfo(view)]]);
      const ref =
        from === 'library' ? { library: 'sticker' as const, id: view.id } : { asset: view.id };
      const id = placeNew(
        (doc, at) => defaultStickerItem(doc, at, ref, { width, height }),
        'elements',
      );
      if (id) setAnnouncement(`${view.name} added.`);
    },
    [knowFiles, placeNew],
  );

  const addBadge = useCallback(
    (platform: BadgePlatform, name: string, widthPx: number) => {
      const id = placeNew(
        (doc, at) => defaultBadgeItem(doc, at, platform, name, widthPx),
        'elements',
      );
      if (id) setAnnouncement('Follow Badge added.');
    },
    [placeNew],
  );

  /** A change to a sticker from the Elements tab (the selected one unless it names another). */
  const editSticker = useCallback<StickerEdit>(
    (change, coalesceKey, itemId) => {
      const { document: doc, selection } = latest.current;
      const id = itemId ?? (selection?.kind === 'item' ? selection.id : null);
      if (!id) return;
      const result = updateItem<StickerItem>(doc, id, (item) =>
        item.type === 'sticker' ? change(item) : item,
      );
      if (!result.ok || result.doc === doc) return;
      commit(doc, result.doc, { coalesceKey });
    },
    [commit],
  );

  const selectedSticker = useMemo((): StickerItem | null => {
    if (state.selection?.kind !== 'item') return null;
    const found = findItem(document, state.selection.id);
    return found?.item.type === 'sticker' ? found.item : null;
  }, [document, state.selection]);
  const selectedStickerFile = selectedSticker
    ? fileOfItem(selectedSticker, stickerFilesKnown)
    : null;

  /** A sticker bar's tiny picture on the timeline. */
  const stickerPicture = useCallback(
    (itemId: string): string | null => {
      const found = findItem(document, itemId);
      if (found?.item.type !== 'sticker') return null;
      const info = fileOfItem(found.item, stickerFilesKnown);
      return info?.previewUrl ?? info?.picture?.fileUrl ?? null;
    },
    [document, stickerFilesKnown],
  );

  // ---- Sound (Module 14) -------------------------------------------------------------------

  /** Add on a row: the sound at the playhead, its file known at once so it plays straight away. */
  const addSound = useCallback(
    (view: LibrarySoundView | SoundUploadView, from: 'library' | 'upload') => {
      const doc = latest.current.document;
      if (countSounds(doc) >= MAX_SOUNDS) {
        setNotice(TOO_MANY_SOUNDS);
        setAnnouncement(TOO_MANY_SOUNDS);
        return;
      }
      const kind = 'kind' in view ? view.kind : 'sfx';
      const durationMs = view.durationMs ?? 0;
      if (!(durationMs > 0)) return;
      knowSounds([[rowSoundKey(view, from), rowSoundInfo(view, kind)]]);
      const ref =
        from === 'library' ? { library: 'sound' as const, id: view.id } : { asset: view.id };
      const id = placeNew(
        (current, at) => defaultSoundItem(current, at, ref, kind, { durationMs }),
        'audio',
      );
      if (id) setAnnouncement(`${view.name} added.`);
    },
    [knowSounds, placeNew],
  );

  /** Volume, fades: one undo step each (a slider's drag is one). */
  const editSound = useCallback(
    (patch: SoundPatch, coalesceKey?: string) => {
      const { document: doc, selection } = latest.current;
      if (selection?.kind !== 'item') return;
      const result = updateSound(doc, selection.id, patch);
      if (result.ok && result.doc !== doc) commit(doc, result.doc, { coalesceKey });
    },
    [commit],
  );

  const selectedSound = useMemo((): AudioItem | null => {
    if (state.selection?.kind !== 'item') return null;
    const found = findItem(document, state.selection.id);
    return found?.item.type === 'sfx' || found?.item.type === 'music' ? found.item : null;
  }, [document, state.selection]);
  const selectedSoundFile = selectedSound ? soundInfoOfItem(selectedSound, soundFilesKnown) : null;

  /** From and For on a sound: an effect plays once, so For stops at its file's end. */
  const timeSound = useCallback(
    (startMs: number, durationMs: number) => {
      const { document: doc, selection } = latest.current;
      if (selection?.kind !== 'item') return;
      const found = findItem(doc, selection.id);
      if (found?.item.type !== 'sfx' && found?.item.type !== 'music') return;
      const item = found.item;
      const fileMs = soundInfoOfItem(item, soundFilesKnown)?.durationMs ?? null;
      const longest = soundLoops(item)
        ? durationMs
        : soundMaxDuration({ ...item, start: startMs }, fileMs, outputDuration(doc));
      const result = setItemTiming(doc, item.id, startMs, Math.min(durationMs, longest));
      if (result.ok && result.doc !== doc) commit(doc, result.doc);
    },
    [commit, soundFilesKnown],
  );

  /** Video Volume: the selected part, or every part when none is selected. */
  const videoPart = state.selection?.kind === 'segment' ? state.selection.id : null;
  const changeVideoVolume = useCallback(
    (volume: number, coalesceKey?: string) => {
      const { document: doc, selection } = latest.current;
      const next =
        selection?.kind === 'segment'
          ? setSegmentVolume(doc, selection.id, volume)
          : setVideoVolume(doc, volume);
      if (next !== doc) commit(doc, next, { coalesceKey });
    },
    [commit],
  );

  /** A sound bar's shape on the timeline, and how much of the bar its file fills. */
  const soundShape = useCallback(
    (itemId: string): { peaks: readonly number[]; fill: number; name: string | null } | null => {
      const found = findItem(document, itemId);
      if (found?.item.type !== 'sfx' && found?.item.type !== 'music') return null;
      const info = soundInfoOfItem(found.item, soundFilesKnown);
      if (!info?.peaks) return info?.name ? { peaks: [], fill: 1, name: info.name } : null;
      const fileMs = info.durationMs ?? 0;
      const fill =
        soundLoops(found.item) || !(fileMs > 0)
          ? 1
          : Math.max(0, Math.min(1, (fileMs - found.item.offsetMs) / found.item.duration));
      return { peaks: info.peaks, fill, name: info.name };
    },
    [document, soundFilesKnown],
  );

  // ---- Effects (Module 13) -------------------------------------------------------------------

  /** Add Zoom: two seconds at the playhead, selected. */
  const addZoomHere = useCallback(() => {
    const doc = latest.current.document;
    const result = addZoom(doc, playback.getCurrentMs());
    if (!result.ok) {
      const sentence = addZoomSentence(result.code);
      if (sentence) {
        setNotice(sentence);
        setAnnouncement(sentence);
      }
      return;
    }
    commit(doc, result.doc, { select: { kind: 'zoom', id: result.zoomId } });
    setNotice(null);
    setAnnouncement('Zoom added. Drag the dot on the clip to choose where it zooms.');
  }, [commit, playback]);

  const editZoom = useCallback(
    (zoomId: string, change: Partial<Pick<Zoom, 'scale' | 'ease'>>, coalesceKey?: string) => {
      const doc = latest.current.document;
      const result = updateZoom(doc, zoomId, change);
      if (result.ok && result.doc !== doc) commit(doc, result.doc, { coalesceKey });
    },
    [commit],
  );

  const timeZoom = useCallback(
    (zoomId: string, startMs: number, durationMs: number, keep: 'length' | 'from') => {
      const doc = latest.current.document;
      const result = setZoomTiming(doc, zoomId, startMs, durationMs, keep);
      if (!result.ok) {
        setNotice(ZOOM_ROOM_SENTENCE);
        setAnnouncement(ZOOM_ROOM_SENTENCE);
        return;
      }
      if (result.doc !== doc) commit(doc, result.doc);
    },
    [commit],
  );

  const removeZoomNow = useCallback(
    (zoomId: string) => {
      const doc = latest.current.document;
      const result = removeZoom(doc, zoomId);
      if (!result.ok) return;
      commit(doc, result.doc, { select: null });
      setAnnouncement('Zoom removed.');
    },
    [commit],
  );

  /** A part's speed; the playhead stays on the video moment it showed. */
  const speedPart = useCallback(
    (segmentId: string, speed: Speed) => {
      const doc = latest.current.document;
      const result = setSpeed(doc, segmentId, speed);
      if (!result.ok) {
        const sentence = speedSentence(result.code);
        setNotice(sentence);
        setAnnouncement(sentence);
        return;
      }
      if (result.doc === doc) return;
      const at = playheadAfterSpeed(
        doc,
        result.doc,
        playback.getCurrentMs(),
        segmentId,
        outputDuration(result.doc),
      );
      commit(doc, result.doc);
      setNotice(null);
      setAnnouncement(`Speed ${speed}x.`);
      // After the engine has the new document (its effect runs first).
      window.requestAnimationFrame(() => playback.seekMs(at));
    },
    [commit, playback],
  );

  const editLooks = useCallback(
    (change: Partial<Looks>, coalesceKey?: string) => {
      const doc = latest.current.document;
      const looks = { ...doc.looks, ...change };
      if (
        looks.colour === doc.looks.colour &&
        looks.strength === doc.looks.strength &&
        looks.vignette === doc.looks.vignette
      ) {
        return;
      }
      commit(doc, { ...doc, looks }, { coalesceKey });
    },
    [commit],
  );

  const editFades = useCallback(
    (change: Partial<Fades>) => {
      const doc = latest.current.document;
      const fades = { ...doc.fades, ...change };
      if (fades.inMs === doc.fades.inMs && fades.outMs === doc.fades.outMs) return;
      commit(doc, { ...doc, fades });
    },
    [commit],
  );

  /** A change to the selected text from the Text tab. */
  const editText = useCallback<TextEdit>(
    (change, coalesceKey) => {
      const { document: doc, selection } = latest.current;
      if (selection?.kind !== 'item') return;
      const result = updateItem<TextItem>(doc, selection.id, (item) =>
        item.type === 'text' ? change(item) : item,
      );
      if (!result.ok || result.doc === doc) return;
      commit(doc, result.doc, { coalesceKey });
    },
    [commit],
  );

  const timeText = useCallback(
    (startMs: number, durationMs: number) => {
      const { document: doc, selection } = latest.current;
      if (selection?.kind !== 'item') return;
      const result = setItemTiming(doc, selection.id, startMs, durationMs);
      if (result.ok && result.doc !== doc) commit(doc, result.doc);
    },
    [commit],
  );

  const anchorText = useCallback(
    (choice: 'moment' | 'whole') => {
      const { document: doc, selection } = latest.current;
      if (selection?.kind !== 'item') return;
      const result = setItemAnchor(doc, selection.id, choice);
      if (result.ok && result.doc !== doc) {
        commit(doc, result.doc);
        setAnnouncement(choice === 'whole' ? 'Shows for the whole clip.' : 'Shows on this moment.');
      }
    },
    [commit],
  );

  /** Words typed on the clip: each change goes in, one undo step for the whole typing. */
  const typeText = useCallback(
    (itemId: string, text: string) => {
      if (text.trim() === '') return;
      const doc = latest.current.document;
      const result = updateItem<TextItem>(doc, itemId, (item) =>
        item.type === 'text' && item.text !== text ? { ...item, text } : item,
      );
      if (result.ok && result.doc !== doc) {
        commit(doc, result.doc, { coalesceKey: `words:${itemId}` });
      }
    },
    [commit],
  );

  /** Typing ended: the words stay, and a text left empty is removed. */
  const finishTyping = useCallback(
    (itemId: string, text: string) => {
      setEditingId((current) => (current === itemId ? null : current));
      if (text.trim() !== '') {
        typeText(itemId, text);
        return;
      }
      const doc = latest.current.document;
      const result = removeItem(doc, itemId);
      if (result.ok) {
        commit(doc, result.doc, { select: null });
        setAnnouncement('Empty text removed.');
      }
    },
    [commit, typeText],
  );

  /** Typing into a text (the handles only offer one on screen at the playhead). */
  const startTyping = useCallback(
    (itemId: string) => {
      const found = findItem(latest.current.document, itemId);
      if (found?.item.type !== 'text') return;
      dispatch({ type: 'select', selection: { kind: 'item', id: itemId } });
      dispatch({ type: 'tab', tab: 'text' });
      playback.pause();
      setEditingId(itemId);
    },
    [playback],
  );

  /** An arrow key on a selected text or sticker: a pixel (ten with Shift), kept on the clip. */
  const nudgeSelected = useCallback(
    (direction: { x: number; y: number }, big: boolean): boolean => {
      const { document: doc, selection } = latest.current;
      if (selection?.kind !== 'item') return false;
      const found = findItem(doc, selection.id);
      if (found?.item.type !== 'text' && found?.item.type !== 'sticker') return false;
      const item = found.item;
      const frame = itemFrame(item, doc.canvas, heights.getSnapshot().get(item.id));
      const to = nudgeFrame(frame, direction, big, doc.canvas);
      const { x, y } = centreToTransform(to.x, to.y, doc.canvas);
      const result = updateItem<StageItem>(doc, item.id, (current) =>
        current.type === 'text' || current.type === 'sticker'
          ? { ...current, transform: { ...current.transform, x, y } }
          : current,
      );
      if (result.ok && result.doc !== doc) {
        commit(doc, result.doc, { coalesceKey: `nudge:${item.id}` });
      }
      return true;
    },
    [commit, heights],
  );

  const splitProblemAt = useCallback(
    (ms: number) => {
      const result = splitAtPlayhead(document, ms);
      return result.ok ? null : result.sentence;
    },
    [document],
  );
  const removeProblem = state.selection
    ? state.selection.kind === 'area'
      ? document.layout.areas.length > 1
        ? null
        : LAST_CROP_SENTENCE
      : removeProblemOf(document, state.selection)
    : 'Select a part or an item first.';

  // ---- Shortcuts ------------------------------------------------------------------------

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const toggleTranscript = useCallback(
    () => setTranscriptOpen(!transcriptOpen),
    [setTranscriptOpen, transcriptOpen],
  );
  const commands = useRef({
    splitHere,
    removeSelected,
    duplicateSelected,
    nudgeSelected,
    startTyping,
    toggleTranscript,
  });
  commands.current = {
    splitHere,
    removeSelected,
    duplicateSelected,
    nudgeSelected,
    startTyping,
    toggleTranscript,
  };

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing) return;
      const place = keyPlaceOf(event.target, window.document);

      const history = editorShortcut(event, place);
      if (history) {
        event.preventDefault();
        dispatch({ type: history });
        return;
      }
      if (place.typing || place.sheltered || place.dialogOpen) return;

      const target = event.target instanceof Element ? event.target : null;
      // With a text selected the arrows move it, unless a slider or tab owns them.
      const nudge = nudgeFor(event);
      if (nudge && !target?.closest(OWN_KEYS) && commands.current.nudgeSelected(nudge, nudge.big)) {
        event.preventDefault();
        return;
      }

      const command = clipShortcutFor(event);
      if (!command) return;
      // A focused button, slider or tab keeps its own Space and arrows.
      if (CONTROL_OWNED.has(command) && target?.closest(OWN_KEYS)) return;
      // Delete inside the Transcript pane cuts words there, never a part of the timeline.
      if (command === 'delete' && target?.closest(TRANSCRIPT_KEYS)) return;

      switch (command) {
        case 'toggle':
          playback.toggle();
          break;
        case 'frameBack':
        case 'frameForward':
          playback.stepFrames(command === 'frameBack' ? -1 : 1);
          break;
        case 'secondBack':
        case 'secondForward':
          playback.seekMs(playback.getCurrentMs() + (command === 'secondBack' ? -1000 : 1000));
          break;
        case 'start':
          playback.seekMs(0);
          break;
        case 'end':
          playback.seekMs(outputDuration(latest.current.document));
          break;
        case 'split':
          commands.current.splitHere();
          break;
        case 'delete':
          if (!latest.current.selection) return;
          commands.current.removeSelected();
          break;
        case 'duplicate':
          // Nothing to copy: Ctrl+D stays the browser's.
          if (!commands.current.duplicateSelected()) return;
          break;
        case 'zoomIn':
          dock.current?.zoomIn();
          break;
        case 'zoomOut':
          dock.current?.zoomOut();
          break;
        case 'fit':
          dock.current?.fit();
          break;
        case 'escape':
          if (!latest.current.selection) return;
          dispatch({ type: 'select', selection: null });
          break;
        case 'edit': {
          const selection = latest.current.selection;
          if (selection?.kind !== 'item') return;
          const found = findItem(latest.current.document, selection.id);
          if (found?.item.type !== 'text') return;
          commands.current.startTyping(selection.id);
          break;
        }
        case 'transcript':
          commands.current.toggleTranscript();
          break;
        case 'shortcuts':
          setShortcutsOpen(true);
          break;
      }
      event.preventDefault();
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [playback]);

  // ---- Leaving with changes unsaved ---------------------------------------------------

  const saved = useRef(status === 'saved');
  useLayoutEffect(() => {
    // A clip that was deleted has nothing left to save.
    saved.current = status === 'saved' || refusal?.kind === 'gone';
  });
  const leaving = useRef(false);
  const answerLeave = useRef<((go: boolean) => void) | null>(null);
  const [leave, setLeave] = useState<{ href: string | null } | null>(null);

  useEffect(() => {
    let live = true;

    // Ahead of the link's own handler (Next's Link listens on the way back up),
    // so a held click never starts a navigation.
    function onClick(event: MouseEvent) {
      if (saved.current) return;
      const href = leaveHref(event, linkOf(event.target), window.location.href);
      if (href === null) return;

      event.preventDefault();
      event.stopPropagation();
      if (leaving.current) return;
      leaving.current = true;

      void settleWithin(flush(), LEAVE_WAIT_MS).then((done) => {
        if (!live) return;
        if (done) {
          leaving.current = false;
          router.push(href);
        } else {
          setLeave({ href });
        }
      });
    }

    window.document.addEventListener('click', onClick, true);
    return () => {
      live = false;
      leaving.current = false;
      window.document.removeEventListener('click', onClick, true);
    };
  }, [flush, router]);

  useEffect(() => {
    let live = true;
    const unregister = registerLeaveGuard(async () => {
      if (saved.current) return true;
      if (leaving.current) return false;
      leaving.current = true;

      const done = await settleWithin(flush(), LEAVE_WAIT_MS);
      if (!live) return true;
      if (done) {
        leaving.current = false;
        return true;
      }
      return new Promise<boolean>((resolve) => {
        answerLeave.current = resolve;
        setLeave({ href: null });
      });
    });

    return () => {
      live = false;
      unregister();
      // The editor has gone, so nothing holds the move back any more.
      answerLeave.current?.(true);
      answerLeave.current = null;
    };
  }, [flush]);

  const onLeaveOpenChange = useCallback((open: boolean) => {
    if (open) return;
    leaving.current = false;
    setLeave(null);
    answerLeave.current?.(false);
    answerLeave.current = null;
  }, []);

  const leaveAnyway = () => {
    const href = leave?.href ?? null;
    leaving.current = false;
    // A move the router makes as a full page load does not ask twice.
    letGo();
    setLeave(null);
    answerLeave.current?.(true);
    answerLeave.current = null;
    if (href) router.push(href);
  };

  // ---- Render ---------------------------------------------------------------------------

  const split = state.tab === 'layouts';

  // Stickers or sounds whose files left the library: ask before an export leaves them out.
  const goneNow = () =>
    goneItems(
      latest.current.document,
      (item) => fileOfItem(item, stickerFilesKnown)?.missing === true,
      (item) => {
        const info = soundInfoOfItem(item, soundFilesKnown);
        return info ? info.missing || info.removed : false;
      },
    );

  const lastExport = latestDone(exporting.exports);
  const sendExportRun: SendExportRun = {
    start: () => startExport(),
    cancel: () => void exporting.cancel(),
    jobId: exporting.jobId,
    job: exporting.job.job,
    busy: exporting.starting || leaveOut !== null || exportQueued,
    problem: exporting.problem,
  };

  const startExport = () => {
    setTab('export');
    const gone = goneNow();
    if (gone.stickers.length + gone.sounds.length > 0) {
      setLeaveOut(gone);
      return;
    }
    void exporting.start();
  };

  const leaveOutAndExport = () => {
    const gone = leaveOut;
    setLeaveOut(null);
    if (!gone) return;
    const start = latest.current.document;
    let next = start;
    for (const id of gone.stickers) {
      const result = removeItem(next, id);
      if (result.ok) next = result.doc;
    }
    for (const id of gone.sounds) {
      const result = removeSound(next, id);
      if (result.ok) next = result.doc;
    }
    if (next !== start) commit(start, next, { select: null });
    // The export starts once the autosave has the trimmed document (the effect below).
    setExportQueued(true);
  };

  const panelBody =
    state.tab === 'export' ? (
      <ExportPanel
        orgId={orgId}
        state={exporting}
        sharp={detail.sharp}
        document={document}
        sourceFps={detail.video?.fps ?? null}
        onExport={startExport}
        onSend={openSend}
      />
    ) : state.tab === 'layouts' ? (
      <LayoutsPanel
        document={document}
        videoSize={videoSize}
        labelledBy={panelHeadingId('layouts')}
        onEdit={editLayout}
      />
    ) : state.tab === 'elements' ? (
      <ElementsPanel
        selected={selectedSticker}
        selectedFile={selectedStickerFile}
        totalMs={outputDuration(document)}
        fps={fps}
        onAddLibrary={(view) => addSticker(view, 'library')}
        onAddUpload={(view) => addSticker(view, 'upload')}
        onAddBadge={addBadge}
        onEdit={editSticker}
        onTiming={timeText}
        onAnchor={anchorText}
        onRemove={removeSelected}
      />
    ) : state.tab === 'audio' ? (
      <AudioPanel
        selected={selectedSound}
        selectedFile={selectedSoundFile}
        totalMs={outputDuration(document)}
        fps={fps}
        videoVolume={videoVolumeOf(document, videoPart)}
        videoTarget={videoPart ? 'part' : 'clip'}
        onVideoVolume={changeVideoVolume}
        playback={playback}
        readLevel={readLevel}
        onAddLibrary={(view) => addSound(view, 'library')}
        onAddUpload={(view) => addSound(view, 'upload')}
        onEdit={editSound}
        onTiming={timeSound}
        onAnchor={anchorText}
        onRemove={removeSelected}
      />
    ) : state.tab === 'captions' ? (
      <CaptionsPanel
        track={captionsTrack}
        layout={captionsLayout}
        captions={captions}
        translatePrice={aiMinutesCost('translate', outputDuration(document))}
        recent={recentColours}
        onRecent={(hex) => setRecentColours((current) => pushRecent(current, hex))}
        safeArea={safeAreaShown}
        onSafeArea={safeArea ? setSafeAreaShown : null}
        onEdit={editCaptions}
        onRemove={removeCaptions}
        onSeek={(ms) => playback.seekMs(ms)}
        onNotice={setNotice}
      />
    ) : state.tab === 'effects' ? (
      <EffectsPanel
        document={document}
        selection={state.selection}
        fps={fps}
        playback={playback}
        filmstrip={detail.filmstrip}
        onAddZoom={addZoomHere}
        onZoom={editZoom}
        onZoomTiming={timeZoom}
        onRemoveZoom={removeZoomNow}
        onSpeed={speedPart}
        onLooks={editLooks}
        onFades={editFades}
      />
    ) : state.tab === 'text' ? (
      <TextPanel
        item={selectedText}
        totalMs={outputDuration(document)}
        fps={fps}
        recent={recentColours}
        onRecent={(hex) => setRecentColours((current) => pushRecent(current, hex))}
        emojiDropped={emojiDropped}
        onEmoji={noteEmoji}
        onAdd={addText}
        onEdit={editText}
        onTiming={timeText}
        onAnchor={anchorText}
        onRemove={removeSelected}
      />
    ) : undefined;

  return (
    <div data-testid="clip-editor" className="flex min-h-0 min-w-0 flex-1 gap-3">
      <StudioFonts />
      <TabRail
        tab={state.tab}
        onTab={(tab) => {
          // The open tab pressed again folds the panel, as an editor's activity bar does.
          if (tab === state.tab && panelOpen) setPanelOpen(false);
          else setTab(tab);
        }}
        onShortcuts={() => setShortcutsOpen(true)}
      />
      {panelOpen ? (
        <EditorPanel
          tab={state.tab}
          onTab={setTab}
          onExport={startExport}
          exportBusy={exporting.starting || exporting.running}
          onHide={() => setPanelOpen(false)}
        >
          {panelBody}
        </EditorPanel>
      ) : null}
      {transcriptOpen ? (
        <TranscriptPane
          orgId={orgId}
          clipId={clipId}
          videoId={detail.video?.id ?? null}
          videoDurationMs={videoDurationMs}
          document={shownDocument}
          playback={playback}
          captionsTrack={captionsTrack}
          waveform={detail.waveform}
          aiOn={captions.ai ? captions.ai.captions === true : null}
          onApply={applyCut}
          onEditCaptions={(change) => editCaptions(change)}
          onNotice={setNotice}
          onClose={() => setTranscriptOpen(false)}
        />
      ) : null}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <EditorTopBar
          backHref={back.href}
          backLabel={back.label}
          title={title}
          onRename={(next) => dispatch({ type: 'rename', title: next, now: Date.now() })}
          status={status}
          mod={mod}
          canUndo={editorCanUndo(state)}
          canRedo={editorCanRedo(state)}
          onUndo={() => dispatch({ type: 'undo' })}
          onRedo={() => dispatch({ type: 'redo' })}
          onShowPanel={panelOpen ? undefined : () => setPanelOpen(true)}
          transcriptOpen={transcriptOpen}
          onTranscript={toggleTranscript}
          onExport={() => setTab('export')}
          exportProgress={exporting.running ? (exporting.job.job?.progress ?? 0) : null}
        />

        {status === 'conflict' ? (
          <Alert variant="warning" className="items-center" data-testid="clip-conflict">
            <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            <p className="m-0 min-w-0 flex-1">{reloadProblem ?? CONFLICT_SENTENCE}</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void reload()}
              disabled={reloading}
            >
              Reload
            </Button>
          </Alert>
        ) : null}
        {status === 'failed' && refusal ? (
          <Alert variant="danger" className="items-center" data-testid="clip-save-refused">
            <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            <p className="m-0 min-w-0 flex-1">{refusal.message}</p>
            {refusal.kind === 'retry' ? (
              <Button variant="secondary" size="sm" onClick={autosave.retry}>
                Try Again
              </Button>
            ) : refusal.kind === 'signIn' ? (
              <Button variant="secondary" size="sm" onClick={() => window.location.reload()}>
                Login
              </Button>
            ) : null}
          </Alert>
        ) : null}
        {detail.sharp === 'gone' ? (
          <Alert variant="warning" className="items-center" data-testid="clip-sharp-gone">
            <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
            <p className="m-0 min-w-0 flex-1">{SHARP_GONE_SENTENCE}</p>
          </Alert>
        ) : null}

        {/* The same tree in every tab, so the clip's stage is never remounted. */}
        <div
          className="flex min-h-0 min-w-0 flex-1 gap-3"
          data-testid={split ? 'clip-split-stage' : undefined}
        >
          {split ? (
            <CropStage
              engine={engine}
              playback={playback}
              document={document}
              shown={shownDocument}
              videoSize={videoSize}
              hasVideo={detail.playback !== null}
              selection={state.selection}
              onSelect={select}
              onCommit={commit}
              onDraft={setDraft}
              onEdit={editLayout}
              onAnnounce={setAnnouncement}
            />
          ) : null}
          <section
            aria-label={split ? 'Clip' : undefined}
            className={cn('flex min-h-0 min-w-0 flex-col gap-2', split ? 'flex-[2]' : 'flex-1')}
          >
            {split ? (
              <p aria-hidden="true" className="m-0 shrink-0 type-label text-sm text-ink">
                Clip
              </p>
            ) : null}
            <Stage
              canvas={shownDocument.canvas}
              containerRef={containerRef}
              playback={playback}
              missing={detail.playback ? null : NO_PREVIEW_SENTENCE}
              onRetry={() => void refreshAddress()}
            >
              <TransformLayer
                document={document}
                shown={shownDocument}
                selection={state.selection}
                playback={playback}
                heights={heights}
                editingId={editingId}
                fontFamily={clipFontFamily}
                onSelect={select}
                onCommit={commit}
                onDraft={setDraft}
                onEdit={startTyping}
                onTyping={typeText}
                onTypingDone={finishTyping}
                onEmoji={noteEmoji}
              />
              {exporting.mark ? <StageMark canvas={shownDocument.canvas} /> : null}
              {safeAreaShown && safeArea && state.tab === 'captions' ? (
                <SafeAreaOverlay covered={safeArea.covered} />
              ) : null}
            </Stage>
          </section>
        </div>
        <TransportBar playback={playback} dock={dock} disabled={!detail.playback} />
        <TimelineDock
          document={document}
          selection={state.selection}
          playback={playback}
          filmstrip={detail.filmstrip}
          waveform={detail.waveform}
          fps={fps}
          held={detail.held}
          videoDurationMs={videoDurationMs}
          gettingMore={gettingMore}
          notice={notice}
          splitProblemAt={splitProblemAt}
          removeProblem={removeProblem}
          controlRef={dock}
          onSelect={select}
          onOpen={openSelection}
          onCommit={commit}
          onDraft={setDraft}
          onSplit={splitHere}
          onRemove={removeSelected}
          onAnnounce={setAnnouncement}
          stickerPicture={stickerPicture}
          soundShape={soundShape}
          captionBars={captionRow}
          onCaptions={(ms) => {
            playback.seekMs(ms);
            setTab('captions');
          }}
        />
      </div>

      <ShapeDialog
        open={shapeOpen}
        initial={initialDocument.canvas.ratio}
        backHref={back.href}
        backLabel={back.label}
        onChoose={chooseFirstShape}
      />
      <EditorShortcutsSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      {lastExport?.media ? (
        <SendClipDialog
          open={sendOpen}
          onOpenChange={setSendOpen}
          orgId={orgId}
          clip={{
            id: clipId,
            title,
            durationMs: outputDuration(document),
            exportedMediaId: lastExport.media.id,
          }}
          outdated={changedSince(document, lastExport.fingerprint)}
          exportRun={sendExportRun}
          onSent={(group) => {
            setSendOpen(false);
            router.push(composerHref(orgId, group));
          }}
        />
      ) : null}
      <AlertDialog open={leaveOut !== null} onOpenChange={(open) => !open && setLeaveOut(null)}>
        <AlertDialogContent data-testid="clip-leave-out">
          <AlertDialogHeader>
            <AlertDialogTitle>{LEAVE_OUT_TITLE}</AlertDialogTitle>
            <AlertDialogDescription>
              {leaveOut ? leaveOutSentence(leaveOut.stickers.length, leaveOut.sounds.length) : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={leaveOutAndExport}>Export Without Them</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <p className="sr-only" aria-live="polite" data-testid="clip-announcer">
        {announcement}
      </p>
      <AlertDialog open={leave !== null} onOpenChange={onLeaveOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{LEAVE_TITLE}</AlertDialogTitle>
            <AlertDialogDescription>{LEAVE_SENTENCE}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction onClick={leaveAnyway}>Leave Anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * The small PostGear mark a plan puts on its exports, drawn where the export
 * draws it (`WATERMARK_*` in the render plan: a width fraction of the canvas,
 * the same margin from the right and the bottom), so the preview matches.
 */
/**
 * The Safe Area Guide (Sprint 13): the strips where TikTok, Reels and Shorts
 * draw their own buttons and text, hatched over the stage while the Captions
 * tab is open. An aid in the editor only: never in an export.
 */
function SafeAreaOverlay({
  covered,
}: {
  covered: ReadonlyArray<{ x: number; y: number; w: number; h: number }>;
}) {
  return (
    <div
      aria-hidden="true"
      data-testid="clip-safe-area"
      className="pointer-events-none absolute inset-0"
    >
      {covered.map((strip) => (
        <span
          key={`${strip.x}-${strip.y}`}
          className="absolute border border-dashed border-white/70"
          style={{
            left: `${strip.x * 100}%`,
            top: `${strip.y * 100}%`,
            width: `${strip.w * 100}%`,
            height: `${strip.h * 100}%`,
            background:
              'repeating-linear-gradient(135deg, rgba(0, 0, 0, 0.35) 0 8px, rgba(0, 0, 0, 0.15) 8px 16px)',
          }}
        />
      ))}
    </div>
  );
}

function StageMark({ canvas }: { canvas: { width: number; height: number } }) {
  const margin = WATERMARK_MARGIN_FRACTION * 100;
  return (
    // biome-ignore lint/performance/noImgElement: drawn at a fraction of the stage, like the export.
    <img
      src="/clips/watermark.png"
      alt=""
      aria-hidden="true"
      draggable={false}
      data-testid="clip-stage-mark"
      className="pointer-events-none absolute h-auto select-none"
      style={{
        width: `${WATERMARK_WIDTH_FRACTION * 100}%`,
        right: `${margin}%`,
        // A margin of the canvas width, as a share of its height.
        bottom: `${(margin * canvas.width) / canvas.height}%`,
        opacity: WATERMARK_OPACITY,
      }}
    />
  );
}
