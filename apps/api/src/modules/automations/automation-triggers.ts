/**
 * Starting and stopping what makes a workflow run on its own: its Temporal
 * Schedule, or its place among the event triggers.
 *
 * A stub until Module 09 (Triggers, Activation And Versions) fills it in.
 * Deleting an active workflow already calls `stop()` first, so that module
 * only adds the body, not a new call site.
 */
import { Injectable } from '@nestjs/common';

@Injectable()
export class AutomationTriggers {
  /** Stops a workflow's trigger. A no-op until Module 09. */
  async stop(_orgId: string, _automationId: string): Promise<void> {}
}
