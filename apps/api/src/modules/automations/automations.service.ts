/**
 * Workflows (Sprint 10, Module 03): the rows the builder saves into. The UI
 * says Workflow and Step; the code says Automation and node.
 *
 * - **Saving is lenient, activating is strict.** A draft may be half built,
 *   so a save keeps a graph with validation issues. It always refuses three
 *   things: a graph the schema refuses (the request pipe does that), a step
 *   type PostGear does not know, and anything that looks like a secret.
 *   Secrets never live in graph JSON; they go in a connection.
 * - **A save is checked against the revision it was made from**, in the
 *   write itself (see the repository). A stale save is a 409 carrying the
 *   current revision, and nothing is merged.
 * - **Tenancy**: every read and write is scoped to the active workspace, and
 *   another workspace's workflow is a 404, never a 403.
 * - **Turning workflows on and off** (Module 09): activating stores an
 *   immutable version of exactly the draft the admin saw and points the
 *   workflow at it; editing afterwards only changes the draft (Unpublished
 *   Changes), which Activate Changes, Discard Changes and Restore As Draft
 *   act on. Triggers are set up after the version is stored, best-effort.
 */
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  type AutomationGraph,
  emptyGraph,
  findSecretLikeValues,
  getDefinition,
  getTemplate,
  hasBlockingIssues,
  instantiateTemplate,
  isTriggerType,
  LIMITS,
  listTemplates,
  NODE_KEY_PATTERN,
  redact,
  rekeyGraph,
  riskSummary,
  type TemplateSummary,
  upgradeGraph,
  utf8Bytes,
  type ValidationIssue,
  validateGraph,
} from '@postgear/automation';
import { type AutomationRunStatus, AutomationStatus, type Prisma, Role } from '@postgear/db';
import {
  MIN_SEARCH_LENGTH,
  matchesAllTerms,
  searchTerms,
  selectiveTerm,
} from '../../common/search-terms';
import { buildCatalog, type WorkspaceCatalog } from './automation-catalog';
import { AutomationContextService } from './automation-context.service';
import { freshKeyMaker } from './automation-keys';
import { AutomationTriggers } from './automation-triggers';
import { AUTOMATION_MESSAGES } from './automations.messages';
import {
  type AutomationListRow,
  type AutomationRow,
  AutomationsRepository,
  type AutomationWrite,
  type VersionDetailRow,
  type VersionRow,
} from './automations.repository';
import {
  type ActivateAutomationInput,
  AUTOMATIONS_PAGE_SIZE,
  type CreateAutomationInput,
  DEFAULT_AUTOMATION_NAME,
  type ListAutomationsQuery,
  MAX_AUTOMATION_NAME_LENGTH,
  type RestoreVersionInput,
  type UpdateAutomationInput,
} from './dto/automations.schema';

/** One row of the list. */
export interface AutomationListItem {
  id: string;
  name: string;
  status: AutomationStatus;
  triggerType: string | null;
  hasUnpublishedChanges: boolean;
  lastRunAt: string | null;
  lastRunStatus: AutomationRunStatus | null;
  lastRunError: string | null;
  /** Live runs in the last 30 days. */
  runs30d: number;
  templateId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A step's pinned test data, as the editor lists it. `output` is the stored,
 * redacted copy: the Input and Output panes show it after a reload (Module 06).
 */
export interface PinnedSummary {
  nodeKey: string;
  pinnedAt: string;
  output: unknown;
}

export interface AutomationDetail extends Omit<AutomationListItem, 'runs30d'> {
  draftGraph: AutomationGraph;
  draftRevision: number;
  pinned: PinnedSummary[];
  /** The version number that runs when the workflow is on; null until it is first turned on. */
  activeVersion: number | null;
}

export interface AutomationSaveResult {
  id: string;
  name: string;
  draftRevision: number;
  triggerType: string | null;
  hasUnpublishedChanges: boolean;
  updatedAt: string;
}

/** One row of the Versions drawer (Module 09). */
export interface VersionSummary {
  version: number;
  note: string | null;
  triggerType: string;
  createdAt: string;
  createdBy: { id: string; name: string } | null;
  /** The version live runs use now. */
  active: boolean;
}

export interface VersionDetail extends VersionSummary {
  graph: AutomationGraph;
}

/** `POST /automations/:id/activate` answers this. */
export interface ActivationResult {
  automation: AutomationDetail;
  version: VersionSummary;
  /** "The schedule is not set up yet. PostGear will set it up within 15 minutes." */
  warnings: string[];
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A version number in a path: a whole number from 1, without leading zeros. */
const VERSION_NUMBER_PATTERN = /^[1-9]\d{0,8}$/;

/** Module 02's AI frequency rule, enforced again on activation. */
const TOO_FREQUENT_FOR_AI = 'schedule.too_frequent_for_ai';

/** A search reads this many newest matches, then checks every word. */
const SEARCH_CANDIDATES = 200;

const RUN_STATS_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const COPY_SUFFIX = ' (Copy)';

@Injectable()
export class AutomationsService {
  constructor(
    private readonly repository: AutomationsRepository,
    private readonly context: AutomationContextService,
    private readonly triggers: AutomationTriggers,
  ) {}

