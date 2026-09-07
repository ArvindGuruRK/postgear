-- AlterEnum
BEGIN;
CREATE TYPE "Provider_new" AS ENUM ('LOCAL', 'FACEBOOK', 'GOOGLE', 'FARCASTER', 'WALLET', 'GENERIC');
ALTER TABLE "User" ALTER COLUMN "providerName" TYPE "Provider_new" USING ("providerName"::text::"Provider_new");
ALTER TYPE "Provider" RENAME TO "Provider_old";
ALTER TYPE "Provider_new" RENAME TO "Provider";
DROP TYPE "Provider_old";
COMMIT;
