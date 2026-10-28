'use client';

/**
 * The Design Studio editor (Sprint 9, Screen 4): the slide on the canvas
 * between the slides rail and the properties panel, under the action row,
 * and every dialog that row opens (DS-4 to DS-9).
 *
 * - The design is one undoable document (`editor-state.ts`). The canvas, the
 *   rail, the panel and the dialogs hand every edit here as a function of the
 *   latest document, so they never disagree and every edit can be undone.
 * - Autosave sends what is on screen (`use-autosave.ts`), and closing the
 *   editor sends whatever is still unsaved. A save that met a newer version
 *   stops and asks (DS-6.2); one that was refused says why, with what is left
 *   to do: Try Again, Sign In for a session that ended, or Back To Studio for
 *   a design that was deleted. A save refused for a premium look the plan
 *   does not include (Sprint 9b) opens the dialog that says why and locks
 *   premium looks from then on; the edits stay on screen, undoable, and the
 *   save waits until the look is taken out, or until Try Again finds the
 *   plan upgraded (See Plans opens in a new tab, so the edits stay here).
 * - Make A Story Version (Design tab) saves, has the API copy the design as
 *   a story, and opens the copy.
 * - A link that leaves the editor while something is unsaved saves it first,
 *   and asks only when that fails (DS-6.3). So does a move from the top bar
 *   (a workspace switch, signing out, a menu item, a search result, a
 *   notification), through `lib/leave-guard.ts`. Closing the tab is the
 *   browser's own prompt (`use-autosave.ts`). A design that was deleted has
 *   nothing left to save, so leaving it never asks.
 * - Below lg the rail and the panel are drawers, opened from the action row.
 *
 * The server page hands the design down, or null when it did not load it (a
 * workspace switch in flight, or a failure worth another try); the editor
 * then loads it itself once the workspace is ready. A design that is not
 * there is the route's not-found page (`design-missing.tsx`).
 */
import { CrownIcon } from '@animateicons/react/lucide/crown-icon';
import { LogInIcon } from '@animateicons/react/lucide/log-in-icon';
import { RefreshCwIcon } from '@animateicons/react/lucide/refresh-cw-icon';
import { RotateCcwIcon } from '@animateicons/react/lucide/rotate-ccw-icon';
import { SaveIcon } from '@animateicons/react/lucide/save-icon';
import { resetDocument, resetSlide, type SlotId, setCaption } from '@postgear/design-engine';
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
  MotionIcon,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Spinner,
} from '@postgear/ui';
import { TriangleAlert } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
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
import { withNext } from '@/app/(auth)/login/safe-next';
import { MediaPickerDialog } from '@/components/composer/media-picker-dialog';
import { ActionLink } from '@/components/home/home-actions';
import { useWorkspaceScope } from '@/components/navigation/workspace-provider';
import { api } from '@/lib/api';
import { registerLeaveGuard } from '@/lib/leave-guard';
import type { MediaItem } from '@/types/media';
import type { BrandKitView, DesignDetail, StudioAccess } from '@/types/studio';
import { ALERT_ICON, ALERT_TEXT, BackToStudio, DesignMissing } from './design-missing';
import type { SaveRefusal, ScreenVersion } from './editor-autosave';
import { EditorCanvas } from './editor-canvas';
import { EditorPanel, type MediaPurpose, type PanelTab } from './editor-panel';
import {
  type ApplyChange,
  canRedoEdit,
  canUndoEdit,
  createEditorState,
  documentOf,
  editorReducer,
  issuesBySlide,
  slideIndexOf,
} from './editor-state';
import { EditorTopBar } from './editor-top-bar';
import { ExportDialog } from './export-dialog';
import { LayoutPickerDialog, type LayoutPickerMode } from './layout-picker-dialog';
import { isPremiumRefusal, PremiumLockDialog } from './premium-lock';
import { PreviewDialog } from './preview-dialog';
import { SendDialog } from './send-dialog';
import { ShareDialog } from './share-dialog';
import { SlidesRail, useSlideDeletion } from './slides-rail';
import {
  backFromComposer,
  CONFLICT_CHOICES,
  CONFLICT_MESSAGE,
  DESIGN_LOAD_FAILED_MESSAGE,
  type DesignLoad,
  type DesignOutcome,
  editorShortcut,
  focusFirstIn,
  isApplePlatform,
  keyPlaceOf,
  LEAVE_WAIT_MS,
  type LoadFailure,
  latestProblem,
  leaveHref,
  linkOf,
  loadFailureOf,
  type MediaMap,
  mediaRefOf,
  mergeMedia,
  NO_OVERFLOW,
  type OverflowMap,
  openerOf,
  pickedMediaId,
  pickerCopy,
  SAVE_FAILED_MESSAGE,
  STORY_UNSAVED_MESSAGE,
  type StoryVersionResult,
  settleWithin,
  shortcutOf,
  storyVersionProblem,
  withKitLogo,
  withMediaRef,
  withOverflow,
  withPickedMedia,
} from './studio-editor-model';
import { StudioPanel } from './studio-ui';
import { mediaResolver } from './studio-view-model';
import { useAutosave } from './use-autosave';
import { useDialog } from './use-dialog';
import { useBrandKits, useStudioAccess } from './use-studio-data';

