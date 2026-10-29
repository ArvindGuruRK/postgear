'use client';

/**
 * A workflow that is not there: deleted, never real, or another workspace's,
 * which the API answers alike. One warning and the way back to Workflows,
 * from the route's `not-found.tsx` (no props, so the workspace comes from
 * the URL) or from the builder's own load in the browser.
 */
import { ArrowLeftIcon } from '@animateicons/react/lucide/arrow-left-icon';
import { Alert, MotionIcon } from '@postgear/ui';
import { TriangleAlert } from 'lucide-react';
import { useParams } from 'next/navigation';
import { ActionLink } from '@/components/home/home-actions';
import { WORKFLOW_MISSING_MESSAGE } from './builder-view-model';

export function WorkflowMissing({ orgId }: { orgId: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <Alert variant="warning" role="status" className="flex-wrap items-center">
        <TriangleAlert aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={2.5} />
        <span className="min-w-0 grow basis-56 break-words">{WORKFLOW_MISSING_MESSAGE}</span>
        <ActionLink href={`/${orgId}/workflows`}>
          <MotionIcon icon={ArrowLeftIcon} className="h-4 w-4" />
          Back To Workflows
        </ActionLink>
      </Alert>
    </div>
  );
}

export function WorkflowMissingHere() {
  const { orgId } = useParams<{ orgId: string }>();
  return <WorkflowMissing orgId={orgId} />;
}
