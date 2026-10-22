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
 * ## When the clipboard refuses
 *
 * Writing to the clipboard after a network round trip can be refused (an
 * insecure origin, Safari's gesture rule). The link is then shown in the
 * dialog, selectable, rather than lost: it is the only copy the admin gets.
 */
import { CopyIcon } from '@animateicons/react/lucide/copy-icon';
import {
  Button,
  Checkbox,
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Text,
  toast,
} from '@postgear/ui';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { InviteLink, InviteRole } from '@/types/team';
import { INVITE_ROLES, inviteEmailProblem } from './team-view-model';

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

  // A fresh form each time it opens.
  useEffect(() => {
    if (open) {
      setEmail('');
      setRole('USER');
      setSendEmail(true);
      setWorking(false);
      setError(null);
      setUncopied(null);
    }
  }, [open]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (working) {
      return;
    }

    const problem = inviteEmailProblem(email, sendEmail);
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
      setError(cause instanceof ApiError ? cause.message : 'We could not create the invitation.');
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
                <FormLabel htmlFor={`${id}-email`} required={sendEmail}>
                  Email
                </FormLabel>
                <Input
                  id={`${id}-email`}
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="teammate@company.com"
                  autoComplete="off"
                  autoFocus
                  variant={error ? 'error' : 'default'}
                />
                {error ? (
                  <FormErrorMessage>{error}</FormErrorMessage>
                ) : sendEmail ? null : (
                  <FormHelperText>
                    Optional. When set, only this address can use the link.
                  </FormHelperText>
                )}
              </FormField>

              <FormField>
                <FormLabel htmlFor={`${id}-role`}>Role</FormLabel>
                {/* Radix Select is always modal (it has no `modal` prop to turn
                    off), so its list sits above the dialog and takes focus. */}
                <Select value={role} onValueChange={(value) => setRole(value as InviteRole)}>
                  <SelectTrigger id={`${id}-role`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INVITE_ROLES.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
              <Button type="submit" disabled={working}>
                {working ? 'Creating…' : sendEmail ? 'Send Invitation' : 'Copy Link'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
