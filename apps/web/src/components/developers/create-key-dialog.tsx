'use client';

/**
 * Create a key: a name in, the secret out, in one dialog.
 *
 * The dialog stays open after the key is created and swaps its body for the
 * secret, because closing it is the one moment the secret is lost. Only
 * "Done" (or an explicit close) dismisses it, and the list refreshes then, 
 * not at creation, so the new row appears next to a developer who has
 * finished copying, rather than shifting the page under them.
 */
import {
  Button,
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
} from '@postgear/ui';
import { type FormEvent, useEffect, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { ApiKeyCreated } from '@/types/developers';
import { SecretPanel } from './secret-panel';

const MAX_NAME_LENGTH = 60;

interface CreateKeyDialogProps {
  open: boolean;
  apiUrl: string;
  onOpenChange: (open: boolean) => void;
  /** Called when the dialog closes after a key was created. */
  onCreated: () => void;
}

export function CreateKeyDialog({ open, apiUrl, onOpenChange, onCreated }: CreateKeyDialogProps) {
  const [name, setName] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);

  // A fresh form every time it opens; the secret of a previous key must not
  // still be on screen when the next one is asked for.
  useEffect(() => {
    if (open) {
      setName('');
      setWorking(false);
      setError(null);
      setCreated(null);
    }
  }, [open]);

  function handleOpenChange(next: boolean) {
    if (!next && created) {
      onCreated();
    }
    onOpenChange(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmed = name.trim();
    if (trimmed.length === 0 || working) {
      return;
    }

    setWorking(true);
    setError(null);

    try {
      const result = await api<ApiKeyCreated>('/developers/api-keys', {
        method: 'POST',
        body: { name: trimmed },
      });
      setCreated(result);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'We could not create the key.');
    } finally {
      setWorking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Your new key</DialogTitle>
              <DialogDescription>
                {created.key.name} ({created.key.prefix}…)
              </DialogDescription>
            </DialogHeader>
            <div className="mt-4">
              <SecretPanel secret={created.secret} apiUrl={apiUrl} />
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} noValidate>
            <DialogHeader>
              <DialogTitle>Create an API key</DialogTitle>
              <DialogDescription>
                Name it after the integration that will use it, so you know what to revoke later.
                Every key acts as an admin in this workspace, so treat it like a password.
              </DialogDescription>
            </DialogHeader>
            <FormField className="mt-4">
              <FormLabel htmlFor="api-key-name" required>
                Name
              </FormLabel>
              <Input
                id="api-key-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={MAX_NAME_LENGTH}
                placeholder="Zapier, CI, my-script"
                autoComplete="off"
                autoFocus
                variant={error ? 'error' : 'default'}
              />
              {error ? (
                <FormErrorMessage>{error}</FormErrorMessage>
              ) : (
                <FormHelperText>Up to {MAX_NAME_LENGTH} characters.</FormHelperText>
              )}
            </FormField>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="secondary" disabled={working}>
                  Cancel
                </Button>
              </DialogClose>
              <Button type="submit" disabled={working || name.trim().length === 0}>
                {working ? 'Creating…' : 'Create key'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
