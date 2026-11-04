'use client';

import type { GraphNode } from '@postgear/automation';
import { Input, Label } from '@postgear/ui';
import { type Dispatch, type RefObject, useEffect, useId, useState } from 'react';
import type { BuilderAction } from '../builder/builder-state';
import { FIELD_PATH_ATTRIBUTE } from '../fields/contract';

/** The step's name, committed on Enter or blur; Esc puts it back. */
export function StepNameField({
  node,
  dispatch,
  inputRef,
  className,
}: {
  node: GraphNode;
  dispatch: Dispatch<BuilderAction>;
  inputRef?: RefObject<HTMLInputElement | null>;
  className?: string;
}) {
  const id = useId();
  const [name, setName] = useState(node.name);

  useEffect(() => {
    setName(node.name);
  }, [node.name]);

  function commit() {
    const trimmed = name.trim();
    if (!trimmed) {
      setName(node.name);
      return;
    }
    if (trimmed !== node.name)
      dispatch({ type: 'renameStep', key: node.key, name: trimmed, now: Date.now() });
  }

  return (
    <div {...{ [FIELD_PATH_ATTRIBUTE]: 'name' }} className={className}>
      <Label htmlFor={`${id}-name`} className="sr-only">
        Step name
      </Label>
      <Input
        id={`${id}-name`}
        ref={inputRef}
        value={name}
        maxLength={60}
        onChange={(event) => setName(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            event.stopPropagation();
            setName(node.name);
            event.currentTarget.blur();
          }
        }}
        placeholder="Enter your step name"
        className="type-ui field-sizing-content h-9 max-w-sm min-w-24 truncate border-transparent bg-transparent px-2 text-base shadow-none hover:border-outline focus:bg-field"
      />
    </div>
  );
}
