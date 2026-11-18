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
} from '@postgear/ui';
import {
  type ClipDocument,
  documentRange,
  duplicateItem,
  findItem,
  outputDuration,
  removeArea,
  type SourceRange,
} from '@postgear/video-engine';
import { usePreviewEngine } from '@postgear/video-preview';
import { TriangleAlert } from 'lucide-react';
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
import {
  editorShortcut,
  isApplePlatform,
  keyPlaceOf,
  LEAVE_WAIT_MS,
  leaveHref,
  linkOf,
  settleWithin,
} from '@/components/studio/studio-editor-model';
import { ApiError } from '@/lib/api';
import { getClip, openClip, requestMoreVideo } from '@/lib/clips-api';
import { registerLeaveGuard } from '@/lib/leave-guard';
import type { ClipDetail } from '@/types/clips';
import { CropStage } from '../layouts/crop-stage';
import { LAST_CROP_SENTENCE } from '../layouts/layouts-model';
import { type LayoutEdit, LayoutsPanel } from '../layouts/layouts-panel';
import { MoreVideoRequester } from '../timeline/more-video';
import {
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
  SHARP_GONE_SENTENCE,
  videoSizeOf,
} from './clip-editor-model';
import { EditorPanel, panelHeadingId } from './editor-panel';
import { CONTROL_OWNED, clipShortcutFor } from './editor-shortcuts';
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
import { ExportPanel, useClipExport } from './export-panel';
import { usePlaybackStore } from './playback';
import { ShapeDialog } from './shape-dialog';
import { Stage } from './stage';
import { TabRail } from './tab-rail';
import { TimelineDock } from './timeline-dock';
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
  'button, a[href], [role="slider"], [role="tab"], [role="separator"], [role="menuitem"], [role="option"], [role="radio"], [role="checkbox"]';

/** Renews the signed address this long before it runs out. */
const RENEW_EARLY_MS = 5 * 60_000;
/** How often the clip is read again while its sharp video is being fetched. */
const SHARP_POLL_MS = 4_000;
/** How long a refused edit's sentence stays in the tools row. */
const NOTICE_MS = 4_000;

const rangeKey = (range: SourceRange | null) => (range ? `${range.fromMs}-${range.toMs}` : '');

export function ClipEditor({
  orgId,
  initial,
  document: initialDocument,
}: {
  orgId: string;
  initial: ClipDetail;
  /** The clip's document, read by the page (it never opens without one). */
  document: ClipDocument;
}) {
  const router = useRouter();
  const clipId = initial.clip.id;
  const [detail, setDetail] = useState(initial);
  const [state, dispatch] = useReducer(editorReducer, undefined, () =>
    createEditorState({ document: initialDocument, title: initial.clip.title }),
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
  const { engine, containerRef } = usePreviewEngine({ document: shownDocument, source });
  const playback = usePlaybackStore(engine);
  const dock = useRef<DockControls | null>(null);

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

  const exporting = useClipExport({ orgId, clipId, flush });

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

  const setTab = useCallback((tab: EditorTab) => dispatch({ type: 'tab', tab }), []);

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
    if (!result.ok || !result.itemId) return false;
    commit(doc, result.doc, { select: { kind: 'item', id: result.itemId } });
    const copy = findItem(result.doc, result.itemId)?.item;
    if (copy) setAnnouncement(`Duplicated. ${itemLabel(copy)}.`);
    return true;
  }, [commit]);

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
  const commands = useRef({ splitHere, removeSelected, duplicateSelected });
  commands.current = { splitHere, removeSelected, duplicateSelected };

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

      const command = clipShortcutFor(event);
      if (!command) return;
      const target = event.target instanceof Element ? event.target : null;
      // A focused button, slider or tab keeps its own Space and arrows.
      if (CONTROL_OWNED.has(command) && target?.closest(OWN_KEYS)) return;

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

  const startExport = () => {
    setTab('export');
    void exporting.start();
  };

  return (
    <div data-testid="clip-editor" className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
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
        onShortcuts={() => setShortcutsOpen(true)}
        onExport={() => setTab('export')}
      />

      {status === 'conflict' ? (
        <Alert variant="warning" className="items-center" data-testid="clip-conflict">
          <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">{reloadProblem ?? CONFLICT_SENTENCE}</p>
          <Button variant="secondary" size="sm" onClick={() => void reload()} disabled={reloading}>
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

      <div className="flex min-h-0 flex-1 gap-3">
        <TabRail tab={state.tab} onTab={setTab} />
        <EditorPanel
          tab={state.tab}
          onTab={setTab}
          onExport={startExport}
          exportBusy={exporting.starting || exporting.running}
        >
          {state.tab === 'export' ? (
            <ExportPanel orgId={orgId} state={exporting} sharp={detail.sharp} />
          ) : state.tab === 'layouts' ? (
            <LayoutsPanel
              document={document}
              videoSize={videoSize}
              labelledBy={panelHeadingId('layouts')}
              onEdit={editLayout}
            />
          ) : undefined}
        </EditorPanel>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
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
              />
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
          />
        </div>
      </div>

      <ShapeDialog
        open={shapeOpen}
        initial={initialDocument.canvas.ratio}
        backHref={back.href}
        backLabel={back.label}
        onChoose={chooseFirstShape}
      />
      <EditorShortcutsSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
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
