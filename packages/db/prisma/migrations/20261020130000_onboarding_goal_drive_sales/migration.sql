-- UI revamp: "What do you most want from PostGear?" gets a sixth answer,
-- "Drive traffic and sales". Additive only: stored answers stay valid.

-- AlterEnum
ALTER TYPE "OnboardingGoal" ADD VALUE 'DRIVE_SALES';
