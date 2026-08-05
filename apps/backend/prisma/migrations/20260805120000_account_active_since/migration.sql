-- When the WhatsApp number itself started being used, as distinct from when it
-- was linked to this system.
--
-- Reading `WhatsAppSession.createdAt` as the account's age treats a number a
-- business has run for years as brand new the moment it is connected here, and
-- caps it at the new-account volume ceiling. That is a large, silent loss of
-- throughput for no safety gain: WhatsApp's scrutiny of a *newly linked device*
-- is real but narrow (cold reachout, error 463) and short-lived, while its trust
-- in the *number* is what actually governs volume.
ALTER TABLE "WhatsAppSession" ADD COLUMN IF NOT EXISTS "accountActiveSince" TIMESTAMP(3);

-- Seed from evidence already on disk: the oldest message we hold for a tenant is
-- a lower bound on how long that number has been in use. A conversation from two
-- months ago cannot have happened on a number that did not exist then.
UPDATE "WhatsAppSession" s
   SET "accountActiveSince" = sub."oldest"
  FROM (
        SELECT "tenantId", MIN("timestamp") AS "oldest"
          FROM "Message"
         GROUP BY "tenantId"
       ) sub
 WHERE s."tenantId" IS NOT DISTINCT FROM sub."tenantId"
   AND s."accountActiveSince" IS NULL
   AND sub."oldest" < s."createdAt";
