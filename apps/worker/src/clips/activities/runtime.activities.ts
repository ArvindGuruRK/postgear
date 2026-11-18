/**
 * `clipRuntimeCheck`: the worker's video tools, from the cached doctor
 * (Module 02, section 4). The harmless job that proves the media role, its
 * quick queue and the wait-for-answer path the probe uses.
 */
import type { ClipRuntimeReport } from '@postgear/scheduling';
import type { ClipActivityDeps } from '../deps';

export function createRuntimeActivities(deps: Pick<ClipActivityDeps, 'runtime'>) {
  return {
    async clipRuntimeCheck(): Promise<ClipRuntimeReport> {
      return deps.runtime.report();
    },
  };
}
