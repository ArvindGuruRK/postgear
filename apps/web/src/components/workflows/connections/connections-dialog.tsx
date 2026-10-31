'use client';

/**
 * Connections (Sprint 10, Module 04; blueprint section 10), as a modal over
 * the Workflows list (2026-10-31): the outside apps this workspace has linked,
 * after the channel picker's dialog and TriForms' Connectors.
 *
 * Two parts. At the top, one tile per app a workflow can use (Slack,
 * Microsoft Teams, Discord, secret headers, Google): pick one to connect it.
 * Under it, the apps already connected, each with its status in words (and
 * "Saved, not checked" under a webhook link, which can only be proven by
 * sending), when it was last really checked and the workflows using it.
 * Admins add, check, rename, reconnect and delete; members read. The secret
 * itself is never here: only its masked hint.
 *
 * The list is fetched when the dialog opens, so the Workflows page does not
 * ask for it unless someone looks.
 */
import { EllipsisIcon } from '@animateicons/react/lucide/ellipsis-icon';
import {
  Alert,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  MotionIcon,
  pressSm,
  Skeleton,
  Text,
  toast,
} from '@postgear/ui';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { Connection, ConnectionCheckResult, ConnectionList } from '@/types/workflows';
import { AppIcon } from '../app-icon';
import { ConnectDialog, type ConnectDialogMode } from './connect-dialog';
import {
  ADD_MENU_APPS,
  appIcon,
  appTitle,
  checkNote,
  connectErrorMessage,
  deleteWarning,
  type GoogleSetup,
  isFormApp,
  isSimulated,
  lastCheckedText,
  STATUS_WORDS,
  usedByText,
} from './connections-view-model';
import { GoogleConnectDialog } from './google-connect-dialog';

export interface ConnectionsDialogProps {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  /** `?connectError=` from an OAuth sign-in that did not finish. */
  connectErrorCode?: string | null;
  /** `?connection=` from an OAuth sign-in that finished. */
  connectedId?: string | null;
}

const FOCUS =
  'outline-none focus-visible:outline-solid focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focusRing';

