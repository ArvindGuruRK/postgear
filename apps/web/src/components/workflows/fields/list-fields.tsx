'use client';

/**
 * The list controls of the step form: rows of a name and a value (Set
 * Fields, headers, sheet columns), email recipients, and the Manual
 * trigger's input fields. Every row and every box in it carries its own
 * `data-field-path` (`fields.2.name`), so an issue focuses the very box.
 */
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import type { FieldOption } from '@postgear/automation';
import {
  Button,
  FormErrorMessage,
  Input,
  Label,
  MotionIcon,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Text,
  Toggle,
} from '@postgear/ui';
import { type ReactNode, useId } from 'react';
import { ChipInput } from './chip-input';
import { FIELD_PATH_ATTRIBUTE } from './contract';
import { asList, asText, type FieldControlProps, joinPath } from './field-types';

type Row = Record<string, unknown>;

const at = (path: string) => ({ [FIELD_PATH_ATTRIBUTE]: path });

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="danger"
      size="sm"
      className="h-11 w-11 shrink-0 px-0"
      onClick={onClick}
    >
      <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
      <span className="sr-only">{label}</span>
    </Button>
  );
}

function AddButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <div>
      <Button type="button" variant="secondary" size="sm" disabled={disabled} onClick={onClick}>
        <MotionIcon icon={PlusIcon} className="h-4 w-4" />
        {label}
      </Button>
    </div>
  );
}

