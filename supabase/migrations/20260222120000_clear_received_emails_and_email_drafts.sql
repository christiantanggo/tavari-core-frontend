-- One-off: clear received emails and draft expenses from email so re-ingestion doesn't hit duplicates.
-- Run once to reset; remove or skip this migration if you don't want to wipe data.

-- 1. Delete draft expenses that came from email (so they don't reference emails we're about to delete)
DELETE FROM accounting_draft_expenses
WHERE source = 'email' OR received_email_id IS NOT NULL;

-- 2. Delete all received emails (CASCADE removes received_email_attachments)
DELETE FROM received_emails;
