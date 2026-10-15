/**
 * The "no index" provider: it always answers `null`, and the backlink
 * evaluator estimates authority from on-page signals instead (see
 * `backlink.evaluator.ts`). It exists so the API can hold one
 * {@link AuthorityProvider} whatever its configuration and report
 * `authority: 'heuristic'` in `/seo/status` without a special case.
 */
import type { AuthorityProvider } from '../types';

export function createHeuristicAuthorityProvider(): AuthorityProvider {
  return {
    name: 'heuristic',
    async estimate() {
      return null;
    },
  };
}
