'use client';

/**
 * Connections (Sprint 10, Module 04; blueprint section 10): the outside
 * apps this workspace has linked, Zapier's Apps page in PostGear's look.
 *
 * Each row: the app's logo, the name, the status in words (and "Saved, not
 * checked" under a webhook link, which can only be proven by sending), when
 * it was last really checked, and the workflows using it. Admins add,
 * check, rename, reconnect and delete; members read. The secret itself is
 * never here: only its masked hint.
 */
import { EllipsisIcon } from '@animateicons/react/lucide/ellipsis-icon';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
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
  Card,
  CardContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  MotionIcon,
  PageActions,
  Popover,
  PopoverContent,
  PopoverTrigger,
  SearchInput,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Text,
  toast,
} from '@postgear/ui';
import { Plug } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { Connection, ConnectionCheckResult } from '@/types/workflows';
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
  searchConnections,
  usedByText,
} from './connections-view-model';
import { GoogleConnectDialog } from './google-connect-dialog';

export interface ConnectionsViewProps {
  orgId: string;
  initialConnections: Connection[] | null;
  canManage: boolean;
  /** `?connectError=` from an OAuth sign-in that did not finish. */
  connectErrorCode: string | null;
  /** `?connection=` from an OAuth sign-in that finished. */
  connectedId?: string | null;
  /**
   * What connecting Google offers (`GET /automation-connections`'s flags);
   * null when the list did not load, so the Google dialog asks itself.
   */
  googleSetup?: GoogleSetup | null;
}

export function ConnectionsView({
  orgId,
  initialConnections,
  canManage,
  connectErrorCode,
  connectedId = null,
  googleSetup = null,
}: ConnectionsViewProps) {
  const [connections, setConnections] = useState<Connection[] | null>(initialConnections);
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<ConnectDialogMode | null>(null);
  const [deleting, setDeleting] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false);
  const [google, setGoogle] = useState<{ reconnect: Connection | null } | null>(null);
  const connectError = connectErrorMessage(connectErrorCode);
  const returnTo = `/${orgId}/workflows/connections`;

  useEffect(() => {
    if (connectError) toast({ title: connectError, variant: 'danger' });
  }, [connectError]);

  useEffect(() => {
    if (connectedId) toast({ title: 'Connection saved' });
  }, [connectedId]);

  const shown = useMemo(() => searchConnections(connections ?? [], search), [connections, search]);

  async function reload() {
    try {
      const result = await api<{ connections: Connection[] }>('/automation-connections');
      setConnections(result.connections);
    } catch {
      // The list on screen stays; the next action refreshes it.
    }
  }

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

  const addMenu = canManage ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button data-testid="connection-add">
          <MotionIcon icon={PlusIcon} className="h-4 w-4" />
          Add Connection
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {ADD_MENU_APPS.map((app) => (
          <DropdownMenuItem
            key={app}
            onSelect={() =>
              isFormApp(app) ? setDialog({ kind: 'add', app }) : setGoogle({ reconnect: null })
            }
          >
            <AppIcon icon={appIcon(app)} />
            {appTitle(app)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  const liveUse = deleting?.usedBy.some((use) => use.live) ?? false;

  return (
    <Stack gap="lg">
      <PageActions>
        <div className="w-full sm:w-64">
          <SearchInput
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onClear={() => setSearch('')}
            placeholder="Enter your search"
            aria-label="Search connections"
          />
        </div>
        {addMenu}
      </PageActions>

      {connections === null ? (
        <Alert variant="danger">
          The connections could not be loaded.{' '}
          <Button variant="secondary" size="sm" onClick={reload}>
            Retry
          </Button>
        </Alert>
      ) : connections.length === 0 ? (
        <EmptyState
          icon={Plug}
          title="No connections yet"
          description={
            canManage
              ? 'Connect Slack, Microsoft Teams, Discord, Google or secret headers once, then use them in any workflow.'
              : 'Ask a workspace admin to connect the apps your workflows need.'
          }
        />
      ) : shown.length === 0 ? (
        <Text muted>No connections match that search.</Text>
      ) : (
        <Card>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Connection</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last Checked</TableHead>
                  <TableHead>Used By</TableHead>
                  <TableHead className="relative w-12">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((connection) => {
                  const status = STATUS_WORDS[connection.status];
                  const note = checkNote(connection);
                  return (
                    <TableRow
                      key={connection.id}
                      data-testid="connection-row"
                      data-connection-id={connection.id}
                    >
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border-2 border-outline bg-card">
                            <AppIcon icon={appIcon(connection.provider)} className="h-5 w-5" />
                          </span>
                          <div className="flex min-w-0 flex-col">
                            <span className="flex min-w-0 items-center gap-2">
                              <span className="type-ui truncate text-ink">{connection.name}</span>
                              {isSimulated(connection) ? (
                                <Badge variant="secondary" className="shrink-0">
                                  Simulated
                                </Badge>
                              ) : null}
                            </span>
                            <Text size="xs" muted as="span" className="font-mono">
                              {connection.maskedHint}
                            </Text>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1">
                          <Badge variant={status.variant}>{status.label}</Badge>
                          {note ? (
                            <Text size="xs" muted as="span">
                              {note}
                            </Text>
                          ) : null}
                          {connection.lastError && connection.status !== 'CONNECTED' ? (
                            <Text size="xs" as="span" className="text-dangerInk">
                              {connection.lastError}
                            </Text>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Text size="sm" as="span">
                          {lastCheckedText(connection)}
                        </Text>
                      </TableCell>
                      <TableCell>
                        {connection.usedBy.length === 0 ? (
                          <Text size="sm" muted as="span">
                            {usedByText(0)}
                          </Text>
                        ) : (
                          <Popover>
                            <PopoverTrigger asChild>
                              <Button variant="secondary" size="sm">
                                {usedByText(connection.usedBy.length)}
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent align="start" className="w-64">
                              <ul className="flex flex-col gap-1">
                                {connection.usedBy.map((use) => (
                                  <li
                                    key={use.id}
                                    className="flex items-center justify-between gap-2"
                                  >
                                    <Link
                                      href={`/${orgId}/workflows/${use.id}`}
                                      className="type-ui truncate text-sm text-ink underline"
                                    >
                                      {use.name}
                                    </Link>
                                    {use.live ? <Badge variant="success">On</Badge> : null}
                                  </li>
                                ))}
                              </ul>
                            </PopoverContent>
                          </Popover>
                        )}
                      </TableCell>
                      <TableCell>
                        {canManage ? (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="secondary"
                                size="sm"
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
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {!canManage ? (
        <Text size="sm" muted>
          Only workspace admins can add or change connections.
        </Text>
      ) : null}

      <ConnectDialog
        mode={dialog}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        onSaved={(connection) => {
          upsert(connection);
          toast({ title: dialog?.kind === 'add' ? 'Connection saved' : 'Connection updated' });
        }}
      />

      <GoogleConnectDialog
        open={google !== null}
        onOpenChange={(open) => {
          if (!open) setGoogle(null);
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
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
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
    </Stack>
  );
}