/** What the canvas and the panel get for a slide with nothing too long on it. */
const NO_SLOTS: readonly SlotId[] = [];

/** The editor shows no design status, so a save's or an export's answer needs nothing here. */
const ignore = () => undefined;

/** Where the rail and the panel stop being drawers (Tailwind's lg). */
const WIDE = '(min-width: 1024px)';

export interface StudioEditorProps {
  orgId: string;
  designId: string;
  /** The server's answer, or null to load the design here. */
  initial: DesignOutcome | null;
  initialKits: BrandKitView[] | null;
  /** Whether the plan includes premium looks, or null to ask here (Sprint 9b). */
  initialAccess: StudioAccess | null;
}

export function StudioEditor({
  orgId,
  designId,
  initial,
  initialKits,
  initialAccess,
}: StudioEditorProps) {
  const { load, retry } = useDesignLoad(designId, initial);

  switch (load.kind) {
    case 'ready':
      return (
        <EditorBody
          key={designId}
          orgId={orgId}
          design={load.design}
          initialKits={initialKits}
          initialAccess={initialAccess}
        />
      );
    case 'loading':
      return <EditorSkeleton />;
    default:
      return <LoadProblem orgId={orgId} problem={load} onRetry={retry} />;
  }
}

/**
 * The design, loaded here when the server did not hand it down: once the
 * workspace is ready (right after a switch the API can still be answering
 * for the previous one), and once per Try Again. An answer that lands after
 * the editor has gone is dropped.
 */
function useDesignLoad(designId: string, initial: DesignOutcome | null) {
  const { orgId, scope, status } = useWorkspaceScope();
  const [load, setLoad] = useState<DesignLoad>(initial ?? { kind: 'loading' });
  const waiting = load.kind === 'loading';

  useEffect(() => {
    if (!waiting) return;
    if (status === 'failed') {
      setLoad({ kind: 'failed' });
      return;
    }
    // The switch is recorded in a layout effect of the same commit, after
    // this component rendered `ready`, so the scope is asked again here.
    if (status !== 'ready' || scope.status(orgId) !== 'ready') return;

    let live = true;
    api<{ design: DesignDetail }>(`/studio/designs/${encodeURIComponent(designId)}`)
      .then(({ design }) => {
        if (live) setLoad({ kind: 'ready', design });
      })
      .catch((cause: unknown) => {
        if (live) setLoad(loadFailureOf(cause));
      });

    return () => {
      live = false;
    };
  }, [waiting, status, orgId, scope, designId]);

  const retry = useCallback(() => setLoad({ kind: 'loading' }), []);

  return { load, retry };
}

