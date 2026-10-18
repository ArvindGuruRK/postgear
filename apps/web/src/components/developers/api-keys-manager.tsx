'use client';

/**
 * The API-keys page (Sprint 8, contract §6): the list, and the three
 * actions on it.
 *
 * ## Who can do what
 *
 * The API answers `/developers/api-keys` for admins only, so a `USER`
 * member's page load lands here with `initialKeys === null`. The role from
 * `useWorkspace()` decides what the page *offers* (the create button, the
 * row actions) and the note explains why there is nothing to offer. It is
 * presentation only; `RolesGuard` is where the rule binds.
 *
 * ## Dates render after mount
 *
 * "Created" and "Last used" are formatted in the viewer's locale, which the
 * server does not share, so both wait for `useMounted()` and show a dash
 * until then: the same hydration rule the queue follows.
 *
 * ## Restrained surface
 *
 * The list is a dense data surface (design-system-rules.md §15): a plain
 * `Table`, the prefix in a `code` element, status as a `Badge`. The comic
 * treatment stays on the chrome: the header, the buttons, the dialogs.
 */
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  ErrorState,
  Link,
  PageActions,
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
import { ExternalLink, KeyRound, Plus } from 'lucide-react';
import { useState } from 'react';
import { ApiError, api, BROWSER_API_URL } from '@/lib/api';
import type { ApiKeyCreated, ApiKeyView } from '@/types/developers';
import { useWorkspace } from '../navigation/workspace-provider';
import { useMounted } from '../posts/use-mounted';
import {
  atKeyLimit,
  docsUrl,
  formatCreated,
  formatLastUsed,
  keyStatus,
  MAX_LIVE_KEYS,
  statusBadge,
} from './api-keys-view-model';
import { CreateKeyDialog } from './create-key-dialog';
import { RevokeKeyDialog } from './revoke-key-dialog';
import { RotateKeyDialog } from './rotate-key-dialog';
import { SecretPanel } from './secret-panel';

interface ApiKeysManagerProps {
  /** Null when the list could not be loaded: a `USER` member, or the API away. */
  initialKeys: ApiKeyView[] | null;
}

export function ApiKeysManager({ initialKeys }: ApiKeysManagerProps) {
  const { role } = useWorkspace();
  const canManage = role !== 'USER';
  const mounted = useMounted();

  const [keys, setKeys] = useState<ApiKeyView[] | null>(initialKeys);
  const [createOpen, setCreateOpen] = useState(false);
  const [rotating, setRotating] = useState<ApiKeyView | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyView | null>(null);
  const [rotated, setRotated] = useState<ApiKeyCreated | null>(null);

  const now = new Date();
  const limitReached = keys !== null && atKeyLimit(keys);
  const docs = docsUrl(BROWSER_API_URL);

  async function refresh() {
    try {
      const response = await api<{ keys: ApiKeyView[] }>('/developers/api-keys');
      setKeys(response.keys);
    } catch (cause) {
      toast({
        title: "Couldn't refresh the list",
        description: cause instanceof ApiError ? cause.message : 'Reload the page to see the latest keys.',
      });
    }
  }

  return (
    <Stack gap="lg">
      <PageActions>
        <Link href={docs} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5">
          API reference
          <ExternalLink className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
        </Link>
        {canManage ? (
          <Button onClick={() => setCreateOpen(true)} disabled={limitReached}>
            <Plus className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
            Create key
          </Button>
        ) : null}
      </PageActions>

      {!canManage ? (
        <Text size="sm" muted>
          Only workspace admins can create, rotate or revoke API keys. Ask an admin if your
          integration needs one.
        </Text>
      ) : null}

      {limitReached ? (
        <Text size="sm" muted>
          This workspace has {MAX_LIVE_KEYS} live keys, the most it can hold. Revoke one to create
          another.
        </Text>
      ) : null}

      {keys === null ? (
        canManage ? (
          <ErrorState
            icon={KeyRound}
            title="Couldn't load your API keys"
            description="The API did not answer. Check that it is running, then try again."
            action={{ label: 'Try again', onClick: () => void refresh() }}
          />
        ) : null
      ) : keys.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No API keys yet"
          description="Create a key to call the PostGear API from your own code: list channels, create posts, read analytics."
          action={canManage ? { label: 'Create key', onClick: () => setCreateOpen(true) } : undefined}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Key</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Last used</TableHead>
              <TableHead>Status</TableHead>
              {/* `relative`: the sr-only label is absolutely positioned and must stay inside the cell, not widen the page. */}
              <TableHead className="relative">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {keys.map((key) => {
              const status = keyStatus(key);
              const badge = statusBadge(status);

              return (
                <TableRow
                  key={key.id}
                  data-testid="api-key-row"
                  data-prefix={key.prefix}
                  data-status={status}
                  className={status === 'revoked' ? 'opacity-70' : undefined}
                >
                  <TableCell className="font-semibold">{key.name}</TableCell>
                  <TableCell>
                    <code className="rounded-md border-2 border-outline bg-secondary px-2 py-0.5 font-sans text-xs">
                      {key.prefix}…
                    </code>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {mounted ? formatCreated(key.createdAt, now) : '-'}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {mounted ? formatLastUsed(key.lastUsedAt, now) : '-'}
                  </TableCell>
                  <TableCell>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage && status === 'live' ? (
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setRotating(key)}
                          aria-label={`Rotate ${key.name}`}
                        >
                          Rotate
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => setRevoking(key)}
                          aria-label={`Revoke ${key.name}`}
                        >
                          Revoke
                        </Button>
                      </div>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <CreateKeyDialog
        open={createOpen}
        apiUrl={BROWSER_API_URL}
        onOpenChange={setCreateOpen}
        onCreated={() => void refresh()}
      />

      <RotateKeyDialog
        apiKey={rotating}
        onOpenChange={(open) => {
          if (!open) {
            setRotating(null);
          }
        }}
        onRotated={(result) => {
          setRotating(null);
          setRotated(result);
          void refresh();
        }}
      />

      <Dialog
        open={rotated !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRotated(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New key for {rotated?.key.name}</DialogTitle>
            <DialogDescription>
              The old secret has been revoked. Update your integration with this one.
            </DialogDescription>
          </DialogHeader>
          {rotated ? (
            <div className="mt-4">
              <SecretPanel secret={rotated.secret} apiUrl={BROWSER_API_URL} />
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" onClick={() => setRotated(null)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RevokeKeyDialog
        apiKey={revoking}
        onOpenChange={(open) => {
          if (!open) {
            setRevoking(null);
          }
        }}
        onDone={() => {
          setRevoking(null);
          void refresh();
        }}
      />
    </Stack>
  );
}
