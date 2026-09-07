/**
 * `@postgear/social-core` — the social platform integration layer.
 *
 * Import surface:
 *   import { IntegrationManager, RefreshTokenError } from '@postgear/social-core';
 *
 * Concrete providers are deliberately **not** exported. Callers dispatch through
 * `IntegrationManager` by identifier — the same identifier stored in
 * `Integration.providerIdentifier` — so nothing outside this package holds a
 * reference to a specific platform class. Adding or renaming a provider then
 * stays an internal change.
 */
export * from './abstract/errors';
export * from './abstract/social.abstract';
export * from './abstract/social.provider.interface';
export * from './manager/integration.manager';
