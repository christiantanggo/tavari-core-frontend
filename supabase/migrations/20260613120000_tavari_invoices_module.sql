-- Tavari Invoices — customer & business invoicing, summary invoices, Helcim pay links

INSERT INTO public.app_modules (module_key, module_name, description, icon, enabled_by_default, module_category)
VALUES (
  'invoices',
  'Tavari Invoices',
  'Send invoices, collect online payments, and build tax summary invoices from paid receipts and bookings',
  'FiFileText',
  false,
  'Sales'
)
ON CONFLICT (module_key) DO UPDATE SET
  module_name = EXCLUDED.module_name,
  description = EXCLUDED.description,
  icon = EXCLUDED.icon,
  module_category = EXCLUDED.module_category;

-- ---------------------------------------------------------------------------
-- Per-business invoice settings (defaults + overrides)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tavari_invoice_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL UNIQUE REFERENCES public.businesses(id) ON DELETE CASCADE,
  doing_business_as TEXT,
  address_override TEXT,
  city_override TEXT,
  state_override TEXT,
  postal_override TEXT,
  tax_number_override TEXT,
  default_logo_url TEXT,
  footer_terms TEXT NOT NULL DEFAULT 'Due on receipt',
  default_due_days INT NOT NULL DEFAULT 0 CHECK (default_due_days >= 0),
  e_transfer_password_hint TEXT NOT NULL DEFAULT 'Tanggo',
  reminder_schedule JSONB NOT NULL DEFAULT '[
    {"days_before_due": 0, "days_after_due": 3, "recipient": "both"},
    {"days_before_due": 0, "days_after_due": 7, "recipient": "both"},
    {"days_before_due": 0, "days_after_due": 14, "recipient": "both"}
  ]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tavari_invoice_settings_business
  ON public.tavari_invoice_settings (business_id);

-- ---------------------------------------------------------------------------
-- Invoices
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tavari_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  invoice_type TEXT NOT NULL DEFAULT 'standard'
    CHECK (invoice_type IN ('standard', 'summary')),
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'sent', 'viewed', 'partially_paid', 'paid', 'overdue', 'void', 'refunded')),
  recipient_type TEXT NOT NULL DEFAULT 'customer'
    CHECK (recipient_type IN ('customer', 'business')),
  loyalty_customer_id UUID REFERENCES public.pos_loyalty_accounts(id) ON DELETE SET NULL,
  recipient_name TEXT NOT NULL,
  recipient_email TEXT,
  recipient_phone TEXT,
  recipient_company TEXT,
  recipient_address TEXT,
  recipient_city TEXT,
  recipient_state TEXT,
  recipient_postal TEXT,
  display_legal_name TEXT,
  display_dba TEXT,
  display_address TEXT,
  display_city TEXT,
  display_state TEXT,
  display_postal TEXT,
  display_tax_number TEXT,
  logo_url TEXT,
  notes TEXT,
  footer_terms TEXT,
  due_date DATE,
  subtotal NUMERIC(12, 2) NOT NULL DEFAULT 0,
  tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total NUMERIC(12, 2) NOT NULL DEFAULT 0,
  balance_due NUMERIC(12, 2) NOT NULL DEFAULT 0,
  indian_status_gst_only BOOLEAN NOT NULL DEFAULT false,
  indian_status_certificate_number TEXT,
  pos_sale_id UUID REFERENCES public.pos_sales(id) ON DELETE SET NULL,
  stock_reserved BOOLEAN NOT NULL DEFAULT false,
  stock_released_at TIMESTAMPTZ,
  helcim_pending_id UUID,
  pay_token TEXT UNIQUE,
  first_sent_at TIMESTAMPTZ,
  last_sent_at TIMESTAMPTZ,
  email_opened_at TIMESTAMPTZ,
  pay_link_clicked_at TIMESTAMPTZ,
  voided_at TIMESTAMPTZ,
  voided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  void_reason TEXT,
  reissued_from_invoice_id UUID REFERENCES public.tavari_invoices(id) ON DELETE SET NULL,
  erpnext_sales_invoice_name TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, invoice_number)
);

