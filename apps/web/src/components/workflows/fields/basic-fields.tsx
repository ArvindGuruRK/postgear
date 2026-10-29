'use client';

/**
 * The simple controls of the step form: text (with data chips when the
 * field accepts data), choices, numbers, a duration and yes or no. Each
 * edits `spec.path` through `onChange` with the whole config path.
 */
import {
  Input,
  MultiSelect,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  Toggle,
} from '@postgear/ui';
import { ChipInput } from './chip-input';
import { asList, asText, type FieldControlProps } from './field-types';

export function TextField({ spec, value, onChange, errors, ids }: FieldControlProps) {
  const multiline = spec.kind === 'longText';
  const invalid = errors[''] !== undefined;
  if (spec.acceptsData) {
    return (
      <ChipInput
        value={asText(value)}
        onChange={(next) => onChange(spec.path, next)}
        label={spec.label}
        labelId={ids.label}
        describedBy={ids.message}
        fieldPath={spec.path}
        multiline={multiline}
        placeholder={spec.placeholder}
        invalid={invalid}
        insertButton={multiline ? 'full' : 'icon'}
      />
    );
  }
  const shared = {
    id: ids.control,
    value: asText(value),
    placeholder: spec.placeholder,
    'aria-describedby': ids.message,
    'aria-invalid': invalid || undefined,
    variant: invalid ? ('error' as const) : ('default' as const),
  };
  return multiline ? (
    <Textarea {...shared} rows={4} onChange={(event) => onChange(spec.path, event.target.value)} />
  ) : (
    <Input {...shared} onChange={(event) => onChange(spec.path, event.target.value)} />
  );
}

export function SelectField({ spec, value, onChange, errors, ids }: FieldControlProps) {
  const options = spec.options ?? [];
  const current = typeof value === 'string' ? value : value === undefined ? '' : String(value);
  return (
    <Select value={current} onValueChange={(next) => onChange(spec.path, next)}>
      <SelectTrigger
        id={ids.control}
        aria-describedby={ids.message}
        aria-invalid={errors[''] !== undefined || undefined}
        className={errors[''] !== undefined ? 'border-actionDanger' : undefined}
      >
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

export function MultiSelectField({ spec, value, onChange, ids }: FieldControlProps) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: names the design system's multi select, which takes no id
    <div role="group" aria-labelledby={ids.label} aria-describedby={ids.message}>
      <MultiSelect
        options={[...(spec.options ?? [])]}
        value={asList<string>(value)}
        onValueChange={(next) => onChange(spec.path, next)}
        placeholder={spec.emptyLabel ?? 'Choose any'}
        searchPlaceholder="Enter your search"
        emptyText="Nothing matches your search."
      />
    </div>
  );
}

/** A whole number from the box, or undefined while it is empty. */
export function readWholeNumber(text: string): number | undefined {
  if (text.trim() === '') return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}

export function NumberField({ spec, value, onChange, errors, ids }: FieldControlProps) {
  const invalid = errors[''] !== undefined;
  return (
    <Input
      id={ids.control}
      type="number"
      inputMode="numeric"
      className="max-w-40"
      min={spec.min}
      max={spec.max}
      step={1}
      value={typeof value === 'number' ? value : ''}
      placeholder={spec.placeholder ?? 'Enter your number'}
      aria-describedby={ids.message}
      aria-invalid={invalid || undefined}
      variant={invalid ? 'error' : 'default'}
      onChange={(event) => onChange(spec.path, readWholeNumber(event.target.value))}
    />
  );
}

export function DurationField({ spec, config, value, onChange, errors, ids }: FieldControlProps) {
  const unitPath = spec.unitPath ?? 'unit';
  const unit = typeof config[unitPath] === 'string' ? (config[unitPath] as string) : '';
  const invalid = errors[''] !== undefined;
  return (
    <div className="flex items-center gap-2">
      <Input
        id={ids.control}
        type="number"
        inputMode="numeric"
        className="max-w-28"
        min={spec.min}
        max={spec.max}
        step={1}
        value={typeof value === 'number' ? value : ''}
        placeholder="Enter your number"
        aria-describedby={ids.message}
        aria-invalid={invalid || undefined}
        variant={invalid ? 'error' : 'default'}
        onChange={(event) => onChange(spec.path, readWholeNumber(event.target.value))}
      />
      <Select value={unit} onValueChange={(next) => onChange(unitPath, next)}>
        <SelectTrigger aria-label="Unit" className="w-36">
          <SelectValue placeholder="Choose one" />
        </SelectTrigger>
        <SelectContent>
          {(spec.options ?? []).map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ToggleField({ spec, value, onChange, ids }: FieldControlProps) {
  return (
    <Toggle
      id={ids.control}
      checked={value === true}
      aria-describedby={ids.message}
      onCheckedChange={(checked) => onChange(spec.path, checked)}
    />
  );
}
