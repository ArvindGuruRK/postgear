'use client';

/**
 * The Brand Kit section at the top of the Layouts tab (Sprint 13, Module 10
 * section 3): which of the workspace's brand kits the clip wears, and a
 * switch for each part the kit has (Logo, Intro, Outro).
 *
 * - Picking a kit asks for it in the engine's shape (`POST
 *   /clips/brand-kits/:id/use`, which copies its logo into the clips space on
 *   first use), then applies it with `applyBrandKit` as ONE undo step through
 *   the tab's `onEdit`: the logo in its corner, the caption style, the intro
 *   and the outro (another kit's parts go in the same step). None takes the
 *   kit off (`removeBrandKit`).
 * - Each switch is one undo step (`setBrandPart`). What is on is read back
 *   from the document (`brandPartsOf`), so undo and redo move the switches.
 * - The outro card is drawn by the export, not the editor's preview, so its
 *   switch says where to see it.
 */
import {
  Button,
  cn,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Toggle,
  toast,
} from '@postgear/ui';
import {
  applyBrandKit,
  brandPartsOf,
  type CaptionLook,
  type ClipBrandKit,
  type ClipDocument,
  removeBrandKit,
  setBrandPart,
} from '@postgear/video-engine';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { NOTE, PanelSection } from '@/components/studio/panel-ui';
import { ApiError } from '@/lib/api';
import { listCaptionStyles } from '@/lib/clips-api';
// Not a hook: the route's name only starts with "use" (it uses the kit on this clip).
import { listClipBrandKits, useClipBrandKit as claimBrandKit } from '@/lib/clips-recipes-api';
import type { ClipBrandKitView } from '@/types/clips-recipes';
import {
  BRAND_KIT_GONE,
  BRAND_KIT_NONE,
  BRAND_KIT_USE_FAILED,
  BRAND_KITS_FAILED,
  BRAND_TOGGLE_NAMES,
  type BrandToggle,
  brandToggleSentence,
  kitOffers,
  NO_BRAND_KITS,
  OUTRO_CARD_PREVIEW_NOTE,
  outroKindName,
  partsOnPick,
} from './brand-kit-model';
import type { LayoutEdit } from './layouts-panel';

const LABEL = 'font-sans text-sm font-bold text-ink';
const TOGGLES: readonly BrandToggle[] = ['logo', 'intro', 'outro'];

type KitsState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; kits: ClipBrandKitView[] };

