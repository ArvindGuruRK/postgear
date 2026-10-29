'use client';

/**
 * What the builder route renders: the builder once the workflow is here.
 * The server usually hands it down; when it could not (a workspace switch
 * that has not landed, or a failed request) this asks again in the browser,
 * with the missing warning for a 404 and a retry for anything else.
 */
import { Alert, Button, Skeleton } from '@postgear/ui';
import { TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { AutomationDetail } from '@/types/workflows';
import { BuilderPage, type BuilderPageProps } from './builder-page';
import { WORKFLOW_LOAD_FAILED } from './builder-view-model';
import { WorkflowMissing } from './workflow-missing';

type Load =
  | { kind: 'loading' }
  | { kind: 'ready'; automation: AutomationDetail }
  | { kind: 'missing' }
  | { kind: 'failed' };

export function BuilderRoute({
  automationId,
  automation,
  ...rest
}: Omit<BuilderPageProps, 'automation'> & {
  automationId: string;
  automation: AutomationDetail | null;
}) {
  const [load, setLoad] = useState<Load>(
    automation ? { kind: 'ready', automation } : { kind: 'loading' },
  );

  const fetchIt = useCallback(() => {
    setLoad({ kind: 'loading' });
    api<{ automation: AutomationDetail }>(`/automations/${encodeURIComponent(automationId)}`)
      .then((result) => setLoad({ kind: 'ready', automation: result.automation }))
      .catch((cause: unknown) =>
        setLoad(
          cause instanceof ApiError && cause.status === 404
            ? { kind: 'missing' }
            : { kind: 'failed' },
        ),
      );
  }, [automationId]);

  useEffect(() => {
    if (!automation) fetchIt();
  }, [automation, fetchIt]);

  if (load.kind === 'ready')
    return <BuilderPage key={load.automation.id} automation={load.automation} {...rest} />;
  if (load.kind === 'missing') return <WorkflowMissing orgId={rest.orgId} />;
  if (load.kind === 'failed') {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <Alert variant="danger" className="flex-wrap items-center">
          <TriangleAlert aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={2.5} />
          <span className="min-w-0 grow basis-56">{WORKFLOW_LOAD_FAILED}</span>
          <Button variant="secondary" size="sm" onClick={fetchIt}>
            Retry
          </Button>
        </Alert>
      </div>
    );
  }
  return <Skeleton className="min-h-96 flex-1" aria-label="Loading the workflow" />;
}
