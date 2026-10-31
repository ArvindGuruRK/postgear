'use client';

/**
 * A step's Setup or Configure tab drawn from its definition's `form`
 * (Module 06). One frame per field: the label, the control the field's
 * kind names (`FIELD_REGISTRY`), then its error or help line. The frame
 * carries `data-field-path`, so focus-the-field finds it.
 *
 * - Edits go out as `onChange(path, value)` with whole config paths.
 * - Inline errors are the config's schema problems plus this step's
 *   validation issues by `field`; chips that an issue names turn red.
 * - A field shows only while its `showIf` holds.
 * - Configure ends with the message preview (`form.preview`, Module 12),
 *   the AI credits a run uses with the workspace's balance (Module 11),
 *   and the form's notes.
 * - An error no shown field covers is still listed at the end, so nothing
 *   the tab's "!" counts is hidden.
 */
import { type FieldSpec, isFieldShown, tabForField } from '@postgear/automation';
import { FormErrorMessage, FormHelperText, FormLabel, Text } from '@postgear/ui';
import { useId, useMemo } from 'react';
import { AiCostLine } from './ai-cost';
import { FIELD_PATH_ATTRIBUTE, type SchemaFormProps } from './contract';
import { type FieldEnv, FieldEnvProvider } from './field-env';
import { FIELD_REGISTRY } from './field-registry';
import type { FieldControlProps } from './field-types';
import { errorsUnder, formErrors, getAtPath } from './form-model';
import { MessagePreviewBox } from './message-preview';

export type { SchemaFormProps } from './contract';

/** Kinds that show their own errors inside (per rule, per row). */
const COMPOSITE = new Set<FieldSpec['kind']>([
  'schedule',
  'condition',
  'cases',
  'keyValue',
  'recipients',
  'manualInputs',
  'sheetColumns',
]);

function within(base: string, path: string): boolean {
  return base === '' || base === path || path.startsWith(`${base}.`);
}

function covers(spec: FieldSpec, path: string): boolean {
  return (
    within(spec.path, path) ||
    (spec.unitPath !== undefined && within(spec.unitPath, path)) ||
    (spec.libraryPath !== undefined && within(spec.libraryPath, path))
  );
}

export function SchemaForm({
  definition,
  node,
  graph,
  tab,
  onChange,
  issues,
  context,
}: SchemaFormProps) {
  const config = (node.config ?? {}) as Record<string, unknown>;
  const own = useId();
  const errors = useMemo(
    () => formErrors(definition, config, issues),
    [definition, config, issues],
  );
  const env = useMemo<FieldEnv>(
    () => ({ graph, nodeKey: node.key, issues, context }),
    [graph, node.key, issues, context],
  );

  const shown = (definition.form?.tabs[tab] ?? []).filter(
    (spec) =>
      isFieldShown(spec, config) && (FIELD_REGISTRY[spec.kind]?.shown?.(spec, config) ?? true),
  );

  const leftover = Object.entries(errors).filter(
    ([path]) =>
      path !== '' &&
      path !== definition.connection?.field &&
      tabForField(definition, path) === tab &&
      !shown.some((spec) => covers(spec, path)),
  );

  let perRun: number | undefined;
  if (tab === 'configure' && definition.credits) {
    try {
      perRun = definition.credits(config as never);
    } catch {
      perRun = undefined;
    }
  }
  const notes = tab === 'configure' ? (definition.form?.notes ?? []) : [];
  const preview = tab === 'configure' ? definition.form?.preview : undefined;

  return (
    <FieldEnvProvider value={env}>
      <div className="flex flex-col gap-5" data-schema-form={tab}>
        {shown.map((spec, i) => {
          const ids = {
            control: `${own}-${i}`,
            label: `${own}-${i}-label`,
            message: `${own}-${i}-message`,
          };
          return (
            <FieldFrame
              key={`${spec.kind}:${spec.path}`}
              errors={errors}
              props={{
                spec,
                definition,
                node,
                config,
                value: getAtPath(config, spec.path),
                onChange,
                errors: errorsUnder(errors, spec.path),
                ids,
              }}
            />
          );
        })}

        {leftover.length > 0 ? (
          <div className="flex flex-col gap-1">
            {leftover.map(([path, message]) => (
              <FormErrorMessage key={path} {...{ [FIELD_PATH_ATTRIBUTE]: path }}>
                {message}
              </FormErrorMessage>
            ))}
          </div>
        ) : null}

        {preview ? <MessagePreviewBox kind={preview} config={config} /> : null}
        {perRun !== undefined && perRun > 0 ? <AiCostLine perRun={perRun} /> : null}
        {notes.map((note) => (
          <Text key={note} size="sm" muted>
            {note}
          </Text>
        ))}
      </div>
    </FieldEnvProvider>
  );
}

function FieldFrame({
  errors,
  props,
}: {
  /** Every error of the step, for a duration's unit. */
  errors: Readonly<Record<string, string>>;
  props: FieldControlProps;
}) {
  const { spec, ids } = props;
  const entry = FIELD_REGISTRY[spec.kind];
  const Control = entry.Control;
  const mode = entry.label(spec);
  // A duration's unit and a media field's library picks report under the field's own line.
  const ownError =
    props.errors[''] ??
    (spec.unitPath !== undefined ? errors[spec.unitPath] : undefined) ??
    (spec.libraryPath !== undefined ? errors[spec.libraryPath] : undefined);
  const message = COMPOSITE.has(spec.kind) ? undefined : ownError;
  const attr = { [FIELD_PATH_ATTRIBUTE]: spec.path };

  const line = message ? (
    <FormErrorMessage id={ids.message}>{message}</FormErrorMessage>
  ) : spec.help ? (
    <FormHelperText id={ids.message}>{spec.help}</FormHelperText>
  ) : null;

  if (mode === 'beside') {
    return (
      <div {...attr} className="flex flex-col gap-1.5">
        <div className="flex items-center gap-3">
          <Control {...props} />
          <FormLabel htmlFor={ids.control} id={ids.label} required={spec.required}>
            {spec.label}
          </FormLabel>
        </div>
        {line}
      </div>
    );
  }

  return (
    <div {...attr} className="flex flex-col gap-1.5">
      {mode === 'for' ? (
        <FormLabel htmlFor={ids.control} id={ids.label} required={spec.required}>
          {spec.label}
        </FormLabel>
      ) : (
        <span id={ids.label} className="font-sans text-sm font-bold text-ink">
          {spec.label}
          {spec.required ? <span className="ml-1 text-dangerInk">*</span> : null}
        </span>
      )}
      <Control {...props} />
      {line}
    </div>
  );
}
