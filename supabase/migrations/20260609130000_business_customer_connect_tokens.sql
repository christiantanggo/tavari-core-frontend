-- Parent QR connect tokens (OTWK app) — stored in Tavari per business + customer.

CREATE TABLE IF NOT EXISTS public.business_customer_connect_tokens (
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL,
  token text NOT NULL,
  display_name text NOT NULL DEFAULT 'Parent',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (business_id, customer_id),
  CONSTRAINT business_customer_connect_tokens_token_unique UNIQUE (token)
);

CREATE INDEX IF NOT EXISTS idx_business_customer_connect_tokens_token
  ON public.business_customer_connect_tokens (token);

ALTER TABLE public.business_customer_connect_tokens ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.business_customer_connect_tokens IS
  'OTWK app parent QR connect codes; customer_id is Tavari pos_customers.id';
