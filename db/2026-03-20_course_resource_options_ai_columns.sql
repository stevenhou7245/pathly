-- Adds AI resource metadata columns requested by the Tavily + DeepSeek pipeline.
alter table if exists public.course_resource_options
  add column if not exists provider text,
  add column if not exists summary text,
  add column if not exists difficulty text,
  add column if not exists estimated_minutes integer,
  add column if not exists ai_selected boolean not null default true,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists ai_generated_at timestamptz;

create index if not exists idx_course_resource_options_course_option
  on public.course_resource_options (course_id, option_no);

create index if not exists idx_course_resource_options_ai_selected
  on public.course_resource_options (course_id, ai_selected);