function EditorBody({
  orgId,
  design,
  initialKits,
  initialAccess,
}: {
  orgId: string;
  design: DesignDetail;
  initialKits: BrandKitView[] | null;
  initialAccess: StudioAccess | null;
}) {
  const router = useRouter();
  const [state, dispatch] = useReducer(editorReducer, design, (start) =>
    createEditorState(start.document, start.lastSlideIndex),
  );
  const doc = documentOf(state);
  const slideIndex = slideIndexOf(state);
  const { slideId, selected, editing } = state;

  const applyChange = useCallback<ApplyChange>(
    (change, options) => dispatch({ type: 'change', change, ...options }),
    [],
  );

  const [title, setTitle] = useState(design.title);
  const [media, setMedia] = useState<MediaMap>(design.media);
  const resolveFull = useMemo(() => mediaResolver(media, 'full'), [media]);
  const resolveThumb = useMemo(() => mediaResolver(media, 'thumbnail'), [media]);
  const brandKits = useBrandKits(initialKits);
  const { premium, markLocked, reload: reloadAccess } = useStudioAccess(initialAccess);
  const [tab, setTab] = useState<PanelTab>('element');
  const mac = useApplePlatform();

  // What each slide's drawing says is too long for its space. A report that
  // changes nothing keeps the same map, so nothing draws again for it.
  const [overflow, setOverflow] = useState<OverflowMap>(NO_OVERFLOW);
  const reportOverflow = useCallback(
    (id: string, slots: readonly SlotId[]) =>
      setOverflow((current) => withOverflow(current, id, slots)),
    [],
  );
  const reportCanvasOverflow = useCallback(
    (slots: readonly SlotId[]) => reportOverflow(slideId, slots),
    [reportOverflow, slideId],
  );
  const slideOverflow = Object.hasOwn(overflow, slideId) ? overflow[slideId] : NO_SLOTS;
  const issues = useMemo(
    () => issuesBySlide(doc, (mediaId) => Object.hasOwn(media, mediaId), overflow),
    [doc, media, overflow],
  );

  const autosave = useAutosave({
    orgId,
    designId: design.id,
    initial: { document: design.document, title: design.title, revision: design.revision },
    document: doc,
    title,
    slideIndex,
    onSaved: ignore,
  });
  const { status, refusal, flush, retry, replace, letGo } = autosave;

  const reset = useDialog<ResetTarget>();
  const leave = useDialog<LeaveRequest>();
  const picker = useDialog<MediaPurpose>();
  const layoutPicker = useDialog<LayoutPickerMode>();
  const preview = useDialog<true>();
  const exporting = useDialog<true>();
  const sending = useDialog<true>();
  const slidesSheet = useDialog<true>();
  const panelSheet = useDialog<true>();
  const premiumLock = useDialog<true>();
  const [shareOpen, setShareOpen] = useState(false);

  const openPremiumLock = premiumLock.open;
  const openPicker = picker.open;
  const openLayoutPicker = layoutPicker.open;
  const openReset = reset.open;
  const openLeave = leave.open;
  const closeLeave = leave.close;
  const closeSending = sending.close;
  const closeSlides = slidesSheet.close;
  const closePanel = panelSheet.close;

  // ---- The parts of the editor ---------------------------------------------

  const showSlide = useCallback((id: string) => dispatch({ type: 'showSlide', slideId: id }), []);
  const showSlideAt = useCallback(
    (index: number) => {
      const id = doc.slides[index]?.id;
      if (id) dispatch({ type: 'showSlide', slideId: id });
    },
    [doc],
  );
  const deleteSlide = useSlideDeletion(applyChange);
  const openAddSlide = useCallback(
    () => openLayoutPicker({ kind: 'add', after: slideId }),
    [openLayoutPicker, slideId],
  );
  const openChangeLayout = useCallback(
    () => openLayoutPicker({ kind: 'change', slideId }),
    [openLayoutPicker, slideId],
  );

  // Choosing on the canvas shows the chosen element's properties.
  const selectOnCanvas = useCallback((slot: SlotId | null) => {
    dispatch({ type: 'select', slot });
    if (slot) setTab('element');
  }, []);
  const editOnCanvas = useCallback((slot: SlotId | null) => {
    dispatch({ type: 'edit', slot });
    if (slot) setTab('element');
  }, []);
  const selectInPanel = useCallback(
    (slot: SlotId | null) => dispatch({ type: 'select', slot }),
    [],
  );
  const pickImage = useCallback(
    (slot: SlotId) => openPicker({ kind: 'image', slideId, slot }),
    [openPicker, slideId],
  );
  const addKitLogo = useCallback(
    (kit: BrandKitView) => setMedia((current) => withKitLogo(current, kit)),
    [],
  );
  const changeCaption = useCallback(
    (caption: string) =>
      applyChange((latest) => setCaption(latest, caption), { coalesceKey: 'caption' }),
    [applyChange],
  );
  const openComposer = useCallback(
    ({ group }: { group: string }) => {
      closeSending();
      router.push(`/${orgId}/composer?group=${encodeURIComponent(group)}`);
    },
    [closeSending, router, orgId],
  );
  const askReset = useCallback(
    (what: 'slide' | 'design') =>
      openReset(what === 'slide' ? { what: 'slide', slideId } : { what: 'design' }),
    [openReset, slideId],
  );
  const showPremiumLock = useCallback(() => openPremiumLock(true), [openPremiumLock]);

  // ---- Make A Story Version (Sprint 9b) ---------------------------------------

  // The API copies the saved design, so what is on screen is saved first.
  const makeStoryVersion = useCallback(async (): Promise<StoryVersionResult> => {
    if (!(await settleWithin(flush(), LEAVE_WAIT_MS))) {
      return { opening: false, problem: STORY_UNSAVED_MESSAGE };
    }

    try {
      const { design: copy } = await api<{ design: { id: string } }>(
        `/studio/designs/${encodeURIComponent(design.id)}/duplicate`,
        { method: 'POST', body: { format: 'story' } },
      );
      router.push(`/${orgId}/studio/${encodeURIComponent(copy.id)}`);
      return { opening: true, problem: null };
    } catch (cause) {
      if (isPremiumRefusal(cause)) {
        markLocked();
        showPremiumLock();
        return { opening: false, problem: null };
      }
      return { opening: false, problem: storyVersionProblem(cause) };
    }
  }, [flush, design.id, router, orgId, markLocked, showPremiumLock]);

  // ---- Undo and Redo from the keyboard (DS-4.8) ------------------------------

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!shortcutOf(event)) return;

      const action = editorShortcut(event, keyPlaceOf(event.target, window.document));
      if (!action) return;

      event.preventDefault();
      dispatch({ type: action });
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // ---- Leaving with changes unsaved (DS-6.3) ----------------------------------

  const saved = useRef(status === 'saved');
  const leaving = useRef(false);
  /** Answers the top bar's held move once the person has chosen (`lib/leave-guard.ts`). */
  const answerLeave = useRef<((go: boolean) => void) | null>(null);
  // The rail, the canvas and the panel: where focus goes when what had it has gone.
  const workArea = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    // A design that was deleted has nothing left to save.
    saved.current = status === 'saved' || refusal?.kind === 'gone';
  });

  useEffect(() => {
    let live = true;

    // Ahead of the link's own handler (Next's Link listens on the way back
    // up), so a held click never starts a navigation.
    function onClick(event: MouseEvent) {
      if (saved.current) return;

      const href = leaveHref(event, linkOf(event.target), window.location.href);
      if (href === null) return;

      event.preventDefault();
      event.stopPropagation();
      // One leave at a time: further clicks wait for this one.
      if (leaving.current) return;
      leaving.current = true;

      void settleWithin(flush(), LEAVE_WAIT_MS).then((done) => {
        if (!live) return;
        if (done) {
          leaving.current = false;
          router.push(href);
        } else {
          openLeave({ href });
        }
      });
    }

    window.document.addEventListener('click', onClick, true);
    return () => {
      live = false;
      leaving.current = false;
      window.document.removeEventListener('click', onClick, true);
    };
  }, [flush, router, openLeave]);

  // The top bar moves through the router, and a workspace switch or signing
  // out changes the session first: a save sent as the editor closed would
  // land in another workspace, or in none. It asks here before it goes.
  useEffect(() => {
    let live = true;

    const unregister = registerLeaveGuard(async () => {
      if (saved.current) return true;
      // One leave at a time: a second move while one is held is dropped.
      if (leaving.current) return false;
      leaving.current = true;

      const done = await settleWithin(flush(), LEAVE_WAIT_MS);
      if (!live) return true;
      if (done) {
        leaving.current = false;
        return true;
      }

      // A search result's box has closed and taken focus with it: Stay gives
      // it to the work area rather than the page.
      const area = workArea.current;
      if (area && !openerOf(window.document.activeElement)) focusFirstIn(area);

      return new Promise<boolean>((resolve) => {
        answerLeave.current = resolve;
        openLeave({ href: null });
      });
    });

    return () => {
      live = false;
      unregister();
      // The editor has gone, so nothing holds the move back any more.
      answerLeave.current?.(true);
      answerLeave.current = null;
    };
  }, [flush, openLeave]);

  const onLeaveOpenChange = useCallback(
    (open: boolean) => {
      if (open) return;
      leaving.current = false;
      closeLeave();
      answerLeave.current?.(false);
      answerLeave.current = null;
    },
    [closeLeave],
  );

  function leaveAnyway() {
    const href = leave.value?.href ?? null;
    leaving.current = false;
    // A move the router makes as a full page load (offline) does not ask twice.
    letGo();
    closeLeave();
    answerLeave.current?.(true);
    answerLeave.current = null;
    if (href) router.push(href);
  }

  // ---- A premium look the plan does not include (Sprint 9b) --------------------

  // The panel thought the look was open (a plan that lapsed in another tab, or
  // access not known yet) and the API refused the save. Premium looks lock
  // from now on, and the dialog says why; the autosave holds the save until
  // the look is taken out, so this runs once per refusal, not in a loop.
  const premiumRefused = status === 'failed' && refusal?.kind === 'premium';

  useEffect(() => {
    if (!premiumRefused) return;
    markLocked();
    showPremiumLock();
  }, [premiumRefused, markLocked, showPremiumLock]);

  // ---- A save that met a newer version (DS-6.2) ------------------------------

  // A save problem's alert goes once it is answered, and the pressed button
  // with it. Focus would then drop to the page; it goes to the first control
  // in the work area instead, so Tab carries on from where the alert was.
  const answered = useRef(false);
  const problemShown = status === 'conflict' || status === 'failed';

  useEffect(() => {
    if (problemShown || !answered.current) return;
    answered.current = false;

    const area = workArea.current;
    const active = window.document.activeElement;
    if (area && (active === null || active === window.document.body)) focusFirstIn(area);
  }, [problemShown]);

  function retrySave() {
    answered.current = true;
    // A plan upgraded in another tab: the save goes through, and asking for
    // access again unlocks the premium tiles with it.
    if (refusal?.kind === 'premium') reloadAccess();
    retry();
  }

  // What is on screen, for an answer that lands after the render that asked.
  const screen = useRef<ScreenVersion>({ document: doc, title, slideIndex });
  useLayoutEffect(() => {
    screen.current = { document: doc, title, slideIndex };
  });

  const resolveConflict = useCallback(
    async (choice: ConflictChoice) => {
      answered.current = true;
      const { design: latest } = await api<{ design: DesignDetail }>(
        `/studio/designs/${encodeURIComponent(design.id)}`,
      );
      const newer = { document: latest.document, title: latest.title, revision: latest.revision };

      if (choice === 'reload') {
        replace(newer, {
          document: latest.document,
          title: latest.title,
          slideIndex: screen.current.slideIndex,
        });
        dispatch({ type: 'load', document: latest.document });
        setTitle(latest.title);
      } else {
        // Saved over the newer version, against its revision.
        replace(newer, screen.current);
      }
      setMedia((current) => mergeMedia(current, latest.media));
    },
    [design.id, replace],
  );

  // ---- Drawers below lg -------------------------------------------------------

  useEffect(() => {
    const wide = window.matchMedia(WIDE);
    const onChange = () => {
      if (!wide.matches) return;
      closeSlides();
      closePanel();
    };

    wide.addEventListener('change', onChange);
    return () => wide.removeEventListener('change', onChange);
  }, [closeSlides, closePanel]);

  // ---- Back from the composer ---------------------------------------------------

  // Send To Composer opens the composer over the editor, which stays. The
  // composer's Back closes it with nothing of the editor's to give focus back
  // to, so focus would drop to the page; it goes back to Send To Composer.
  const pathname = usePathname();
  const lastPath = useRef(pathname);
  const sendButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previous = lastPath.current;
    lastPath.current = pathname;
    if (!backFromComposer(previous, pathname, orgId, design.id)) return;

    // After the composer's own focus handling, which runs in a timeout as it goes.
    const timer = setTimeout(() => {
      const active = window.document.activeElement;
      if (active === null || active === window.document.body) {
        sendButton.current?.focus({ preventScroll: true });
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [pathname, orgId, design.id]);

  // ---- Pictures (DS-4.6) --------------------------------------------------------

  const purpose = picker.value;
  const copy = purpose ? pickerCopy(purpose) : null;
  const attachedId = purpose ? pickedMediaId(doc, purpose) : null;
  const alreadyAttached = useMemo(() => (attachedId ? [attachedId] : []), [attachedId]);

  function attachPicked(items: MediaItem[]) {
    const item = items[0];
    const chosen = purpose;
    if (!item || !chosen) return;

    setMedia((current) => withMediaRef(current, item.id, mediaRefOf(item)));
    applyChange((latest) => withPickedMedia(latest, chosen, item.id));
    picker.close();
  }

  // ---- Reset (DS-4.8) ------------------------------------------------------------

  const resetTarget = reset.value;
  const resetNumber =
    resetTarget?.what === 'slide'
      ? doc.slides.findIndex((slide) => slide.id === resetTarget.slideId) + 1
      : 0;

  function confirmReset() {
    if (!resetTarget) return;

    if (resetTarget.what === 'slide') {
      const target = resetTarget.slideId;
      applyChange((latest) => resetSlide(latest, target));
    } else {
      applyChange((latest) => resetDocument(latest));
    }
    reset.close();
  }

  // ---- Layout ----------------------------------------------------------------------

  const rail = {
    document: doc,
    activeId: slideId,
    issues,
    resolveMedia: resolveThumb,
    onShow: showSlide,
    onChange: applyChange,
    onDelete: deleteSlide,
    onOverflow: reportOverflow,
    onAddSlide: openAddSlide,
  };

  const panel = {
    document: doc,
    slideId,
    selected,
    overflow: slideOverflow,
    media,
    kits: brandKits.kits,
    kitsError: brandKits.error,
    onReloadKits: brandKits.reload,
    tab,
    onTabChange: setTab,
    onSelect: selectInPanel,
    onChange: applyChange,
    onPickMedia: openPicker,
    onChangeLayout: openChangeLayout,
    onKitApplied: addKitLogo,
    premium,
    onPremiumLocked: showPremiumLock,
    onMakeStoryVersion: makeStoryVersion,
  };

  return (
    <div data-testid="studio-editor" className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <EditorTopBar
        orgId={orgId}
        title={title}
        onRename={setTitle}
        status={status}
        mac={mac}
        canUndo={canUndoEdit(state)}
        canRedo={canRedoEdit(state)}
        onUndo={() => dispatch({ type: 'undo' })}
        onRedo={() => dispatch({ type: 'redo' })}
        onReset={askReset}
        onPreview={() => preview.open(true)}
        onShare={() => setShareOpen(true)}
        onExport={() => exporting.open(true)}
        onSend={() => sending.open(true)}
        sendRef={sendButton}
        onOpenSlides={() => slidesSheet.open(true)}
        onOpenPanel={() => panelSheet.open(true)}
      />

      {status === 'conflict' ? <ConflictAlert onChoose={resolveConflict} /> : null}

      {status === 'failed' ? (
        <RefusalAlert orgId={orgId} designId={design.id} refusal={refusal} onRetry={retrySave} />
      ) : null}

      <div ref={workArea} className="flex min-h-0 flex-1 gap-3">
        <SlidesRail {...rail} className="hidden w-56 shrink-0 lg:flex" />
        <EditorCanvas
          document={doc}
          slideId={slideId}
          slideIndex={slideIndex}
          selected={selected}
          editing={editing}
          overflow={slideOverflow}
          resolveMedia={resolveFull}
          onSelect={selectOnCanvas}
          onEdit={editOnCanvas}
          onChange={applyChange}
          onOverflow={reportCanvasOverflow}
          onPickImage={pickImage}
          onShowSlide={showSlideAt}
          className="min-w-0 flex-1"
        />
        <EditorPanel {...panel} className="hidden w-80 shrink-0 lg:flex" />
      </div>

      {/* The drawers are the rail and the panel, not dialogs, to Undo and
          Redo from the keyboard (`data-editor-drawer`, see `KeyPlace`). */}
      <Sheet open={slidesSheet.value !== null} onOpenChange={slidesSheet.onOpenChange}>
        <SheetContent
          side="left"
          data-editor-drawer=""
          className="w-72 max-w-[85vw] gap-0 bg-chrome p-0"
          // Choosing a slide shows it and closes the drawer. Browsing with the
          // arrow keys, a slide's menu and a drag (whose click never arrives)
          // leave it open.
          onClick={(event) => {
            if (event.target instanceof Element && event.target.closest('[data-rail-thumbnail]')) {
              closeSlides();
            }
          }}
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Slides</SheetTitle>
            <SheetDescription>
              Choose a slide to edit it, or add, duplicate, move and delete slides.
            </SheetDescription>
          </SheetHeader>
          <SlidesRail {...rail} bare className="min-h-0 flex-1 px-4 pt-14 pb-4" />
        </SheetContent>
      </Sheet>

      <Sheet open={panelSheet.value !== null} onOpenChange={panelSheet.onOpenChange}>
        <SheetContent
          side="right"
          data-editor-drawer=""
          className="w-[22rem] max-w-[92vw] gap-0 bg-chrome p-0"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>Properties</SheetTitle>
            <SheetDescription>
              Change the selected element, this slide or the whole design.
            </SheetDescription>
          </SheetHeader>
          <EditorPanel {...panel} bare className="min-h-0 flex-1 px-4 pt-14 pb-4" />
        </SheetContent>
      </Sheet>

      <MediaPickerDialog
        open={purpose !== null}
        onOpenChange={picker.onOpenChange}
        single
        imagesOnly
        alreadyAttached={alreadyAttached}
        title={copy?.title}
        description={copy?.description}
        confirmLabel={copy?.confirmLabel}
        onAttach={attachPicked}
      />

      <LayoutPickerDialog
        document={doc}
        mode={layoutPicker.value}
        resolveMedia={resolveThumb}
        onChange={applyChange}
        onClose={layoutPicker.close}
      />

      <PreviewDialog
        open={preview.value !== null}
        onOpenChange={preview.onOpenChange}
        document={doc}
        platforms={design.platforms}
        media={media}
        startIndex={slideIndex}
        onCaptionChange={changeCaption}
      />

      <ExportDialog
        open={exporting.value !== null}
        onOpenChange={exporting.onOpenChange}
        designId={design.id}
        title={title}
        flush={flush}
        issues={issues}
        onExported={ignore}
        format={doc.format}
      />

      <SendDialog
        open={sending.value !== null}
        onOpenChange={sending.onOpenChange}
        orgId={orgId}
        designId={design.id}
        title={title}
        caption={doc.caption}
        flush={flush}
        issues={issues}
        onSent={openComposer}
      />

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        designId={design.id}
        title={title}
        flush={flush}
      />

      <PremiumLockDialog
        newTab
        open={premiumLock.value !== null}
        onOpenChange={premiumLock.onOpenChange}
      />

      <AlertDialog open={resetTarget !== null} onOpenChange={reset.onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {resetTarget?.what === 'design' ? 'Reset the whole design?' : 'Reset this slide?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {resetTarget?.what === 'design'
                ? 'Every slide goes back to its template. You can undo this until you leave the editor.'
                : `Slide ${resetNumber || slideIndex + 1} goes back to how its template drew it. Undo brings your version back.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmReset}>
              {resetTarget?.what === 'design' ? 'Reset Design' : 'Reset Slide'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={leave.value !== null} onOpenChange={onLeaveOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave without saving?</AlertDialogTitle>
            <AlertDialogDescription>
              Your latest changes are not saved yet. If you leave now, they may be lost.
            </AlertDialogDescription>
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

type ResetTarget = { what: 'slide'; slideId: string } | { what: 'design' };

/** A held leave: a link's address, or null for a move from the top bar (`lib/leave-guard.ts`). */
type LeaveRequest = { href: string | null };

type ConflictChoice = 'reload' | 'keep';

/**
 * A save that met a newer version (DS-6.2). Nothing is overwritten until the
 * person chooses: Reload shows the newer version, Keep This Version saves the
 * one on screen over it. Both fetch the newer version first; while one does,
 * neither can be pressed, and a failure says why and leaves both to try again.
 */
function ConflictAlert({ onChoose }: { onChoose: (choice: ConflictChoice) => Promise<void> }) {
  const [busy, setBusy] = useState<ConflictChoice | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const reloadButton = useRef<HTMLButtonElement>(null);
  const keepButton = useRef<HTMLButtonElement>(null);
  const refocus = useRef<ConflictChoice | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // A button loses focus while it is disabled; after a failure it gets it back.
  useEffect(() => {
    if (busy !== null || refocus.current === null) return;

    const button = (refocus.current === 'reload' ? reloadButton : keepButton).current;
    refocus.current = null;
    const active = window.document.activeElement;
    if (button && (active === null || active === window.document.body)) button.focus();
  }, [busy]);

  function choose(choice: ConflictChoice) {
    if (busy) return;
    setBusy(choice);
    setProblem(null);

    onChoose(choice).then(
      () => {
        // The alert goes once the save settles; until then nothing is pressed twice.
        if (alive.current) setBusy(null);
      },
      (cause: unknown) => {
        if (!alive.current) return;
        refocus.current = choice;
        setProblem(latestProblem(cause));
        setBusy(null);
      },
    );
  }

  return (
    <Alert variant="danger" className="flex-wrap items-center">
      <TriangleAlert aria-hidden="true" className={ALERT_ICON} strokeWidth={2.5} />
      <div className="flex min-w-0 grow basis-64 flex-col gap-1">
        <span className="break-words font-bold">{CONFLICT_MESSAGE}</span>
        <span className="break-words font-medium opacity-90">{problem ?? CONFLICT_CHOICES}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          ref={reloadButton}
          variant="secondary"
          size="sm"
          disabled={busy !== null}
          onClick={() => choose('reload')}
        >
          {busy === 'reload' ? (
            <Spinner
              size="sm"
              role="presentation"
              aria-hidden="true"
              className="motion-reduce:animate-none"
            />
          ) : (
            <MotionIcon icon={RefreshCwIcon} className="h-4 w-4" />
          )}
          Reload
        </Button>
        <Button
          ref={keepButton}
          variant="secondary"
          size="sm"
          disabled={busy !== null}
          onClick={() => choose('keep')}
        >
          {busy === 'keep' ? (
            <Spinner
              size="sm"
              role="presentation"
              aria-hidden="true"
              className="motion-reduce:animate-none"
            />
          ) : (
            <MotionIcon icon={SaveIcon} className="h-4 w-4" />
          )}
          Keep This Version
        </Button>
      </div>
    </Alert>
  );
}

/**
 * A save the server refused (DS-6.2): why, and what is left to do. Try
 * Again only where another try can work. A session that ended signs in
 * again and comes back to this design; a design that was deleted (the save
 * has already pointed the API back at this workspace once, see
 * `saveInWorkspace`) goes back to Studio, since nothing can save it. A
 * premium look the plan does not include points at the plans, in a new tab
 * so the edits stay here, with Try Again for once the plan is upgraded there;
 * taking the look out (Undo, or a free one) saves on its own.
 */
function RefusalAlert({
  orgId,
  designId,
  refusal,
  onRetry,
}: {
  orgId: string;
  designId: string;
  refusal: SaveRefusal | null;
  onRetry: () => void;
}) {
  const kind = refusal?.kind ?? 'retry';

  return (
    <Alert variant="danger" className="flex-wrap items-center">
      <TriangleAlert aria-hidden="true" className={ALERT_ICON} strokeWidth={2.5} />
      <span className={ALERT_TEXT}>{refusal?.message ?? SAVE_FAILED_MESSAGE}</span>
      {kind === 'gone' ? (
        <BackToStudio orgId={orgId} />
      ) : kind === 'signIn' ? (
        <ActionLink href={withNext('/login', `/${orgId}/studio/${designId}`)}>
          <MotionIcon icon={LogInIcon} className="h-4 w-4" />
          Sign In
        </ActionLink>
      ) : kind === 'premium' ? (
        <div className="flex flex-wrap gap-2">
          <ActionLink href={`/${orgId}/settings/billing`} target="_blank" rel="noopener">
            <MotionIcon icon={CrownIcon} className="h-4 w-4" />
            See Plans
          </ActionLink>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <MotionIcon icon={RotateCcwIcon} className="h-4 w-4" />
            Try Again
          </Button>
        </div>
      ) : (
        <Button variant="secondary" size="sm" onClick={onRetry}>
          <MotionIcon icon={RotateCcwIcon} className="h-4 w-4" />
          Try Again
        </Button>
      )}
    </Alert>
  );
}

/** The editor's shape while the design loads: the action row, then rail, canvas and panel. */
function EditorSkeleton() {
  return (
    <div role="status" className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
      <span className="sr-only">Loading the design.</span>

      <div
        aria-hidden="true"
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Skeleton className="h-9 w-9 shrink-0" />
          <Skeleton className="h-6 w-full max-w-56" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-20" />
          <Skeleton className="h-9 w-9" />
          <Skeleton className="hidden h-9 w-24 sm:block" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>

      <div aria-hidden="true" className="flex min-h-0 flex-1 gap-3">
        <StudioPanel className="hidden w-56 shrink-0 flex-col gap-3 p-3 lg:flex">
          <Skeleton className="h-5 w-20" />
          {['first', 'second', 'third'].map((key) => (
            <Skeleton key={key} className="aspect-square w-full" />
          ))}
        </StudioPanel>
        <StudioPanel className="flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-inset p-5">
          <Skeleton className="aspect-[4/5] max-h-full w-full max-w-sm" />
        </StudioPanel>
        <StudioPanel className="hidden w-80 shrink-0 flex-col gap-3 p-3 lg:flex">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </StudioPanel>
      </div>
    </div>
  );
}

/** Why the design did not open, and the way on: back to Studio, or another try. */
function LoadProblem({
  orgId,
  problem,
  onRetry,
}: {
  orgId: string;
  problem: LoadFailure;
  onRetry: () => void;
}) {
  if (problem.kind === 'missing') return <DesignMissing orgId={orgId} />;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      {problem.kind === 'unreadable' ? (
        <Alert variant="danger" className="flex-wrap items-center">
          <TriangleAlert aria-hidden="true" className={ALERT_ICON} strokeWidth={2.5} />
          <span className={ALERT_TEXT}>{problem.message}</span>
          <BackToStudio orgId={orgId} />
        </Alert>
      ) : (
        <Alert variant="danger" className="flex-wrap items-center">
          <TriangleAlert aria-hidden="true" className={ALERT_ICON} strokeWidth={2.5} />
          <span className={ALERT_TEXT}>{DESIGN_LOAD_FAILED_MESSAGE}</span>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            <MotionIcon icon={RotateCcwIcon} className="h-4 w-4" />
            Try Again
          </Button>
        </Alert>
      )}
    </div>
  );
}

const subscribeNever = () => () => undefined;

/**
 * Whether shortcut hints show the Command key. The server, and the first
 * render in the browser, say Ctrl; the browser's own answer follows.
 */
function useApplePlatform(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => isApplePlatform(navigator),
    () => false,
  );
}
