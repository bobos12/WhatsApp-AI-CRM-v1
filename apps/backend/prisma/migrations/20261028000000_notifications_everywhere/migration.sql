-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'MESSAGE';
ALTER TYPE "NotificationType" ADD VALUE 'ASSIGNMENT';
ALTER TYPE "NotificationType" ADD VALUE 'MENTION';
ALTER TYPE "NotificationType" ADD VALUE 'NOTE';
ALTER TYPE "NotificationType" ADD VALUE 'TASK_DUE';
ALTER TYPE "NotificationType" ADD VALUE 'REMINDER';
ALTER TYPE "NotificationType" ADD VALUE 'TEST';

-- AlterTable
ALTER TABLE "User" ADD COLUMN "notificationPrefs" JSONB;

-- AlterTable
ALTER TABLE "PushSubscription" ADD COLUMN "locale" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN "actorId" TEXT,
ADD COLUMN "actorName" TEXT,
ADD COLUMN "url" TEXT,
ADD COLUMN "dedupeKey" TEXT,
ADD COLUMN "groupCount" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "pushedAt" TIMESTAMP(3);

-- Rows that existed before this release were already pushed the old way.
UPDATE "Notification" SET "pushedAt" = "createdAt" WHERE "pushedAt" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Notification_recipientId_dedupeKey_key" ON "Notification"("recipientId", "dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_pushedAt_createdAt_idx" ON "Notification"("pushedAt", "createdAt");
