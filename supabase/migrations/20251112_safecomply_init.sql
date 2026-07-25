-- SafeComply initial schema
create extension if not exists "pgcrypto";

create table if not exists public.jhsc_host_businesses (
  id uuid primary key default gen_random_uuid(),
  tavari_business_id uuid references public.businesses(id),
  platform text not null default 'safecomply',
  name text not null,
  industry text,
  contact_name text,
  contact_email text,
  contact_phone text,
  wsib_required boolean not null default true,
  wsib_number text,
  plan_tier text not null default 'basic',
  status text not null default 'active' check (status in ('active','paused','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.jhsc_locations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.jhsc_host_businesses(id) on delete cascade,
  name text not null,
  address_line1 text,
  address_line2 text,
  city text,
  province text,
  postal_code text,
  country text default 'Canada',
  qr_slug text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.jhsc_business_users (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.jhsc_host_businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('employer_admin','management_rep','worker_rep')),
  status text not null default 'active' check (status in ('active','invited','disabled')),
  setup_complete boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, user_id)
);

create table if not exists public.jhsc_contract_reps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('manager','worker')),
  certification_url text,
  certification_expires_on date,
  hourly_rate numeric(10,2),
  status text not null default 'active' check (status in ('active','inactive','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

create table if not exists public.jhsc_assignments (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.jhsc_locations(id) on delete cascade,
  rep_id uuid not null references public.jhsc_contract_reps(id) on delete cascade,
  assignment_type text not null default 'standard' check (assignment_type in ('standard','backup','special')),
  start_date date not null default current_date,
  end_date date,
  status text not null default 'active' check (status in ('active','paused','ended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (location_id, rep_id, status)
);

create table if not exists public.jhsc_inspections (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.jhsc_locations(id) on delete cascade,
  form_version text,
  conducted_by uuid references public.jhsc_contract_reps(id),
  scheduled_for timestamptz,
  completed_at timestamptz,
  data_json jsonb not null default '{}'::jsonb,
  attachments jsonb not null default '[]'::jsonb,
  employer_status text not null default 'pending' check (employer_status in ('pending','approved','rejected')),
  employer_signed_by uuid references auth.users(id),
  employer_signed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.jhsc_meetings (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.jhsc_locations(id) on delete cascade,
  meeting_date date not null,
  conducted_by uuid references public.jhsc_contract_reps(id),
  agenda_json jsonb not null default '[]'::jsonb,
  minutes_url text,
  attendance_json jsonb not null default '[]'::jsonb,
  employer_status text not null default 'pending' check (employer_status in ('pending','approved','rejected')),
  employer_signed_by uuid references auth.users(id),
  employer_signed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.jhsc_hazards (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.jhsc_locations(id) on delete cascade,
  submitted_by_type text not null check (submitted_by_type in ('employee','rep','employer')),
  submitted_by uuid references auth.users(id),
  description text not null,
  severity text not null default 'medium' check (severity in ('low','medium','high','critical')),
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open','in_progress','for_review','resolved','archived')),
  deadline_at timestamptz,
  escalated_at timestamptz,
  resolved_at timestamptz,
  resolution_notes text,
  publish_state text not null default 'draft' check (publish_state in ('draft','published','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.jhsc_hazard_updates (
  id uuid primary key default gen_random_uuid(),
  hazard_id uuid not null references public.jhsc_hazards(id) on delete cascade,
  author_type text not null check (author_type in ('employer','rep','worker','hq')),
  author_id uuid references auth.users(id),
  update_type text not null default 'comment' check (update_type in ('comment','status_change','note')),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.jhsc_board_items (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.jhsc_locations(id) on delete cascade,
  item_type text not null check (item_type in ('inspection','meeting','hazard','announcement','policy','report')),
  source_id uuid,
  title text not null,
  description text,
  file_url text,
  published_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.jhsc_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_type text not null check (recipient_type in ('employer','management_rep','worker_rep','rep','hq')),
  recipient_id uuid,
  channel text not null check (channel in ('email','sms','in_app')),
  template_id text not null,
  subject text,
  payload jsonb not null default '{}'::jsonb,
  sent_at timestamptz,
  status text not null default 'queued' check (status in ('queued','sent','failed')),
  error_message text,
  created_at timestamptz not null default now()
);

create table if not exists public.jhsc_reports (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.jhsc_host_businesses(id) on delete cascade,
  report_type text not null,
  period_start date not null,
  period_end date not null,
  file_url text not null,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.jhsc_compliance_scores (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.jhsc_host_businesses(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  score_total numeric(5,2) not null,
  breakdown jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.jhsc_audit_logs (
  id bigint generated always as identity primary key,
  business_id uuid references public.jhsc_host_businesses(id) on delete set null,
  actor_type text not null check (actor_type in ('hq','employer','rep','system')),
  actor_id uuid,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.jhsc_qr_access_log (
  id bigint generated always as identity primary key,
  location_id uuid not null references public.jhsc_locations(id) on delete cascade,
  ip_hash text,
  user_agent text,
  accessed_at timestamptz not null default now()
);

-- Indexes
create index if not exists idx_jhsc_locations_business on public.jhsc_locations (business_id);
create index if not exists idx_jhsc_business_users_user on public.jhsc_business_users (user_id);
create index if not exists idx_jhsc_assignments_location on public.jhsc_assignments (location_id);
create index if not exists idx_jhsc_assignments_rep on public.jhsc_assignments (rep_id);
create index if not exists idx_jhsc_inspections_status on public.jhsc_inspections (employer_status);
create index if not exists idx_jhsc_meetings_date on public.jhsc_meetings (meeting_date);
create index if not exists idx_jhsc_hazards_deadline on public.jhsc_hazards (deadline_at) where status <> 'archived';
create index if not exists idx_jhsc_board_items_location on public.jhsc_board_items (location_id, item_type);
create index if not exists idx_jhsc_notifications_recipient on public.jhsc_notifications (recipient_type, recipient_id);
create index if not exists idx_jhsc_reports_business on public.jhsc_reports (business_id, period_start, period_end);
create index if not exists idx_jhsc_compliance_scores_business on public.jhsc_compliance_scores (business_id, period_start, period_end);

-- extend shared tables with platform awareness
alter table if exists public.businesses
  add column if not exists platform text not null default 'tavari';

alter table if exists public.scheduling_shifts
  add column if not exists platform text not null default 'tavari';

alter table if exists public.scheduling_time_clocks
  add column if not exists platform text not null default 'tavari';

alter table if exists public.hrpayroll_entries
  add column if not exists platform text not null default 'tavari';

create index if not exists idx_businesses_platform on public.businesses (platform);
create index if not exists idx_scheduling_shifts_platform on public.scheduling_shifts (platform);
create index if not exists idx_scheduling_time_clocks_platform on public.scheduling_time_clocks (platform);
create index if not exists idx_hrpayroll_entries_platform on public.hrpayroll_entries (platform);

-- enable RLS on SafeComply tables (specific policies will be refined during integration)
alter table if exists public.jhsc_host_businesses enable row level security;
alter table if exists public.jhsc_locations enable row level security;
alter table if exists public.jhsc_business_users enable row level security;
alter table if exists public.jhsc_contract_reps enable row level security;
alter table if exists public.jhsc_assignments enable row level security;
alter table if exists public.jhsc_inspections enable row level security;
alter table if exists public.jhsc_meetings enable row level security;
alter table if exists public.jhsc_hazards enable row level security;
alter table if exists public.jhsc_hazard_updates enable row level security;
alter table if exists public.jhsc_board_items enable row level security;
alter table if exists public.jhsc_notifications enable row level security;
alter table if exists public.jhsc_reports enable row level security;
alter table if exists public.jhsc_compliance_scores enable row level security;
alter table if exists public.jhsc_audit_logs enable row level security;
alter table if exists public.jhsc_qr_access_log enable row level security;

DO $$ BEGIN
  CREATE POLICY "service role access jhsc_host_businesses" ON public.jhsc_host_businesses FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "service role access jhsc_locations" ON public.jhsc_locations FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "service role access jhsc_business_users" ON public.jhsc_business_users FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "service role access jhsc_contract_reps" ON public.jhsc_contract_reps FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "service role access jhsc_assignments" ON public.jhsc_assignments FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "service role access jhsc_inspections" ON public.jhsc_inspections FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "service role access jhsc_meetings" ON public.jhsc_meetings FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "service role access jhsc_hazards" ON public.jhsc_hazards FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "service role access jhsc_hazard_updates" ON public.jhsc_hazard_updates FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "service role access jhsc_board_items" ON public.jhsc_board_items FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "service role access jhsc_notifications" ON public.jhsc_notifications FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "service role access jhsc_reports" ON public.jhsc_reports FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "service role access jhsc_compliance_scores" ON public.jhsc_compliance_scores FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "service role access jhsc_audit_logs" ON public.jhsc_audit_logs FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "service role access jhsc_qr_access_log" ON public.jhsc_qr_access_log FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


