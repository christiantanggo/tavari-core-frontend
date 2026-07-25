-- Remove duplicate expense categories created by the concurrent-mount race condition.
-- Keeps the oldest row (lowest created_at, then smallest ctid) for each (business_id, name) pair.
DELETE FROM accounting_expense_categories
WHERE ctid NOT IN (
  SELECT MIN(ctid)
  FROM accounting_expense_categories
  GROUP BY business_id, name
);
