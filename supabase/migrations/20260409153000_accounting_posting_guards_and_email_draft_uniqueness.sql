-- Prevent duplicate email draft expenses and allow a transient posting status
-- so edge functions can claim a record before writing to ERPNext.

ALTER TABLE accounting_draft_expenses
  DROP CONSTRAINT IF EXISTS accounting_draft_expenses_status_check;

ALTER TABLE accounting_draft_expenses
  ADD CONSTRAINT accounting_draft_expenses_status_check
  CHECK (status IN ('draft', 'approved', 'posting', 'posted'));

ALTER TABLE accounting_sales_batches
  DROP CONSTRAINT IF EXISTS accounting_sales_batches_status_check;

ALTER TABLE accounting_sales_batches
  ADD CONSTRAINT accounting_sales_batches_status_check
  CHECK (status IN ('draft', 'approved', 'posting', 'posted'));

ALTER TABLE accounting_deposits
  DROP CONSTRAINT IF EXISTS accounting_deposits_status_check;

ALTER TABLE accounting_deposits
  ADD CONSTRAINT accounting_deposits_status_check
  CHECK (status IN ('draft', 'approved', 'posting', 'posted'));

WITH ranked_email_drafts AS (
  SELECT
    id,
    business_id,
    received_email_id,
    attachment_id,
    ROW_NUMBER() OVER (
      PARTITION BY business_id, received_email_id, attachment_id
      ORDER BY
        CASE
          WHEN erpnext_journal_entry_id IS NOT NULL THEN 0
          WHEN status = 'posted' THEN 1
          WHEN status = 'approved' THEN 2
          WHEN status = 'posting' THEN 3
          ELSE 4
        END,
        created_at ASC,
        id ASC
    ) AS row_rank
  FROM accounting_draft_expenses
  WHERE source = 'email'
    AND received_email_id IS NOT NULL
    AND attachment_id IS NOT NULL
),
duplicate_map AS (
  SELECT dup.id AS duplicate_id, keeper.id AS keep_id
  FROM ranked_email_drafts dup
  JOIN ranked_email_drafts keeper
    ON keeper.business_id = dup.business_id
   AND keeper.received_email_id = dup.received_email_id
   AND keeper.attachment_id = dup.attachment_id
   AND keeper.row_rank = 1
  WHERE dup.row_rank > 1
)
UPDATE accounting_bank_transactions tx
SET matched_draft_expense_id = dm.keep_id
FROM duplicate_map dm
WHERE tx.matched_draft_expense_id = dm.duplicate_id;

WITH ranked_email_drafts AS (
  SELECT
    id,
    business_id,
    received_email_id,
    attachment_id,
    ROW_NUMBER() OVER (
      PARTITION BY business_id, received_email_id, attachment_id
      ORDER BY
        CASE
          WHEN erpnext_journal_entry_id IS NOT NULL THEN 0
          WHEN status = 'posted' THEN 1
          WHEN status = 'approved' THEN 2
          WHEN status = 'posting' THEN 3
          ELSE 4
        END,
        created_at ASC,
        id ASC
    ) AS row_rank
  FROM accounting_draft_expenses
  WHERE source = 'email'
    AND received_email_id IS NOT NULL
    AND attachment_id IS NOT NULL
),
duplicate_map AS (
  SELECT dup.id AS duplicate_id, keeper.id AS keep_id
  FROM ranked_email_drafts dup
  JOIN ranked_email_drafts keeper
    ON keeper.business_id = dup.business_id
   AND keeper.received_email_id = dup.received_email_id
   AND keeper.attachment_id = dup.attachment_id
   AND keeper.row_rank = 1
  WHERE dup.row_rank > 1
)
DELETE FROM accounting_bank_transaction_draft_matches m
USING duplicate_map dm
WHERE m.draft_expense_id = dm.duplicate_id
  AND EXISTS (
    SELECT 1
    FROM accounting_bank_transaction_draft_matches existing
    WHERE existing.bank_transaction_id = m.bank_transaction_id
      AND existing.draft_expense_id = dm.keep_id
  );

WITH ranked_email_drafts AS (
  SELECT
    id,
    business_id,
    received_email_id,
    attachment_id,
    ROW_NUMBER() OVER (
      PARTITION BY business_id, received_email_id, attachment_id
      ORDER BY
        CASE
          WHEN erpnext_journal_entry_id IS NOT NULL THEN 0
          WHEN status = 'posted' THEN 1
          WHEN status = 'approved' THEN 2
          WHEN status = 'posting' THEN 3
          ELSE 4
        END,
        created_at ASC,
        id ASC
    ) AS row_rank
  FROM accounting_draft_expenses
  WHERE source = 'email'
    AND received_email_id IS NOT NULL
    AND attachment_id IS NOT NULL
),
duplicate_map AS (
  SELECT dup.id AS duplicate_id, keeper.id AS keep_id
  FROM ranked_email_drafts dup
  JOIN ranked_email_drafts keeper
    ON keeper.business_id = dup.business_id
   AND keeper.received_email_id = dup.received_email_id
   AND keeper.attachment_id = dup.attachment_id
   AND keeper.row_rank = 1
  WHERE dup.row_rank > 1
)
UPDATE accounting_bank_transaction_draft_matches m
SET draft_expense_id = dm.keep_id
FROM duplicate_map dm
WHERE m.draft_expense_id = dm.duplicate_id;

WITH ranked_email_drafts AS (
  SELECT
    id,
    business_id,
    received_email_id,
    attachment_id,
    ROW_NUMBER() OVER (
      PARTITION BY business_id, received_email_id, attachment_id
      ORDER BY
        CASE
          WHEN erpnext_journal_entry_id IS NOT NULL THEN 0
          WHEN status = 'posted' THEN 1
          WHEN status = 'approved' THEN 2
          WHEN status = 'posting' THEN 3
          ELSE 4
        END,
        created_at ASC,
        id ASC
    ) AS row_rank
  FROM accounting_draft_expenses
  WHERE source = 'email'
    AND received_email_id IS NOT NULL
    AND attachment_id IS NOT NULL
)
DELETE FROM accounting_draft_expenses d
USING ranked_email_drafts ranked
WHERE d.id = ranked.id
  AND ranked.row_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_accounting_email_drafts_unique_attachment
  ON accounting_draft_expenses (business_id, received_email_id, attachment_id)
  WHERE source = 'email'
    AND received_email_id IS NOT NULL
    AND attachment_id IS NOT NULL;
