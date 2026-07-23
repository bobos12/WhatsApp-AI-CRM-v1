-- Backfill BroadcastRecipient.tenantId from the owning Broadcast.
--
-- Recipients are written through a NESTED create (`recipients: { create: [...] }`)
-- in broadcasts.service.ts. The tenant guard in lib/prisma.ts only stamps the
-- top-level `data` of a create, so every recipient row written since the
-- multi-tenant migration landed with tenantId = NULL. Guarded queries inject
-- `where: { tenantId }` and matched none of them, which broke:
--
--   * per-recipient sent/failed markers (never persisted -> a resumed run would
--     message the whole audience a second time), and
--   * deleting a broadcast at all (the recipient deleteMany removed nothing, so
--     the parent delete died on the foreign key).
--
-- The service now stamps the child rows itself; this repairs the rows already on
-- disk. The parent broadcast is the authority — a recipient always belongs to
-- exactly the tenant that owns its campaign.
UPDATE "BroadcastRecipient" AS r
SET "tenantId" = b."tenantId"
FROM "Broadcast" AS b
WHERE r."broadcastId" = b."id"
  AND r."tenantId" IS DISTINCT FROM b."tenantId";
