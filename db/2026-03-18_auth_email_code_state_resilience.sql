-- Resilience migration for auth_email_code_state
-- Safe to run multiple times.

begin;

create table if not exists public.auth_email_code_state (
  email text not null,
  purpose text not null,
  last_sent_at timestamptz,
  failed_attempt_count integer not null default 0,
  failed_window_started_at timestamptz,
  blocked_until timestamptz
);

alter table public.auth_email_code_state
  add column if not exists send_count_window integer not null default 0;

alter table public.auth_email_code_state
  add column if not exists send_window_started_at timestamptz;

alter table public.auth_email_code_state
  add column if not exists last_request_ip text;

alter table public.auth_email_code_state
  add column if not exists created_at timestamptz not null default now();

alter table public.auth_email_code_state
  add column if not exists updated_at timestamptz not null default now();

alter table public.auth_email_code_state
  alter column failed_attempt_count set default 0;

update public.auth_email_code_state
set failed_attempt_count = 0
where failed_attempt_count is null;

alter table public.auth_email_code_state
  alter column failed_attempt_count set not null;

create index if not exists idx_auth_email_code_state_email
  on public.auth_email_code_state (email);

create unique index if not exists uq_auth_email_code_state_email_purpose
  on public.auth_email_code_state (email, purpose);

commit;

