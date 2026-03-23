-- Email system upgrade
-- 1) Anti-abuse verification/reset code protection
-- 2) Reusable learning email template + send logs for AI automation
-- Safe to run multiple times.

begin;

create table if not exists public.auth_email_code_state (
  email text not null,
  purpose text not null check (purpose in ('registration_verification', 'password_reset')),
  last_sent_at timestamptz,
  send_count_window integer not null default 0 check (send_count_window >= 0),
  send_window_started_at timestamptz,
  failed_attempt_count integer not null default 0 check (failed_attempt_count >= 0),
  failed_window_started_at timestamptz,
  blocked_until timestamptz,
  last_request_ip text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (email, purpose)
);

create table if not exists public.auth_email_code_challenges (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  purpose text not null check (purpose in ('registration_verification', 'password_reset')),
  code_hash text not null,
  status text not null default 'active' check (
    status in ('active', 'used', 'expired', 'superseded', 'blocked')
  ),
  invalid_attempt_count integer not null default 0 check (invalid_attempt_count >= 0),
  expires_at timestamptz not null,
  used_at timestamptz,
  request_ip text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_auth_email_code_active_one_per_email_purpose
  on public.auth_email_code_challenges (email, purpose)
  where status = 'active';

create index if not exists idx_auth_email_code_challenges_lookup
  on public.auth_email_code_challenges (email, purpose, status, created_at desc);

create index if not exists idx_auth_email_code_challenges_expiry
  on public.auth_email_code_challenges (expires_at, status);

create table if not exists public.auth_email_code_send_events (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  purpose text not null check (purpose in ('registration_verification', 'password_reset')),
  request_ip text,
  created_at timestamptz not null default now()
);

create index if not exists idx_auth_email_code_send_events_email
  on public.auth_email_code_send_events (email, purpose, created_at desc);

create index if not exists idx_auth_email_code_send_events_ip
  on public.auth_email_code_send_events (request_ip, created_at desc);

create table if not exists public.learning_email_templates (
  id uuid primary key default gen_random_uuid(),
  template_type text not null check (template_type in ('learning_nudge', 'weekly_digest')),
  learning_field_id uuid references public.learning_fields(id) on delete set null,
  level_band text,
  template_version integer not null default 1 check (template_version > 0),
  source_hash text not null,
  prompt_input_json jsonb not null default '{}'::jsonb,
  content_json jsonb not null default '{}'::jsonb,
  ai_provider text,
  ai_model text,
  ai_prompt_version text,
  ai_generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_learning_email_templates_dedupe
  on public.learning_email_templates (
    template_type,
    coalesce(learning_field_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(level_band, ''),
    source_hash
  );

create index if not exists idx_learning_email_templates_lookup
  on public.learning_email_templates (template_type, learning_field_id, created_at desc);

create table if not exists public.user_learning_email_sends (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  template_id uuid references public.learning_email_templates(id) on delete set null,
  template_type text not null check (template_type in ('learning_nudge', 'weekly_digest')),
  subject text not null,
  status text not null check (status in ('preview', 'sent', 'failed', 'skipped')),
  provider text,
  provider_message_id text,
  source_hash text,
  dispatch_context_json jsonb not null default '{}'::jsonb,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_learning_email_sends_user_created
  on public.user_learning_email_sends (user_id, created_at desc);

create index if not exists idx_user_learning_email_sends_type_created
  on public.user_learning_email_sends (template_type, created_at desc);

commit;