  async list(
    orgId: string,
    query: ListAutomationsQuery,
  ): Promise<{ automations: AutomationListItem[]; nextCursor: string | null }> {
    const search = query.search ?? '';
    const terms = search.length >= MIN_SEARCH_LENGTH ? searchTerms(search) : [];
    let rows: AutomationListRow[];
    let nextCursor: string | null = null;

    if (terms.length > 0) {
      // The database narrows by the most selective word; every word is then
      // checked here. A search is one page: nobody pages through matches.
      const candidates = await this.repository.search(orgId, selectiveTerm(terms), {
        status: query.status,
        limit: SEARCH_CANDIDATES,
      });
      rows = candidates
        .filter((row) => matchesAllTerms(row.name, terms))
        .slice(0, AUTOMATIONS_PAGE_SIZE);
    } else {
      const page = await this.repository.list(orgId, {
        status: query.status,
        cursor: query.cursor,
        take: AUTOMATIONS_PAGE_SIZE,
      });
      rows = page.slice(0, AUTOMATIONS_PAGE_SIZE);
      if (page.length > AUTOMATIONS_PAGE_SIZE) nextCursor = rows[rows.length - 1].id;
    }

    const counts = await this.repository.liveRunCounts(
      orgId,
      rows.map((row) => row.id),
      new Date(Date.now() - RUN_STATS_DAYS * DAY_MS),
    );

    return {
      automations: rows.map((row) => ({ ...toListFields(row), runs30d: counts.get(row.id) ?? 0 })),
      nextCursor,
    };
  }

  /** Blank (an empty graph) or from a starter template, always a draft. */
  async create(
    orgId: string,
    userId: string | null,
    input: CreateAutomationInput,
  ): Promise<AutomationDetail> {
    let graph: AutomationGraph = emptyGraph();
    let name = input.name ?? DEFAULT_AUTOMATION_NAME;
    let templateId: string | null = null;

    if (input.templateId !== undefined) {
      const template = getTemplate(input.templateId);
      if (!template) throw new NotFoundException(AUTOMATION_MESSAGES.TEMPLATE_NOT_FOUND);
      graph = instantiateTemplate(template, freshKeyMaker(), { timeZone: input.timeZone });
      name = input.name ?? template.title;
      templateId = template.id;
    }

    const row = await this.repository.create(orgId, {
      name,
      draftGraph: toJson(graph),
      triggerType: triggerTypeOf(graph),
      templateId,
      createdById: userId,
    });
    return toDetail(row);
  }

  async get(orgId: string, id: string): Promise<AutomationDetail> {
    return toDetail(await this.findOrThrow(orgId, id));
  }

