-- Learning steps schema for per-user path content and resource links.
-- Safe to run multiple times.

create table if not exists public.learning_steps (
  id uuid primary key default gen_random_uuid(),
  user_learning_field_id uuid not null references public.user_learning_fields(id) on delete cascade,
  step_number integer not null check (step_number > 0),
  title text not null,
  summary text,
  resources_json jsonb not null default '[]'::jsonb,
  status text not null default 'locked' check (status in ('locked', 'current', 'completed')),
  generation_source text not null default 'database' check (generation_source in ('ai', 'fallback', 'database')),
  started_at timestamptz,
  completed_at timestamptz,
  source_hash text,
  artifact_version integer not null default 1,
  ai_provider text,
  ai_model text,
  ai_prompt_version text,
  ai_generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_learning_field_id, step_number)
);

create index if not exists idx_learning_steps_user_field
  on public.learning_steps (user_learning_field_id, step_number);

create index if not exists idx_learning_steps_status
  on public.learning_steps (user_learning_field_id, status);

create index if not exists idx_learning_steps_generation_source
  on public.learning_steps (user_learning_field_id, generation_source);

create index if not exists idx_learning_steps_generated_at
  on public.learning_steps (ai_generated_at desc);

create index if not exists idx_learning_steps_resources_gin
  on public.learning_steps using gin (resources_json);

create or replace function public.learning_steps_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_learning_steps_set_updated_at on public.learning_steps;
create trigger trg_learning_steps_set_updated_at
before update on public.learning_steps
for each row execute function public.learning_steps_set_updated_at();
