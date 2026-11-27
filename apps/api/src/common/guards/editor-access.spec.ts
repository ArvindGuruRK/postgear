/**
 * The route matrix (Sprint 13, Module 14): every route the API mounts has one
 * entry in `editor-access.json`, and the entry agrees with the decorators.
 *
 * This is the safety net behind "every route is an Editor decision". A new
 * route with no entry fails here, so it can never reach production without
 * someone deciding whether an Editor may call it. The kinds:
 *
 * - `allow`: the route's `@Roles()` names EDITOR.
 * - `draft-only`: names EDITOR, and the service refuses anything but a draft
 *   (`assertEditorMayWrite` in `posts.service.ts`).
 * - `deny`: carries `@Roles()` without EDITOR, so `RolesGuard` refuses an
 *   Editor with a 403 and logs `rbac.denied`.
 * - `open`: no `@Roles()` at all, so any signed-in member (an Editor too)
 *   passes the role check; each one says why that is safe.
 * - `public`: `@Public()`, no session read at all (sign-in, callbacks, the
 *   worker's internal routes with their own token, the public `/v1` API with
 *   its key); each one says what authorizes it instead.
 *
 * The public `/v1` routes authenticate with an API key, not a role. Only an
 * admin can create a key (`/developers/api-keys` is ADMIN only), so an
 * Editor can never hold one: nothing about them changes in Module 14.
 */
import {
  accessFromDecorators,
  type EditorAccess,
  loadAppRoutes,
  loadMatrix,
} from './editor-access.routes';

// The env schema runs inside `ConfigModule.forRoot()` when `AppModule` is
// imported; listing routes needs no environment at all.
jest.mock('../../config/env', () => ({
  ...jest.requireActual('../../config/env'),
  validateEnv: (config: unknown) => config,
}));

const KINDS: readonly EditorAccess[] = ['allow', 'deny', 'draft-only', 'open', 'public'];

describe('editor-access.json (the route matrix)', () => {
  const matrix = loadMatrix();
  const routes = loadAppRoutes();
  const byKey = new Map(routes.map((route) => [route.key, route]));

  it('finds the whole app (a sanity floor, not a count to keep in step)', () => {
    expect(routes.length).toBeGreaterThan(300);
    expect(byKey.has('PUT /posts/:group/schedule')).toBe(true);
  });

  it('never mounts one route twice', () => {
    const keys = routes.map((route) => route.key);
    const twice = keys.filter((key, index) => keys.indexOf(key) !== index);
    expect(twice).toEqual([]);
  });

  it('has an entry for every route', () => {
    const missing = routes.map((route) => route.key).filter((key) => !(key in matrix.routes));
    expect(missing).toEqual([]);
  });

  it('has a route for every entry', () => {
    const stale = Object.keys(matrix.routes).filter((key) => !byKey.has(key));
    expect(stale).toEqual([]);
  });

  it('uses only the five kinds', () => {
    const odd = Object.entries(matrix.routes)
      .filter(([, entry]) => !KINDS.includes(entry.access))
      .map(([key]) => key);
    expect(odd).toEqual([]);
  });

  it('agrees with every decorator', () => {
    const wrong = routes
      .filter((route) => route.key in matrix.routes)
      .map((route) => {
        const recorded = matrix.routes[route.key].access;
        const actual = accessFromDecorators(route);
        const matches = recorded === 'draft-only' ? actual === 'allow' : recorded === actual;
        return matches ? null : `${route.key}: the table says ${recorded}, the code says ${actual}`;
      })
      .filter((line): line is string => line !== null);
    expect(wrong).toEqual([]);
  });

  it('gives a reason for every open and public route', () => {
    const silent = Object.entries(matrix.routes)
      .filter(([, entry]) => entry.access === 'open' || entry.access === 'public')
      .filter(([, entry]) => !entry.reason || entry.reason.trim().length < 10)
      .map(([key]) => key);
    expect(silent).toEqual([]);
  });

  it('keeps the posts wall: drafts only, never schedule or publish', () => {
    expect(matrix.routes['POST /posts'].access).toBe('draft-only');
    expect(matrix.routes['PUT /posts/:group'].access).toBe('draft-only');
    expect(matrix.routes['DELETE /posts/:group'].access).toBe('draft-only');
    expect(matrix.routes['PUT /posts/:group/schedule'].access).toBe('deny');
    expect(matrix.routes['POST /posts/:group/publish-now'].access).toBe('deny');
    expect(matrix.routes['GET /channels/next-slot'].access).toBe('deny');
  });

  it('denies an Editor everything that connects, bills, invites or reads analytics', () => {
    const mustDeny = routes.filter((route) =>
      /^(GET|POST|PUT|PATCH|DELETE) \/(analytics|seo|discover|billing|webhooks|developers|automations|automation-runs|automation-connections)(\/|$)/.test(
        route.key,
      ),
    );
    const leaks = mustDeny
      .filter((route) => !route.isPublic)
      .filter((route) => matrix.routes[route.key]?.access !== 'deny')
      .map((route) => route.key);
    expect(mustDeny.length).toBeGreaterThan(50);
    expect(leaks).toEqual([]);
  });

  it('lets an Editor work on every Clips and Studio route a member can', () => {
    const memberRoutes = routes.filter(
      (route) =>
        /^\w+ \/(clips|studio)(\/|$)/.test(route.key) && route.roles?.includes('USER' as never),
    );
    const shut = memberRoutes
      .filter((route) => !route.roles?.includes('EDITOR' as never))
      .map((route) => route.key);
    expect(memberRoutes.length).toBeGreaterThan(100);
    expect(shut).toEqual([]);
  });
});
