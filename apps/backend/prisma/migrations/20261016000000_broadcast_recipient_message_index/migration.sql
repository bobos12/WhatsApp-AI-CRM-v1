-- Delivery receipts look up the campaign recipient by WhatsApp message id.
CREATE INDEX IF NOT EXISTS "BroadcastRecipient_messageId_idx" ON "BroadcastRecipient"("messageId");
