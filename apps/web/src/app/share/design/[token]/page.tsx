import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { BrandMark } from '@/components/brand/brand-mark';
import { type ShareProblem, shareProblem } from '@/components/studio/preview-model';
import {
  SharedDesignFailure,
  SharedDesignPreview,
  ShareExpiry,
} from '@/components/studio/shared-design-view';
import { StudioFonts } from '@/components/studio/studio-fonts';
import { ApiError, serverApi } from '@/lib/api';
import type { SharedDesignView } from '@/types/studio';

/**
 * Search engines and link archives are told to stay away, and the page
 * sends no referrer, so the link's token never reaches the hosts its
 * pictures load from.
 */
export const metadata: Metadata = {
  title: 'Shared Design',
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    googleBot: { index: false, follow: false, noarchive: true },
  },
  referrer: 'no-referrer',
};

/** Phone first: the page's own gutters, out of the way of a notch and the home bar. */
const PAGE =
  'mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-5 pt-[max(1.5rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(2rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] sm:pt-10';

/**
 * A shared design (Sprint 9, DS-9.2), for anyone holding the link: no
 * sign-in. Outside the route groups, so only the root layout applies: no
 * dashboard shell, and no session is read or sent.
 *
 * - **Live link**: the design's title and workspace, the platform frames
 *   with the slides to swipe through and the caption, and when the link
 *   stops working.
 * - **Dead link** (expired, revoked, deleted or never real, which the API
 *   answers alike): "This link is no longer available." and nothing else,
 *   with a 404 (`not-found.tsx`).
 * - **The API away or failing**: a sentence and Try Again.
 *
 * Fetched on every request (the API marks it `no-store`), so a revocation
 * or an edit shows on the next load.
 */
export default async function SharedDesignPage({ params }: PageProps<'/share/design/[token]'>) {
  const { token } = await params;
  const loaded = await loadShare(token);

  if (!loaded.ok) {
    // `not-found.tsx` beside this page: the one sentence, with a 404.
    if (loaded.problem === 'gone') notFound();

    return (
      <main className={PAGE} data-testid="share-failed">
        <SharedDesignFailure />
      </main>
    );
  }

  const { view } = loaded;

  return (
    <main className={PAGE} data-testid="shared-design">
      {/* The design's own typefaces, from the API: the slides use them, not the app's. */}
      <StudioFonts />

      <header className="flex min-w-0 flex-col gap-1">
        <h1 className="m-0 break-words type-heading text-2xl text-ink">{view.title}</h1>
        <p className="m-0 break-words font-sans text-sm font-medium text-ink muted-tone">
          Shared by {view.workspaceName}
        </p>
      </header>

      <SharedDesignPreview view={view} />

      <footer className="flex flex-col items-center gap-2 text-center font-sans text-xs font-medium text-ink muted-tone">
        <ShareExpiry expiresAt={view.expiresAt} />
        <p className="m-0 flex items-center gap-2">
          <BrandMark className="h-5 w-5" />
          Made with PostGear
        </p>
      </footer>
    </main>
  );
}

type Loaded = { ok: true; view: SharedDesignView } | { ok: false; problem: ShareProblem };

/** The shared design, without the visitor's cookies: the route is public and needs none. */
async function loadShare(token: string): Promise<Loaded> {
  try {
    const view = await serverApi<SharedDesignView>(
      `/public/design-shares/${encodeURIComponent(token)}`,
    );
    return { ok: true, view };
  } catch (cause) {
    // A connection that never got an answer is a TypeError, and a proxy's
    // HTML page a SyntaxError: both are worth another try.
    return {
      ok: false,
      problem: cause instanceof ApiError ? shareProblem(cause.status) : 'failed',
    };
  }
}
