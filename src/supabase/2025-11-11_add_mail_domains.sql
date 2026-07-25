create table if not exists mail_domains (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  domain_name text not null,
  status text not null default 'pending',
  verification_records jsonb not null default '{}'::jsonb,
  configuration_set text,
  inbound_rule_set text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (business_id, domain_name)
);

create index if not exists idx_mail_domains_business_id on mail_domains (business_id);
create index if not exists idx_mail_domains_status on mail_domains (status);

create or replace function update_mail_domains_updated_at()
returns trigger as $$
begin
  new.updated_at := timezone('utc', now());
  return new;
end;
$$ language plpgsql;

create trigger trg_mail_domains_updated_at
before update on mail_domains
for each row execute function update_mail_domains_updated_at();

alter table mail_domains enable row level security;

drop policy if exists "mail_domains_business_access" on mail_domains;
create policy "mail_domains_business_access" on mail_domains
  for all using (business_id = ((auth.jwt() ->> 'currentBusinessId')::uuid))
  with check (business_id = ((auth.jwt() ->> 'currentBusinessId')::uuid));
