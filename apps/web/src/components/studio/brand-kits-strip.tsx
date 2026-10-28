'use client';

/**
 * The Brand Kits strip on the Studio page (DS-2.3): each kit's logo, name and
 * colours, with Edit and Delete, and New Brand Kit in its header. The
 * wizard's brand step reads the same list, so a kit made here is offered
 * there at once.
 *
 * Deleting a kit asks first and says what happens to the designs that used
 * it: each design holds its own copy of the colours and logo, so they keep
 * both, and their properties panel says the kit was deleted.
 *
 * Duplicate (Sprint 9b) copies a kit, "Name (Copy)", through the API, which
 * lists the newest first: the copy arrives at the start of the strip, and
 * focus goes to its Edit, the likely next step.
 */
import { CopyIcon } from '@animateicons/react/lucide/copy-icon';
import { PencilIcon } from '@animateicons/react/lucide/pencil-icon';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import {
  Alert,
  AlertDescription,
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
  FormErrorMessage,
  MotionIcon,
  Skeleton,
  TooltipHint,
  toast,
} from '@postgear/ui';
import { useEffect, useRef, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { BrandKitView } from '@/types/studio';
import { KitSwatches } from './kit-preview';
import { LogoTile } from './logo-field';
import { INSET, PanelHeader, StudioPanel } from './studio-ui';
import { siteName } from './studio-view-model';

export function BrandKitsStrip({
  kits,
  loading,
  error,
  onRetry,
  onNew,
  onEdit,
  onDelete,
  onDuplicated,
}: {
  kits: BrandKitView[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onNew: () => void;
  onEdit: (kit: BrandKitView) => void;
  onDelete: (kit: BrandKitView) => void;
  /**
   * The copy Duplicate made, to put first in the list (`useBrandKits().upsert`).
   * Without it the list is loaded again, which puts the copy first as well.
   */
  onDuplicated?: (kit: BrandKitView) => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  const [copying, setCopying] = useState<string | null>(null);
  /** The copy to focus once the list shows it. */
  const [arrived, setArrived] = useState<string | null>(null);

  useEffect(() => {
    if (!arrived || !kits?.some((kit) => kit.id === arrived)) return;
    setArrived(null);

    const card = Array.from(list.current?.children ?? []).find(
      (child) => child instanceof HTMLElement && child.dataset.kitId === arrived,
    );
    card?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    card?.querySelector<HTMLElement>('[data-kit-edit]')?.focus({ preventScroll: true });
  }, [arrived, kits]);

  async function duplicate(kit: BrandKitView) {
    if (copying) return;
    setCopying(kit.id);

    try {
      const { brandKit } = await api<{ brandKit: BrandKitView }>(
        `/studio/brand-kits/${encodeURIComponent(kit.id)}/duplicate`,
        { method: 'POST' },
      );
      setArrived(brandKit.id);
      if (onDuplicated) onDuplicated(brandKit);
      else onRetry();
      toast({ title: 'Brand kit duplicated', description: `${brandKit.name} is ready to edit.` });
    } catch (cause) {
      toast({
        variant: 'danger',
        title: "Couldn't duplicate the brand kit",
        description:
          cause instanceof ApiError
            ? cause.message
            : 'PostGear could not be reached. Check your connection and try again.',
      });
    } finally {
      setCopying(null);
    }
  }

  return (
    <StudioPanel className="flex flex-col gap-4 p-4 sm:p-5" aria-labelledby="studio-brand-kits">
      <PanelHeader
        id="studio-brand-kits"
        title="Brand Kits"
        aside={
          <Button variant="secondary" size="sm" onClick={onNew}>
            <MotionIcon icon={PlusIcon} className="h-4 w-4" />
            New Brand Kit
          </Button>
        }
      />

      {error && !kits ? (
        <Alert variant="danger" className="flex-wrap items-center justify-between">
          <AlertDescription>{error}</AlertDescription>
          <Button variant="secondary" size="sm" onClick={onRetry}>
            Try Again
          </Button>
        </Alert>
      ) : !kits ? (
        <div role="status" aria-label="Loading brand kits" className="flex gap-3 overflow-hidden">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-40 w-64 shrink-0" />
          ))}
        </div>
      ) : kits.length === 0 ? (
        <p className="m-0 font-sans text-sm text-ink type-muted">
          No brand kits yet. Save your logo and colours once, and every template can use them.
        </p>
      ) : (
        <ul
          ref={list}
          aria-busy={loading}
          className="m-0 flex list-none snap-x gap-3 overflow-x-auto p-0 pb-2 pg-scrollbar pg-scrollbar-secondary"
        >
          {kits.map((kit) => (
            <KitCard
              key={kit.id}
              kit={kit}
              copying={copying === kit.id}
              canCopy={copying === null}
              onEdit={onEdit}
              onDelete={onDelete}
              onDuplicate={duplicate}
            />
          ))}
        </ul>
      )}
    </StudioPanel>
  );
}

