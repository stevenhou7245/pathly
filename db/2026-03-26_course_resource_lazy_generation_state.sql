-- Add lazy course resource generation tracking columns for fast journey skeleton creation.

alter table if exists public.courses
  add column if not exists resource_generation_status text;

alter table if exists public.courses
  add column if not exists is_resource_generated boolean;

alter table if exists public.courses
  add column if not exists resources_generated_at timestamptz;

update public.courses
set resource_generation_status = 'pending'
where resource_generation_status is null;

update public.courses
set is_resource_generated = false
where is_resource_generated is null;

with option_stats as (
  select
    course_id,
    count(*)::int as option_count,
    max(coalesce(ai_generated_at, created_at)) as latest_generated_at
  from public.course_resource_options
  group by course_id
)
update public.courses as c
set
  is_resource_generated = (option_stats.option_count > 0),
  resource_generation_status = case
    when option_stats.option_count > 0 then 'ready'
    when c.resource_generation_status = 'generating' then 'pending'
    when c.resource_generation_status = 'failed' then 'failed'
    else 'pending'
  end,
  resources_generated_at = case
    when option_stats.option_count > 0 then coalesce(c.resources_generated_at, option_stats.latest_generated_at)
    else null
  end
from option_stats
where option_stats.course_id = c.id;

update public.courses as c
set
  is_resource_generated = false,
  resource_generation_status = case
    when c.resource_generation_status in ('failed', 'generating') then c.resource_generation_status
    else 'pending'
  end,
  resources_generated_at = null
where not exists (
  select 1
  from public.course_resource_options cro
  where cro.course_id = c.id
);

update public.courses
set resource_generation_status = 'pending'
where resource_generation_status not in ('pending', 'generating', 'ready', 'failed');

alter table if exists public.courses
  alter column resource_generation_status set default 'pending';

alter table if exists public.courses
  alter column resource_generation_status set not null;

alter table if exists public.courses
  alter column is_resource_generated set default false;

alter table if exists public.courses
  alter column is_resource_generated set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'courses_resource_generation_status_check'
      and conrelid = 'public.courses'::regclass
  ) then
    alter table public.courses
      add constraint courses_resource_generation_status_check
      check (resource_generation_status in ('pending', 'generating', 'ready', 'failed'));
  end if;
end $$;

create index if not exists idx_courses_resource_generation_status
  on public.courses (resource_generation_status);
