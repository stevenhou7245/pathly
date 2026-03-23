-- Storage alignment for email auth codes.
-- Keeps legacy email_verification_codes untouched.
-- Safe to run multiple times.

begin;

create extension if not exists pgcrypto;

create table if not exists public.auth_email_code_state (
  email text not null,
  purpose text not null,
  last_sent_at timestamptz null,
  failed_attempt_count integer not null default 0,
  failed_window_started_at timestamptz null,
  blocked_until timestamptz null,
  primary key (email, purpose)
);

alter table public.auth_email_code_state
  add column if not exists email text;

alter table public.auth_email_code_state
  add column if not exists purpose text;

alter table public.auth_email_code_state
  add column if not exists last_sent_at timestamptz null;

alter table public.auth_email_code_state
  add column if not exists failed_attempt_count integer not null default 0;

alter table public.auth_email_code_state
  add column if not exists failed_window_started_at timestamptz null;

alter table public.auth_email_code_state
  add column if not exists blocked_until timestamptz null;

create table if not exists public.auth_email_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  purpose text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  superseded_at timestamptz null,
  consumed_at timestamptz null,
  request_ip text null
);

alter table public.auth_email_codes
  add column if not exists email text;

alter table public.auth_email_codes
  add column if not exists purpose text;

alter table public.auth_email_codes
  add column if not exists code_hash text;

alter table public.auth_email_codes
  add column if not exists expires_at timestamptz;

alter table public.auth_email_codes
  add column if not exists created_at timestamptz not null default now();

alter table public.auth_email_codes
  add column if not exists superseded_at timestamptz null;

alter table public.auth_email_codes
  add column if not exists consumed_at timestamptz null;

alter table public.auth_email_codes
  add column if not exists request_ip text null;

create index if not exists idx_auth_email_codes_email_purpose
  on public.auth_email_codes (email, purpose);

create index if not exists idx_auth_email_codes_active
  on public.auth_email_codes (email, purpose, created_at desc)
  where superseded_at is null and consumed_at is null;

commit;

