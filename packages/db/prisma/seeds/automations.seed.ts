/**
 * Workflow Builder demo content (Sprint 10, Module 03).
 *
 * One draft for the demo workspace, the Publishing Report starter, so the
 * Workflows list opens on something to click. Its Google Sheets and Slack
 * steps stay unconnected on purpose: that is what makes the canvas show its
 * Finish Setup markers (Module 05).
 *
 * The graph comes from the template itself, in `@postgear/automation`,
 * loaded with `require` at run time like the Studio seed loads the design
 * engine: `packages/db` does not depend on an engine package, and copying
 * the graph here would let it drift from the template. The template's own
 * step keys are kept, so re-seeding writes the same draft. In this monorepo
 * the package is always there; without it the workflow is skipped.
 *
 * Idempotent by fixed id and `upsert`, like the rest of the seeds.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { AutomationStatus, type Prisma, type PrismaClient } from '@prisma/client';

const PUBLISHING_REPORT_ID = '6f1c2a3e-5b7d-4e9f-8a1b-2c3d4e5f6a7b';
const TEMPLATE_ID = 'publishing-report';

interface AutomationPackage {
  getTemplate(id: string): { id: string; title: string } | undefined;
  instantiateTemplate(
    template: unknown,
    makeKey: (key: string) => string,
  ): {
    nodes: { type: string }[];
  };
  findSecretLikeValues(graph: unknown): unknown[];
}

function loadPackage(): AutomationPackage | null {
  const entry = join(__dirname, '../../../automation/src/index.ts');
  return existsSync(entry) ? (require(entry) as AutomationPackage) : null;
}

export async function seedAutomations(
  prisma: PrismaClient,
  organizationId: string,
  createdById: string,
) {
  const automation = loadPackage();
  if (!automation) return { skipped: 'packages/automation not found' };

  const template = automation.getTemplate(TEMPLATE_ID);
  if (!template) {
    throw new Error(`prisma/seeds/automations.seed.ts is stale: no "${TEMPLATE_ID}" template`);
  }
  const graph = automation.instantiateTemplate(template, (key) => key);
  if (automation.findSecretLikeValues(graph).length > 0) {
    throw new Error('prisma/seeds/automations.seed.ts: the template holds a secret-looking value');
  }

  const draftGraph = graph as unknown as Prisma.InputJsonValue;
  const triggerType = graph.nodes.find((node) => node.type.startsWith('trigger.'))?.type ?? null;

  await prisma.automation.upsert({
    where: { id: PUBLISHING_REPORT_ID },
    create: {
      id: PUBLISHING_REPORT_ID,
      organizationId,
      name: template.title,
      status: AutomationStatus.DRAFT,
      draftGraph,
      triggerType,
      templateId: template.id,
      createdById,
      updatedById: createdById,
    },
    // Back to the template on re-seed. The revision still moves on, so an
    // editor left open on the old draft gets a conflict, not a silent overwrite.
    update: {
      name: template.title,
      status: AutomationStatus.DRAFT,
      draftGraph,
      triggerType,
      pinnedData: {},
      hasUnpublishedChanges: false,
      deletedAt: null,
      draftRevision: { increment: 1 },
    },
  });

  return { workflows: [template.title] };
}
