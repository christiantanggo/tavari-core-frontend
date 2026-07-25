create table if not exists scheduling_settings (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  shift_lead_enabled boolean default true,
  shift_lead_position text default 'Shift Lead',
  shift_lead_mode text not null default 'relative' check (shift_lead_mode in ('relative','fixed')),
  shift_lead_fixed_start time,
  shift_lead_grace_before_open integer default 0,
  shift_lead_grace_after_close integer default 0,
  shift_lead_excluded_positions text[] default array['President / CEO', 'Manager'],
  after_hours_enabled boolean default true,
  after_hours_position text default 'After Hours',
  after_hours_mode text not null default 'relative' check (after_hours_mode in ('relative','fixed')),
  after_hours_fixed_start time,
  after_hours_grace_after_close integer default 0,
  default_max_hours integer default 44,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (business_id)
);

create index if not exists idx_scheduling_settings_business_id on scheduling_settings (business_id);

create or replace function update_scheduling_settings_updated_at()
returns trigger as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_scheduling_settings_updated_at on scheduling_settings;
create trigger trg_scheduling_settings_updated_at
before update on scheduling_settings
for each row execute function update_scheduling_settings_updated_at();

alter table scheduling_settings enable row level security;

drop policy if exists "Allow managers select scheduling settings" on scheduling_settings;
create policy "Allow managers select scheduling settings"
on scheduling_settings for select
using (
  business_id in (
    select business_id from business_users
    where user_id = auth.uid()
      and role in ('owner','manager','admin')
  )
);

drop policy if exists "Allow managers upsert scheduling settings" on scheduling_settings;
create policy "Allow managers upsert scheduling settings"
on scheduling_settings for all
using (
  business_id in (
    select business_id from business_users
    where user_id = auth.uid()
      and role in ('owner','manager','admin')
  )
)
with check (
  business_id in (
    select business_id from business_users
    where user_id = auth.uid()
      and role in ('owner','manager','admin')
  )
);

