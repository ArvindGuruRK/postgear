'use client';

/**
 * A design that is not there: deleted, never real, or another workspace's,
 * which the API answers alike (section 5). One warning and the way back to
 * Studio, the same wherever it is found out: the server page (the route's
 * `not-found.tsx`, which gets no props, so the workspace comes from the URL)
 * or the editor's own load in the browser.
 *
 * The editor's other alerts share the pieces: `ALERT_ICON`, `ALERT_TEXT` and
 * `BackToStudio`, which a save that finds the design deleted offers too.
 */
import { ArrowLeftIcon } from '@animateicons/react/lucide/arrow-left-icon';
import { Alert, MotionIcon } from '@postgear/ui';
import { TriangleAlert } from 'lucide-react';
import { useParams } from 'next/navigation';
import { ActionLink } from '@/components/home/home-actions';
import { DESIGN_MISSING_MESSAGE } from './studio-editor-model';

export const ALERT_ICON = 'h-5 w-5 shrink-0';

/**
 * An alert's sentence: it fills the line, and the alert's buttons wrap
 * below it once there is no room beside it, rather than squeezing it.
 */
export const ALERT_TEXT = 'min-w-0 grow basis-56 break-words';

/** The way back to the Studio page, as a link (it navigates). */
export function BackToStudio({ orgId }: { orgId: string }) {
  return (
    <ActionLink href={`/${orgId}/studio`}>
      <MotionIcon icon={ArrowLeftIcon} className="h-4 w-4" />
      Back To Studio
    </ActionLink>
  );
}

/** The warning for a design that is not there, in place of the editor. */
export function DesignMissing({ orgId }: { orgId: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <Alert variant="warning" role="status" className="flex-wrap items-center">
        <TriangleAlert aria-hidden="true" className={ALERT_ICON} strokeWidth={2.5} />
        <span className={ALERT_TEXT}>{DESIGN_MISSING_MESSAGE}</span>
        <BackToStudio orgId={orgId} />
      </Alert>
    </div>
  );
}

/** The same, for the route's not-found page: the workspace is the URL's. */
export function DesignMissingHere() {
  const { orgId } = useParams<{ orgId: string }>();
  return <DesignMissing orgId={orgId} />;
}
