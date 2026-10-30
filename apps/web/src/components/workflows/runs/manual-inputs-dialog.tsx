'use client';

/**
 * Asks for a Manual trigger's fields before a run (Modules 08 and 09): the
 * test of a Manual workflow and Run Now share it. One input per field of
 * the trigger's `config.fields` (text, number or a choice), required ones
 * checked before it submits; numbers go out as numbers and empty optional
 * fields are left out.
 */
import type { GraphNode } from '@postgear/automation';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@postgear/ui';
import { type FormEvent, useEffect, useId, useMemo, useState } from 'react';
import {
  type ManualField,
  manualFields,
  manualPlaceholder,
  readManualInputs,
} from '../activation/activation-model';

export interface ManualInputsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The `trigger.manual` node: its `config.fields` are the inputs. */
  trigger: GraphNode;
  /** "Test Workflow" or "Run Now". */
  title: string;
  submitLabel: string;
  busy: boolean;
  onSubmit: (inputs: Record<string, unknown>) => void;
}

export function ManualInputsDialog({
  open,
  onOpenChange,
  trigger,
  title,
  submitLabel,
  busy,
  onSubmit,
}: ManualInputsDialogProps) {
  const formId = useId();
  const fields = useMemo(() => manualFields(trigger), [trigger]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setValues({});
    setErrors({});
  }, [open]);

  function change(key: string, value: string) {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!current[key]) return current;
      const { [key]: _gone, ...rest } = current;
      return rest;
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const result = readManualInputs(fields, values);
    if (!result.ok) {
      setErrors(result.errors);
      const first = fields.find((field) => result.errors[field.key]);
      if (first) document.getElementById(`${formId}-${first.key}`)?.focus();
      return;
    }
    onSubmit(result.inputs);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent className="max-w-md" data-testid="manual-inputs-dialog">
        <form onSubmit={submit} noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {fields.length > 0
                ? 'Fill in what this run starts with. Later steps can use the answers.'
                : 'This run starts with no fields to fill in.'}
            </DialogDescription>
          </DialogHeader>
          {fields.length > 0 ? (
            <div className="mt-4 flex flex-col gap-4">
              {fields.map((field) => (
                <ManualFieldInput
                  key={field.key}
                  id={`${formId}-${field.key}`}
                  field={field}
                  value={values[field.key] ?? ''}
                  error={errors[field.key]}
                  disabled={busy}
                  onChange={(value) => change(field.key, value)}
                />
              ))}
            </div>
          ) : null}
          <DialogFooter className="flex-wrap">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? 'Starting...' : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ManualFieldInput({
  id,
  field,
  value,
  error,
  disabled,
  onChange,
}: {
  id: string;
  field: ManualField;
  value: string;
  error: string | undefined;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const errorId = `${id}-error`;
  return (
    <FormField>
      <FormLabel htmlFor={id} required={field.required}>
        {field.label}
      </FormLabel>
      {field.type === 'choice' ? (
        <Select value={value || undefined} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger
            id={id}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
          >
            <SelectValue placeholder="Choose one" />
          </SelectTrigger>
          <SelectContent>
            {field.options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={id}
          type={field.type === 'number' ? 'number' : 'text'}
          inputMode={field.type === 'number' ? 'decimal' : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={manualPlaceholder(field)}
          variant={error ? 'error' : 'default'}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          aria-required={field.required || undefined}
          disabled={disabled}
        />
      )}
      {error ? <FormErrorMessage id={errorId}>{error}</FormErrorMessage> : null}
    </FormField>
  );
}
