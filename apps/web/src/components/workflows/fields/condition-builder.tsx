'use client';

/**
 * The condition builder (blueprint 5.4): rules of "data, operator, value",
 * joined by All Of or Any Of, with the whole condition read back as a
 * sentence under them ("Only continue if Post Text contains 'launch'").
 *
 * - The left side takes one data chip; the operator menu lists only what
 *   fits that data's type (a number never offers "starts with"), in words.
 * - The value is a chip input too, hidden for operators that take none.
 * - Match Case shows for text comparisons.
 * - Every rule's sides carry `data-field-path`, so an issue on
 *   `condition.rules.1.left` focuses that very box.
 */
import { PlusIcon } from '@animateicons/react/lucide/plus-icon';
import { Trash2Icon } from '@animateicons/react/lucide/trash-2-icon';
import {
  type ConditionGroup,
  describeCondition,
  MAX_CONDITION_RULES,
  OPERATORS,
  tokenLabeler,
} from '@postgear/automation';
import {
  Button,
  cn,
  FormErrorMessage,
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
import { useId, useMemo } from 'react';
import { ChipInput } from './chip-input';
import {
  addRule,
  asGroup,
  leftType,
  operatorChoices,
  removeRule,
  setLeft,
  setMatch,
  setMatchCase,
  setOperator,
  setRight,
  takesMatchCase,
} from './condition-model';
import { FIELD_PATH_ATTRIBUTE } from './contract';
import { useFieldEnv } from './field-env';
import { joinPath } from './field-types';
import { Segmented } from './segmented';

const MATCH_CHOICES = [
  { value: 'all', label: 'All Of' },
  { value: 'any', label: 'Any Of' },
] as const;

export interface ConditionBuilderProps {
  value: unknown;
  onChange: (group: ConditionGroup) => void;
  /** The group's config path (`condition`, `cases.0.condition`), for issues and focus. */
  path: string;
  /** The words before the sentence: "Only continue if". */
  lead?: string;
  /** Errors inside the group, by path relative to it (`rules.0.left`). */
  errors?: Readonly<Record<string, string>>;
  /** The id of the label that names the whole group. */
  labelledBy?: string;
}

export function ConditionBuilder({
  value,
  onChange,
  path,
  lead,
  errors = {},
  labelledBy,
}: ConditionBuilderProps) {
  const env = useFieldEnv();
  const graph = env?.graph;
  const nodeKey = env?.nodeKey;
  const group = asGroup(value);
  const ids = useId();
  const typeOf = (left: string) => leftType(graph, nodeKey, left);
  const label = useMemo(() => (graph ? tokenLabeler(graph) : undefined), [graph]);

  const described = describeCondition(group, { tokenLabel: label });
  const sentence =
    group.rules.length === 0
      ? 'Add a rule to say when.'
      : `${lead ? `${lead} ` : ''}${described}${/[.?!]$/.test(described) ? '' : '.'}`;

  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of rules named by the field's label
    <div role="group" aria-labelledby={labelledBy} className="flex flex-col gap-3">
      {group.rules.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Text size="sm" id={`${ids}-match`}>
            Match
          </Text>
          <Segmented
            labelledBy={`${ids}-match`}
            options={MATCH_CHOICES}
            value={group.match}
            onValueChange={(match) => onChange(setMatch(group, match))}
          />
        </div>
      ) : null}

      {group.rules.map((rule, i) => {
        const rulePath = joinPath(path, `rules.${i}`);
        const type = typeOf(rule.left);
        const info = OPERATORS[rule.operator];
        const choices = operatorChoices(type, rule.operator);
        const ruleError = errors[`rules.${i}`] ?? errors[`rules.${i}.operator`];
        const leftError = errors[`rules.${i}.left`];
        const rightError = errors[`rules.${i}.right`];
        return (
          <div key={rule.id} className="flex flex-col gap-1">
            {i > 0 ? (
              <span className="type-label text-xs text-ink type-muted">
                {group.match === 'all' ? 'And' : 'Or'}
              </span>
            ) : null}
            <div
              {...{ [FIELD_PATH_ATTRIBUTE]: rulePath }}
              className="flex flex-col gap-2 rounded-md border-2 border-outline bg-chrome p-3"
            >
              <div className="flex items-start gap-2">
                <div {...{ [FIELD_PATH_ATTRIBUTE]: `${rulePath}.left` }} className="min-w-0 flex-1">
                  <ChipInput
                    value={rule.left}
                    onChange={(left) => onChange(setLeft(group, rule.id, left, typeOf))}
                    label={`Rule ${i + 1}, data to check`}
                    fieldPath={`${rulePath}.left`}
                    placeholder="Enter your data to check"
                    maxChips={1}
                    insertButton="icon"
                    invalid={leftError !== undefined}
                  />
                </div>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  className="h-11 w-11 shrink-0 px-0"
                  onClick={() => onChange(removeRule(group, rule.id))}
                >
                  <MotionIcon icon={Trash2Icon} className="h-4 w-4" />
                  <span className="sr-only">Remove Rule {i + 1}</span>
                </Button>
              </div>
              <div {...{ [FIELD_PATH_ATTRIBUTE]: `${rulePath}.operator` }}>
                <Select
                  value={rule.operator}
                  onValueChange={(operator) =>
                    onChange(setOperator(group, rule.id, operator as typeof rule.operator, type))
                  }
                >
                  <SelectTrigger aria-label={`Rule ${i + 1}, how to compare`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {choices.map((choice) => (
                      <SelectItem key={choice.value} value={choice.value}>
                        {choice.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {info.takesValue ? (
                <div {...{ [FIELD_PATH_ATTRIBUTE]: `${rulePath}.right` }}>
                  <ChipInput
                    value={rule.right ?? ''}
                    onChange={(right) => onChange(setRight(group, rule.id, right))}
                    label={`Rule ${i + 1}, value`}
                    fieldPath={`${rulePath}.right`}
                    placeholder={info.valueIsCount ? 'Enter your number' : 'Enter your value'}
                    insertButton="icon"
                    invalid={rightError !== undefined}
                  />
                </div>
              ) : null}
              {takesMatchCase(type, rule.operator) ? (
                <div className="flex items-center gap-2">
                  <Toggle
                    id={`${ids}-${rule.id}-case`}
                    checked={rule.matchCase === true}
                    onCheckedChange={(checked) => onChange(setMatchCase(group, rule.id, checked))}
                  />
                  <Label htmlFor={`${ids}-${rule.id}-case`} className="font-normal">
                    Match upper and lower case
                  </Label>
                </div>
              ) : null}
              {leftError || rightError || ruleError ? (
                <FormErrorMessage>{leftError ?? rightError ?? ruleError}</FormErrorMessage>
              ) : null}
            </div>
          </div>
        );
      })}

      <div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={group.rules.length >= MAX_CONDITION_RULES}
          onClick={() => onChange(addRule(group))}
        >
          <MotionIcon icon={PlusIcon} className="h-4 w-4" />
          Add Rule
        </Button>
      </div>

      <p
        className={cn(
          'm-0 rounded-md border-2 border-dashed border-outline bg-inset px-3 py-2 font-sans text-sm text-ink',
          group.rules.length === 0 && 'type-muted',
        )}
        aria-live="polite"
      >
        {sentence}
      </p>
      {errors[''] || errors.rules ? (
        <FormErrorMessage>{errors[''] ?? errors.rules}</FormErrorMessage>
      ) : null}
    </div>
  );
}
