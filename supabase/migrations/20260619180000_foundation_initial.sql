-- Foundation app — Ontario math tutoring (foundation_* tables on TAVARI-CORE-DATABASE)

CREATE TABLE IF NOT EXISTS public.foundation_parent_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  mastery_threshold int NOT NULL DEFAULT 90 CHECK (mastery_threshold BETWEEN 50 AND 100),
  allow_helpers_on_facts boolean NOT NULL DEFAULT false,
  daily_session_minutes int NOT NULL DEFAULT 10 CHECK (daily_session_minutes BETWEEN 3 AND 30),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.foundation_children (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  age int NOT NULL CHECK (age BETWEEN 4 AND 18),
  grade int NOT NULL CHECK (grade BETWEEN 1 AND 8),
  display_grade int NOT NULL CHECK (display_grade BETWEEN 1 AND 8),
  style_pace text NOT NULL DEFAULT 'balanced' CHECK (style_pace IN ('explorer', 'balanced', 'driller')),
  style_support text NOT NULL DEFAULT 'independent' CHECK (style_support IN ('independent', 'tool-assisted')),
  style_hint_affinity text NOT NULL DEFAULT 'medium' CHECK (style_hint_affinity IN ('low', 'medium', 'high')),
  style_session_minutes int NOT NULL DEFAULT 10,
  style_completed boolean NOT NULL DEFAULT false,
  points int NOT NULL DEFAULT 0,
  streak int NOT NULL DEFAULT 0,
  last_practice_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.foundation_strand_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES public.foundation_children(id) ON DELETE CASCADE,
  strand text NOT NULL CHECK (strand IN ('operations', 'fluency', 'fractions', 'decimals')),
  working_grade int NOT NULL CHECK (working_grade BETWEEN 1 AND 8),
  working_band text NOT NULL DEFAULT 'warmup' CHECK (working_band IN ('warmup', 'core', 'stretch')),
  recent_correct int NOT NULL DEFAULT 0,
  recent_total int NOT NULL DEFAULT 0,
  UNIQUE (child_id, strand)
);

CREATE TABLE IF NOT EXISTS public.foundation_question_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id uuid NOT NULL REFERENCES public.foundation_children(id) ON DELETE CASCADE,
  strand text NOT NULL,
  grade int NOT NULL,
  question_key text NOT NULL,
  correct boolean NOT NULL,
  used_hint boolean NOT NULL DEFAULT false,
  used_helper boolean NOT NULL DEFAULT false,
  response_ms int,
  is_review_probe boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS foundation_children_parent_id_idx ON public.foundation_children (parent_id);
CREATE INDEX IF NOT EXISTS foundation_strand_progress_child_id_idx ON public.foundation_strand_progress (child_id);
CREATE INDEX IF NOT EXISTS foundation_question_log_child_id_idx ON public.foundation_question_log (child_id);

ALTER TABLE public.foundation_parent_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.foundation_children ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.foundation_strand_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.foundation_question_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "foundation_users_manage_own_settings" ON public.foundation_parent_settings;
CREATE POLICY "foundation_users_manage_own_settings"
  ON public.foundation_parent_settings FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "foundation_users_manage_own_children" ON public.foundation_children;
CREATE POLICY "foundation_users_manage_own_children"
  ON public.foundation_children FOR ALL
  USING (auth.uid() = parent_id)
  WITH CHECK (auth.uid() = parent_id);

DROP POLICY IF EXISTS "foundation_users_manage_own_strand_progress" ON public.foundation_strand_progress;
CREATE POLICY "foundation_users_manage_own_strand_progress"
  ON public.foundation_strand_progress FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.foundation_children c
      WHERE c.id = foundation_strand_progress.child_id AND c.parent_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.foundation_children c
      WHERE c.id = foundation_strand_progress.child_id AND c.parent_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "foundation_users_manage_own_question_log" ON public.foundation_question_log;
CREATE POLICY "foundation_users_manage_own_question_log"
  ON public.foundation_question_log FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.foundation_children c
      WHERE c.id = foundation_question_log.child_id AND c.parent_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.foundation_children c
      WHERE c.id = foundation_question_log.child_id AND c.parent_id = auth.uid()
    )
  );

NOTIFY pgrst, 'reload schema';