export function ConnectionsDialog({
  orgId,
  open,
  onOpenChange,
  canManage,
  connectErrorCode = null,
  connectedId = null,
}: ConnectionsDialogProps) {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [googleSetup, setGoogleSetup] = useState<GoogleSetup | null>(null);
  const [failed, setFailed] = useState(false);
  const [dialog, setDialog] = useState<ConnectDialogMode | null>(null);
  const [deleting, setDeleting] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false);
  const [google, setGoogle] = useState<{ reconnect: Connection | null } | null>(null);
  const connectError = connectErrorMessage(connectErrorCode);
  const returnTo = `/${orgId}/workflows?connections=1`;

  useEffect(() => {
    if (connectError) toast({ title: connectError, variant: 'danger' });
  }, [connectError]);

  useEffect(() => {
    if (connectedId) toast({ title: 'Connection saved' });
  }, [connectedId]);

  async function load() {
    try {
      const result = await api<Partial<ConnectionList>>('/automation-connections');
      setConnections(result.connections ?? []);
      setGoogleSetup({
        simulation: result.simulation === true,
        googleReady: result.googleReady === true,
      });
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  // biome-ignore lint/correctness/useExhaustiveDependencies: `load` reads nothing from render; it runs each time the dialog opens
  useEffect(() => {
    if (open) void load();
  }, [open]);

  function upsert(connection: Connection) {
    setConnections((current) => {
      const list = current ?? [];
      return list.some((entry) => entry.id === connection.id)
        ? list.map((entry) => (entry.id === connection.id ? connection : entry))
        : [...list, connection];
    });
  }

  async function check(connection: Connection) {
    try {
      const result = await api<ConnectionCheckResult>(
        `/automation-connections/${connection.id}/check`,
        { method: 'POST' },
      );
      upsert(result.connection);
      toast({
        title: result.message,
        variant: result.connection.status === 'CONNECTED' ? 'default' : 'danger',
      });
    } catch (cause) {
      toast({
        title: cause instanceof ApiError ? cause.message : 'The check did not run. Try again.',
        variant: 'danger',
      });
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setBusy(true);
    try {
      await api(`/automation-connections/${deleting.id}`, { method: 'DELETE' });
      setConnections((current) => (current ?? []).filter((entry) => entry.id !== deleting.id));
      toast({ title: 'Connection deleted' });
      setDeleting(null);
    } catch (cause) {
      toast({
        title: cause instanceof ApiError ? cause.message : 'That did not work. Try again.',
        variant: 'danger',
      });
    } finally {
      setBusy(false);
    }
  }

  const liveUse = deleting?.usedBy.some((use) => use.live) ?? false;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="max-w-4xl"
          data-testid="connections-dialog"
          // The first app tile would take the focus ring on open; the dialog itself does.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Connections</DialogTitle>
            <DialogDescription>Connect an app once, then use it in any workflow.</DialogDescription>
          </DialogHeader>

          <div className="pg-scrollbar pg-scrollbar-secondary -mx-2 mt-2 flex max-h-[min(70vh,40rem)] flex-col gap-6 overflow-y-auto px-2 pt-1 pb-2">
            {canManage ? (
              <section aria-labelledby="connections-apps" className="flex flex-col gap-3">
                <h3 id="connections-apps" className="type-heading text-lg text-ink">
                  Apps
                </h3>
                <ul className="grid grid-cols-5 gap-3">
                  {ADD_MENU_APPS.map((app) => (
                    <li key={app} className="flex">
                      <button
                        type="button"
                        data-testid={`connection-add-${app}`}
                        onClick={() =>
                          isFormApp(app)
                            ? setDialog({ kind: 'add', app })
                            : setGoogle({ reconnect: null })
                        }
                        className={cn(
                          'flex w-full flex-col items-center gap-2 rounded-card border-2 border-outline bg-secondary px-2 py-4 text-center',
                          pressSm,
                          FOCUS,
                        )}
                      >
                        <AppIcon icon={appIcon(app)} className="h-8 w-8" />
                        <span className="type-ui text-sm text-ink">{appTitle(app)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section aria-labelledby="connections-list" className="flex flex-col gap-3">
              <h3 id="connections-list" className="type-heading text-lg text-ink">
                Connected
              </h3>

              {connections === null && !failed ? (
                <Skeleton className="h-32" aria-label="Loading connections" />
              ) : connections === null ? (
                <Alert variant="danger" className="flex-wrap items-center">
                  <span className="min-w-0 grow">The connections could not be loaded.</span>
                  <Button variant="secondary" size="sm" onClick={() => void load()}>
                    Retry
                  </Button>
                </Alert>
              ) : connections.length === 0 ? (
                <Text muted>
                  {canManage
                    ? 'Nothing connected yet. Pick an app above to start.'
                    : 'Ask a workspace admin to connect the apps your workflows need.'}
                </Text>
              ) : (
                <ul className="flex flex-col gap-2">
                  {connections.map((connection) => {
                    const status = STATUS_WORDS[connection.status];
                    const note = checkNote(connection);
                    return (
                      <li
                        key={connection.id}
                        data-testid="connection-row"
                        data-connection-id={connection.id}
                        className="flex items-center gap-3 rounded-card border-2 border-outline bg-inset p-3 shadow-surfaceSm"
                      >
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border-2 border-outline bg-inset">
                          <AppIcon icon={appIcon(connection.provider)} className="h-5 w-5" />
                        </span>
                        <div className="flex min-w-0 flex-1 flex-col">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate type-ui text-ink">{connection.name}</span>
                            {isSimulated(connection) ? (
                              <Badge variant="secondary" className="shrink-0">
                                Simulated
                              </Badge>
                            ) : null}
                          </span>
                          <Text size="xs" muted as="span" className="truncate font-mono">
                            {connection.maskedHint}
                          </Text>
                        </div>
                        <div className="flex shrink-0 flex-col items-start gap-1">
                          <Badge variant={status.variant}>{status.label}</Badge>
                          <Text size="xs" muted as="span">
                            {note ?? `Checked: ${lastCheckedText(connection)}`}
                          </Text>
                          {connection.lastError && connection.status !== 'CONNECTED' ? (
                            <Text size="xs" as="span" className="text-dangerInk">
                              {connection.lastError}
                            </Text>
                          ) : null}
                        </div>
                        <div className="flex w-44 shrink-0 flex-col items-start gap-1">
                          {connection.usedBy.length === 0 ? (
                            <Text size="sm" muted as="span">
                              {usedByText(0)}
                            </Text>
                          ) : (
                            <>
                              <Text size="sm" as="span">
                                {usedByText(connection.usedBy.length)}
                              </Text>
                              <span className="flex max-w-full flex-col gap-0.5">
                                {connection.usedBy.slice(0, 2).map((use) => (
                                  <Link
                                    key={use.id}
                                    href={`/${orgId}/workflows/${use.id}`}
                                    className="truncate type-ui text-xs text-ink underline underline-offset-2"
                                  >
                                    {use.name}
                                  </Link>
                                ))}
                              </span>
                            </>
                          )}
                        </div>
                        {canManage ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="secondary"
                                size="sm"
                                className="w-9 shrink-0 px-0"
                                aria-label={`Actions for ${connection.name}`}
                              >
                                <MotionIcon icon={EllipsisIcon} className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onSelect={() => void check(connection)}>
                                Check Connection
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onSelect={() => setDialog({ kind: 'rename', connection })}
                              >
                                Rename
                              </DropdownMenuItem>
                              {isFormApp(connection.provider) ? (
                                <DropdownMenuItem
                                  onSelect={() => setDialog({ kind: 'reconnect', connection })}
                                >
                                  Reconnect
                                </DropdownMenuItem>
                              ) : connection.provider === 'google' && !isSimulated(connection) ? (
                                <DropdownMenuItem
                                  onSelect={() => setGoogle({ reconnect: connection })}
                                >
                                  Reconnect
                                </DropdownMenuItem>
                              ) : null}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="text-dangerInk"
                                onSelect={() => setDeleting(connection)}
                              >
                                Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}

              {!canManage ? (
                <Text size="sm" muted>
                  Only workspace admins can add or change connections.
                </Text>
              ) : null}
            </section>
          </div>
        </DialogContent>
      </Dialog>

      <ConnectDialog
        mode={dialog}
        onOpenChange={(next) => {
          if (!next) setDialog(null);
        }}
        onSaved={(connection) => {
          upsert(connection);
          toast({ title: dialog?.kind === 'add' ? 'Connection saved' : 'Connection updated' });
        }}
      />

      <GoogleConnectDialog
        open={google !== null}
        onOpenChange={(next) => {
          if (!next) setGoogle(null);
        }}
        onSaved={(connection) => {
          upsert(connection);
          toast({ title: 'Connection saved' });
        }}
        returnTo={returnTo}
        setup={googleSetup}
        reconnect={google?.reconnect ?? null}
      />

      <AlertDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleting ? deleteWarning(deleting) : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Keep It</AlertDialogCancel>
            {liveUse ? null : (
              <AlertDialogAction
                variant="danger"
                onClick={() => void confirmDelete()}
                disabled={busy}
                data-testid="connection-delete-confirm"
              >
                {busy ? 'Deleting...' : 'Delete'}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
