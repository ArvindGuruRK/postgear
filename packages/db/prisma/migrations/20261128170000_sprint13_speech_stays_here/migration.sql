-- Sprint 13, Module 17 item 26: a workspace can keep every listen on our own
-- machine, even when the media service sends long speech to a hosted lane.
-- Additive: one column with a default, so every workspace keeps today's
-- behaviour (false: the hosted lane may be used when the service has one).

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "clipsSpeechStaysHere" BOOLEAN NOT NULL DEFAULT false;
