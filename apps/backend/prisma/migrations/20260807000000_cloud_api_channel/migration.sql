-- Cloud API channel: per-tenant provider selection, Meta credentials, template
-- review state, and per-conversation billing capture.
--
-- No data backfill is performed. A tenant with no WhatsAppChannel row reads as
-- "BAILEYS, unconfigured", which is exactly the behaviour before this migration,
-- so every existing tenant keeps sending through Baileys untouched. Rows are
-- created lazily the first time a tenant configures a channel.

-- ── Enums ───────────────────────────────────────────────────────────────────
CREATE TYPE "MessagingProviderKind" AS ENUM ('BAILEYS', 'CLOUD_API');
CREATE TYPE "ChannelQuality" AS ENUM ('UNKNOWN', 'GREEN', 'YELLOW', 'RED');

-- ── WhatsAppChannel ─────────────────────────────────────────────────────────
CREATE TABLE "WhatsAppChannel" (
    "id"                 TEXT NOT NULL,
    "tenantId"           TEXT,
    "provider"           "MessagingProviderKind" NOT NULL DEFAULT 'BAILEYS',
    "phoneNumberId"      TEXT,
    "wabaId"             TEXT,
    "businessId"         TEXT,
    "appId"              TEXT,
    "accessTokenEnc"     TEXT,
    "appSecretEnc"       TEXT,
    "displayPhoneNumber" TEXT,
    "verifiedName"       TEXT,
    "qualityRating"      "ChannelQuality" NOT NULL DEFAULT 'UNKNOWN',
    "messagingLimit"     TEXT,
    "restrictedUntil"    TIMESTAMP(3),
    "lastSyncedAt"       TIMESTAMP(3),
    "lastSyncError"      TEXT,
    "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsAppChannel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WhatsAppChannel_tenantId_key" ON "WhatsAppChannel"("tenantId");
-- The webhook routing key. Two tenants claiming one phone number id would send
-- every inbound message for it into whichever row was found first.
CREATE UNIQUE INDEX "WhatsAppChannel_phoneNumberId_key" ON "WhatsAppChannel"("phoneNumberId");
CREATE INDEX "WhatsAppChannel_provider_idx" ON "WhatsAppChannel"("provider");

-- ── MessageTemplate: Meta review state ──────────────────────────────────────
ALTER TABLE "MessageTemplate"
    ADD COLUMN "metaRejectedReason" TEXT,
    ADD COLUMN "metaSubmittedAt"    TIMESTAMP(3),
    ADD COLUMN "metaSyncedAt"       TIMESTAMP(3),
    ADD COLUMN "metaQualityScore"   TEXT;

-- Meta identifies a template by (name, language) inside a WABA, so the pair must
-- be unique per tenant before the constraint can be added. Existing duplicates
-- predate that rule: keep the oldest row's name and suffix the rest rather than
-- deleting anything, so no tenant silently loses a template.
WITH dupes AS (
    SELECT "id",
           ROW_NUMBER() OVER (
               PARTITION BY "tenantId", "name", "language"
               ORDER BY "createdAt", "id"
           ) AS rn
    FROM "MessageTemplate"
)
UPDATE "MessageTemplate" m
SET "name" = m."name" || '-' || d.rn
FROM dupes d
WHERE m."id" = d."id" AND d.rn > 1;

CREATE UNIQUE INDEX "MessageTemplate_tenantId_name_language_key"
    ON "MessageTemplate"("tenantId", "name", "language");
CREATE INDEX "MessageTemplate_metaStatus_idx" ON "MessageTemplate"("metaStatus");

-- ── Broadcast: the approved template a Cloud API campaign sends ─────────────
ALTER TABLE "Broadcast"
    ADD COLUMN "templateId"        TEXT,
    ADD COLUMN "templateVariables" JSONB;

ALTER TABLE "Broadcast"
    ADD CONSTRAINT "Broadcast_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Message: what Meta actually billed ──────────────────────────────────────
ALTER TABLE "Message"
    ADD COLUMN "metaConversationId"  TEXT,
    ADD COLUMN "metaPricingCategory" TEXT,
    ADD COLUMN "metaBillable"        BOOLEAN;
