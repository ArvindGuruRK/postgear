/**
 * API-key shapes shared between server components and client islands
 * (Sprint 8). Mirror `/developers/api-keys` — see
 * docs/sprint-documents/sprint-08-contract.md §5.3.
 */

export interface ApiKeyView {
  id: string;
  name: string;
  /** `pg_` + 8 characters: enough to tell keys apart, never enough to use one. */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

/** The one response that carries the secret, at creation and rotation. */
export interface ApiKeyCreated {
  key: ApiKeyView;
  secret: string;
  revokedKeyId?: string;
}
