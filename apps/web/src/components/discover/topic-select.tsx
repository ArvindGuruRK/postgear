'use client';

/**
 * The News tab's Topic select (story DC-3.2): All, then Google News's eight
 * topics in its own order. A topic adds a "{Topic} In {Country}" group to the
 * tab; All shows the tab without one.
 *
 * It is the design system's `Select`, dressed like the language chip because
 * it sits on the page beside nothing but the groups: a dropdown, so a border
 * and no shadow. Null stands for All, which `Select` cannot hold as a value.
 */
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@postgear/ui';
import { useId } from 'react';
import type { NewsTopic } from '@/types/discover';
import { TOPIC_CHOICES, TOPIC_NAMES, type TopicChoice } from './discover-model';

export function TopicSelect({
  value,
  onChange,
  disabled,
}: {
  /** Null is All. */
  value: NewsTopic | null;
  onChange: (topic: NewsTopic | null) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const choice: TopicChoice = value ?? 'ALL';

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="font-sans text-sm font-bold text-ink">
        Topic
      </label>
      <Select
        value={choice}
        onValueChange={(next) => onChange(next === 'ALL' ? null : (next as NewsTopic))}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          data-testid="discover-topic-select"
          className="h-10 w-48 max-w-full gap-2 rounded-lg bg-chrome px-3"
        >
          <SelectValue>{TOPIC_NAMES[choice]}</SelectValue>
        </SelectTrigger>
        <SelectContent align="start">
          {TOPIC_CHOICES.map((topic) => (
            <SelectItem key={topic} value={topic}>
              {TOPIC_NAMES[topic]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
