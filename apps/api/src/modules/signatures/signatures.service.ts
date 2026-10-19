/**
 * Signatures (2026-10-19, after Postiz's): a workspace's saved sign-offs.
 * The one marked `autoAdd` starts every new blank post in the composer; any
 * of them can be inserted at the cursor from its toolbar.
 *
 * Reading is open to every member (the composer needs them); writing is an
 * admin's, like every other workspace setting. Postiz lets anyone write
 * them; PostGear keeps workspace settings admin-only.
 */
import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import {
  type CreateSignatureInput,
  MAX_SIGNATURES_PER_WORKSPACE,
  type UpdateSignatureInput,
} from './dto/signatures.schema';
import { SIGNATURE_MESSAGES } from './signatures.messages';
import { type SignatureRow, SignaturesRepository } from './signatures.repository';

/** What `/signatures` returns; mirrors `apps/web/src/types/signature.ts`. */
export type SignatureView = SignatureRow;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class SignaturesService {
  constructor(private readonly repository: SignaturesRepository) {}

  list(orgId: string): Promise<SignatureView[]> {
    return this.repository.list(orgId);
  }

  /** The signature new posts start with, or null when the workspace has none marked. */
  findDefault(orgId: string): Promise<SignatureView | null> {
    return this.repository.findDefault(orgId);
  }

  async create(orgId: string, input: CreateSignatureInput): Promise<SignatureView> {
    const result = await this.repository.create(orgId, input, MAX_SIGNATURES_PER_WORKSPACE);

    if (result.outcome === 'too_many') {
      throw new UnprocessableEntityException(SIGNATURE_MESSAGES.TOO_MANY);
    }

    return result.signature;
  }

  async update(orgId: string, id: string, input: UpdateSignatureInput): Promise<SignatureView> {
    const updated = UUID_PATTERN.test(id) ? await this.repository.update(orgId, id, input) : null;

    if (!updated) {
      throw new NotFoundException(SIGNATURE_MESSAGES.NOT_FOUND);
    }

    return updated;
  }

  async remove(orgId: string, id: string): Promise<void> {
    if (!UUID_PATTERN.test(id) || !(await this.repository.softDelete(orgId, id))) {
      throw new NotFoundException(SIGNATURE_MESSAGES.NOT_FOUND);
    }
  }
}