function TypeSelect({
  options,
  value,
  label,
  onChange,
}: {
  options: readonly FieldOption[];
  value: string;
  label: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="w-36 shrink-0">
        <SelectValue placeholder="Choose one" />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function ListFrame({
  labelledBy,
  empty,
  count,
  children,
  footer,
  error,
}: {
  labelledBy: string;
  empty: string;
  count: number;
  children: ReactNode;
  footer: ReactNode;
  error?: string;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: the rows, named by the field's label
    <div role="group" aria-labelledby={labelledBy} className="flex flex-col gap-3">
      {count === 0 ? (
        <Text size="sm" muted>
          {empty}
        </Text>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-3 p-0">{children}</ol>
      )}
      {footer}
      {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
    </div>
  );
}

/** Rows of a name and a value, as the field's `row` describes them. */
export function KeyValueList({ spec, value, onChange, errors, ids }: FieldControlProps) {
  const rows = asList<Row>(value);
  const row = spec.row ?? { key: 'key', value: 'value', keyLabel: 'Name', valueLabel: 'Value' };
  const types = spec.options ?? [];
  const max = spec.max ?? 20;
  const write = (next: Row[]) => onChange(spec.path, next);
  const update = (i: number, part: string, next: unknown) =>
    write(rows.map((entry, j) => (j === i ? { ...entry, [part]: next } : entry)));
  const empty: Row = { [row.key]: '', [row.value]: '' };
  if (row.type && types[0]) empty[row.type] = types[0].value;

  return (
    <ListFrame
      labelledBy={ids.label}
      empty="No rows yet."
      count={rows.length}
      error={errors['']}
      footer={
        <AddButton
          label="Add Row"
          disabled={rows.length >= max}
          onClick={() => write([...rows, { ...empty }])}
        />
      }
    >
      {rows.map((entry, i) => {
        const rowPath = joinPath(spec.path, String(i));
        const name = asText(entry[row.key]);
        const keyError = errors[`${i}.${row.key}`];
        const valueError = errors[`${i}.${row.value}`];
        const rowError = errors[String(i)] ?? (row.type ? errors[`${i}.${row.type}`] : undefined);
        return (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no ids; their place is their identity
            key={i}
            {...at(rowPath)}
            className="flex flex-col gap-2 rounded-md border-2 border-outline bg-chrome p-3"
          >
            <div className="flex items-start gap-2">
              <div {...at(`${rowPath}.${row.key}`)} className="min-w-0 flex-1">
                <Input
                  value={name}
                  aria-label={`Row ${i + 1}, ${row.keyLabel.toLowerCase()}`}
                  placeholder={`Enter your ${row.keyLabel.toLowerCase()}`}
                  variant={keyError ? 'error' : 'default'}
                  aria-invalid={keyError ? true : undefined}
                  onChange={(event) => update(i, row.key, event.target.value)}
                />
              </div>
              {row.type && types.length > 0 ? (
                <div {...at(`${rowPath}.${row.type}`)}>
                  <TypeSelect
                    options={types}
                    value={asText(entry[row.type])}
                    label={`Row ${i + 1}, type`}
                    onChange={(next) => update(i, row.type as string, next)}
                  />
                </div>
              ) : null}
              <RemoveButton
                label={`Remove Row ${i + 1}`}
                onClick={() => write(rows.filter((_, j) => j !== i))}
              />
            </div>
            <div {...at(`${rowPath}.${row.value}`)}>
              <ChipInput
                value={asText(entry[row.value])}
                onChange={(next) => update(i, row.value, next)}
                label={`Row ${i + 1}, ${row.valueLabel.toLowerCase()}`}
                fieldPath={`${rowPath}.${row.value}`}
                placeholder={`Enter your ${row.valueLabel.toLowerCase()}`}
                insertButton="icon"
                invalid={valueError !== undefined}
              />
            </div>
            {keyError || valueError || rowError ? (
              <FormErrorMessage>{keyError ?? valueError ?? rowError}</FormErrorMessage>
            ) : null}
          </li>
        );
      })}
    </ListFrame>
  );
}

/** Email addresses, each typed or a data chip, at most `max`. */
export function RecipientsInput({ spec, value, onChange, errors, ids }: FieldControlProps) {
  const list = asList<string>(value).map(asText);
  const max = spec.max ?? 10;
  const write = (next: string[]) => onChange(spec.path, next);
  return (
    <ListFrame
      labelledBy={ids.label}
      empty="No one yet."
      count={list.length}
      error={errors['']}
      footer={
        <AddButton
          label="Add Recipient"
          disabled={list.length >= max}
          onClick={() => write([...list, ''])}
        />
      }
    >
      {list.map((address, i) => {
        const path = joinPath(spec.path, String(i));
        const error = errors[String(i)];
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: addresses repeat while typed; their place is their identity
          <li key={i} {...at(path)} className="flex flex-col gap-1">
            <div className="flex items-start gap-2">
              <ChipInput
                className="flex-1"
                value={address}
                onChange={(next) => write(list.map((entry, j) => (j === i ? next : entry)))}
                label={`Recipient ${i + 1}`}
                fieldPath={path}
                placeholder="Enter your email address"
                insertButton="icon"
                invalid={error !== undefined}
              />
              <RemoveButton
                label={`Remove Recipient ${i + 1}`}
                onClick={() => write(list.filter((_, j) => j !== i))}
              />
            </div>
            {error ? <FormErrorMessage>{error}</FormErrorMessage> : null}
          </li>
        );
      })}
    </ListFrame>
  );
}

// Manual trigger inputs ------------------------------------------------------

export interface ManualInput {
  key: string;
  label: string;
  type: 'text' | 'number' | 'choice';
  required?: boolean;
  options?: string[];
}

const MANUAL_TYPES: readonly FieldOption[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'choice', label: 'Choice' },
];

/**
 * The key later steps use for a label: "Post Topic" is `postTopic`. Starts
 * with a letter, letters, digits and _ only, at most 32 characters, and
 * different from the keys already taken.
 */
export function keyFromLabel(label: string, taken: readonly string[]): string {
  const words = label
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  let key = words
    .map((word, i) =>
      i === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join('')
    .replace(/^[^a-z]+/i, '');
  key = key ? key[0].toLowerCase() + key.slice(1) : 'field';
  key = key.slice(0, 28);
  if (!taken.includes(key)) return key;
  for (let n = 2; ; n++) {
    const next = `${key}${n}`;
    if (!taken.includes(next)) return next;
  }
}

function asManualInputs(value: unknown): ManualInput[] {
  return asList<Partial<ManualInput>>(value).map((raw) => ({
    key: asText(raw.key),
    label: asText(raw.label),
    type: raw.type === 'number' || raw.type === 'choice' ? raw.type : 'text',
    ...(raw.required ? { required: true } : {}),
    ...(Array.isArray(raw.options) ? { options: raw.options.map(asText) } : {}),
  }));
}

/** The Manual trigger's fields: up to `max`, each a label, a type, required, and choices. */
export function ManualInputsEditor({ spec, value, onChange, errors, ids }: FieldControlProps) {
  const inputs = asManualInputs(value);
  const max = spec.max ?? 5;
  const own = useId();
  const write = (next: ManualInput[]) => onChange(spec.path, next);
  const replace = (i: number, next: ManualInput) =>
    write(inputs.map((entry, j) => (j === i ? next : entry)));
  const othersKeys = (i: number) => inputs.filter((_, j) => j !== i).map((entry) => entry.key);

  return (
    <ListFrame
      labelledBy={ids.label}
      empty="Nothing is asked for yet. Run Now starts the workflow straight away."
      count={inputs.length}
      error={errors['']}
      footer={
        <AddButton
          label="Add Field"
          disabled={inputs.length >= max}
          onClick={() =>
            write([
              ...inputs,
              {
                key: keyFromLabel(
                  `Field ${inputs.length + 1}`,
                  inputs.map((entry) => entry.key),
                ),
                label: `Field ${inputs.length + 1}`,
                type: 'text',
              },
            ])
          }
        />
      }
    >
      {inputs.map((input, i) => {
        const path = joinPath(spec.path, String(i));
        const labelError = errors[`${i}.label`] ?? errors[`${i}.key`];
        const optionsError = errors[`${i}.options`];
        return (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: a field's key changes with its label; its place is its identity
            key={i}
            {...at(path)}
            className="flex flex-col gap-2 rounded-md border-2 border-outline bg-chrome p-3"
          >
            <div className="flex items-end gap-2">
              <div {...at(`${path}.label`)} className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Label htmlFor={`${own}-${i}-label`}>Label</Label>
                <Input
                  id={`${own}-${i}-label`}
                  value={input.label}
                  maxLength={60}
                  placeholder="Enter your field label"
                  variant={labelError ? 'error' : 'default'}
                  aria-invalid={labelError ? true : undefined}
                  onChange={(event) =>
                    replace(i, {
                      ...input,
                      label: event.target.value,
                      key: keyFromLabel(event.target.value, othersKeys(i)),
                    })
                  }
                />
              </div>
              <div {...at(`${path}.type`)}>
                <TypeSelect
                  options={MANUAL_TYPES}
                  value={input.type}
                  label={`Field ${i + 1}, type`}
                  onChange={(type) => {
                    const next: ManualInput = { ...input, type: type as ManualInput['type'] };
                    if (next.type === 'choice') next.options = input.options ?? [];
                    else delete next.options;
                    replace(i, next);
                  }}
                />
              </div>
              <RemoveButton
                label={`Remove Field ${i + 1}`}
                onClick={() => write(inputs.filter((_, j) => j !== i))}
              />
            </div>
            <div className="flex items-center gap-2" {...at(`${path}.required`)}>
              <Toggle
                id={`${own}-${i}-required`}
                checked={input.required === true}
                onCheckedChange={(checked) => {
                  const { required: _old, ...rest } = input;
                  replace(i, checked ? { ...rest, required: true } : rest);
                }}
              />
              <Label htmlFor={`${own}-${i}-required`} className="font-normal">
                Must be filled in
              </Label>
            </div>
            {input.type === 'choice' ? (
              <div {...at(`${path}.options`)} className="flex flex-col gap-1.5">
                <Label htmlFor={`${own}-${i}-options`}>Choices</Label>
                <Input
                  id={`${own}-${i}-options`}
                  value={(input.options ?? []).join(', ')}
                  placeholder="Enter your choices, separated by commas"
                  variant={optionsError ? 'error' : 'default'}
                  onChange={(event) =>
                    replace(i, {
                      ...input,
                      options: event.target.value
                        .split(',')
                        .map((choice) => choice.trim())
                        .filter((choice, j, all) => choice !== '' || j === all.length - 1)
                        .slice(0, 20),
                    })
                  }
                />
              </div>
            ) : null}
            <Text size="xs" muted>
              Later steps use it as {input.key || 'field'}.
            </Text>
            {labelError || optionsError ? (
              <FormErrorMessage>{labelError ?? optionsError}</FormErrorMessage>
            ) : null}
          </li>
        );
      })}
    </ListFrame>
  );
}
