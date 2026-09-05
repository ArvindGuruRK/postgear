/*
  Warnings:

  - You are about to drop the column `approvedSubmitForOrder` on the `Post` table. All the data in the column will be lost.
  - You are about to drop the column `lastMessageId` on the `Post` table. All the data in the column will be lost.
  - You are about to drop the column `submittedForOrderId` on the `Post` table. All the data in the column will be lost.
  - You are about to drop the column `submittedForOrganizationId` on the `Post` table. All the data in the column will be lost.
  - You are about to drop the `Messages` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `MessagesGroup` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `OrderItems` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Orders` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `PayoutProblems` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SocialMediaAgency` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SocialMediaAgencyNiche` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Messages" DROP CONSTRAINT "Messages_groupId_fkey";

-- DropForeignKey
ALTER TABLE "MessagesGroup" DROP CONSTRAINT "MessagesGroup_buyerId_fkey";

-- DropForeignKey
ALTER TABLE "MessagesGroup" DROP CONSTRAINT "MessagesGroup_buyerOrganizationId_fkey";

-- DropForeignKey
ALTER TABLE "MessagesGroup" DROP CONSTRAINT "MessagesGroup_sellerId_fkey";

-- DropForeignKey
ALTER TABLE "OrderItems" DROP CONSTRAINT "OrderItems_integrationId_fkey";

-- DropForeignKey
ALTER TABLE "OrderItems" DROP CONSTRAINT "OrderItems_orderId_fkey";

-- DropForeignKey
ALTER TABLE "Orders" DROP CONSTRAINT "Orders_buyerId_fkey";

-- DropForeignKey
ALTER TABLE "Orders" DROP CONSTRAINT "Orders_messageGroupId_fkey";

-- DropForeignKey
ALTER TABLE "Orders" DROP CONSTRAINT "Orders_sellerId_fkey";

-- DropForeignKey
ALTER TABLE "PayoutProblems" DROP CONSTRAINT "PayoutProblems_orderId_fkey";

-- DropForeignKey
ALTER TABLE "PayoutProblems" DROP CONSTRAINT "PayoutProblems_postId_fkey";

-- DropForeignKey
ALTER TABLE "PayoutProblems" DROP CONSTRAINT "PayoutProblems_userId_fkey";

-- DropForeignKey
ALTER TABLE "Post" DROP CONSTRAINT "Post_lastMessageId_fkey";

-- DropForeignKey
ALTER TABLE "Post" DROP CONSTRAINT "Post_submittedForOrderId_fkey";

-- DropForeignKey
ALTER TABLE "Post" DROP CONSTRAINT "Post_submittedForOrganizationId_fkey";

-- DropForeignKey
ALTER TABLE "SocialMediaAgency" DROP CONSTRAINT "SocialMediaAgency_logoId_fkey";

-- DropForeignKey
ALTER TABLE "SocialMediaAgency" DROP CONSTRAINT "SocialMediaAgency_userId_fkey";

-- DropForeignKey
ALTER TABLE "SocialMediaAgencyNiche" DROP CONSTRAINT "SocialMediaAgencyNiche_agencyId_fkey";

-- DropIndex
DROP INDEX "Post_approvedSubmitForOrder_idx";

-- DropIndex
DROP INDEX "Post_lastMessageId_idx";

-- DropIndex
DROP INDEX "Post_submittedForOrderId_idx";

-- AlterTable
ALTER TABLE "Post" DROP COLUMN "approvedSubmitForOrder",
DROP COLUMN "lastMessageId",
DROP COLUMN "submittedForOrderId",
DROP COLUMN "submittedForOrganizationId";

-- DropTable
DROP TABLE "Messages";

-- DropTable
DROP TABLE "MessagesGroup";

-- DropTable
DROP TABLE "OrderItems";

-- DropTable
DROP TABLE "Orders";

-- DropTable
DROP TABLE "PayoutProblems";

-- DropTable
DROP TABLE "SocialMediaAgency";

-- DropTable
DROP TABLE "SocialMediaAgencyNiche";

-- DropEnum
DROP TYPE "APPROVED_SUBMIT_FOR_ORDER";

-- DropEnum
DROP TYPE "From";

-- DropEnum
DROP TYPE "OrderStatus";
