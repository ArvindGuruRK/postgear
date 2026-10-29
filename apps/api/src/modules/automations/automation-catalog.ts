/**
 * The step catalog as one workspace sees it (`GET /automations/catalog`).
 *
 * The definitions themselves are code the web app imports from
 * `@postgear/automation`; what only the server knows is the state of each
 * one here:
 *
 * - `comingSoon` when the definition says so. Shown, never added.
 * - `needsConnection` when the step needs a connection kind and the
 *   workspace has no healthy one (or, for Publish, no active channel on a
 *   platform it can publish to). Still addable: the panel offers Connect.
 * - otherwise `ready`.
 *
 * `runnable` is separate: false while the worker has no executor for the
 * type. Such a step can be placed on a draft (the canvas is built before the
 * run engine), and validation's `node.not_runnable` blocks Test and
 * Activate.
 */
import {
  type ConnectionUse,
  connectionKindInfo,
  NODE_CATALOG,
  type NodeDefinition,
  PUBLISH_PLATFORMS,
  type PublishPlatformId,
  type ValidationContext,
} from '@postgear/automation';
import { CATALOG_REASONS } from './automations.messages';

export type CatalogState = 'ready' | 'needsConnection' | 'comingSoon';

export interface CatalogEntry {
  type: string;
  typeVersion: number;
  category: NodeDefinition['category'];
  title: string;
  description: string;
  keywords: readonly string[];
  icon: string;
  family: NodeDefinition['family'];
  priority: NodeDefinition['priority'];
  sideEffect: NodeDefinition['sideEffect'];
  publishes: boolean;
  connection: ConnectionUse | null;
  /** Estimated AI credits per run with the default settings; 0 for other steps. */
  credits: number;
  state: CatalogState;
  runnable: boolean;
  /** Why the step cannot be used as it is: Coming Soon, Connect first, or cannot run yet. */
  reason: string | null;
}

export interface WorkspaceCatalog {
  steps: CatalogEntry[];
  /** Platforms with at least one active channel, for the Publish cards. */
  connectedPlatforms: PublishPlatformId[];
}

export function connectedPlatforms(ctx: ValidationContext): PublishPlatformId[] {
  const active = new Set(
    ctx.channels
      .filter((channel) => channel.status === 'active')
      .map((channel) => channel.provider),
  );
  return PUBLISH_PLATFORMS.filter((platform) =>
    platform.providers.some((provider) => active.has(provider)),
  ).map((platform) => platform.id);
}

function stateOf(
  def: NodeDefinition,
  ctx: ValidationContext,
  platforms: readonly PublishPlatformId[],
): { state: CatalogState; reason: string | null } {
  if (def.status === 'comingSoon') {
    return { state: 'comingSoon', reason: def.comingSoonReason ?? null };
  }
  if (def.type === 'postgear.publish' && platforms.length === 0) {
    return { state: 'needsConnection', reason: CATALOG_REASONS.connectChannel };
  }
  const use = def.connection;
  if (use && !use.optional) {
    const healthy = ctx.connections.some(
      (connection) => connection.kind === use.kind && connection.status === 'CONNECTED',
    );
    if (!healthy) {
      return {
        state: 'needsConnection',
        reason: CATALOG_REASONS.connect(connectionKindInfo(use.kind).title),
      };
    }
  }
  return { state: 'ready', reason: null };
}

export function buildCatalog(ctx: ValidationContext): WorkspaceCatalog {
  const platforms = connectedPlatforms(ctx);
  const steps = NODE_CATALOG.map((def): CatalogEntry => {
    const { state, reason } = stateOf(def, ctx, platforms);
    const runnable = ctx.availableTypes?.has(def.type) ?? true;
    return {
      type: def.type,
      typeVersion: def.typeVersion,
      category: def.category,
      title: def.title,
      description: def.description,
      keywords: def.keywords,
      icon: def.icon,
      family: def.family,
      priority: def.priority,
      sideEffect: def.sideEffect,
      publishes: def.publishes ?? false,
      connection: def.connection ?? null,
      credits: def.credits?.(def.defaultConfig) ?? 0,
      state,
      runnable,
      reason: reason ?? (runnable ? null : CATALOG_REASONS.notRunnable(def.title)),
    };
  });
  return { steps, connectedPlatforms: platforms };
}
