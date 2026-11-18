/**
 * Checks on the part list a browser sends to complete an upload, shared by
 * both bindings so they refuse the same lists.
 */
import { StorageUploadError } from './errors';
import { isPartNumber } from './file-token';
import type { UploadedPart } from './private-storage.interface';

/**
 * The parts in ascending order. Refuses an empty list, a part number outside
 * 1 to 10000, a missing ETag and a part listed twice.
 */
export function orderedParts(parts: UploadedPart[]): UploadedPart[] {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new StorageUploadError('An upload needs at least one part');
  }

  const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);
  ordered.forEach((part, index) => {
    if (!isPartNumber(part.partNumber)) {
      throw new StorageUploadError('A part number runs from 1 to 10000');
    }
    if (typeof part.etag !== 'string' || unquoteEtag(part.etag) === '') {
      throw new StorageUploadError('Every part needs the ETag its upload answered');
    }
    if (index > 0 && ordered[index - 1]?.partNumber === part.partNumber) {
      throw new StorageUploadError('A part is listed twice');
    }
  });

  return ordered;
}

/** An ETag without its surrounding quotes. */
export function unquoteEtag(etag: string): string {
  return etag.trim().replace(/^"|"$/g, '');
}
