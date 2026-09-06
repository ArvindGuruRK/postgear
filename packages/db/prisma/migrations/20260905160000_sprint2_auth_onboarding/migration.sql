-- CreateEnum
CREATE TYPE "OnboardingRole" AS ENUM ('SOLO_CREATOR', 'AGENCY', 'IN_HOUSE_TEAM', 'SMALL_BUSINESS', 'OTHER');

-- CreateEnum
CREATE TYPE "OnboardingTeamSize" AS ENUM ('JUST_ME', 'SIZE_2_10', 'SIZE_11_50', 'SIZE_51_200', 'SIZE_200_PLUS');

-- CreateEnum
CREATE TYPE "OnboardingGoal" AS ENUM ('GROW_AUDIENCE', 'SAVE_TIME', 'BETTER_CONTENT', 'TRACK_PERFORMANCE', 'TEAM_COLLAB');

-- CreateEnum
CREATE TYPE "PostingFrequency" AS ENUM ('DAILY', 'FEW_TIMES_WEEK', 'WEEKLY', 'MONTHLY', 'NOT_YET');

-- CreateEnum
CREATE TYPE "ReferralSource" AS ENUM ('SEARCH', 'SOCIAL', 'FRIEND', 'NEWSLETTER', 'OTHER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "activationTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "activationTokenHash" TEXT,
ADD COLUMN     "failedLoginAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastFailedLoginAt" TIMESTAMP(3),
ADD COLUMN     "lockedUntil" TIMESTAMP(3),
ADD COLUMN     "onboardingCompletedAt" TIMESTAMP(3),
ADD COLUMN     "onboardingStep" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN     "passwordResetTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "passwordResetTokenHash" TEXT;

-- CreateTable
CREATE TABLE "OnboardingResponse" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OnboardingRole",
    "teamSize" "OnboardingTeamSize",
    "primaryGoal" "OnboardingGoal",
    "postingFrequency" "PostingFrequency",
    "referralSource" "ReferralSource",
    "interestedChannels" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OnboardingResponse_userId_key" ON "OnboardingResponse"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "User_activationTokenHash_key" ON "User"("activationTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "User_passwordResetTokenHash_key" ON "User"("passwordResetTokenHash");

-- CreateIndex
CREATE INDEX "User_lockedUntil_idx" ON "User"("lockedUntil");

-- AddForeignKey
ALTER TABLE "OnboardingResponse" ADD CONSTRAINT "OnboardingResponse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