  async update(
    orgId: string,
    userId: string | null,
    id: string,
    input: UpdateAutomationInput,
  ): Promise<AutomationSaveResult> {
    if (!UUID_PATTERN.test(id)) throw new NotFoundException(AUTOMATION_MESSAGES.NOT_FOUND);
    if (input.draftGraph) assertSavable(input.draftGraph);

    const current = await this.repository.findSaveState(orgId, id);
    if (!current) throw new NotFoundException(AUTOMATION_MESSAGES.NOT_FOUND);
    if (current.draftRevision !== input.draftRevision) throw conflict(current.draftRevision);

    const data: AutomationWrite = { updatedById: userId };
    if (input.name !== undefined) data.name = input.name;
    if (input.draftGraph) {
      data.draftGraph = toJson(input.draftGraph);
      data.triggerType = triggerTypeOf(input.draftGraph);
      // Only a workflow that has been turned on has a version to differ from.
      data.hasUnpublishedChanges =
        current.status !== AutomationStatus.DRAFT &&
        !sameJson(input.draftGraph, current.activeVersion?.graph ?? null);
    }

    const saved = await this.repository.update(orgId, id, input.draftRevision, data);
    if (!saved) {
      // Nothing matched: either the workflow is gone, or somebody else saved
      // between the read above and this write.
      const now = await this.repository.findSaveState(orgId, id);
      if (!now) throw new NotFoundException(AUTOMATION_MESSAGES.NOT_FOUND);
      throw conflict(now.draftRevision);
    }

    return {
      id: saved.id,
      name: saved.name,
      draftRevision: saved.draftRevision,
      triggerType: saved.triggerType,
      hasUnpublishedChanges: saved.hasUnpublishedChanges,
      updatedAt: saved.updatedAt.toISOString(),
    };
  }

  /**
   * Soft delete that really stops the workflow (Module 09): its schedule is
   * deleted and its runs in progress are cancelled first, so nothing runs
   * for a deleted workflow. Any member deletes a draft or a paused one; an
   * active one acts for the whole workspace, so only an admin may.
   */
  async remove(orgId: string, role: Role, id: string): Promise<void> {
    const row = await this.findOrThrow(orgId, id);
    if (row.status === AutomationStatus.ACTIVE && !isAdmin(role)) {
      throw new ForbiddenException(AUTOMATION_MESSAGES.DELETE_ACTIVE_ADMIN_ONLY);
    }
    // A draft never had a schedule; a paused one should not, but a missed delete costs nothing to repeat.
    if (row.status !== AutomationStatus.DRAFT) await this.triggers.stop(orgId, id);
    await this.triggers.stopRuns(orgId, id);
    if (!(await this.repository.softDelete(orgId, id))) {
      throw new NotFoundException(AUTOMATION_MESSAGES.NOT_FOUND);
    }
  }

  /**
   * "{name} (Copy)": a draft with fresh step keys (data chips follow them),
   * from the source's draft. Pinned data and runs stay with the source.
   */
  async duplicate(orgId: string, userId: string | null, id: string): Promise<AutomationDetail> {
    const source = await this.findOrThrow(orgId, id);
    const graph = rekeyGraph(upgradeGraph(source.draftGraph), freshKeyMaker());
    const row = await this.repository.create(orgId, {
      name: copyName(source.name),
      draftGraph: toJson(graph),
      triggerType: triggerTypeOf(graph),
      templateId: source.templateId,
      createdById: userId,
    });
    return toDetail(row);
  }

  /** Every issue of the saved draft against this workspace's channels, connections and runnable steps. */
  async validate(
    orgId: string,
    id: string,
  ): Promise<{ issues: ValidationIssue[]; blocking: boolean }> {
    const row = await this.findOrThrow(orgId, id);
    const issues = validateGraph(upgradeGraph(row.draftGraph), await this.context.forOrg(orgId));
    return { issues, blocking: hasBlockingIssues(issues) };
  }

  async catalog(orgId: string): Promise<WorkspaceCatalog> {
    return buildCatalog(await this.context.forOrg(orgId));
  }

  templates(): TemplateSummary[] {
    return listTemplates();
  }

  /**
   * Pins a step's test data: Test Step and test runs use it instead of
   * running the step; live runs never read it. Refused past 64 KB rather
   * than cut, because cut test data would test something else. Redacted on
   * the way in.
   */
  async pin(
    orgId: string,
    userId: string | null,
    id: string,
    nodeKey: string,
    output: unknown,
  ): Promise<PinnedSummary> {
    const row = await this.findOrThrow(orgId, id);
    assertStepInDraft(row, nodeKey);

    if (utf8Bytes(JSON.stringify(output)) > LIMITS.stepIoCapBytes) {
      throw new UnprocessableEntityException({
        message: AUTOMATION_MESSAGES.PINNED_TOO_LARGE,
        code: 'pinned_too_large',
      });
    }

    const pinnedAt = new Date().toISOString();
    const safe = redact(output, { capBytes: LIMITS.stepIoCapBytes });
    const stored = await this.repository.setPinned(orgId, id, nodeKey, {
      output: safe.value,
      pinnedAt,
      pinnedById: userId,
    });
    if (!stored) throw new NotFoundException(AUTOMATION_MESSAGES.NOT_FOUND);
    return { nodeKey, pinnedAt, output: safe.value };
  }

