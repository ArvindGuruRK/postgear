'use client';

/**
 * One name in a small dialog: Save Layout, Rename Layout and Rename Crop
 * (Module 10 sections 4 and 5). Built like Studio's Rename Design: the field
 * is chosen when it opens, Enter saves, and a refusal stays in the dialog
 * under the field (the API's own sentence) so nothing typed is lost.
 *
 * `onSubmit` answers null when it worked (the dialog closes) or the sentence
 * to show.
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
  FormLabel,
  Input,
} from '@postgear/ui';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';

export function NameDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  placeholder,
  initial,
  maxLength,
  submitLabel,
  busyLabel,
  onSubmit,
  testId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Title Case: "Save Layout". */
  title: string;
  description: string;
  /** A form label, sentence case: "Layout name". */
  label: string;
  /** "Enter your layout name". */
  placeholder: string;
  initial: string;
  maxLength: number;
  submitLabel: string;
  busyLabel: string;
  onSubmit: (value: string) => Promise<string | null>;
  testId?: string;
}) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fieldId = useId();
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  // Each opening starts from the name it was given.
  useEffect(() => {
    if (!open) return;
    setValue(initial);
    setError(null);
    setBusy(false);
  }, [open, initial]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const problem = await onSubmit(value);
      if (!live.current) return;
      if (problem) {
        setError(problem);
      } else {
        onOpenChange(false);
      }
    } finally {
      if (live.current) setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent data-testid={testId}>
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="sr-only">{description}</DialogDescription>
          </DialogHeader>

          <FormField className="mt-5">
            <FormLabel htmlFor={fieldId}>{label}</FormLabel>
            <Input
              id={fieldId}
              value={value}
              maxLength={maxLength}
              disabled={busy}
              aria-invalid={error ? true : undefined}
              onChange={(event) => setValue(event.target.value)}
              onFocus={(event) => event.currentTarget.select()}
              placeholder={placeholder}
              autoFocus
            />
            {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
          </FormField>

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? busyLabel : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
