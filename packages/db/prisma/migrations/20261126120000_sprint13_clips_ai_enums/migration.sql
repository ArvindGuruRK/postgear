-- Sprint 13 (Clips AI): the new kinds of job, file and clip origin.
-- Additive only: new enum values, no column and no row changes. Nothing here
-- uses a new value (Postgres cannot use one in the transaction that adds it).

-- AlterEnum
ALTER TYPE "ClipOrigin" ADD VALUE 'AI_TRANSCRIPT';
ALTER TYPE "ClipOrigin" ADD VALUE 'AUTO_EDIT';

-- AlterEnum
ALTER TYPE "ClipAssetKind" ADD VALUE 'TRANSCRIPT';
ALTER TYPE "ClipAssetKind" ADD VALUE 'FACE_TRACKS';

-- AlterEnum
ALTER TYPE "ClipJobKind" ADD VALUE 'TRANSCRIBE';
ALTER TYPE "ClipJobKind" ADD VALUE 'FACES';
ALTER TYPE "ClipJobKind" ADD VALUE 'TRANSLATE';
ALTER TYPE "ClipJobKind" ADD VALUE 'SPEECH';
