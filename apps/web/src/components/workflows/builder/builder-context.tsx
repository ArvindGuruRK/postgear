'use client';

/**
 * What the canvas's cards, lines and notes need from the builder, without
 * prop drilling through React Flow: the reducer's `dispatch`, the handful
 * of actions that open something (the picker, the step panel), and a ref to
 * the graph as it is right now.
 *
 * The ref is updated in the same render that produces the graph, so a
 * handler reading it during a drag or a connect always sees the latest
 * graph (the stale-closure lesson in builder-state.ts).
 */
import type { AutomationGraph, PortId } from '@postgear/automation';
import { createContext, type Dispatch, type RefObject, useContext } from 'react';
import type { BuilderAction, Selection } from './builder-state';

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface BuilderApi {
  dispatch: Dispatch<BuilderAction>;
  graphRef: RefObject<AutomationGraph>;
  /** Moving steps is off (the lock in the controls). */
  locked: boolean;
  /** Selects a step and opens its panel. */
  open: (key: string) => void;
  /** Opens the Expanded view on a step (double-click on a card). */
  expand: (key: string) => void;
  /** Steps with pinned test data: their cards wear the pin sticker. */
  pinned: ReadonlySet<string>;
  /** Opens the panel on the step's name. */
  rename: (key: string) => void;
  /** The picker from an output's "+", or a line dropped on empty canvas. */
  pickFrom: (
    from: { source: string; sourcePort: PortId },
    at: ScreenPoint,
    flowAt?: ScreenPoint,
  ) => void;
  /** The picker from a line's midpoint "+": the new step goes in between. */
  pickOnEdge: (edgeId: string, at: ScreenPoint) => void;
  remove: (items: Partial<Selection>) => void;
  duplicate: (keys: string[]) => void;
  copy: (keys: string[]) => void;
  /** Right-click on a card, a note or the canvas. */
  contextMenu: (target: ContextTarget, at: ScreenPoint) => void;
  /** Module 08: steps this builder's tests send for real (the red Live In Tests sticker). */
  liveInTests?: ReadonlySet<string>;
  /** Module 08: Test Step from a card's hover toolbar. */
  testStep?: (key: string) => void;
}

export type ContextTarget =
  | { kind: 'step'; key: string }
  | { kind: 'note'; id: string }
  | { kind: 'edge'; id: string }
  | { kind: 'canvas'; flowAt: ScreenPoint };

const BuilderContext = createContext<BuilderApi | null>(null);

export const BuilderProvider = BuilderContext.Provider;

export function useBuilder(): BuilderApi {
  const value = useContext(BuilderContext);
  if (!value) throw new Error('useBuilder must be used inside the workflow builder');
  return value;
}

/** Null outside the builder: a read-only canvas (a run or a version) has no builder. */
export function useOptionalBuilder(): BuilderApi | null {
  return useContext(BuilderContext);
}
