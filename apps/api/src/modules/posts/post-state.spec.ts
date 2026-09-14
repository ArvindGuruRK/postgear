import { State } from '@postgear/db';
import { canTransition, groupState } from './post-state';

describe('canTransition', () => {
  it('lets a draft be queued and a queued post go back to draft', () => {
    expect(canTransition(State.DRAFT, State.QUEUE)).toBe(true);
    expect(canTransition(State.QUEUE, State.DRAFT)).toBe(true);
    expect(canTransition(State.DRAFT, State.DRAFT)).toBe(true);
  });

  it('lets a failed post be fixed and re-queued', () => {
    expect(canTransition(State.ERROR, State.QUEUE)).toBe(true);
    expect(canTransition(State.ERROR, State.DRAFT)).toBe(true);
  });

  it('never lets a person set an outcome, or move a published post', () => {
    for (const from of Object.values(State)) {
      expect(canTransition(from, State.PUBLISHED)).toBe(false);
      expect(canTransition(from, State.ERROR)).toBe(false);
    }
    expect(canTransition(State.PUBLISHED, State.DRAFT)).toBe(false);
    expect(canTransition(State.PUBLISHED, State.QUEUE)).toBe(false);
  });
});

describe('groupState', () => {
  it('reports the state that most needs attention', () => {
    expect(groupState([State.PUBLISHED, State.ERROR, State.QUEUE])).toBe(State.ERROR);
    expect(groupState([State.PUBLISHED, State.QUEUE])).toBe(State.QUEUE);
    expect(groupState([State.DRAFT, State.PUBLISHED])).toBe(State.DRAFT);
    expect(groupState([State.PUBLISHED, State.PUBLISHED])).toBe(State.PUBLISHED);
  });
});
