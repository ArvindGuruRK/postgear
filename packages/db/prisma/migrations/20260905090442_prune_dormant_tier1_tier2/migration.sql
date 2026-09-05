/*
  Warnings:

  - You are about to drop the `AutoPost` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ExisingPlugData` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `GitHub` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ItemUser` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Mentions` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Plugs` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PopularPosts` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Star` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ThirdParty` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Trending` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `TrendingLog` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `UsedCodes` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `mastra_ai_spans` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `mastra_evals` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `mastra_messages` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `mastra_resources` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `mastra_scorers` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `mastra_threads` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `mastra_traces` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `mastra_workflow_snapshot` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "AutoPost" DROP CONSTRAINT "AutoPost_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "ExisingPlugData" DROP CONSTRAINT "ExisingPlugData_integrationId_fkey";

-- DropForeignKey
ALTER TABLE "GitHub" DROP CONSTRAINT "GitHub_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "ItemUser" DROP CONSTRAINT "ItemUser_userId_fkey";

-- DropForeignKey
ALTER TABLE "Plugs" DROP CONSTRAINT "Plugs_integrationId_fkey";

-- DropForeignKey
ALTER TABLE "Plugs" DROP CONSTRAINT "Plugs_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "ThirdParty" DROP CONSTRAINT "ThirdParty_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "UsedCodes" DROP CONSTRAINT "UsedCodes_orgId_fkey";

-- DropTable
DROP TABLE "AutoPost";

-- DropTable
DROP TABLE "ExisingPlugData";

-- DropTable
DROP TABLE "GitHub";

-- DropTable
DROP TABLE "ItemUser";

-- DropTable
DROP TABLE "Mentions";

-- DropTable
DROP TABLE "Plugs";

-- DropTable
DROP TABLE "PopularPosts";

-- DropTable
DROP TABLE "Star";

-- DropTable
DROP TABLE "ThirdParty";

-- DropTable
DROP TABLE "Trending";

-- DropTable
DROP TABLE "TrendingLog";

-- DropTable
DROP TABLE "UsedCodes";

-- DropTable
DROP TABLE "mastra_ai_spans";

-- DropTable
DROP TABLE "mastra_evals";

-- DropTable
DROP TABLE "mastra_messages";

-- DropTable
DROP TABLE "mastra_resources";

-- DropTable
DROP TABLE "mastra_scorers";

-- DropTable
DROP TABLE "mastra_threads";

-- DropTable
DROP TABLE "mastra_traces";

-- DropTable
DROP TABLE "mastra_workflow_snapshot";
