import type { ValidationRule } from '../types';
import { channelsReady } from './channels';
import { conditionsComplete } from './conditions';
import { configIsValid } from './config';
import { connectionsReady } from './connections';
import { noCycles } from './cycles';
import { ifElseDeadEnds } from './dead-ends';
import { disabledOutputUsed } from './disabled-output';
import { graphSize } from './graph-size';
import { joinsNeedMerge } from './merge';
import { uniqueNames } from './names';
import { knownRunnableTypes } from './node-types';
import { portsExist } from './ports';
import { reachableFromTrigger } from './reachability';
import { scheduleFitsAi } from './schedule';
import { tokensResolve } from './tokens';
import { exactlyOneTrigger } from './triggers';

/**
 * Every rule `validateGraph` runs, in the order their issues are listed:
 * the shape of the graph first, then each step, then its data chips,
 * conditions and schedule.
 */
export const VALIDATION_RULES: readonly ValidationRule[] = [
  graphSize,
  exactlyOneTrigger,
  noCycles,
  portsExist,
  reachableFromTrigger,
  joinsNeedMerge,
  knownRunnableTypes,
  configIsValid,
  connectionsReady,
  channelsReady,
  uniqueNames,
  disabledOutputUsed,
  ifElseDeadEnds,
  tokensResolve,
  conditionsComplete,
  scheduleFitsAi,
];
