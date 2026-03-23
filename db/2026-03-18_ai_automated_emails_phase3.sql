-- AI automated emails phase 3
-- Safe to run multiple times.

begin;

create table if not exists public.automated_learning_email_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  email_type text not null check (
    email_type in (
      'learning_reminder',
      'comeback_inactivity',
      'milestone',
      'review_reminder'
    )
  ),
  context_hash text not null,
  status text not null check (status in ('preview', 'sent', 'failed', 'skipped')),
  subject text,
  provider text,
  provider_message_id text,
  details_json jsonb not null default '{}'::jsonb,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_automated_learning_email_events_dedupe
  on public.automated_learning_email_events (user_id, email_type, context_hash);

create index if not exists idx_automated_learning_email_events_user_created
  on public.automated_learning_email_events (user_id, created_at desc);

create index if not exists idx_automated_learning_email_events_type_status_created
  on public.automated_learning_email_events (email_type, status, created_at desc);

alter table public.learning_email_templates
  drop constraint if exists learning_email_templates_template_type_check;

alter table public.learning_email_templates
  add constraint learning_email_templates_template_type_check
  check (
    template_type in (
      'learning_nudge',
      'weekly_digest',
      'learning_reminder',
      'comeback_inactivity',
      'milestone',
      'review_reminder'
    )
  );

alter table public.user_learning_email_sends
  drop constraint if exists user_learning_email_sends_template_type_check;

alter table public.user_learning_email_sends
  add constraint user_learning_email_sends_template_type_check
  check (
    template_type in (
      'learning_nudge',
      'weekly_digest',
      'learning_reminder',
      'comeback_inactivity',
      'milestone',
      'review_reminder'
    )
  );

commit;
