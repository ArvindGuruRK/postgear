import { WorkflowMissingHere } from '@/components/workflows/builder/workflow-missing';

/**
 * A workflow that is not there (deleted, never real, or another workspace's,
 * which the API answers alike): the page calls `notFound()`, and this shows
 * inside the workspace's shell with the way back to Workflows.
 */
export default function WorkflowNotFound() {
  return <WorkflowMissingHere />;
}
