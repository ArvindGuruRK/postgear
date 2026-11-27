-- Sprint 13, Module 14: the Editor seat.
--
-- Additive: a new value on "Role" and nothing else. Postgres cannot use a new
-- enum value inside the transaction that adds it, so the seat seed that the
-- value goes with lives in the next migration.

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'EDITOR';
