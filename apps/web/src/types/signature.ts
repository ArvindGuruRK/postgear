/**
 * Signatures (2026-10-19, after Postiz's): a workspace's saved sign-offs.
 * The one marked `autoAdd` starts every new blank post; any of them can be
 * inserted at the cursor from the composer's toolbar. Mirrors `/signatures`.
 *
 * `content` is plain text; line breaks are kept and become paragraphs when
 * inserted into the editor.
 */
export interface Signature {
  id: string;
  content: string;
  /** At most one per workspace: the default added to new posts. */
  autoAdd: boolean;
  createdAt: string;
  updatedAt: string;
}
