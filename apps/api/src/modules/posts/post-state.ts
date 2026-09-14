/**
 * The post lifecycle, as a table.
 *
 * `DRAFT → QUEUE → PUBLISHED | ERROR`, using the schema's own `State` enum.
 * Sprint 4 makes the first transition real; Sprint 5's publisher owns the
 * rest. The table is written out now so that the rule "a person cannot edit a
 * published post" exists before anything can publish one.
 *
 * | From \ To  | DRAFT | QUEUE | PUBLISHED | ERROR |
 * |------------|-------|-------|-----------|-------|
 * | DRAFT      | ✓     | ✓     |           |       |
 * | QUEUE      | ✓     | ✓     |           |       |
 * | ERROR      | ✓     | ✓     |           |       |
 * | PUBLISHED  |       |       |           |       |
 *
 * A person may only ever move a post *to* `DRAFT` or `QUEUE` — the other two
 * are outcomes, recorded by the publisher. `ERROR` is editable so a failed post
 * can be fixed and re-queued. `PUBLISHED` is final: the post exists on the
 * platform, and editing PostGear's copy would only make the two disagree.
 */
import { State } from '@postgear/db';

const TRANSITIONS: Record<State, readonly State[]> = {
  [State.DRAFT]: [State.DRAFT, State.QUEUE],
  [State.QUEUE]: [State.DRAFT, State.QUEUE],
  [State.ERROR]: [State.DRAFT, State.QUEUE],
  [State.PUBLISHED]: [],
};

export function canTransition(from: State, to: State): boolean {
  return TRANSITIONS[from].includes(to);
}

/**
 * One state for a group whose rows may disagree.
 *
 * Every row in a group is written with the same state today, but from Sprint 5
 * a post can publish to one channel and fail on another. The group then reads
 * as the state that most needs attention: a failure outranks a pending post,
 * which outranks a draft, which outranks a success.
 */
export function groupState(states: State[]): State {
  for (const state of [State.ERROR, State.QUEUE, State.DRAFT]) {
    if (states.includes(state)) {
      return state;
    }
  }

  return State.PUBLISHED;
}
