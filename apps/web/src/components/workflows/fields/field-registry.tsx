'use client';

/**
 * Which control draws each field kind of a step's `form`, and how its
 * label attaches. Adding a kind to the package's `FIELD_KINDS` without an
 * entry here fails the type check.
 */
import type { FieldKind, FieldSpec } from '@postgear/automation';
import type { ComponentType } from 'react';
import {
  DurationField,
  MultiSelectField,
  NumberField,
  SelectField,
  TextField,
  ToggleField,
} from './basic-fields';
import { CasesBuilder } from './cases-builder';
import { ConditionBuilder } from './condition-builder';
import type { FieldControlProps } from './field-types';
import { KeyValueList, ManualInputsEditor, RecipientsInput } from './list-fields';
import { MediaField } from './media-field';
import { ProviderSettingsField, settingsFieldsOf } from './provider-settings-field';
import { ScheduleBuilder } from './schedule-builder';
import { SheetColumnsField, SheetTabField, SpreadsheetField } from './sheets-fields';
import { TimeZoneField } from './time-zone-field';
import { WebhookLinkField } from './webhook-field';
import { ChannelsField, ConnectionField, TagsField } from './workspace-fields';

function ConditionField({ spec, value, onChange, errors, ids }: FieldControlProps) {
  return (
    <ConditionBuilder
      value={value}
      path={spec.path}
      lead={spec.lead}
      errors={errors}
      labelledBy={ids.label}
      onChange={(group) => onChange(spec.path, group)}
    />
  );
}

export interface FieldKindEntry {
  Control: ComponentType<FieldControlProps>;
  /**
   * How the label names the control: `for` points a `<label>` at the
   * control's id, `beside` does that with the control first on one line (a
   * toggle), `group` names a group of controls by the label's id.
   */
  label: (spec: FieldSpec) => 'for' | 'beside' | 'group';
  /**
   * Whether the field shows at all for this config, past its `showIf`: a
   * platform without settings draws no Settings field. Shown when left out.
   */
  shown?: (spec: FieldSpec, config: Record<string, unknown>) => boolean;
}

export const FIELD_REGISTRY: Readonly<Record<FieldKind, FieldKindEntry>> = {
  text: { Control: TextField, label: (spec) => (spec.acceptsData ? 'group' : 'for') },
  longText: { Control: TextField, label: (spec) => (spec.acceptsData ? 'group' : 'for') },
  select: { Control: SelectField, label: () => 'for' },
  multiSelect: { Control: MultiSelectField, label: () => 'group' },
  channels: { Control: ChannelsField, label: () => 'group' },
  tags: { Control: TagsField, label: () => 'group' },
  connection: { Control: ConnectionField, label: () => 'group' },
  schedule: { Control: ScheduleBuilder, label: () => 'group' },
  condition: { Control: ConditionField, label: () => 'group' },
  cases: { Control: CasesBuilder, label: () => 'group' },
  keyValue: { Control: KeyValueList, label: () => 'group' },
  recipients: { Control: RecipientsInput, label: () => 'group' },
  duration: { Control: DurationField, label: () => 'for' },
  number: { Control: NumberField, label: () => 'for' },
  toggle: { Control: ToggleField, label: () => 'beside' },
  manualInputs: { Control: ManualInputsEditor, label: () => 'group' },
  media: { Control: MediaField, label: () => 'group' },
  providerSettings: {
    Control: ProviderSettingsField,
    label: () => 'group',
    shown: (spec, config) => settingsFieldsOf(spec, config).length > 0,
  },
  spreadsheet: { Control: SpreadsheetField, label: () => 'group' },
  sheetTab: { Control: SheetTabField, label: () => 'for' },
  sheetColumns: { Control: SheetColumnsField, label: () => 'group' },
  webhookLink: { Control: WebhookLinkField, label: () => 'group' },
  timeZone: { Control: TimeZoneField, label: () => 'group' },
};