  async unpin(orgId: string, id: string, nodeKey: string): Promise<void> {
    if (!UUID_PATTERN.test(id) || !NODE_KEY_PATTERN.test(nodeKey)) {
      throw new NotFoundException(AUTOMATION_MESSAGES.NOT_FOUND);
    }
    if (!(await this.repository.removePinned(orgId, id, nodeKey))) {
      throw new NotFoundException(AUTOMATION_MESSAGES.NOT_FOUND);
    }
  }

  /**
   * Turns a workflow on, or makes its draft the new live version (Module 09).
   *
   * 1. The draft must be at the revision the admin saw (409 otherwise).
   * 2. The full server check with the workspace's connections and channels:
   *    any error refuses it (422 `activation_blocked`, or
   *    `schedule_too_frequent` when the AI frequency rule is the only one).
   * 3. A workflow that can publish without a review needs the tick.
   * 4. One transaction stores version n + 1 and points the workflow at it.
   * 5. Then the trigger is set up. A Temporal blip never undoes a version:
   *    the answer carries a warning and the reconcile finishes the job.
   */
  async activate(
    orgId: string,
    userId: string | null,
    id: string,
    input: ActivateAutomationInput,
  ): Promise<ActivationResult> {
    const row = await this.findOrThrow(orgId, id);
    if (row.draftRevision !== input.draftRevision) throw conflict(row.draftRevision);

    const graph = upgradeGraph(row.draftGraph);
    const errors = validateGraph(graph, await this.context.forOrg(orgId)).filter(
      (issue) => issue.severity === 'error',
    );
    if (errors.length > 0) {
      if (errors.every((issue) => issue.code === TOO_FREQUENT_FOR_AI)) {
        throw new UnprocessableEntityException({
          message: errors[0].message,
          code: 'schedule_too_frequent',
        });
      }
      throw new UnprocessableEntityException({
        message: AUTOMATION_MESSAGES.ACTIVATION_BLOCKED,
        code: 'activation_blocked',
        details: { issues: errors.length },
      });
    }

    if (riskSummary(graph).publishesWithoutReview && input.acceptAutomaticPosting !== true) {
      throw new UnprocessableEntityException({
        message: AUTOMATION_MESSAGES.CONFIRM_AUTOMATIC_POSTING,
        code: 'confirm_automatic_posting',
      });
    }

    const triggerType = triggerTypeOf(graph);
    if (!triggerType) {
      // validateGraph reports a missing trigger as an error; this is the type guard.
      throw new UnprocessableEntityException({
        message: AUTOMATION_MESSAGES.ACTIVATION_BLOCKED,
        code: 'activation_blocked',
        details: { issues: 1 },
      });
    }

    const result = await this.repository.activate(orgId, id, {
      expectedRevision: input.draftRevision,
      graph: toJson(graph),
      triggerType,
      note: input.note ? input.note : null,
      createdById: userId,
    });
    if (result.outcome === 'not_found') throw new NotFoundException(AUTOMATION_MESSAGES.NOT_FOUND);
    if (result.outcome === 'conflict') throw conflict(result.currentRevision);

    const warnings: string[] = [];
    const started = await this.triggers.start(orgId, id, { id: result.version.id, graph });
    if (!started) warnings.push(AUTOMATION_MESSAGES.SCHEDULE_NOT_SET_UP);

    return {
      automation: await this.get(orgId, id),
      version: toVersionSummary(result.version, result.version.id),
      warnings,
    };
  }

