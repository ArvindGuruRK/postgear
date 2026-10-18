-- CreateEnum
CREATE TYPE "ThemeMode" AS ENUM ('SYSTEM', 'LIGHT', 'DARK');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarPreset" TEXT,
ADD COLUMN     "avatarUrl" TEXT,
ADD COLUMN     "lightTheme" TEXT NOT NULL DEFAULT 'cream',
ADD COLUMN     "themeMode" "ThemeMode" NOT NULL DEFAULT 'SYSTEM';
