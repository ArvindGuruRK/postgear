import { Role } from '@postgear/db';
import { z } from 'zod';
import { emailSchema, orgNameSchema } from '../../auth/dto/common.schema';

export const createOrgSchema = z.object({ name: orgNameSchema }).strict();

export const inviteMemberSchema = z
  .object({
    email: emailSchema,
    // SUPERADMIN is deliberately absent from the invitable set. It is a
    // platform-level flag (`User.isSuperAdmin`), not a workspace role anyone
    // should be able to grant through an invitation form.
    role: z.enum([Role.ADMIN, Role.USER]).default(Role.USER),
  })
  .strict();

export const changeRoleSchema = z.object({ role: z.enum([Role.ADMIN, Role.USER]) }).strict();
