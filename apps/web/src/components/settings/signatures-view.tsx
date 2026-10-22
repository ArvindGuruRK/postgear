'use client';

/**
 * Settings > Signatures (2026-10-19), after the reference's signatures
 * settings: a workspace's saved sign-offs, which the composer's toolbar
 * inserts at the cursor, and the one marked "Default" that every new blank
 * post starts with.
 *
 * Laid out like the other settings pages (§16d): the `PageActions` row with
 * "Add signature", then the list. The list is restrained: bordered rows with
 * each signature's text (its first lines, line breaks kept), the "Default"
 * badge on the one that is added automatically, and an edit and a delete
 * button. Where the reference lets any member change them, PostGear keeps
 * workspace settings to admins (the API refuses the writes); members see the
 * same list, read-only, and are told why.
 */
import { PencilIcon } from '@animateicons/react/lucide/pencil-icon';
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  EmptyState,
  MotionIcon,
  PageActions,
  Stack,
  Text,
  TooltipHint,
  toast,
} from '@postgear/ui';
import { Signature as SignatureGlyph } from 'lucide-react';
import { useState } from 'react';
import { useWorkspace } from '@/components/navigation/workspace-provider';
import { ApiError, api } from '@/lib/api';
import type { Signature } from '@/types/signature';
import { DeleteSignatureDialog } from './delete-signature-dialog';
import { SignatureDialog } from './signature-dialog';

export function SignaturesView({ initialSignatures }: { initialSignatures: Signature[] | null }) {
  const { role } = useWorkspace();
  // Presentation only: the API is what refuses a member's write.
  const canManage = role === 'ADMIN' || role === 'SUPERADMIN';

  const [signatures, setSignatures] = useState<Signature[] | null>(initialSignatures);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Signature | null>(null);
  const [deleting, setDeleting] = useState<Signature | null>(null);
  const [busy, setBusy] = useState(false);

  // Read back after every write: setting a default clears it on the others,
  // so the list the API returns is the only one that is certainly right.
  async function reload() {
    try {
      const result = await api<{ signatures: Signature[] }>('/signatures');
      setSignatures(result.signatures);
    } catch {
      // The list on screen stays; the next action refreshes it.
    }
  }

  function openAdd() {
    setEditing(null);
    setDialogOpen(true);
  }

  async function remove() {
    if (!deleting) {
      return;
    }

    setBusy(true);
    try {
      await api(`/signatures/${deleting.id}`, { method: 'DELETE' });
      setSignatures((current) => (current ?? []).filter((entry) => entry.id !== deleting.id));
      toast({ title: 'Signature deleted' });
      setDeleting(null);
    } catch (cause) {
      toast({
        title: cause instanceof ApiError ? cause.message : 'That did not work. Please try again.',
        variant: 'danger',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Stack gap="lg">
      {canManage ? (
        <PageActions>
          <Button onClick={openAdd} data-testid="signature-add">
            <MotionIcon icon={PlusIcon} className="h-4 w-4" />
            Add Signature
          </Button>
        </PageActions>
      ) : null}

      {signatures === null ? (
        <Alert variant="danger" className="flex-wrap">
          <span>The signatures couldn't be loaded.</span>
          <Button variant="secondary" size="sm" onClick={() => void reload()}>
            Retry
          </Button>
        </Alert>
      ) : signatures.length === 0 ? (
        <EmptyState
          icon={SignatureGlyph}
          title="No signatures yet"
          description="A signature is a sign-off you add to posts: a closing line, a link, your hashtags. Make one the default and every new post starts with it."
          {...(canManage ? { action: { label: 'Add Signature', onClick: openAdd } } : {})}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="m-0 list-none p-0">
              {signatures.map((signature) => (
                <li
                  key={signature.id}
                  data-testid="signature-row"
                  data-signature-id={signature.id}
                  data-default={signature.autoAdd}
                  className="flex items-start gap-3 border-b-2 border-outline p-4 last:border-b-0"
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    {signature.autoAdd ? (
                      <Badge variant="primary" className="self-start px-2 py-0.5">
                        Default
                      </Badge>
                    ) : null}
                    <p className="m-0 line-clamp-3 whitespace-pre-line break-words font-sans text-sm text-ink">
                      {signature.content}
                    </p>
                  </div>

                  {canManage ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <TooltipHint label="Edit Signature" side="top">
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-label="Edit Signature"
                          onClick={() => {
                            setEditing(signature);
                            setDialogOpen(true);
                          }}
                        >
                          <MotionIcon icon={PencilIcon} className="h-4 w-4" />
                        </Button>
                      </TooltipHint>
                      <TooltipHint label="Delete Signature" side="top">
                        <Button
                          variant="secondary"
                          size="sm"
                          aria-label="Delete Signature"
                          onClick={() => setDeleting(signature)}
                        >
                          <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
                        </Button>
                      </TooltipHint>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {canManage ? null : (
        <Text size="sm" muted>
          Only workspace admins can add or change signatures.
        </Text>
      )}

      <SignatureDialog
        open={dialogOpen}
        signature={editing}
        onOpenChange={setDialogOpen}
        onSaved={() => void reload()}
      />
      <DeleteSignatureDialog
        signature={deleting}
        busy={busy}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onConfirm={() => void remove()}
      />
    </Stack>
  );
}
