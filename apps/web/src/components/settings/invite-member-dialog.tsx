'use client';

/**
 * Invite someone to the workspace (Settings > Team, 2026-10-19), after
 * Postiz's "Add member": an address, a role, and whether to email the link.
 *
 * Either way the API makes a signed link that works once and expires in a
 * week. With the box ticked it is emailed to the address; without, it goes
 * on the admin's clipboard to send however they like, and the address, if
 * they typed one, still binds the link to that person.
 *
 * Nobody joins until they open the link and accept, so this dialog never
 * says anyone "was added".
 *
 * ## Editors (Sprint 13, Module 14)
 *
 * The role is the form's main choice, so it is `ChoiceTiles`: Member, Admin,
 * Editor. Picking Editor says what an Editor may do, makes the address
 * required (the API binds an Editor link to it) and shows the plan's seats
 * from `GET /orgs/:id/seats`. With none left, sending is blocked and the
 * dialog says why; the API's 402 says the same if it refuses anyway (a seat
 * taken in another tab).
 *
 * ## When the clipboard refuses
 *
 * Writing to the clipboard after a network round trip can be refused (an
 * insecure origin, Safari's gesture rule). The link is then shown in the
 * dialog, selectable, rather than lost: it is the only copy the admin gets.
 */
import { CopyIcon } from '@animateicons/react/lucide/copy-icon';
import { isEditor } from '@postgear/entitlements';
import {
  Button,
  Checkbox,
  ChoiceTiles,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormErrorMessage,
  FormField,
  FormHelperText,
  FormLabel,
  Input,
  MotionIcon,
  Stack,
  Text,
  toast,
} from '@postgear/ui';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { EditorSeats, InviteLink, InviteRole, SeatsResponse } from '@/types/team';
import {
  EDITOR_EMAIL_HELP,
  EDITOR_ROLE_LINE,
  EDITOR_SEATS_FULL,
  editorSeatLine,
  editorSeatsFull,
  INVITE_ROLES,
  inviteEmailProblem,
  refusalMessage,
} from './team-view-model';

interface InviteMemberDialogProps {
  open: boolean;
  orgId: string;
  workspaceName: string;
  onOpenChange: (open: boolean) => void;
}