  /**
   * Turns a workflow off: no new runs from now on, its schedule deleted (so
   * turning it back on never catches up). Runs in progress finish; they can
   * be cancelled from the Runs tab. Pausing a paused workflow changes
   * nothing; a draft was never on (409).
   */
  async pause(orgId: string, id: string): Promise<AutomationDetail> {
    const row = await this.findOrThrow(orgId, id);
    if (row.status === AutomationStatus.DRAFT) {
      throw new ConflictException({
        message: AUTOMATION_MESSAGES.NOT_TURNED_ON,
        code: 'no_active_version',
      });
    }
    await this.repository.pause(orgId, id);
    // Best-effort: the reconcile deletes a schedule whose workflow is not on.
    await this.triggers.stop(orgId, id);
    return this.get(orgId, id);
  }

  /** Discard Changes: the draft becomes the live version again. Never changes what is live. */
  async discard(orgId: string, userId: string | null, id: string): Promise<AutomationDetail> {
    if (!UUID_PATTERN.test(id)) throw new NotFoundException(AUTOMATION_MESSAGES.NOT_FOUND);
    const result = await this.repository.discard(orgId, id, userId);
    if (result.outcome === 'not_found') throw new NotFoundException(AUTOMATION_MESSAGES.NOT_FOUND);
    if (result.outcome === 'no_active_version') {
      throw new ConflictException({
        message: AUTOMATION_MESSAGES.NO_ACTIVE_VERSION,
        code: 'no_active_version',
      });
    }
    return toDetail(result.row);
  }

  /** The Versions drawer: newest first, the live one marked. */
  async versions(orgId: string, id: string): Promise<VersionSummary[]> {
    const row = await this.findOrThrow(orgId, id);
    const rows = await this.repository.listVersions(orgId, id);
    return rows.map((version) => toVersionSummary(version, row.activeVersion?.id ?? null));
  }

  /** One version with its graph, for a read-only preview on the canvas. */
  async version(orgId: string, id: string, number: string): Promise<VersionDetail> {
    const row = await this.findOrThrow(orgId, id);
    const found = await this.findVersionOrThrow(orgId, id, number);
    return {
      ...toVersionSummary(found, row.activeVersion?.id ?? null),
      graph: upgradeGraph(found.graph),
    };
  }

  /**
   * Restore As Draft: copies a version's graph into the draft, checked
   * against the editor's revision like a save. What is live never changes;
   * Unpublished Changes is worked out again against the live version.
   */
  async restore(
    orgId: string,
    userId: string | null,
    id: string,
    number: string,
    input: RestoreVersionInput,
  ): Promise<AutomationDetail> {
    if (!UUID_PATTERN.test(id)) throw new NotFoundException(AUTOMATION_MESSAGES.NOT_FOUND);
    const current = await this.repository.findSaveState(orgId, id);
    if (!current) throw new NotFoundException(AUTOMATION_MESSAGES.NOT_FOUND);
    const found = await this.findVersionOrThrow(orgId, id, number);
    if (current.draftRevision !== input.draftRevision) throw conflict(current.draftRevision);

    const graph = upgradeGraph(found.graph);
    const saved = await this.repository.update(orgId, id, input.draftRevision, {
      updatedById: userId,
      draftGraph: toJson(graph),
      triggerType: triggerTypeOf(graph),
      hasUnpublishedChanges:
        current.status !== AutomationStatus.DRAFT &&
        !sameJson(graph, current.activeVersion?.graph ?? null),
    });
    if (!saved) {
      const now = await this.repository.findSaveState(orgId, id);
      if (!now) throw new NotFoundException(AUTOMATION_MESSAGES.NOT_FOUND);
      throw conflict(now.draftRevision);
    }
    return toDetail(saved);
  }

  private async findVersionOrThrow(
    orgId: string,
    id: string,
    number: string,
  ): Promise<VersionDetailRow> {
    const found = VERSION_NUMBER_PATTERN.test(number)
      ? await this.repository.findVersion(orgId, id, Number(number))
      : null;
    if (!found) throw new NotFoundException(AUTOMATION_MESSAGES.VERSION_NOT_FOUND);
    return found;
  }

