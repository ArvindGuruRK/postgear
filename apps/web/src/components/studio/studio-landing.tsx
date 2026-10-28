'use client';

/**
 * Studio's front page (DS-1.1 to DS-1.4, DS-2.3): the Brand Kits strip, then
 * the workspace's designs, newest first, with search, a format filter and
 * each card's Open, Duplicate, Rename and Delete.
 *
 * With no designs at all, the designs panel is the first step instead (DS-1.2):
 * one sentence, Create Design, and three templates drawn as small decks, each
 * opening the wizard with it already chosen. Nothing in it pretends to be one
 * of the user's own designs.
 */
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import {
  CATEGORY_LABELS,
  documentFromPreset,
  FEATURED_PRESET_IDS,
  FORMAT_IDS,
  type FormatId,
  presetById,
  presetFormats,
} from '@postgear/design-engine';
import {
  Alert,
  AlertDescription,
  Button,
  buttonVariants,
  cn,
  EmptyState,
  ErrorState,
  MotionIcon,
  PageActions,
  Pagination,
  SearchInput,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  toast,
} from '@postgear/ui';
import { Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { BrandKitView, DesignDetail, DesignPage, DesignSummary } from '@/types/studio';
import { BrandKitDialog } from './brand-kit-dialog';
import { BrandKitsStrip, DeleteBrandKitDialog } from './brand-kits-strip';
import { DesignCard, FOCUS } from './design-card';
import { DeleteDesignDialog, RenameDesignDialog } from './design-dialogs';
import { SlideFrame } from './slide-frame';
import { INSET, PanelHeader, StudioPanel, useNow } from './studio-ui';
import { formatName, slideCountLabel, wizardQuery } from './studio-view-model';
import { useDialog } from './use-dialog';
import { type FormatFilter, useBrandKits, useDesigns } from './use-studio-data';

const GRID = 'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5';

/**
 * One of this page's panels, by its heading's id: where focus goes when a
 * dialog deleted the last card in it (see `useDialog`).
 */
const panelOf = (headingId: string) => () =>
  window.document.querySelector<HTMLElement>(`[aria-labelledby="${headingId}"]`);
const designsPanel = panelOf('studio-designs');
const kitsPanel = panelOf('studio-brand-kits');

export function StudioLanding({
  orgId,
  initialDesigns,
  initialKits,
}: {
  orgId: string;
  initialDesigns: DesignPage | null;
  initialKits: BrandKitView[] | null;
}) {
  const router = useRouter();
  const designs = useDesigns(initialDesigns);
  const kits = useBrandKits(initialKits);
  const now = useNow();
  // Each dialog gives focus back to the card control or button that opened
  // it, or, after a delete, to the card that took the deleted one's place.
  const renaming = useDialog<DesignSummary>(designsPanel);
  const deleting = useDialog<DesignSummary>(designsPanel);
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const kitDialog = useDialog<{ kit: BrandKitView | null; key: number }>(kitsPanel);
  const deletingKit = useDialog<BrandKitView>(kitsPanel);
  const kitDialogs = useRef(0);
  const openKitDialog = kitDialog.open;
  const closeKitDialog = kitDialog.close;

  const page = designs.data;
  const list = page?.designs ?? [];
  const firstRun = page !== null && page.total === 0 && !designs.filtered && !designs.search;

  function openKit(kit: BrandKitView | null) {
    kitDialogs.current += 1;
    openKitDialog({ kit, key: kitDialogs.current });
  }

  /** DS-1.4: the copy is made on the server, then opened. */
  async function duplicate(design: DesignSummary) {
    if (duplicating) return;
    setDuplicating(design.id);

    try {
      const { design: copy } = await api<{ design: DesignDetail }>(
        `/studio/designs/${encodeURIComponent(design.id)}/duplicate`,
        { method: 'POST' },
      );
      router.push(`/${orgId}/studio/${copy.id}`);
    } catch (cause) {
      setDuplicating(null);
      toast({
        variant: 'danger',
        title: "Couldn't duplicate the design",
        description: cause instanceof ApiError ? cause.message : 'Please try again.',
      });
    }
  }

  function clearFilters() {
    designs.setSearch('');
    designs.setFormat('all');
  }

  return (
    <div className="flex flex-col gap-6">
      {firstRun ? null : (
        <PageActions>
          <Link href={`/${orgId}/studio/new`} className={buttonVariants({ variant: 'primary' })}>
            <MotionIcon icon={PlusIcon} className="h-4 w-4" />
            Create Design
          </Link>
        </PageActions>
      )}

      <BrandKitsStrip
        kits={kits.kits}
        loading={kits.loading}
        error={kits.error}
        onRetry={kits.reload}
        onNew={() => openKit(null)}
        onEdit={openKit}
        onDelete={deletingKit.open}
      />

      <StudioPanel className="flex flex-col gap-4 p-4 sm:p-5" aria-labelledby="studio-designs">
        <PanelHeader
          id="studio-designs"
          title="Recent Designs"
          aside={
            page && !firstRun ? (
              <span className="font-sans text-sm text-ink type-muted" aria-live="polite">
                {page.total} {page.total === 1 ? 'design' : 'designs'}
              </span>
            ) : null
          }
        />

        {firstRun ? null : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="sm:max-w-sm sm:flex-1">
              <SearchInput
                value={designs.search}
                onChange={(event) => designs.setSearch(event.target.value)}
                onClear={() => designs.setSearch('')}
                placeholder="Enter your search"
                aria-label="Search designs"
                className="shadow-none"
              />
            </div>
            <Select
              value={designs.format}
              onValueChange={(value) => designs.setFormat(value as FormatFilter)}
            >
              <SelectTrigger aria-label="Filter by format" className="shadow-none sm:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Formats</SelectItem>
                {FORMAT_IDS.map((format) => (
                  <SelectItem key={format} value={format}>
                    {formatName(format)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {designs.error && page ? (
          <Alert variant="danger" className="flex-wrap items-center justify-between">
            <AlertDescription>{designs.error}</AlertDescription>
            <Button variant="secondary" size="sm" onClick={designs.reload}>
              Try Again
            </Button>
          </Alert>
        ) : null}

        {designs.error && !page ? (
          <ErrorState
            title="Your designs didn't load"
            description={designs.error}
            action={{ label: 'Try Again', onClick: designs.reload }}
          />
        ) : !page ? (
          <div role="status" aria-busy="true" aria-label="Loading designs" className={GRID}>
            {Array.from({ length: 8 }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders have no identity
              <Skeleton key={index} className="aspect-[4/5]" />
            ))}
          </div>
        ) : firstRun ? (
          <FirstSteps orgId={orgId} />
        ) : list.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No designs match"
            description="Try another word or another format."
            action={{ label: 'Clear Filters', onClick: clearFilters }}
          />
        ) : (
          <ul className={cn(GRID, 'm-0 list-none p-0')} aria-busy={designs.loading}>
            {list.map((design) => (
              <DesignCard
                key={design.id}
                orgId={orgId}
                design={design}
                now={now}
                busy={duplicating === design.id}
                onDuplicate={(chosen) => void duplicate(chosen)}
                onRename={renaming.open}
                onDelete={deleting.open}
              />
            ))}
          </ul>
        )}

        {page && page.pageCount > 1 ? (
          <Pagination
            page={designs.page}
            pageCount={page.pageCount}
            onPageChange={designs.setPage}
            className="justify-center"
          />
        ) : null}
      </StudioPanel>

      <RenameDesignDialog
        design={renaming.value}
        onOpenChange={renaming.onOpenChange}
        onRenamed={(result) => {
          designs.patch(result.id, {
            title: result.title,
            revision: result.revision,
            status: result.status,
            exportStale: result.exportStale,
            updatedAt: result.updatedAt,
          });
          renaming.close();
        }}
      />

      <DeleteDesignDialog
        design={deleting.value}
        onOpenChange={deleting.onOpenChange}
        onDeleted={(design) => {
          deleting.close();
          designs.remove(design.id);
          toast({ title: 'Design deleted', description: design.title });
          designs.reload();
        }}
      />

      {kitDialog.value ? (
        <BrandKitDialog
          key={kitDialog.value.key}
          kit={kitDialog.value.kit}
          onClose={closeKitDialog}
          onSaved={(kit) => {
            kits.upsert(kit);
            closeKitDialog();
          }}
        />
      ) : null}

      <DeleteBrandKitDialog
        kit={deletingKit.value}
        onOpenChange={deletingKit.onOpenChange}
        onDeleted={(kit) => {
          deletingKit.close();
          kits.remove(kit.id);
          toast({
            title: 'Brand kit deleted',
            description: 'Designs that used it keep their colours.',
          });
        }}
      />
    </div>
  );
}

/** The first step, for a workspace with no designs yet (DS-1.2). */
function FirstSteps({ orgId }: { orgId: string }) {
  return (
    <div className="flex flex-col items-center gap-8 py-6 text-center">
      <div className="flex flex-col items-center gap-4">
        <p className="m-0 max-w-md font-sans text-base text-ink">
          No designs yet. Create your first post or carousel from a template.
        </p>
        <Link href={`/${orgId}/studio/new`} className={buttonVariants({ variant: 'primary' })}>
          <MotionIcon icon={PlusIcon} className="h-4 w-4" />
          Create Design
        </Link>
      </div>

      <ul
        aria-label="Templates to start from"
        className="m-0 grid w-full max-w-4xl list-none grid-cols-1 gap-4 p-0 sm:grid-cols-3"
      >
        {FEATURED_PRESET_IDS.map((presetId) => (
          <FeaturedTemplate key={presetId} orgId={orgId} presetId={presetId} />
        ))}
      </ul>
    </div>
  );
}

/**
 * One template to start from, drawn as a small deck: its cover in front and
 * the next two slides fanned out behind, so a carousel reads as one.
 */
function FeaturedTemplate({ orgId, presetId }: { orgId: string; presetId: string }) {
  const preset = presetById(presetId);
  const formats = preset ? presetFormats(preset) : [];
  const format: FormatId | null = formats.includes('square') ? 'square' : (formats[0] ?? null);

  const design = useMemo(() => {
    if (!preset || !format) return null;
    let next = 0;
    return documentFromPreset({
      presetId: preset.id,
      format,
      newId: () => `featured-${preset.id}-${next++}`,
    });
  }, [preset, format]);

  if (!preset || !design) return null;

  const query = wizardQuery({ step: 'brand', kitId: null, format: null, presetId: preset.id });
  const fanned = Math.min(design.slides.length - 1, 2);

  return (
    <li className="min-w-0">
      <Link
        href={`/${orgId}/studio/new?${query}`}
        aria-label={`Start with ${preset.name}`}
        className={cn(
          'group flex h-full flex-col gap-3 rounded-card border-2 border-outline bg-secondary p-3 text-left shadow-surfaceMd',
          FOCUS,
        )}
      >
        <span
          className={cn(INSET, 'flex aspect-[4/3] items-center justify-center bg-halftone p-6')}
        >
          <span className="relative block w-1/2">
            {fanned >= 2 ? (
              <span className="absolute inset-0 block translate-x-6 rotate-6 border-2 border-outline shadow-brutalSm transition-[translate,rotate] duration-200 group-hover:translate-x-8 group-hover:rotate-12 motion-reduce:transition-none">
                <SlideFrame design={design} index={2} lazy />
              </span>
            ) : null}
            {fanned >= 1 ? (
              <span className="absolute inset-0 block translate-x-3 rotate-3 border-2 border-outline shadow-brutalSm transition-[translate,rotate] duration-200 group-hover:translate-x-4 group-hover:rotate-6 motion-reduce:transition-none">
                <SlideFrame design={design} index={1} lazy />
              </span>
            ) : null}
            <span className="relative block border-2 border-outline shadow-brutalSm">
              <SlideFrame design={design} lazy />
            </span>
          </span>
        </span>

        <span className="flex flex-col gap-0.5">
          <span className="type-ui text-sm text-ink">{preset.name}</span>
          <span className="font-sans text-xs text-ink type-muted">
            {CATEGORY_LABELS[preset.category]}, {slideCountLabel(preset.slides.length)}
          </span>
        </span>
      </Link>
    </li>
  );
}
