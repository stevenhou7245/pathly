-- Pathly journey schema alignment patch
-- Safe to run multiple times.

begin;

-- 1) Core mismatch from runtime error
alter table if exists public.journey_path_courses
  add column if not exists is_required boolean not null default true;

-- Keep journey_path_courses aligned with backend select/insert usage
alter table if exists public.journey_path_courses
  add column if not exists created_at timestamptz not null default now();

-- 2) Other journey columns referenced by backend
alter table if exists public.course_resources
  add column if not exists display_order integer;

alter table if exists public.course_resources
  add column if not exists is_active boolean not null default true;

alter table if exists public.course_resources
  add column if not exists created_at timestamptz not null default now();

alter table if exists public.resource_ratings
  add column if not exists created_at timestamptz not null default now();

alter table if exists public.resource_ratings
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.resource_comments
  add column if not exists updated_at timestamptz not null default now();

alter table if exists public.resource_comments
  add column if not exists is_deleted boolean not null default false;

alter table if exists public.user_course_progress
  add column if not exists selected_resource_id uuid references public.course_resources(id) on delete set null;

alter table if exists public.user_course_progress
  add column if not exists started_at timestamptz;

alter table if exists public.user_course_progress
  add column if not exists completed_at timestamptz;

alter table if exists public.user_course_progress
  add column if not exists last_test_score integer;

alter table if exists public.user_course_progress
  add column if not exists best_test_score integer;

alter table if exists public.user_course_progress
  add column if not exists passed_at timestamptz;

alter table if exists public.user_course_progress
  add column if not exists last_activity_at timestamptz;

alter table if exists public.user_course_progress
  add column if not exists ready_for_test_at timestamptz;

alter table if exists public.user_course_progress
  add column if not exists current_test_attempt_id uuid;

alter table if exists public.user_course_progress
  add column if not exists attempt_count integer not null default 0;

create table if not exists public.course_test_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  journey_path_id uuid not null references public.journey_paths(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  selected_resource_id uuid references public.course_resources(id) on delete set null,
  score integer not null check (score between 0 and 100),
  passed boolean not null,
  attempt_number integer not null check (attempt_number > 0),
  started_at timestamptz,
  submitted_at timestamptz not null default now(),
  feedback_summary text,
  created_at timestamptz not null default now()
);

create table if not exists public.course_test_questions (
  id uuid primary key default gen_random_uuid(),
  test_attempt_id uuid not null references public.course_test_attempts(id) on delete cascade,
  question_order integer not null check (question_order > 0),
  question_text text not null,
  question_type text,
  options_json jsonb,
  correct_answer_json jsonb,
  user_answer_json jsonb,
  points integer default 20,
  earned_points integer default 0,
  explanation text,
  created_at timestamptz not null default now()
);

create table if not exists public.resource_content_summaries (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.course_resources(id) on delete cascade,
  summary text,
  key_points jsonb,
  generated_at timestamptz not null default now()
);

-- 3) Backfill nulls for newly-added nullable legacy rows
update public.journey_path_courses
set is_required = true
where is_required is null;

update public.course_resources
set is_active = true
where is_active is null;

update public.resource_comments
set is_deleted = false
where is_deleted is null;

update public.user_course_progress
set status = 'passed'
where status = 'completed';

update public.user_course_progress
set attempt_count = 0
where attempt_count is null;

update public.courses
set difficulty_level = lower(trim(difficulty_level))
where difficulty_level is not null;

update public.courses
set difficulty_level = null
where difficulty_level is not null
  and difficulty_level not in ('beginner', 'basic', 'intermediate', 'advanced', 'expert');

-- 4) Useful uniqueness constraints expected by progression logic
create unique index if not exists uq_journey_path_courses_journey_step
  on public.journey_path_courses (journey_path_id, step_number);

create unique index if not exists uq_journey_path_courses_journey_course
  on public.journey_path_courses (journey_path_id, course_id);

create unique index if not exists uq_resource_ratings_resource_user
  on public.resource_ratings (resource_id, user_id);

create unique index if not exists uq_course_resources_course_display_order
  on public.course_resources (course_id, display_order);

create index if not exists idx_course_test_attempts_user_course
  on public.course_test_attempts (user_id, journey_path_id, course_id, submitted_at desc);

create index if not exists idx_course_test_questions_attempt
  on public.course_test_questions (test_attempt_id, question_order);

create index if not exists idx_resource_content_summaries_resource
  on public.resource_content_summaries (resource_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'courses_difficulty_level_check'
      and conrelid = 'public.courses'::regclass
  ) then
    alter table public.courses
      add constraint courses_difficulty_level_check
      check (
        difficulty_level is null
        or difficulty_level in ('beginner', 'basic', 'intermediate', 'advanced', 'expert')
      );
  end if;
end
$$;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select c.conname
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'user_course_progress'
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%status%'
  loop
    execute format('alter table public.user_course_progress drop constraint if exists %I', constraint_name);
  end loop;

  alter table public.user_course_progress
    add constraint user_course_progress_status_check
    check (status in ('locked', 'unlocked', 'in_progress', 'ready_for_test', 'passed'));
end
$$;

commit;
