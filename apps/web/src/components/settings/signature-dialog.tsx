'use client';

/**
 * Add or edit a signature (2026-10-19), after the reference's signature
 * modal: the text, and whether it starts every new post.
 *
 * One dialog for both, keyed on whether a signature was handed in, and reset
 * on every open so an abandoned edit never leaks into an add. The reference's
 * yes/no select for "auto add" is a switch here, the system's on/off control.
 * Turning it on for one signature turns it off on whichever had it (the API
 * keeps one default per workspace), which the helper line says before the
 * person finds out.
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FormErrorMessage,
  FormField,
  FormHelperText,
  FormLabel,
  Stack,
  Textarea,
  Toggle,
  toast,
} from '@postgear/ui';
import { type FormEvent, useEffect, useId, useState } from 'react';
import { ApiError, api } from '@/lib/api';
import type { Signature } from '@/types/signature';

/** The API's ceiling on a signature's text. */
export const SIGNATURE_MAX = 2000;

export function SignatureDialog({
  open,
  signature,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  /** The signature being edited, or null to add one. */
  signature: Signature | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const formId = useId();
  const [content, setContent] = useState('');
  const [autoAdd, setAutoAdd] = useState(false);
  const [contentError, setContentError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setContent(signature?.content ?? '');
      setAutoAdd(signature?.autoAdd ?? false);
      setContentError(null);
      setServerError(null);
    }
  }, [open, signature]);

  async function submit(event: FormEvent) {
    event.preventDefault();

    if (content.trim().length === 0) {
      setContentError('Write the signature first.');
      return;
    }

    if (content.length > SIGNATURE_MAX) {
      setContentError(`Keep it to ${SIGNATURE_MAX.toLocaleString()} characters.`);
      return;
    }

    setContentError(null);
    setServerError(null);
    setSaving(true);

    try {
      if (signature) {
        await api(`/signatures/${signature.id}`, {
          method: 'PATCH',
          body: { content, autoAdd },
        });
        toast({ title: 'Signature saved' });
      } else {
        await api('/signatures', { method: 'POST', body: { content, autoAdd } });
        toast({ title: 'Signature added' });
      }
      onSaved();
      onOpenChange(false);
    } catch (cause) {
      setServerError(
        cause instanceof ApiError ? cause.message : 'We could not save that signature.',
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <form id={formId} onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{signature ? 'Edit Signature' : 'Add Signature'}</DialogTitle>
            <DialogDescription className="sr-only">
              A sign-off you can add to posts from the composer.
            </DialogDescription>
          </DialogHeader>

          <Stack gap="md" className="py-4">
            <FormField>
              <FormLabel htmlFor={`${formId}-content`} required>
                Signature
              </FormLabel>
              <Textarea
                id={`${formId}-content`}
                value={content}
                rows={6}
                maxLength={SIGNATURE_MAX}
                placeholder="Write your signature…"
                variant={contentError ? 'error' : undefined}
                onChange={(event) => setContent(event.target.value)}
                className="max-h-80 resize-y pg-scrollbar pg-scrollbar-secondary"
              />
              {contentError ? (
                <FormErrorMessage>{contentError}</FormErrorMessage>
              ) : (
                <FormHelperText>
                  {content.length.toLocaleString()} / {SIGNATURE_MAX.toLocaleString()} characters
                </FormHelperText>
              )}
            </FormField>

            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 flex-col gap-1">
                <FormLabel htmlFor={`${formId}-auto`}>Add to new posts automatically</FormLabel>
                <FormHelperText id={`${formId}-auto-help`}>
                  Every new post starts with it. Only one signature can do this, so turning it on
                  here turns it off on the others.
                </FormHelperText>
              </div>
              <Toggle
                id={`${formId}-auto`}
                checked={autoAdd}
                onCheckedChange={setAutoAdd}
                aria-describedby={`${formId}-auto-help`}
                data-testid="signature-auto-add"
              />
            </div>

            {serverError ? <FormErrorMessage>{serverError}</FormErrorMessage> : null}
          </Stack>

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving} data-testid="signature-save">
              {saving ? 'Saving…' : signature ? 'Save Changes' : 'Add Signature'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
