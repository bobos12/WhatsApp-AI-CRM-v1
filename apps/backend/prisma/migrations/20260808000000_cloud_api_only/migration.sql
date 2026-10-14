-- Cloud API only: remove the unofficial WhatsApp Web (Baileys) transport.
--
-- Dropping WhatsAppSession destroys stored Baileys auth state. That is the
-- intent: those credentials are the session keys of an unofficial WhatsApp Web
-- client, they cannot be used by anything in this codebase any more, and keeping
-- a table of live WhatsApp session keys that nothing reads is a liability rather
-- than a backup. Contacts, conversations and message history are untouched.

-- The provider column had exactly two values and now has one.
ALTER TABLE "WhatsAppChannel" DROP COLUMN IF EXISTS "provider";
DROP INDEX IF EXISTS "WhatsAppChannel_provider_idx";
DROP TYPE IF EXISTS "MessagingProviderKind";

-- Baileys auth state. Nothing reads it after this migration.
DROP TABLE IF EXISTS "WhatsAppSession";
