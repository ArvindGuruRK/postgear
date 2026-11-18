import { Alert, Card } from '@postgear/ui';
import {
  LIBRARY_CREDIT_GROUPS,
  type LibraryCreditGroup,
  type LibraryCreditSource,
  type LibraryCreditsView,
} from '@postgear/video-engine';
import { TriangleAlert } from 'lucide-react';
import type { Metadata } from 'next';
import { BrandMark, BrandName } from '@/components/brand/brand-mark';
import {
  CREDIT_GROUP_NAMES,
  CREDITS_EMPTY,
  CREDITS_FAILED,
  CREDITS_INTRO,
  licenceName,
  linkable,
  sourceByline,
} from '@/components/clips/credits-model';
import { serverApi } from '@/lib/api';

export const metadata: Metadata = {
  title: 'Clips Credits',
};

const PAGE =
  'mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 pt-[max(1.5rem,env(safe-area-inset-top))] pr-[max(1rem,env(safe-area-inset-right))] pb-[max(2rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))] sm:pt-10';

const LINK = 'text-ink underline underline-offset-2 hover:text-actionPrimary';

/**
 * The Clips credits (Module 12 section 9, sounds from Module 14), for anyone:
 * where the library's stickers and sounds come from, in four groups
 * (Attribution Required, Notices, Public Domain And CC0, Made By PostGear),
 * from `GET /clips/library/credits`, which lists only sources that have live
 * stickers or sounds, each with its counts. Outside the route groups, so no
 * session is read or sent.
 */
export default async function ClipsCreditsPage() {
  const credits = await loadCredits();

  return (
    <main className={PAGE} data-testid="clips-credits">
      <header className="flex min-w-0 flex-col gap-2">
        <h1 className="m-0 type-heading text-2xl text-ink">Credits</h1>
        <p className="m-0 font-sans text-sm text-ink type-muted">{CREDITS_INTRO}</p>
      </header>

      {credits === null ? (
        <Alert variant="danger" className="items-center">
          <TriangleAlert className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <p className="m-0 min-w-0 flex-1">{CREDITS_FAILED}</p>
        </Alert>
      ) : credits.groups.length === 0 ? (
        <p className="m-0 font-sans text-sm text-ink type-muted">{CREDITS_EMPTY}</p>
      ) : (
        LIBRARY_CREDIT_GROUPS.map((group) => {
          const found = credits.groups.find((entry) => entry.group === group);
          if (!found || found.sources.length === 0) return null;
          return <CreditGroup key={group} group={group} sources={found.sources} />;
        })
      )}

      <footer className="mt-auto flex items-center justify-center gap-2 pt-4 font-sans text-xs text-ink type-muted">
        <BrandMark className="h-5 w-5" />
        <span>
          <BrandName /> Clips
        </span>
      </footer>
    </main>
  );
}

function CreditGroup({
  group,
  sources,
}: {
  group: LibraryCreditGroup;
  sources: readonly LibraryCreditSource[];
}) {
  return (
    <section className="flex flex-col gap-3" data-testid={`credits-${group}`}>
      <h2 className="m-0 type-heading text-lg text-ink">
        {group === 'own' ? (
          <>
            Made By <BrandName />
          </>
        ) : (
          CREDIT_GROUP_NAMES[group]
        )}
      </h2>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {sources.map((source) => (
          <CreditSource key={`${source.name}-${source.url}`} source={source} />
        ))}
      </ul>
    </section>
  );
}

function CreditSource({ source }: { source: LibraryCreditSource }) {
  const home = linkable(source.url);
  const licence = licenceName(source.licence);
  const licenceLink = linkable(source.licenceUrl);
  return (
    <li>
      <Card className="flex flex-col gap-1.5 p-4 shadow-surfaceSm">
        <p className="m-0 type-heading text-base text-ink">
          {home ? (
            <a href={home} target="_blank" rel="noopener noreferrer" className={LINK}>
              {source.name}
            </a>
          ) : (
            source.name
          )}
        </p>
        <p className="m-0 font-sans text-sm text-ink type-muted">{sourceByline(source)}</p>
        {licence ? (
          <p className="m-0 font-sans text-sm text-ink">
            Licence:{' '}
            {licenceLink ? (
              <a href={licenceLink} target="_blank" rel="noopener noreferrer" className={LINK}>
                {licence}
              </a>
            ) : (
              licence
            )}
          </p>
        ) : null}
        {source.creditLine ? (
          <p className="m-0 font-sans text-sm text-ink">{source.creditLine}</p>
        ) : null}
        {source.changeNote ? (
          <p className="m-0 font-sans text-sm text-ink type-muted">Changes: {source.changeNote}.</p>
        ) : null}
        {source.noticeText ? (
          <pre className="m-0 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-inset p-3 font-mono text-xs text-ink">
            {source.noticeText}
          </pre>
        ) : null}
      </Card>
    </li>
  );
}

/** The credits, without the visitor's cookies; null when the API did not answer. */
async function loadCredits(): Promise<LibraryCreditsView | null> {
  try {
    return await serverApi<LibraryCreditsView>('/clips/library/credits');
  } catch {
    return null;
  }
}