  private async findOrThrow(orgId: string, id: string): Promise<AutomationRow> {
    const row = UUID_PATTERN.test(id) ? await this.repository.find(orgId, id) : null;
    if (!row) throw new NotFoundException(AUTOMATION_MESSAGES.NOT_FOUND);
    return row;
  }
}

/**
 * The two refusals the graph schema cannot make: a step type (and version)
 * the catalog does not have, and a value that looks like a secret.
 */
export function assertSavable(graph: AutomationGraph): void {
  if (graph.nodes.some((node) => !getDefinition(node.type, node.typeVersion))) {
    throw new UnprocessableEntityException({
      message: AUTOMATION_MESSAGES.UNKNOWN_STEP,
      code: 'unknown_step',
    });
  }
  if (findSecretLikeValues(graph).length > 0) {
    throw new UnprocessableEntityException({
      message: AUTOMATION_MESSAGES.SECRET_REFUSED,
      code: 'secret_in_step',
    });
  }
}

function assertStepInDraft(row: AutomationRow, nodeKey: string): void {
  const graph = NODE_KEY_PATTERN.test(nodeKey) ? upgradeGraph(row.draftGraph) : null;
  if (!graph?.nodes.some((node) => node.key === nodeKey)) {
    throw new NotFoundException(AUTOMATION_MESSAGES.STEP_NOT_FOUND);
  }
}

/** Admins and superadmins act for the whole workspace. */
function isAdmin(role: Role): boolean {
  return role === Role.ADMIN || role === Role.SUPERADMIN;
}

/** A person's name as the drawer shows it: first and last name, else their email. */
function personName(user: { name: string | null; lastName: string | null; email: string }): string {
  return [user.name, user.lastName].filter(Boolean).join(' ').trim() || user.email;
}

function toVersionSummary(row: VersionRow, activeVersionId: string | null): VersionSummary {
  return {
    version: row.version,
    note: row.note,
    triggerType: row.triggerType,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy ? { id: row.createdBy.id, name: personName(row.createdBy) } : null,
    active: row.id === activeVersionId,
  };
}

function conflict(currentRevision: number): ConflictException {
  return new ConflictException({
    message: AUTOMATION_MESSAGES.CONFLICT,
    code: 'automation_conflict',
    details: { currentRevision },
  });
}

export function copyName(name: string): string {
  const room = MAX_AUTOMATION_NAME_LENGTH - COPY_SUFFIX.length;
  return `${name.length > room ? name.slice(0, room).trimEnd() : name}${COPY_SUFFIX}`;
}

function triggerTypeOf(graph: AutomationGraph): string | null {
  return graph.nodes.find((node) => isTriggerType(node.type))?.type ?? null;
}

/**
 * Whether two graphs are the same, ignoring key order: Postgres stores JSON
 * with its keys reordered, so a plain `JSON.stringify` of the stored version
 * would differ from the editor's copy of the same graph.
 */
export function sameJson(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function toJson(graph: AutomationGraph): Prisma.InputJsonValue {
  return graph as unknown as Prisma.InputJsonValue;
}

function toListFields(row: AutomationListRow): Omit<AutomationListItem, 'runs30d'> {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    triggerType: row.triggerType,
    hasUnpublishedChanges: row.hasUnpublishedChanges,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    lastRunStatus: row.lastRunStatus,
    lastRunError: row.lastRunError,
    templateId: row.templateId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The pinned steps that are still in the draft (a deleted step's pin is simply not listed). */
function pinnedSummary(pinnedData: unknown, graph: AutomationGraph): PinnedSummary[] {
  if (typeof pinnedData !== 'object' || pinnedData === null || Array.isArray(pinnedData)) return [];
  const keys = new Set(graph.nodes.map((node) => node.key));
  return Object.entries(pinnedData as Record<string, unknown>)
    .filter(([nodeKey]) => keys.has(nodeKey))
    .flatMap(([nodeKey, entry]) => {
      const stored = entry as { pinnedAt?: unknown; output?: unknown } | null;
      return typeof stored?.pinnedAt === 'string'
        ? [{ nodeKey, pinnedAt: stored.pinnedAt, output: stored.output ?? null }]
        : [];
    })
    .sort((a, b) => (a.nodeKey < b.nodeKey ? -1 : 1));
}

function toDetail(row: AutomationRow): AutomationDetail {
  const graph = upgradeGraph(row.draftGraph);
  return {
    ...toListFields(row),
    draftGraph: graph,
    draftRevision: row.draftRevision,
    pinned: pinnedSummary(row.pinnedData, graph),
    activeVersion: row.activeVersion?.version ?? null,
  };
}
