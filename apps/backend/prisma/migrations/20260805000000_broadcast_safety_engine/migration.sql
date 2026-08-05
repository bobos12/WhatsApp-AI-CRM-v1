-- ═══════════════════════════════════════════════════════════════════════════════
-- Broadcast safety engine
--
-- Adds everything the redesigned broadcast module needs to keep a WhatsApp
-- Business number out of trouble: a suppression list, per-contact marketing
-- consent, a daily account-health rollup, per-campaign risk/pacing columns, and
-- per-recipient delivery forensics.
--
-- Every statement is IF NOT EXISTS / guarded so it is safe to run against a
-- database that was previously brought up with `prisma db push`.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── Contact: marketing consent ────────────────────────────────────────────────
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "marketingOptOut" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "optOutAt"        TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "optOutReason"    TEXT;
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "consentAt"       TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "consentSource"   TEXT;

-- ── Broadcast: risk, pacing, quiet hours, progressive rollout ─────────────────
ALTER TABLE "Broadcast" ADD COLUMN IF NOT EXISTS "riskScore"         INTEGER;
ALTER TABLE "Broadcast" ADD COLUMN IF NOT EXISTS "riskLevel"         TEXT;
ALTER TABLE "Broadcast" ADD COLUMN IF NOT EXISTS "preflight"         JSONB;
ALTER TABLE "Broadcast" ADD COLUMN IF NOT EXISTS "pacingProfile"     TEXT NOT NULL DEFAULT 'BALANCED';
ALTER TABLE "Broadcast" ADD COLUMN IF NOT EXISTS "throttlePerHour"   INTEGER;
ALTER TABLE "Broadcast" ADD COLUMN IF NOT EXISTS "quietHoursEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Broadcast" ADD COLUMN IF NOT EXISTS "quietHoursStart"   INTEGER NOT NULL DEFAULT 21;
ALTER TABLE "Broadcast" ADD COLUMN IF NOT EXISTS "quietHoursEnd"     INTEGER NOT NULL DEFAULT 9;
ALTER TABLE "Broadcast" ADD COLUMN IF NOT EXISTS "contentHash"       TEXT;
ALTER TABLE "Broadcast" ADD COLUMN IF NOT EXISTS "healthPausedAt"    TIMESTAMP(3);
ALTER TABLE "Broadcast" ADD COLUMN IF NOT EXISTS "healthPauseReason" TEXT;
ALTER TABLE "Broadcast" ADD COLUMN IF NOT EXISTS "variants"          JSONB;
ALTER TABLE "Broadcast" ADD COLUMN IF NOT EXISTS "pilotSize"         INTEGER;
ALTER TABLE "Broadcast" ADD COLUMN IF NOT EXISTS "pilotCompletedAt"  TIMESTAMP(3);
ALTER TABLE "Broadcast" ADD COLUMN IF NOT EXISTS "reviewedAt"        TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "Broadcast_tenantId_contentHash_idx" ON "Broadcast" ("tenantId", "contentHash");

-- ── BroadcastRecipient: delivery forensics ───────────────────────────────────
ALTER TABLE "BroadcastRecipient" ADD COLUMN IF NOT EXISTS "contactId"    TEXT;
ALTER TABLE "BroadcastRecipient" ADD COLUMN IF NOT EXISTS "tier"         TEXT;
ALTER TABLE "BroadcastRecipient" ADD COLUMN IF NOT EXISTS "sortOrder"    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BroadcastRecipient" ADD COLUMN IF NOT EXISTS "variantIndex" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BroadcastRecipient" ADD COLUMN IF NOT EXISTS "attempts"     INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "BroadcastRecipient" ADD COLUMN IF NOT EXISTS "errorCode"    TEXT;
ALTER TABLE "BroadcastRecipient" ADD COLUMN IF NOT EXISTS "lastError"    TEXT;
ALTER TABLE "BroadcastRecipient" ADD COLUMN IF NOT EXISTS "skipReason"   TEXT;
ALTER TABLE "BroadcastRecipient" ADD COLUMN IF NOT EXISTS "sentAt"       TIMESTAMP(3);
ALTER TABLE "BroadcastRecipient" ADD COLUMN IF NOT EXISTS "deliveredAt"  TIMESTAMP(3);
ALTER TABLE "BroadcastRecipient" ADD COLUMN IF NOT EXISTS "readAt"       TIMESTAMP(3);
ALTER TABLE "BroadcastRecipient" ADD COLUMN IF NOT EXISTS "repliedAt"    TIMESTAMP(3);
ALTER TABLE "BroadcastRecipient" ADD COLUMN IF NOT EXISTS "messageId"    TEXT;