export function BrandKitSection({
  document,
  onEdit,
}: {
  document: ClipDocument;
  /** One undo step: the change, and the sentence a screen reader hears after it. */
  onEdit: LayoutEdit;
}) {
  const headingId = useId();
  const switchIds = { logo: useId(), intro: useId(), outro: useId() };
  const parts = brandPartsOf(document);
  const [state, setState] = useState<KitsState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [engineKits, setEngineKits] = useState<ReadonlyMap<string, ClipBrandKit>>(new Map());
  const [busy, setBusy] = useState(false);
  const asked = useRef(new Map<string, Promise<ClipBrandKit>>());
  const looks = useRef<Promise<ReadonlyMap<string, CaptionLook>> | null>(null);
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    void attempt;
    const abort = new AbortController();
    setState({ status: 'loading' });
    listClipBrandKits({ signal: abort.signal })
      .then((view) => {
        if (!abort.signal.aborted) setState({ status: 'ready', kits: view.brandKits });
      })
      .catch(() => {
        if (!abort.signal.aborted) setState({ status: 'failed' });
      });
    return () => abort.abort();
  }, [attempt]);

  /** The kit in the engine's shape, asked for once per kit while the tab is open. */
  const kitFor = useCallback((id: string): Promise<ClipBrandKit> => {
    const known = asked.current.get(id);
    if (known) return known;
    const pending = claimBrandKit(id).then((kit) => {
      if (live.current) setEngineKits((current) => new Map(current).set(id, kit));
      return kit;
    });
    // A refusal is asked again next time.
    pending.catch(() => asked.current.delete(id));
    asked.current.set(id, pending);
    return pending;
  }, []);

  /** The workspace's caption looks by style id, for the kit's caption style; empty when unread. */
  const captionLooks = useCallback((): Promise<ReadonlyMap<string, CaptionLook>> => {
    if (!looks.current) {
      looks.current = listCaptionStyles()
        .then((view) => new Map(view.styles.map((style) => [style.id, style.look])))
        .catch(() => {
          looks.current = null;
          return new Map();
        });
    }
    return looks.current;
  }, []);

  // The clip's own kit, for its switches.
  const kitId = parts.kitId;
  useEffect(() => {
    if (kitId) kitFor(kitId).catch(() => undefined);
  }, [kitId, kitFor]);

  const pick = async (value: string) => {
    if (value === BRAND_KIT_GONE || busy) return;
    if (value === BRAND_KIT_NONE) {
      onEdit((doc) => removeBrandKit(doc), 'Brand kit removed.');
      return;
    }
    setBusy(true);
    try {
      const [kit, byId] = await Promise.all([kitFor(value), captionLooks()]);
      if (!live.current) return;
      // `applyBrandKit` starts from the clip without any kit, so another kit's parts go too.
      onEdit(
        (doc) =>
          applyBrandKit(doc, kit, partsOnPick(kit), {
            captionLook: (styleId: string) => byId.get(styleId) ?? null,
          }),
        `${kit.name} applied.`,
      );
    } catch (cause) {
      toast({
        title: cause instanceof ApiError && cause.message ? cause.message : BRAND_KIT_USE_FAILED,
        variant: 'danger',
      });
    } finally {
      if (live.current) setBusy(false);
    }
  };

  const kits = state.status === 'ready' ? state.kits : [];
  const listed = kitId === null || kits.some((kit) => kit.id === kitId);
  const value =
    kitId === null ? BRAND_KIT_NONE : listed || state.status !== 'ready' ? kitId : BRAND_KIT_GONE;
  const kit = kitId ? (engineKits.get(kitId) ?? null) : null;
  const offers = kit ? kitOffers(kit) : null;

  const toggle = (part: BrandToggle, on: boolean) => {
    if (!kit) return;
    onEdit((doc) => setBrandPart(doc, kit, part, on), brandToggleSentence(part, on));
  };

  return (
    <PanelSection title="Brand Kit" headingId={headingId}>
      <div data-testid="clip-brand-kit-section" className="flex flex-col gap-3">
        <Select
          value={value}
          disabled={busy || (state.status !== 'ready' && kitId === null)}
          onValueChange={(next) => void pick(next)}
        >
          <SelectTrigger aria-labelledby={headingId} data-testid="clip-brand-kit-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={BRAND_KIT_NONE}>None</SelectItem>
            {kitId !== null && state.status !== 'ready' ? (
              <SelectItem value={kitId}>{kit?.name ?? 'Brand Kit'}</SelectItem>
            ) : null}
            {value === BRAND_KIT_GONE ? (
              <SelectItem value={BRAND_KIT_GONE}>Deleted Brand Kit</SelectItem>
            ) : null}
            {kits.map((one) => (
              <SelectItem key={one.id} value={one.id}>
                {one.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {state.status === 'failed' ? (
          <div className="flex flex-col items-start gap-2">
            <p className={NOTE}>{BRAND_KITS_FAILED}</p>
            <Button variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)}>
              Try Again
            </Button>
          </div>
        ) : null}
        {state.status === 'ready' && kits.length === 0 && kitId === null ? (
          <p className={NOTE}>{NO_BRAND_KITS}</p>
        ) : null}

        {kit && offers
          ? TOGGLES.filter((part) => offers[part]).map((part) => {
              const kind = part === 'outro' ? outroKindName(kit) : null;
              return (
                <div key={part} className="flex flex-col gap-1">
                  <div className="flex items-center gap-3">
                    <Toggle
                      id={switchIds[part]}
                      checked={parts[part]}
                      onCheckedChange={(on) => toggle(part, on)}
                      data-testid={`clip-brand-${part}`}
                    />
                    <label htmlFor={switchIds[part]} className={cn(LABEL, 'flex-1')}>
                      {BRAND_TOGGLE_NAMES[part]}
                    </label>
                    {kind ? (
                      <span className="type-label text-xs text-ink type-muted">{kind}</span>
                    ) : null}
                  </div>
                  {part === 'outro' && kit.outro?.kind === 'card' ? (
                    <p className={NOTE}>{OUTRO_CARD_PREVIEW_NOTE}</p>
                  ) : null}
                </div>
              );
            })
          : null}
      </div>
    </PanelSection>
  );
}
