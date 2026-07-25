-- Custom calendar event types per household (label + color); events.event_type stores slug.

CREATE TABLE IF NOT EXISTS public.pullcoparent_event_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id uuid NOT NULL REFERENCES public.pullcoparent_households(id) ON DELETE CASCADE,
  slug text NOT NULL,
  label text NOT NULL,
  color text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pullcoparent_event_types_slug_format CHECK (slug ~ '^[a-z0-9_]+$'),
  CONSTRAINT pullcoparent_event_types_color_format CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
  CONSTRAINT pullcoparent_event_types_household_slug_unique UNIQUE (household_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_pullcoparent_event_types_household
  ON public.pullcoparent_event_types (household_id, sort_order);

DROP TRIGGER IF EXISTS trg_pullcoparent_event_types_updated_at ON public.pullcoparent_event_types;
CREATE TRIGGER trg_pullcoparent_event_types_updated_at
BEFORE UPDATE ON public.pullcoparent_event_types
FOR EACH ROW EXECUTE FUNCTION public.pullcoparent_touch_updated_at();

ALTER TABLE public.pullcoparent_event_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pullcoparent_event_types_all_member ON public.pullcoparent_event_types;
CREATE POLICY pullcoparent_event_types_all_member ON public.pullcoparent_event_types
  FOR ALL TO authenticated
  USING (public.pullcoparent_is_household_member(household_id))
  WITH CHECK (public.pullcoparent_is_household_member(household_id));

-- Allow any slug on events (custom types per household).
ALTER TABLE public.pullcoparent_events
  DROP CONSTRAINT IF EXISTS pullcoparent_events_event_type_check;

-- Seed defaults for existing households.
INSERT INTO public.pullcoparent_event_types (household_id, slug, label, color, sort_order)
SELECT h.id, d.slug, d.label, d.color, d.sort_order
FROM public.pullcoparent_households h
CROSS JOIN (
  VALUES
    ('custody', 'Custody', '#6366F1', 0),
    ('handoff', 'Handoff', '#0EA5E9', 1),
    ('appointment', 'Appointment', '#14B8A6', 2),
    ('other', 'Other', '#94A3B8', 3)
) AS d(slug, label, color, sort_order)
ON CONFLICT (household_id, slug) DO NOTHING;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pullcoparent_event_types TO authenticated;
