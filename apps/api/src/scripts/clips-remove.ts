/**
 * `npm run clips:remove -- --url <link> --reason "<why>" --by <operator email>`
 * (Sprint 12, Module 19 section 5): for an operator who has only the link
 * from a rights request. Removes every workspace's copy of that video through
 * the same service as `DELETE /operator/clips/videos/:videoId`, and blocks the
 * link for everyone, even when no workspace has it yet.
 *
 * Runs the API's own modules in a Nest application context (no HTTP server),
 * so the removal, the notifications, the security events and the owner mail
 * are exactly the route's. `--by` must be a platform operator: a superadmin,
 * and in production an address in `OPERATOR_EMAILS`. One log line says who
 * ran it.
 */
import { NestFactory } from '@nestjs/core';
import { prisma } from '@postgear/db';
import { AppModule } from '../app.module';
import { OperatorClipsService } from '../modules/admin/clips/operator-clips.service';
import { parseClipsRemoveArgs } from './clips-remove.args';

async function main(): Promise<number> {
  const args = parseClipsRemoveArgs(process.argv.slice(2));
  if ('error' in args) {
    console.error(args.error);
    return 1;
  }

  // An address can hold a password and a Google account; one flagged operator account is enough.
  const operator = await prisma.user.findFirst({
    where: { email: args.by, isSuperAdmin: true },
    select: { id: true, email: true, isSuperAdmin: true },
  });
  const allowlist = (process.env.OPERATOR_EMAILS ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const production = process.env.NODE_ENV === 'production';
  if (
    !operator?.isSuperAdmin ||
    (production && !allowlist.includes(operator.email.toLowerCase()))
  ) {
    console.error(`${args.by} is not a platform operator. See npm run operator:grant.`);
    return 1;
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    console.log(
      JSON.stringify({
        event: 'clips.remove.script',
        by: operator.email,
        url: args.url,
        at: new Date().toISOString(),
      }),
    );
    const removed = await app
      .get(OperatorClipsService)
      .removeByLink(args.url, args.reason, operator);
    for (const one of removed) {
      console.log(`Removed video ${one.videoId} from workspace ${one.organizationId}.`);
    }
    console.log(
      removed.length === 0
        ? 'No workspace had this video. Its link is blocked, so nobody can bring it in.'
        : `Removed ${removed.length} ${removed.length === 1 ? 'copy' : 'copies'}. The link is blocked for every workspace.`,
    );
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    await app.close();
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
