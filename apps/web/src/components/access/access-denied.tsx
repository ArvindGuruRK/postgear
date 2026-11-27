'use client';

/**
 * The plain page a role may not open (Sprint 13, Module 14): an Editor who
 * types `/analytics`, a bookmark to Billing, an old link to a workflow.
 *
 * One warning `Alert` with the one sentence, and the way back to where this
 * person lands: Clips for an Editor, Home for everyone else. Drawn by
 * `RoleGate` in the denied sections' layouts, in place of the page, so the
 * page never shows half loaded with its requests refused. It fills whatever
 * frame it is in: the dashboard's page region, or the whole window under an
 * immersive route (the workflow builder), centred either way.
 *
 * Presentation only: the API refuses every request these pages would make.
 */
import { ClapperboardIcon } from '@animateicons/react/lucide/clapperboard-icon';
import { HouseIcon } from '@animateicons/react/lucide/house-icon';
import { isEditor, PAGE_DENIED_SENTENCE, type RoleInput } from '@postgear/entitlements';
import { Alert, MotionIcon } from '@postgear/ui';
import { Lock } from 'lucide-react';
import { workspaceHome } from '@/lib/workspace-home';
import { ActionLink } from '../home/home-actions';

export function AccessDenied({
  orgId,
  workspaceRole,
}: {
  orgId: string;
  /** The viewer's role here, or null when it could not be read. */
  workspaceRole: RoleInput;
}) {
  const editor = isEditor(workspaceRole);

  return (
    <div
      className="flex w-full flex-1 items-center justify-center p-4 md:p-8"
      data-testid="access-denied"
    >
      <div className="flex w-full max-w-md flex-col items-start gap-4">
        <Alert variant="warning" className="w-full items-center">
          <Lock className="h-5 w-5 shrink-0" strokeWidth={2.5} aria-hidden="true" />
          <span>{PAGE_DENIED_SENTENCE}</span>
        </Alert>
        <ActionLink href={workspaceHome(orgId, workspaceRole)}>
          <MotionIcon icon={editor ? ClapperboardIcon : HouseIcon} className="h-4 w-4" />
          {editor ? 'Go To Clips' : 'Go To Home'}
        </ActionLink>
      </div>
    </div>
  );
}