export function InviteMemberDialog({
  open,
  orgId,
  workspaceName,
  onOpenChange,
}: InviteMemberDialogProps) {
  const id = useId();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InviteRole>('USER');
  const [sendEmail, setSendEmail] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set only when the clipboard refused: the link to copy by hand. */
  const [uncopied, setUncopied] = useState<string | null>(null);
  /** The plan's Editor seats; null until read, or when they could not be (the API still checks). */
  const [seats, setSeats] = useState<EditorSeats | null>(null);

  // A fresh form each time it opens, with the seats as they are now.
  useEffect(() => {
    if (!open) {
      return;
    }

    setEmail('');
    setRole('USER');
    setSendEmail(true);
    setWorking(false);
    setError(null);
    setUncopied(null);
    setSeats(null);

    let live = true;
    api<SeatsResponse>(`/orgs/${orgId}/seats`)
      .then((response) => {
        if (live) setSeats(response.editors);
      })
      .catch(() => {
        // No seat line then; the invite itself is still checked by the API.
      });
    return () => {
      live = false;
    };
  }, [open, orgId]);

  const editor = isEditor(role);
  const seatsFull = editorSeatsFull(role, seats);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (working || seatsFull) {
      return;
    }

    const problem = inviteEmailProblem(email, sendEmail, role);
    if (problem) {
      setError(problem);
      return;
    }

    setWorking(true);
    setError(null);

    const address = email.trim();

    try {
      const { url } = await api<InviteLink>(`/orgs/${orgId}/invites`, {
        method: 'POST',
        body: { role, sendEmail, ...(address ? { email: address } : {}) },
      });

      if (sendEmail) {
        toast({
          title: 'Invitation sent',
          description: `We emailed ${address} a link to join ${workspaceName}.`,
        });
        onOpenChange(false);
        return;
      }

      try {
        await navigator.clipboard.writeText(url);
        toast({
          title: 'Invite link copied',
          description: 'It works once and expires in 7 days.',
        });
        onOpenChange(false);
      } catch {
        setUncopied(url);
      }
    } catch (cause) {
      setError(
        cause instanceof ApiError ? refusalMessage(cause) : 'We could not create the invitation.',
      );
    } finally {
      setWorking(false);
    }
  }

  async function copyAgain() {
    if (!uncopied) {
      return;
    }

    try {
      await navigator.clipboard.writeText(uncopied);
      toast({ title: 'Invite link copied', description: 'It works once and expires in 7 days.' });
      onOpenChange(false);
    } catch {
      toast({ title: "Couldn't copy", description: 'Select the link and copy it by hand.' });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {uncopied ? (
          <>
            <DialogHeader>
              <DialogTitle>Your invite link</DialogTitle>
              <DialogDescription>
                Your browser would not let us copy it. Copy it from here; it works once and expires
                in 7 days.
              </DialogDescription>
            </DialogHeader>
            <FormField className="mt-4">
              <FormLabel htmlFor={`${id}-link`}>Invite link</FormLabel>
              <div className="flex items-center gap-2">
                <Input
                  id={`${id}-link`}
                  data-testid="invite-link"
                  readOnly
                  value={uncopied}
                  spellCheck={false}
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button type="button" variant="secondary" onClick={copyAgain} className="shrink-0">
                  <MotionIcon icon={CopyIcon} className="h-4 w-4" />
                  Copy
                </Button>
              </div>
            </FormField>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} noValidate>
            <DialogHeader>
              <DialogTitle>Invite A Member</DialogTitle>
              <DialogDescription>
                They get a link to join {workspaceName}. It works once and expires in 7 days.
              </DialogDescription>
            </DialogHeader>

            <Stack gap="md" className="mt-4">
              <FormField>
                <FormLabel htmlFor={`${id}-email`} required={sendEmail || editor}>
                  Email
                </FormLabel>
                <Input
                  id={`${id}-email`}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="Enter your teammate's email"
                  autoComplete="off"
                  autoFocus
                  variant={error ? 'error' : 'default'}
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `${id}-email-error` : undefined}
                />
                {error ? (
                  <FormErrorMessage id={`${id}-email-error`}>{error}</FormErrorMessage>
                ) : editor ? (
                  <FormHelperText>{EDITOR_EMAIL_HELP}</FormHelperText>
                ) : sendEmail ? null : (
                  <FormHelperText>
                    Optional. When set, only this address can use the link.
                  </FormHelperText>
                )}
              </FormField>

              <FormField>
                <FormLabel id={`${id}-role`}>Role</FormLabel>
                <ChoiceTiles
                  labelledBy={`${id}-role`}
                  options={INVITE_ROLES}
                  value={role}
                  onValueChange={(next: InviteRole) => {
                    setRole(next);
                    setError(null);
                  }}
                />
                {editor ? (
                  <div className="flex flex-col gap-1" data-testid="invite-editor-notes">
                    <FormHelperText>{EDITOR_ROLE_LINE}</FormHelperText>
                    {seatsFull ? (
                      <FormErrorMessage data-testid="invite-seats">
                        {EDITOR_SEATS_FULL}
                      </FormErrorMessage>
                    ) : seats ? (
                      <FormHelperText data-testid="invite-seats">
                        {editorSeatLine(seats)}
                      </FormHelperText>
                    ) : null}
                  </div>
                ) : null}
              </FormField>

              <label htmlFor={`${id}-send`} className="flex items-center gap-3">
                <Checkbox
                  id={`${id}-send`}
                  checked={sendEmail}
                  onCheckedChange={(checked) => {
                    setSendEmail(checked === true);
                    setError(null);
                  }}
                />
                <Text as="span" size="sm">
                  Send invitation by email
                </Text>
              </label>
            </Stack>

            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="secondary" disabled={working}>
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={working || seatsFull}>
                {working ? 'Creating…' : sendEmail ? 'Send Invitation' : 'Copy Link'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
