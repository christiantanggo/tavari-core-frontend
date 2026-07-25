-- Booking Terms & Conditions packages (step-by-step acknowledgment + signature).

CREATE TABLE IF NOT EXISTS public.booking_terms_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_terms_packages_business
  ON public.booking_terms_packages (business_id, is_active);

CREATE TABLE IF NOT EXISTS public.booking_terms_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL REFERENCES public.booking_terms_packages(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  require_acknowledge BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_booking_terms_steps_package
  ON public.booking_terms_steps (package_id, step_order);

ALTER TABLE public.booking_activities
  ADD COLUMN IF NOT EXISTS terms_package_id UUID REFERENCES public.booking_terms_packages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_booking_activities_terms_package
  ON public.booking_activities (terms_package_id)
  WHERE terms_package_id IS NOT NULL;

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS terms_package_id UUID REFERENCES public.booking_terms_packages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS terms_status TEXT NOT NULL DEFAULT 'not_required'
    CHECK (terms_status IN ('not_required', 'pending', 'signed')),
  ADD COLUMN IF NOT EXISTS terms_ack_token TEXT,
  ADD COLUMN IF NOT EXISTS terms_signed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS terms_signature_data JSONB,
  ADD COLUMN IF NOT EXISTS terms_signer_name TEXT,
  ADD COLUMN IF NOT EXISTS terms_signed_ip TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_terms_ack_token
  ON public.bookings (terms_ack_token)
  WHERE terms_ack_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_terms_status
  ON public.bookings (business_id, terms_status)
  WHERE terms_status = 'pending';

CREATE TABLE IF NOT EXISTS public.booking_terms_acknowledgments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  package_id UUID NOT NULL REFERENCES public.booking_terms_packages(id) ON DELETE CASCADE,
  step_id UUID REFERENCES public.booking_terms_steps(id) ON DELETE SET NULL,
  step_order INTEGER NOT NULL DEFAULT 0,
  step_title_snapshot TEXT NOT NULL,
  step_body_snapshot TEXT NOT NULL DEFAULT '',
  acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (booking_id, step_order)
);

CREATE INDEX IF NOT EXISTS idx_booking_terms_acknowledgments_booking
  ON public.booking_terms_acknowledgments (booking_id);

ALTER TABLE public.booking_terms_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_terms_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_terms_acknowledgments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS booking_terms_packages_select_business ON public.booking_terms_packages;
CREATE POLICY booking_terms_packages_select_business
  ON public.booking_terms_packages FOR SELECT
  USING (
    is_active = true
    OR EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = booking_terms_packages.business_id
        AND bu.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS booking_terms_packages_write_managers ON public.booking_terms_packages;
CREATE POLICY booking_terms_packages_write_managers
  ON public.booking_terms_packages FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = booking_terms_packages.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('manager', 'owner')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = booking_terms_packages.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('manager', 'owner')
    )
  );

DROP POLICY IF EXISTS booking_terms_steps_select_business ON public.booking_terms_steps;
CREATE POLICY booking_terms_steps_select_business
  ON public.booking_terms_steps FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.booking_terms_packages p
      WHERE p.id = booking_terms_steps.package_id
        AND (
          p.is_active = true
          OR EXISTS (
            SELECT 1 FROM public.business_users bu
            WHERE bu.business_id = p.business_id
              AND bu.user_id = auth.uid()
          )
        )
    )
  );

DROP POLICY IF EXISTS booking_terms_steps_write_managers ON public.booking_terms_steps;
CREATE POLICY booking_terms_steps_write_managers
  ON public.booking_terms_steps FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = booking_terms_steps.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('manager', 'owner')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = booking_terms_steps.business_id
        AND bu.user_id = auth.uid()
        AND bu.role IN ('manager', 'owner')
    )
  );

DROP POLICY IF EXISTS booking_terms_acknowledgments_select_business ON public.booking_terms_acknowledgments;
CREATE POLICY booking_terms_acknowledgments_select_business
  ON public.booking_terms_acknowledgments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.business_users bu
      WHERE bu.business_id = booking_terms_acknowledgments.business_id
        AND bu.user_id = auth.uid()
    )
  );

CREATE OR REPLACE FUNCTION public.update_booking_terms_packages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_booking_terms_packages_updated_at ON public.booking_terms_packages;
CREATE TRIGGER trigger_update_booking_terms_packages_updated_at
  BEFORE UPDATE ON public.booking_terms_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_booking_terms_packages_updated_at();

CREATE OR REPLACE FUNCTION public.update_booking_terms_steps_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_booking_terms_steps_updated_at ON public.booking_terms_steps;
CREATE TRIGGER trigger_update_booking_terms_steps_updated_at
  BEFORE UPDATE ON public.booking_terms_steps
  FOR EACH ROW
  EXECUTE FUNCTION public.update_booking_terms_steps_updated_at();

COMMENT ON TABLE public.booking_terms_packages IS
  'Reusable booking Terms & Conditions packages that can be attached to any activity.';
COMMENT ON COLUMN public.bookings.terms_status IS
  'not_required | pending | signed — approval is blocked while pending when a package is attached.';
COMMENT ON COLUMN public.bookings.terms_ack_token IS
  'Public token for customer T&C acknowledgment flow.';
