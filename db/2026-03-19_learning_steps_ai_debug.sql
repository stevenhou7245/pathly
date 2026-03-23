-- Learning-steps AI observability and debug persistence patch.
-- Safe to run multiple times.

alter table if exists public.learning_steps
  add column if not exists generation_source text
  not null default 'database'
  check (generation_source in ('ai', 'fallback', 'database'));

create index if not exists idx_learning_steps_generation_source
  on public.learning_steps (user_learning_field_id, generation_source);

alter table if exists public.user_learning_fields
  add column if not exists generated_course_json jsonb;

alter table if exists public.user_learning_fields
  add column if not exists generated_course_source text
  check (generated_course_source in ('ai', 'fallback', 'database'));

alter table if exists public.user_learning_fields
  add column if not exists generated_course_at timestamptz;

create index if not exists idx_user_learning_fields_generated_source
  on public.user_learning_fields (generated_course_source, generated_course_at desc);
