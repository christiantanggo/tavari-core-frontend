-- Sub-categories: optional parent for expense categories (one level only)

ALTER TABLE accounting_expense_categories
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES accounting_expense_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_accounting_expense_categories_parent_id
  ON accounting_expense_categories(parent_id);

COMMENT ON COLUMN accounting_expense_categories.parent_id IS 'Parent category for sub-categories; NULL = top-level';
