'use client';

/**
 * The kit page's Brand Kit tab (Module 10 section 3): the workspace's Studio
 * brand kits, one `BrandKitCard` each with the clip fields. Kits are made and
 * named in Design Studio; with none, the tab points there. The caption styles
 * (built in and the workspace's own) are read once for every card's picker.
 */
import { Alert, Button, EmptyState, Skeleton } from '@postgear/ui';
import { Palette, TriangleAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { listCaptionStyles } from '@/lib/clips-api';
import { listClipBrandKits } from '@/lib/clips-recipes-api';
import type { CaptionStyleView } from '@/types/clips';
import type { ClipBrandKitView } from '@/types/clips-recipes';
import { BrandKitCard } from './brand-kit-card';
import { KITS_FAILED, NO_KITS_HELP, NO_KITS_SENTENCE } from './kit-model';
import type { BrandUploadDeps } from './use-brand-video-upload';

type KitsState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; kits: ClipBrandKitView[] };

export function BrandKitsTab({
  orgId,
  initial,
  uploadDeps,
}: {
  orgId: string;
  initial: ClipBrandKitView[] | null;
  uploadDeps?: BrandUploadDeps;
}) {
  const router = useRouter();
  const [state, setState] = useState<KitsState>(
    initial ? { status: 'ready', kits: initial } : { status: 'loading' },
  );
  const [styles, setStyles] = useState<CaptionStyleView[] | null>(null);
  const [attempt, setAttempt] = useState(initial ? 0 : 1);

  useEffect(() => {
    if (attempt === 0) return;
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

  useEffect(() => {
    const abort = new AbortController();
    listCaptionStyles({ signal: abort.signal })
      .then((view) => {
        if (!abort.signal.aborted) setStyles(view.styles);
      })
      .catch(() => {
        // The picker then offers None only; the rest of the card still works.
        if (!abort.signal.aborted) setStyles([]);
      });
    return () => abort.abort();
  }, []);

  const replace = useCallback((kit: ClipBrandKitView) => {
    setState((current) =>
      current.status === 'ready'
        ? { status: 'ready', kits: current.kits.map((one) => (one.id === kit.id ? kit : one)) }
        : current,
    );
  }, []);

  if (state.status === 'loading') {
    return (
      <div className="flex flex-col gap-4" data-testid="clip-kit-brand-loading">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (state.status === 'failed') {
    return (
      <Alert variant="warning" className="items-center" data-testid="clip-kit-brand-failed">
        <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
        <p className="m-0 min-w-0 flex-1">{KITS_FAILED}</p>
        <Button variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)}>
          Try Again
        </Button>
      </Alert>
    );
  }
  if (state.kits.length === 0) {
    return (
      <EmptyState
        icon={Palette}
        title={NO_KITS_SENTENCE}
        description={NO_KITS_HELP}
        action={{
          label: 'Open Design Studio',
          onClick: () => router.push(`/${encodeURIComponent(orgId)}/studio`),
          variant: 'primary',
        }}
        data-testid="clip-kit-no-kits"
      />
    );
  }
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2" data-testid="clip-kit-brand-kits">
      {state.kits.map((kit) => (
        <BrandKitCard
          key={kit.id}
          kit={kit}
          styles={styles}
          onChange={replace}
          uploadDeps={uploadDeps}
        />
      ))}
    </div>
  );
}