CREATE INDEX IF NOT EXISTS idx_tavari_invoices_business_status
  ON public.tavari_invoices (business_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tavari_invoices_business_type
  ON public.tavari_invoices (business_id, invoice_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_tavari_invoices_loyalty_customer
  ON public.tavari_invoices (loyalty_customer_id)
  WHERE loyalty_customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tavari_invoices_pay_token
  ON public.tavari_invoices (pay_token)
  WHERE pay_token IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Line items (custom, inventory, bundle, or expanded from source transactions)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tavari_invoice_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.tavari_invoices(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  line_type TEXT NOT NULL DEFAULT 'custom'
    CHECK (line_type IN ('custom', 'inventory', 'bundle', 'source_receipt', 'source_booking')),
  inventory_id UUID REFERENCES public.pos_inventory(id) ON DELETE SET NULL,
  source_pos_sale_id UUID REFERENCES public.pos_sales(id) ON DELETE SET NULL,
  source_pos_sale_item_id UUID,
  source_booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,
  participant_name TEXT,
  name TEXT NOT NULL,
  description TEXT,
  quantity NUMERIC(12, 3) NOT NULL DEFAULT 1,
  unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  total_price NUMERIC(12, 2) NOT NULL DEFAULT 0,
  tax_exempt BOOLEAN NOT NULL DEFAULT false,
  tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tavari_invoice_line_items_invoice
  ON public.tavari_invoice_line_items (invoice_id, sort_order);

-- ---------------------------------------------------------------------------
-- Summary invoice source links (one receipt/booking per master invoice ever)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tavari_invoice_source_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.tavari_invoices(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('pos_sale', 'booking')),
  source_id UUID NOT NULL,
  display_label TEXT,
  amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
  transaction_date TIMESTAMPTZ,
  payment_method_summary TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (business_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS idx_tavari_invoice_source_links_invoice
  ON public.tavari_invoice_source_links (invoice_id);

-- ---------------------------------------------------------------------------
-- Reminder send log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tavari_invoice_reminder_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.tavari_invoices(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('customer', 'business')),
  recipient_email TEXT NOT NULL,
  schedule_key TEXT,
  mail_message_id TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tavari_invoice_reminder_log_invoice
  ON public.tavari_invoice_reminder_log (invoice_id, sent_at DESC);

-- ---------------------------------------------------------------------------
-- Refund linkage (pos_refunds created on refund; this tracks invoice association)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tavari_invoice_refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES public.tavari_invoices(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  pos_refund_id UUID REFERENCES public.pos_refunds(id) ON DELETE SET NULL,
  refund_amount NUMERIC(12, 2) NOT NULL,
  refund_reason TEXT,
  refunded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tavari_invoice_refunds_invoice
  ON public.tavari_invoice_refunds (invoice_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tavari_invoice_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tavari_invoice_settings_updated_at ON public.tavari_invoice_settings;
CREATE TRIGGER trg_tavari_invoice_settings_updated_at
  BEFORE UPDATE ON public.tavari_invoice_settings
  FOR EACH ROW EXECUTE FUNCTION public.tavari_invoice_touch_updated_at();

DROP TRIGGER IF EXISTS trg_tavari_invoices_updated_at ON public.tavari_invoices;
CREATE TRIGGER trg_tavari_invoices_updated_at
  BEFORE UPDATE ON public.tavari_invoices
  FOR EACH ROW EXECUTE FUNCTION public.tavari_invoice_touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tavari_invoice_is_business_member(p_business_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.business_users bu
    WHERE bu.business_id = p_business_id AND bu.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.business_id = p_business_id AND ur.user_id = auth.uid()
  );
$$;

ALTER TABLE public.tavari_invoice_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tavari_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tavari_invoice_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tavari_invoice_source_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tavari_invoice_reminder_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tavari_invoice_refunds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tavari_invoice_settings_select ON public.tavari_invoice_settings;
CREATE POLICY tavari_invoice_settings_select ON public.tavari_invoice_settings
  FOR SELECT USING (public.tavari_invoice_is_business_member(business_id));
DROP POLICY IF EXISTS tavari_invoice_settings_insert ON public.tavari_invoice_settings;
CREATE POLICY tavari_invoice_settings_insert ON public.tavari_invoice_settings
  FOR INSERT WITH CHECK (public.tavari_invoice_is_business_member(business_id));
DROP POLICY IF EXISTS tavari_invoice_settings_update ON public.tavari_invoice_settings;
CREATE POLICY tavari_invoice_settings_update ON public.tavari_invoice_settings
  FOR UPDATE USING (public.tavari_invoice_is_business_member(business_id));

DROP POLICY IF EXISTS tavari_invoices_select ON public.tavari_invoices;
CREATE POLICY tavari_invoices_select ON public.tavari_invoices
  FOR SELECT USING (public.tavari_invoice_is_business_member(business_id));
DROP POLICY IF EXISTS tavari_invoices_insert ON public.tavari_invoices;
CREATE POLICY tavari_invoices_insert ON public.tavari_invoices
  FOR INSERT WITH CHECK (public.tavari_invoice_is_business_member(business_id));
DROP POLICY IF EXISTS tavari_invoices_update ON public.tavari_invoices;
CREATE POLICY tavari_invoices_update ON public.tavari_invoices
  FOR UPDATE USING (public.tavari_invoice_is_business_member(business_id));
DROP POLICY IF EXISTS tavari_invoices_delete ON public.tavari_invoices;
CREATE POLICY tavari_invoices_delete ON public.tavari_invoices
  FOR DELETE USING (public.tavari_invoice_is_business_member(business_id));

DROP POLICY IF EXISTS tavari_invoice_line_items_all ON public.tavari_invoice_line_items;
CREATE POLICY tavari_invoice_line_items_all ON public.tavari_invoice_line_items
  FOR ALL USING (public.tavari_invoice_is_business_member(business_id))
  WITH CHECK (public.tavari_invoice_is_business_member(business_id));

DROP POLICY IF EXISTS tavari_invoice_source_links_all ON public.tavari_invoice_source_links;
CREATE POLICY tavari_invoice_source_links_all ON public.tavari_invoice_source_links
  FOR ALL USING (public.tavari_invoice_is_business_member(business_id))
  WITH CHECK (public.tavari_invoice_is_business_member(business_id));

DROP POLICY IF EXISTS tavari_invoice_reminder_log_select ON public.tavari_invoice_reminder_log;
CREATE POLICY tavari_invoice_reminder_log_select ON public.tavari_invoice_reminder_log
  FOR SELECT USING (public.tavari_invoice_is_business_member(business_id));
DROP POLICY IF EXISTS tavari_invoice_reminder_log_insert ON public.tavari_invoice_reminder_log;
CREATE POLICY tavari_invoice_reminder_log_insert ON public.tavari_invoice_reminder_log
  FOR INSERT WITH CHECK (public.tavari_invoice_is_business_member(business_id));

DROP POLICY IF EXISTS tavari_invoice_refunds_select ON public.tavari_invoice_refunds;
CREATE POLICY tavari_invoice_refunds_select ON public.tavari_invoice_refunds
  FOR SELECT USING (public.tavari_invoice_is_business_member(business_id));
DROP POLICY IF EXISTS tavari_invoice_refunds_insert ON public.tavari_invoice_refunds;
CREATE POLICY tavari_invoice_refunds_insert ON public.tavari_invoice_refunds
  FOR INSERT WITH CHECK (public.tavari_invoice_is_business_member(business_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tavari_invoice_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tavari_invoices TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tavari_invoice_line_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tavari_invoice_source_links TO authenticated;
GRANT SELECT, INSERT ON public.tavari_invoice_reminder_log TO authenticated;
GRANT SELECT, INSERT ON public.tavari_invoice_refunds TO authenticated;