CREATE INDEX IF NOT EXISTS "BroadcastRecipient_tenantId_phone_sentAt_idx"
  ON "BroadcastRecipient" ("tenantId", "phone", "sentAt");
CREATE INDEX IF NOT EXISTS "BroadcastRecipient_messageId_idx"
  ON "BroadcastRecipient" ("messageId");
CREATE INDEX IF NOT EXISTS "BroadcastRecipient_broadcastId_status_sortOrder_idx"
  ON "BroadcastRecipient" ("broadcastId", "status", "sortOrder");

-- Rows written before this migration are `sent`/`failed`/`pending` with no
-- timestamp. Backfill `sentAt` from the parent campaign so cooldown checks have
-- something to work with instead of treating every historical send as "never".
UPDATE "BroadcastRecipient" r
   SET "sentAt" = b."sentAt"
  FROM "Broadcast" b
 WHERE r."broadcastId" = b."id"
   AND r."status" = 'sent'
   AND r."sentAt" IS NULL
   AND b."sentAt" IS NOT NULL;

-- ── Suppression list ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "SuppressionEntry" (
  "id"        TEXT NOT NULL,
  "tenantId"  TEXT,
  "phone"     TEXT NOT NULL,
  "reason"    TEXT NOT NULL,
  "detail"    TEXT,
  "source"    TEXT,
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SuppressionEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "SuppressionEntry_tenantId_phone_key"
  ON "SuppressionEntry" ("tenantId", "phone");
CREATE INDEX IF NOT EXISTS "SuppressionEntry_tenantId_idx"
  ON "SuppressionEntry" ("tenantId");
CREATE INDEX IF NOT EXISTS "SuppressionEntry_tenantId_expiresAt_idx"
  ON "SuppressionEntry" ("tenantId", "expiresAt");

-- ── Daily account-health rollup ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "AccountHealthDay" (
  "id"                 TEXT NOT NULL,
  "tenantId"           TEXT,
  "date"               DATE NOT NULL,
  "broadcastSent"      INTEGER NOT NULL DEFAULT 0,
  "broadcastFailed"    INTEGER NOT NULL DEFAULT 0,
  "coldSent"           INTEGER NOT NULL DEFAULT 0,
  "hardBlocks"         INTEGER NOT NULL DEFAULT 0,
  "coldReachoutBlocks" INTEGER NOT NULL DEFAULT 0,
  "broadcastReplies"   INTEGER NOT NULL DEFAULT 0,
  "optOuts"            INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "AccountHealthDay_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AccountHealthDay_tenantId_date_key"
  ON "AccountHealthDay" ("tenantId", "date");
CREATE INDEX IF NOT EXISTS "AccountHealthDay_tenantId_date_idx"
  ON "AccountHealthDay" ("tenantId", "date");

-- ── Seed consent from behaviour ──────────────────────────────────────────────
-- A contact who has written to us at some point has, in WhatsApp's eyes, opened
-- a relationship. Recording that as implied consent means existing customers
-- aren't all scored as cold on day one of this feature.
UPDATE "Contact" c
   SET "consentAt" = sub."firstInbound",
       "consentSource" = 'inbound_message'
  FROM (
        SELECT co."contactId" AS contact_id, MIN(m."timestamp") AS "firstInbound"
          FROM "Message" m
          JOIN "Conversation" co ON co."id" = m."conversationId"
         WHERE m."fromMe" = false
         GROUP BY co."contactId"
       ) sub
 WHERE c."id" = sub.contact_id
   AND c."consentAt" IS NULL;
