import { z } from 'zod';
import {
  emailSchema,
  nameSchema,
  passwordSchema,
  timezoneSchema,
  tokenSchema,
} from './common.schema';

/**
 * Request-body schemas for the auth routes.
 *
 * `.strict()` on every object is load-bearing: it rejects unknown keys rather
 * than ignoring them, so a request that tries to set `isSuperAdmin` or
 * `activated` during registration fails outright instead of having the extra
 * field quietly dropped. That turns mass-assignment from "prevented by the
 * service happening to list its fields explicitly" into "prevented by the
 * schema", which is the layer that cannot forget.
 */

export const registerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    name: nameSchema,
    lastName: nameSchema.optional(),
    timezone: timezoneSchema.optional(),
  })
  .strict();

export type RegisterDto = z.infer<typeof registerSchema>;

export const loginSchema = z
  .object({
    email: emailSchema,
    // Not `passwordSchema`: a login must accept whatever the user has, which
    // includes a password set before a rule changed. Applying the composition
    // rule here would also turn the login endpoint into a password-policy
    // oracle. Only a length bound, purely to cap hashing work.
    password: z.string().min(1).max(512),
  })
  .strict();

export type LoginDto = z.infer<typeof loginSchema>;

export const activateSchema = z.object({ token: tokenSchema }).strict();

export const resetRequestSchema = z.object({ email: emailSchema }).strict();

export const resetPasswordSchema = z
  .object({
    token: tokenSchema,
    password: passwordSchema,
  })
  .strict();

export type ResetPasswordDto = z.infer<typeof resetPasswordSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(512),
    newPassword: passwordSchema,
  })
  .strict()
  .refine((value) => value.currentPassword !== value.newPassword, 'unchanged');

export type ChangePasswordDto = z.infer<typeof changePasswordSchema>;
