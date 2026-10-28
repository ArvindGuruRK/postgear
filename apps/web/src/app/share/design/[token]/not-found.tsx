import { SHARE_UNAVAILABLE } from '@/components/studio/preview-model';

/**
 * A dead share link (DS-9.2): expired, revoked, deleted or never real, which
 * the API answers alike. One sentence and nothing else, sent as a real 404
 * so link checkers and archives see the link is gone; Next adds `noindex`.
 */
export default function SharedDesignGone() {
  return (
    <main className="flex min-h-dvh items-center justify-center p-6" data-testid="share-gone">
      <p className="m-0 text-center font-sans text-lg font-bold text-ink">{SHARE_UNAVAILABLE}</p>
    </main>
  );
}
