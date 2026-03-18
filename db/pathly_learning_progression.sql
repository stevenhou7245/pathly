-- Pathly learning progression core schema
-- Safe to run multiple times (uses IF NOT EXISTS where supported).

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  learning_field_id uuid not null references public.learning_fields(id) on delete cascade,
  title text not null,
  slug text not null unique,
  description text,
  estimated_minutes integer,
  difficulty_level text check (
    difficulty_level is null
    or difficulty_level in ('beginner', 'basic', 'intermediate', 'advanced', 'expert')
  ),
  created_at timestamptz not null default now()
);

create index if not exists idx_courses_learning_field_id
  on public.courses (learning_field_id);

create table if not exists public.journey_paths (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  learning_field_id uuid not null references public.learning_fields(id) on delete cascade,
  starting_point text not null,
  destination text not null,
  total_steps integer not null check (total_steps > 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_journey_paths_user_id
  on public.journey_paths (user_id, created_at desc);

create table if not exists public.journey_path_courses (
  id uuid primary key default gen_random_uuid(),
  journey_path_id uuid not null references public.journey_paths(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  step_number integer not null check (step_number > 0),
  is_required boolean not null default true,
  created_at timestamptz not null default now(),
  unique (journey_path_id, step_number),
  unique (journey_path_id, course_id)
);

create index if not exists idx_journey_path_courses_journey
  on public.journey_path_courses (journey_path_id, step_number);

create table if not exists public.course_resources (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  title text not null,
  resource_type text not null check (resource_type in ('video', 'article', 'tutorial')),
  provider_name text not null,
  url text not null,
  description text,
  display_order integer not null check (display_order between 1 and 3),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (course_id, display_order)
);

create index if not exists idx_course_resources_course
  on public.course_resources (course_id, is_active, display_order);

create table if not exists public.resource_ratings (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.course_resources(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (resource_id, user_id)
);

create index if not exists idx_resource_ratings_resource
  on public.resource_ratings (resource_id);

create table if not exists public.resource_comments (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.course_resources(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  comment_text text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  is_deleted boolean not null default false
);

create index if not exists idx_resource_comments_resource
  on public.resource_comments (resource_id, created_at desc)
  where is_deleted = false;

create table if not exists public.user_course_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  journey_path_id uuid not null references public.journey_paths(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  status text not null check (status in ('locked', 'unlocked', 'in_progress', 'ready_for_test', 'passed')),
  selected_resource_id uuid references public.course_resources(id) on delete set null,
  started_at timestamptz,
  completed_at timestamptz,
  last_test_score integer,
  best_test_score integer,
  passed_at timestamptz,
  last_activity_at timestamptz,
  ready_for_test_at timestamptz,
  current_test_attempt_id uuid,
  attempt_count integer not null default 0,
  unique (user_id, journey_path_id, course_id)
);

create index if not exists idx_user_course_progress_user_journey
  on public.user_course_progress (user_id, journey_path_id);

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

create index if not exists idx_course_test_attempts_user_course
  on public.course_test_attempts (user_id, journey_path_id, course_id, submitted_at desc);

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

create index if not exists idx_course_test_questions_attempt
  on public.course_test_questions (test_attempt_id, question_order);

create table if not exists public.resource_content_summaries (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.course_resources(id) on delete cascade,
  summary text,
  key_points jsonb,
  generated_at timestamptz not null default now()
);

create index if not exists idx_resource_content_summaries_resource
  on public.resource_content_summaries (resource_id);

-- ------------------------------------------------------------
-- Alignment patch for existing deployments
-- Ensures required journey columns exist even when tables were created earlier.
-- ------------------------------------------------------------

alter table if exists public.journey_path_courses
  add column if not exists is_required boolean not null default true;

alter table if exists public.journey_path_courses
  add column if not exists created_at timestamptz not null default now();

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

create unique index if not exists uq_journey_path_courses_journey_step
  on public.journey_path_courses (journey_path_id, step_number);

create unique index if not exists uq_journey_path_courses_journey_course
  on public.journey_path_courses (journey_path_id, course_id);

create unique index if not exists uq_resource_ratings_resource_user
  on public.resource_ratings (resource_id, user_id);

create index if not exists idx_course_test_attempts_user_course
  on public.course_test_attempts (user_id, journey_path_id, course_id, submitted_at desc);

create index if not exists idx_course_test_questions_attempt
  on public.course_test_questions (test_attempt_id, question_order);

create index if not exists idx_resource_content_summaries_resource
  on public.resource_content_summaries (resource_id);

-- Optional trigger helper: keep updated_at fresh where needed.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_resource_ratings_set_updated_at on public.resource_ratings;
create trigger trg_resource_ratings_set_updated_at
before update on public.resource_ratings
for each row execute function public.set_updated_at();

drop trigger if exists trg_resource_comments_set_updated_at on public.resource_comments;
create trigger trg_resource_comments_set_updated_at
before update on public.resource_comments
for each row execute function public.set_updated_at();

-- ------------------------------------------------------------
-- Example seed data (run manually after creating at least one learning field)
-- ------------------------------------------------------------
-- Replace :learning_field_id with an existing UUID from learning_fields.
--
-- insert into public.courses (learning_field_id, title, slug, description, estimated_minutes, difficulty_level)
-- values
--   (':learning_field_id', 'HTML Basics', 'html-basics', 'Core HTML tags, structure, and semantics.', 35, 'beginner'),
--   (':learning_field_id', 'CSS Basics', 'css-basics', 'Selectors, cascade, and box model fundamentals.', 40, 'beginner'),
--   (':learning_field_id', 'CSS Layout', 'css-layout', 'Flexbox and grid for practical layouts.', 45, 'basic'),
--   (':learning_field_id', 'JavaScript Intro', 'javascript-intro', 'Variables, functions, and control flow.', 50, 'basic'),
--   (':learning_field_id', 'DOM Basics', 'dom-basics', 'Querying, events, and DOM updates.', 45, 'intermediate');
--
-- For each course, add exactly 3 resources:
-- insert into public.course_resources (course_id, title, resource_type, provider_name, url, description, display_order)
-- select id, title || ' Video Lesson', 'video', 'Pathly Video', 'https://example.com/video/' || slug, 'Video walkthrough', 1 from public.courses where learning_field_id=':learning_field_id'
-- union all
-- select id, title || ' Article Guide', 'article', 'Pathly Docs', 'https://example.com/article/' || slug, 'Reference article', 2 from public.courses where learning_field_id=':learning_field_id'
-- union all
-- select id, title || ' Hands-on Tutorial', 'tutorial', 'Pathly Lab', 'https://example.com/tutorial/' || slug, 'Practice tutorial', 3 from public.courses where learning_field_id=':learning_field_id';
