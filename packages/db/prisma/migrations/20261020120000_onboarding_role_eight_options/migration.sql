-- UI revamp: "How would you describe yourself?" grows from five answers to
-- eight (Buffer's onboarding). Additive only: the existing five values keep
-- their names, so every stored answer stays valid and nothing is backfilled.

-- AlterEnum
ALTER TYPE "OnboardingRole" ADD VALUE 'FREELANCER';
ALTER TYPE "OnboardingRole" ADD VALUE 'NONPROFIT';
ALTER TYPE "OnboardingRole" ADD VALUE 'FOUNDER';
