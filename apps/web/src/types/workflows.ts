/**
 * What the workflow and connection routes answer (Sprint 10). Hand-mirrored
 * from `apps/api/src/modules/automations`: Prisma types never reach the
 * browser. The graph itself is `AutomationGraph` from `@postgear/automation`,
 * the same shape the API validates.
 */
import type {
  AutomationGraph,
  ConnectionKind,
  ConnectionUse,
  NodeDefinition,
  PublishPlatformId,
  TemplateSummary,
} from '@postgear/automation';

export type AutomationStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED';

export type AutomationRunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'WAITING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'EXPIRED';

export interface AutomationListItem {
  id: string;
  name: string;
  status: AutomationStatus;
  triggerType: string | null;
  hasUnpublishedChanges: boolean;
  lastRunAt: string | null;
  lastRunStatus: AutomationRunStatus | null;
  lastRunError: string | null;
  runs30d: number;
  templateId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A step's pinned test data as the builder knows it: the API's stored,
 * redacted copy, listed on the workflow and returned by a pin.
 */
export interface PinnedStep {
  nodeKey: string;
  pinnedAt: string;
  output?: unknown;
}

export interface AutomationDetail extends Omit<AutomationListItem, 'runs30d'> {
  draftGraph: AutomationGraph;
  draftRevision: number;
  pinned: PinnedStep[];
  activeVersion: number | null;
}

/** `PATCH /automations/:id` answers this. */
export interface AutomationSaveResult {
  id: string;
  name: string;
  draftRevision: number;
  triggerType: string | null;
  hasUnpublishedChanges: boolean;
  updatedAt: string;
}

export type CatalogState = 'ready' | 'needsConnection' | 'comingSoon';

/** One step type as this workspace sees it (`GET /automations/catalog`). */
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
  credits: number;
  state: CatalogState;
  runnable: boolean;
  reason: string | null;
}

export interface WorkspaceCatalog {
  steps: CatalogEntry[];
  connectedPlatforms: PublishPlatformId[];
}

export type { TemplateSummary };

export type ConnectionStatus = 'CONNECTED' | 'NEEDS_RECONNECT' | 'ERROR';

/** A connection as every response shows it: never its credentials. */
export interface Connection {
  id: string;
  provider: ConnectionKind;
  name: string;
  status: ConnectionStatus;
  /** "hooks.slack.com/...a9F2", or the header names for secret headers. */
  maskedHint: string;
  meta: Record<string, unknown> | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  usedBy: { id: string; name: string; live: boolean }[];
}

export interface ConnectionCheckResult {
  connection: Connection;
  message: string;
}
