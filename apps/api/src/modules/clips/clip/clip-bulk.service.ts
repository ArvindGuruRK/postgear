/**
 * Many clips at once (Sprint 13, Module 11): the Clips tab's bar of ticked
 * clips, Hide, Unhide and Delete.
 *
 * - **All or nothing.** Every id must be a clip of this workspace, or the
 *   whole request is 404 `clip_not_found` and nothing changes, so an id of
 *   another workspace learns nothing and a stale selection never half-applies.
 *   The same clips the single routes act on (a clip marked removed with its
 *   video can still be hidden or deleted).
 * - **Hide and Unhide** (`PATCH /clips/bulk`): one serializable transaction
 *   reads the clips and sets the status, as the single PATCH would: the
 *   revision moves on, and an export that drew the clip stays current (a
 *   status is not the picture). A clip already in that status is left as it
 *   is (no revision bump, so an editor open on it never sees a conflict) and
 *   not counted: `updated` is how many changed.
 * - **Delete** (`DELETE /clips/bulk`): `ClipEditsService.removeClips`, the
 *   single delete's own rules (jobs cancelled, sharp files kept while a clip
 *   that stays still uses them, transcripts handed on or removed), with the
 *   rows of every clip deleted in one transaction that refuses the lot when
 *   one went meanwhile.
 */
import { Injectable, Logger } from '@nestjs/common';
import { type Prisma, prisma } from '@postgear/db';
import { serializable } from '../clips.tx';
import { ClipEditsService } from './clip-edits.service';
import type { BulkDeleteClipsInput, BulkPatchClipsInput } from './clip-item.schema';
import { clipNotFound } from './clip-item.service';

@Injectable()
export class ClipBulkService {
  private readonly logger = new Logger(ClipBulkService.name);

  constructor(private readonly edits: ClipEditsService) {}

  /** `{ updated }`: how many clips changed status. 404 for the lot when one id is not ours. */
  async patch(orgId: string, body: BulkPatchClipsInput): Promise<{ updated: number }> {
    const updated = await serializable(async (tx) => {
      const clips = await tx.clip.findMany({
        where: { id: { in: body.clipIds }, organizationId: orgId },
        select: { id: true, status: true, revision: true, lastExportedRevision: true },
      });
      if (clips.length !== body.clipIds.length) throw clipNotFound();

      let changed = 0;
      for (const clip of clips) {
        if (clip.status === body.status) continue;
        const data: Prisma.ClipUpdateInput = { status: body.status, revision: clip.revision + 1 };
        // The export still shows exactly this clip: a status is not the picture.
        if (clip.lastExportedRevision === clip.revision) {
          data.lastExportedRevision = clip.revision + 1;
        }
        await tx.clip.update({ where: { id: clip.id }, data });
        changed += 1;
      }
      return changed;
    });
    this.logger.log(
      JSON.stringify({
        event: 'clips.clip.bulk_status',
        orgId,
        status: body.status,
        asked: body.clipIds.length,
        updated,
      }),
    );
    return { updated };
  }

  /** `{ deleted }`. 404 for the lot when one id is not ours. */
  async remove(orgId: string, body: BulkDeleteClipsInput): Promise<{ deleted: number }> {
    const clips = await prisma.clip.findMany({
      where: { id: { in: body.clipIds }, organizationId: orgId },
    });
    if (clips.length !== body.clipIds.length) throw clipNotFound();
    const { deleted } = await this.edits.removeClips(orgId, clips);
    this.logger.log(JSON.stringify({ event: 'clips.clip.bulk_deleted', orgId, deleted }));
    return { deleted };
  }
}
