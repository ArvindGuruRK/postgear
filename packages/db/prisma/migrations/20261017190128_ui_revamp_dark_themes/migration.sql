-- UI revamp: dark themes, and Classic as the default light theme.
--
-- `darkTheme` is new; `classic` is the original dark look. `lightTheme`'s
-- default moves from `cream` to `classic`, the original light look (cream
-- page, everything else white). Cream itself stays a free option, but with the
-- butter frame it now names a different look from the default.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "darkTheme" TEXT NOT NULL DEFAULT 'classic',
ALTER COLUMN "lightTheme" SET DEFAULT 'classic';

-- Until now `cream` was only the implicit default: the theme picker is
-- unreleased, so no real user chose it on purpose. Moving those rows to
-- `classic` keeps every existing account on the default.
UPDATE "User" SET "lightTheme" = 'classic' WHERE "lightTheme" = 'cream';
