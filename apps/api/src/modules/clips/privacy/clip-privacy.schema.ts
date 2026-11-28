import { z } from 'zod';

/** `PUT /clips/privacy` (Module 17 item 26). */
export const clipPrivacySchema = z.object({ speechStaysHere: z.boolean() }).strict();
export type ClipPrivacyInput = z.infer<typeof clipPrivacySchema>;
