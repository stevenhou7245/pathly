-- Align journey_path_courses for AI-generated step content.
-- Safe and idempotent for existing deployments.

alter table if exists public.journey_path_courses
  alter column course_id drop not null;

alter table if exists public.journey_path_courses
  add column if not exists title text,
  add column if not exists description text,
  add column if not exists objective text,
  add column if not exists difficulty text,
  add column if not exists skill_tags jsonb not null default '[]'::jsonb,
  add column if not exists concept_tags jsonb not null default '[]'::jsonb;

create index if not exists idx_journey_path_courses_journey_step
  on public.journey_path_courses (journey_path_id, step_number);