function KitCard({
  kit,
  copying,
  canCopy,
  onEdit,
  onDelete,
  onDuplicate,
}: {
  kit: BrandKitView;
  /** This kit's copy is being made. */
  copying: boolean;
  /** No copy of any kit is being made, so another may start. */
  canCopy: boolean;
  onEdit: (kit: BrandKitView) => void;
  onDelete: (kit: BrandKitView) => void;
  onDuplicate: (kit: BrandKitView) => void;
}) {
  const origin = kit.websiteUrl
    ? siteName(kit.websiteUrl)
    : kit.source === 'EXTRACTED'
      ? 'Read from a website'
      : 'Made by hand';

  return (
    <li
      data-testid="brand-kit-card"
      data-kit-id={kit.id}
      className={cn(INSET, 'flex w-64 shrink-0 snap-start flex-col gap-3 p-3')}
    >
      <div className="flex min-w-0 items-center gap-3">
        <LogoTile url={kit.logoUrl} alt="" className="h-12 w-12 bg-secondary p-1" />
        <div className="flex min-w-0 flex-col">
          <span className="line-clamp-2 break-words type-ui text-sm text-ink" title={kit.name}>
            {kit.name}
          </span>
          <span className="truncate font-sans text-xs text-ink type-muted">{origin}</span>
        </div>
      </div>

      <KitSwatches colors={kit.colors} />

      <div className="flex gap-2">
        <Button
          data-kit-edit=""
          variant="secondary"
          size="sm"
          className="flex-1"
          aria-label={`Edit ${kit.name}`}
          onClick={() => onEdit(kit)}
        >
          <MotionIcon icon={PencilIcon} className="h-4 w-4" />
          Edit
        </Button>
        <TooltipHint label="Duplicate" side="top" disabled={!canCopy}>
          <Button
            variant="secondary"
            size="sm"
            className="w-9 shrink-0 px-0"
            aria-label={copying ? `Duplicating ${kit.name}` : `Duplicate ${kit.name}`}
            aria-busy={copying || undefined}
            disabled={!canCopy}
            onClick={() => onDuplicate(kit)}
          >
            <MotionIcon icon={CopyIcon} className="h-4 w-4" />
          </Button>
        </TooltipHint>
        <TooltipHint label="Delete" side="top">
          <Button
            variant="danger"
            size="sm"
            className="w-9 shrink-0 px-0"
            aria-label={`Delete ${kit.name}`}
            onClick={() => onDelete(kit)}
          >
            <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
          </Button>
        </TooltipHint>
      </div>
    </li>
  );
}

export function DeleteBrandKitDialog({
  kit,
  onOpenChange,
  onDeleted,
}: {
  kit: BrandKitView | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: (kit: BrandKitView) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (kit) setError(null);
  }, [kit]);

  async function confirm(event: React.MouseEvent) {
    // Kept open until the request settles, so an error has somewhere to show.
    event.preventDefault();
    if (!kit) return;

    setWorking(true);

    try {
      await api(`/studio/brand-kits/${encodeURIComponent(kit.id)}`, { method: 'DELETE' });
      onDeleted(kit);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'That brand kit could not be deleted.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <AlertDialog
      open={kit !== null}
      onOpenChange={(open) => {
        if (!working) onOpenChange(open);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {kit?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Designs that used it keep their colours and logo. The logo stays in your media library.
            This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={working}>Keep It</AlertDialogCancel>
          <AlertDialogAction variant="danger" onClick={confirm} disabled={working}>
            {working ? 'Deleting…' : 'Delete'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
