-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'PLATFORM_OWNER';

-- DropIndex
DROP INDEX "Analytics_date_key";

-- DropIndex
DROP INDEX "Contact_phone_key";

-- AlterTable
ALTER TABLE "Analytics" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "AutomationFlow" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "AutomationFlowExecution" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "AutomationRule" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Broadcast" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "BroadcastRecipient" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "CustomFieldDefinition" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "InternalNote" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "LeadQualification" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "LeadStatusEvent" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "MessageReaction" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "MessageTemplate" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "SavedReply" ADD COLUMN     "tenantId" TEXT;

-- AlterTable: Setting gains a surrogate `id` PK + `tenantId`, preserving any
-- existing rows. `id` is added nullable, backfilled from the old `key` PK
-- (which was unique + non-null), then promoted to NOT NULL and made the PK.
ALTER TABLE "Setting" DROP CONSTRAINT "Setting_pkey";
ALTER TABLE "Setting" ADD COLUMN     "id" TEXT;
ALTER TABLE "Setting" ADD COLUMN     "tenantId" TEXT;
UPDATE "Setting" SET "id" = "key" WHERE "id" IS NULL;
ALTER TABLE "Setting" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "Setting" ADD CONSTRAINT "Setting_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "Tag" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "tenantId" TEXT;

-- AlterTable
ALTER TABLE "WhatsAppSession" ADD COLUMN     "tenantId" TEXT;

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_slug_key" ON "Tenant"("slug");

-- CreateIndex
CREATE INDEX "Tenant_status_idx" ON "Tenant"("status");

-- CreateIndex
CREATE INDEX "Analytics_tenantId_idx" ON "Analytics"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Analytics_tenantId_date_key" ON "Analytics"("tenantId", "date");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_idx" ON "AuditLog"("tenantId");

-- CreateIndex
CREATE INDEX "AutomationFlow_tenantId_idx" ON "AutomationFlow"("tenantId");

-- CreateIndex
CREATE INDEX "AutomationFlowExecution_tenantId_idx" ON "AutomationFlowExecution"("tenantId");

-- CreateIndex
CREATE INDEX "AutomationRule_tenantId_idx" ON "AutomationRule"("tenantId");

-- CreateIndex
CREATE INDEX "Broadcast_tenantId_idx" ON "Broadcast"("tenantId");

-- CreateIndex
CREATE INDEX "BroadcastRecipient_tenantId_idx" ON "BroadcastRecipient"("tenantId");

-- CreateIndex
CREATE INDEX "Contact_tenantId_idx" ON "Contact"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_tenantId_phone_key" ON "Contact"("tenantId", "phone");

-- CreateIndex
CREATE INDEX "Conversation_tenantId_idx" ON "Conversation"("tenantId");

-- CreateIndex
CREATE INDEX "CustomFieldDefinition_tenantId_idx" ON "CustomFieldDefinition"("tenantId");

-- CreateIndex
CREATE INDEX "Deal_tenantId_idx" ON "Deal"("tenantId");

-- CreateIndex
CREATE INDEX "InternalNote_tenantId_idx" ON "InternalNote"("tenantId");

-- CreateIndex
CREATE INDEX "LeadQualification_tenantId_idx" ON "LeadQualification"("tenantId");

-- CreateIndex
CREATE INDEX "LeadStatusEvent_tenantId_idx" ON "LeadStatusEvent"("tenantId");

-- CreateIndex
CREATE INDEX "Message_tenantId_idx" ON "Message"("tenantId");

-- CreateIndex
CREATE INDEX "MessageReaction_tenantId_idx" ON "MessageReaction"("tenantId");

-- CreateIndex
CREATE INDEX "MessageTemplate_tenantId_idx" ON "MessageTemplate"("tenantId");

-- CreateIndex
CREATE INDEX "Notification_tenantId_idx" ON "Notification"("tenantId");

-- CreateIndex
CREATE INDEX "SavedReply_tenantId_idx" ON "SavedReply"("tenantId");

-- CreateIndex
CREATE INDEX "Setting_tenantId_idx" ON "Setting"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Setting_tenantId_key_key" ON "Setting"("tenantId", "key");

-- CreateIndex
CREATE INDEX "Tag_tenantId_idx" ON "Tag"("tenantId");

-- CreateIndex
CREATE INDEX "Task_tenantId_idx" ON "Task"("tenantId");

-- CreateIndex
CREATE INDEX "Team_tenantId_idx" ON "Team"("tenantId");

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppSession_tenantId_key" ON "WhatsAppSession"("tenantId");

