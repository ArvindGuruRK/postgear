import { Role } from '@postgear/db';
import { z } from 'zod';
import { emailSchema, orgNameSchema } from '../../auth/dto/common.schema';

export const createOrgSchema = z.object({ name: orgNameSchema }).strict();

/**
 * `POST /orgs/:id/invites` (Settings > Team, 2026-10-19).
 *
 * Mirrors Postiz's "Add member": a role, whether to send the link by email,
 * and the address. The address is required only when there is an email to
 * send; for a copied link it is optional and, when given, binds the link to
 * that address. A blank field arrives as `''` from a form and means "none".
 */
export const inviteMemberSchema = z
  .object({
    // SUPERADMIN is deliberately absent from the invitable set. It is a
    // platform-level flag (`User.isSuperAdmin`), not a workspace role anyone
    // should be able to grant through an invitation form.
    role: z.enum([Role.ADMIN, Role.USER]).default(Role.USER),
    sendEmail: z.boolean().default(true),
    email: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      emailSchema.optional(),
    ),
  })
  .strict()
  .refine((body) => !body.sendEmail || body.email !== undefined, {
    message: 'email is required to send an invitation',
    path: ['email'],
  });

export type InviteMemberBody = z.infer<typeof inviteMemberSchema>;

/**
 * `POST /orgs/invites/accept`. The token's own checks (shape, signature,
 * expiry) happen in `InviteTokenService`, so a bad one is answered "not
 * valid" rather than the generic "Invalid input"; this only bounds the body.
 */
export const acceptInviteSchema = z.object({ token: z.string().min(1).max(2048) }).strict();

export const changeRoleSchema = z.object({ role: z.enum([Role.ADMIN, Role.USER]) }).strict();
