-- Sprint 13, Module 14: the Emote Maker's job kind.
--
-- Additive: one new value on "ClipJobKind". An EMOTE job cuts a short stretch
-- of a video into emote files; it costs no AI Minutes and one download.

-- AlterEnum
ALTER TYPE "ClipJobKind" ADD VALUE 'EMOTE';
