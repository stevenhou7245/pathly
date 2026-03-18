-- AI integration phase 1 schema
-- Safe to run multiple times.

begin;

create table if not exists public.learning_field_templates (
  id uuid primary key default gen_random_uuid(),
  learning_field_id uuid not null references public.learning_fields(id) on delete cascade,
  template_name text not null,
  start_level text not null,
  target_level text not null,
  desired_total_steps integer,
  total_steps integer not null check (total_steps > 0),
  status text not null default 'ready' check (status in ('draft', 'ready', 'archived')),
  template_version integer not null default 1 check (template_version > 0),
  source_hash text not null,
  reuse_scope text not null default 'global' check (reuse_scope in ('global', 'field', 'course', 'user')),
  generation_input_json jsonb not null default '{}'::jsonb,
  template_json jsonb not null default '{}'::jsonb,
  ai_provider text,
  ai_model text,
  ai_prompt_version text,
  ai_generated_at timestamptz,
  created_by_user_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_learning_field_templates_match
  on public.learning_field_templates (
    learning_field_id,
    start_level,
    target_level,
    coalesce(desired_total_steps, -1),
    template_version,
    source_hash
  );

create index if not exists idx_learning_field_templates_lookup
  on public.learning_field_templates (
    learning_field_id,
    start_level,
    target_level,
    status,
    created_at desc
  );

create table if not exists public.learning_field_template_steps (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.learning_field_templates(id) on delete cascade,
  step_number integer not null check (step_number > 0),
  step_title text not null,
  step_description text,
  learning_objective text,
  difficulty_level text,
  course_id uuid references public.courses(id) on delete set null,
  skill_tags_json jsonb not null default '[]'::jsonb,
  concept_tags_json jsonb not null default '[]'::jsonb,
  metadata_json jsonb not null default '{}'::jsonb,
  source_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_id, step_number)
);

create index if not exists idx_learning_field_template_steps_template
  on public.learning_field_template_steps (template_id, step_number);

create table if not exists public.user_learning_journeys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  learning_field_id uuid not null references public.learning_fields(id) on delete cascade,
  learning_field_template_id uuid references public.learning_field_templates(id) on delete set null,
  journey_path_id uuid not null references public.journey_paths(id) on delete cascade,
  start_level text not null,
  target_level text not null,
  total_steps integer not null check (total_steps > 0),
  current_step integer not null default 1 check (current_step > 0),
  status text not null default 'active' check (status in ('active', 'completed', 'archived')),
  template_version integer not null default 1 check (template_version > 0),
  source_hash text,
  generation_input_json jsonb not null default '{}'::jsonb,
  adaptation_json jsonb not null default '{}'::jsonb,
  ai_provider text,
  ai_model text,
  ai_prompt_version text,
  ai_generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_user_learning_journeys_user_journey_path
  on public.user_learning_journeys (user_id, journey_path_id);

create index if not exists idx_user_learning_journeys_user_field_created
  on public.user_learning_journeys (user_id, learning_field_id, created_at desc);

create table if not exists public.course_resource_options (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  learning_field_template_step_id uuid references public.learning_field_template_steps(id) on delete set null,
  option_no integer not null check (option_no between 1 and 3),
  title text not null,
  resource_type text not null check (
    resource_type in ('video', 'article', 'tutorial', 'document', 'interactive')
  ),
  provider_name text not null,
  url text not null,
  description text,
  source_hash text,
  quality_score numeric(5,2),
  diversity_group text,
  reuse_scope text not null default 'course' check (reuse_scope in ('global', 'field', 'course', 'user')),
  artifact_version integer not null default 1 check (artifact_version > 0),
  generation_input_json jsonb not null default '{}'::jsonb,
  generation_output_json jsonb not null default '{}'::jsonb,
  ai_provider text,
  ai_model text,
  ai_prompt_version text,
  ai_generated_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, option_no)
);

create index if not exists idx_course_resource_options_course
  on public.course_resource_options (course_id, is_active, option_no);

create table if not exists public.user_resource_selections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  journey_path_id uuid not null references public.journey_paths(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  resource_option_id uuid not null references public.course_resource_options(id) on delete cascade,
  selected_at timestamptz not null default now(),
  completed_at timestamptz,
  test_attempt_id uuid references public.ai_user_tests(id) on delete set null,
  selection_context_json jsonb not null default '{}'::jsonb,
  source_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_resource_selections_user_course
  on public.user_resource_selections (user_id, course_id, selected_at desc);

create index if not exists idx_user_resource_selections_journey
  on public.user_resource_selections (user_id, journey_path_id, selected_at desc);

create table if not exists public.user_resource_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  resource_type text not null check (
    resource_type in ('video', 'article', 'tutorial', 'document', 'interactive')
  ),
  selection_count integer not null default 0 check (selection_count >= 0),
  completion_count integer not null default 0 check (completion_count >= 0),
  test_success_count integer not null default 0 check (test_success_count >= 0),
  weighted_score numeric(8,4) not null default 0,
  confidence numeric(8,4) not null default 0,
  preference_version integer not null default 1 check (preference_version > 0),
  signal_history_json jsonb not null default '[]'::jsonb,
  source_hash text,
  last_selected_at timestamptz,
  last_completed_at timestamptz,
  last_test_success_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, resource_type)
);

create index if not exists idx_user_resource_preferences_user
  on public.user_resource_preferences (user_id, weighted_score desc, resource_type);

create table if not exists public.weakness_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  journey_path_id uuid references public.journey_paths(id) on delete cascade,
  concept_tag text not null,
  skill_tag text,
  weakness_score numeric(8,4) not null default 0,
  incorrect_count integer not null default 0 check (incorrect_count >= 0),
  partial_count integer not null default 0 check (partial_count >= 0),
  total_observations integer not null default 0 check (total_observations >= 0),
  last_test_id uuid references public.ai_user_tests(id) on delete set null,
  source_hash text,
  profile_version integer not null default 1 check (profile_version > 0),
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_weakness_profiles_user_course_score
  on public.weakness_profiles (user_id, course_id, weakness_score desc, updated_at desc);

create unique index if not exists uq_weakness_profiles_user_course_concept_skill
  on public.weakness_profiles (user_id, course_id, concept_tag, coalesce(skill_tag, ''));

create table if not exists public.review_question_templates (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  concept_tag text not null,
  skill_tag text,
  question_type text not null check (question_type in ('single_choice', 'fill_blank', 'short_answer')),
  question_text text not null,
  options_json jsonb not null default '[]'::jsonb,
  correct_answer_json jsonb not null default '{}'::jsonb,
  explanation text,
  difficulty_band text not null default 'remedial',
  template_version integer not null default 1 check (template_version > 0),
  source_hash text not null,
  reuse_scope text not null default 'course' check (reuse_scope in ('global', 'field', 'course', 'user')),
  generation_input_json jsonb not null default '{}'::jsonb,
  generation_output_json jsonb not null default '{}'::jsonb,
  ai_provider text,
  ai_model text,
  ai_prompt_version text,
  ai_generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_review_question_templates_dedupe
  on public.review_question_templates (course_id, concept_tag, coalesce(skill_tag, ''), source_hash);

create index if not exists idx_review_question_templates_lookup
  on public.review_question_templates (course_id, concept_tag, skill_tag, difficulty_band, created_at desc);

create table if not exists public.user_review_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  journey_path_id uuid not null references public.journey_paths(id) on delete cascade,
  trigger_user_test_id uuid references public.ai_user_tests(id) on delete set null,
  trigger_type text not null default 'before_next_lesson' check (
    trigger_type in ('before_next_lesson', 'manual', 'scheduled')
  ),
  score_at_trigger integer,
  review_required boolean not null default true,
  status text not null default 'open' check (status in ('open', 'completed', 'skipped')),
  weakness_snapshot_json jsonb not null default '{}'::jsonb,
  source_hash text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_review_sessions_user_course
  on public.user_review_sessions (user_id, course_id, status, created_at desc);

create table if not exists public.user_review_session_questions (
  id uuid primary key default gen_random_uuid(),
  review_session_id uuid not null references public.user_review_sessions(id) on delete cascade,
  review_question_template_id uuid references public.review_question_templates(id) on delete set null,
  question_order integer not null check (question_order > 0),
  question_type text not null check (question_type in ('single_choice', 'fill_blank', 'short_answer')),
  question_text text not null,
  options_json jsonb not null default '[]'::jsonb,
  correct_answer_json jsonb not null default '{}'::jsonb,
  user_answer_json jsonb not null default '{}'::jsonb,
  result_status text check (result_status in ('correct', 'partial', 'incorrect')),
  concept_tag text not null,
  skill_tag text,
  max_score integer not null default 5 check (max_score > 0),
  earned_score integer not null default 0 check (earned_score >= 0),
  explanation text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (review_session_id, question_order)
);

create index if not exists idx_user_review_session_questions_session
  on public.user_review_session_questions (review_session_id, question_order);

alter table if exists public.ai_test_templates
  add column if not exists difficulty_band text;

alter table if exists public.ai_test_templates
  add column if not exists variant_no integer not null default 1;

alter table if exists public.ai_test_templates
  add column if not exists based_on_resource_option_id uuid references public.course_resource_options(id) on delete set null;

alter table if exists public.ai_test_templates
  add column if not exists reuse_scope text;

alter table if exists public.ai_test_template_questions
  add column if not exists skill_tag text;

alter table if exists public.ai_test_template_questions
  add column if not exists concept_tag text;

create index if not exists idx_ai_test_templates_course_variant
  on public.ai_test_templates (course_id, difficulty_band, variant_no, created_at desc);

create index if not exists idx_ai_test_templates_course_resource
  on public.ai_test_templates (course_id, based_on_resource_option_id, created_at desc);

create index if not exists idx_ai_test_template_questions_tags
  on public.ai_test_template_questions (template_id, concept_tag, skill_tag, question_order);

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_test_templates'
      and column_name = 'reuse_scope'
  ) then
    if not exists (
      select 1
      from pg_constraint
      where conname = 'ai_test_templates_reuse_scope_check'
        and conrelid = 'public.ai_test_templates'::regclass
    ) then
      alter table public.ai_test_templates
        add constraint ai_test_templates_reuse_scope_check
        check (reuse_scope is null or reuse_scope in ('global', 'field', 'course', 'user'));
    end if;
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_test_templates'
      and column_name = 'difficulty_band'
  ) then
    if not exists (
      select 1
      from pg_constraint
      where conname = 'ai_test_templates_difficulty_band_check'
        and conrelid = 'public.ai_test_templates'::regclass
    ) then
      alter table public.ai_test_templates
        add constraint ai_test_templates_difficulty_band_check
        check (
          difficulty_band is null
          or difficulty_band in ('beginner', 'basic', 'intermediate', 'advanced', 'expert')
        );
    end if;
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_test_templates'
      and column_name = 'variant_no'
  ) then
    update public.ai_test_templates
    set variant_no = 1
    where variant_no is null or variant_no < 1;
  end if;
end
$$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ai_test_templates'
      and column_name = 'reuse_scope'
  ) then
    update public.ai_test_templates
    set reuse_scope = coalesce(nullif(reuse_scope, ''), 'course');
  end if;
end
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_learning_field_templates_set_updated_at on public.learning_field_templates;
create trigger trg_learning_field_templates_set_updated_at
before update on public.learning_field_templates
for each row execute function public.set_updated_at();

drop trigger if exists trg_learning_field_template_steps_set_updated_at on public.learning_field_template_steps;
create trigger trg_learning_field_template_steps_set_updated_at
before update on public.learning_field_template_steps
for each row execute function public.set_updated_at();

drop trigger if exists trg_user_learning_journeys_set_updated_at on public.user_learning_journeys;
create trigger trg_user_learning_journeys_set_updated_at
before update on public.user_learning_journeys
for each row execute function public.set_updated_at();

drop trigger if exists trg_course_resource_options_set_updated_at on public.course_resource_options;
create trigger trg_course_resource_options_set_updated_at
before update on public.course_resource_options
for each row execute function public.set_updated_at();

drop trigger if exists trg_user_resource_selections_set_updated_at on public.user_resource_selections;
create trigger trg_user_resource_selections_set_updated_at
before update on public.user_resource_selections
for each row execute function public.set_updated_at();

drop trigger if exists trg_user_resource_preferences_set_updated_at on public.user_resource_preferences;
create trigger trg_user_resource_preferences_set_updated_at
before update on public.user_resource_preferences
for each row execute function public.set_updated_at();

drop trigger if exists trg_weakness_profiles_set_updated_at on public.weakness_profiles;
create trigger trg_weakness_profiles_set_updated_at
before update on public.weakness_profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_review_question_templates_set_updated_at on public.review_question_templates;
create trigger trg_review_question_templates_set_updated_at
before update on public.review_question_templates
for each row execute function public.set_updated_at();

drop trigger if exists trg_user_review_sessions_set_updated_at on public.user_review_sessions;
create trigger trg_user_review_sessions_set_updated_at
before update on public.user_review_sessions
for each row execute function public.set_updated_at();

drop trigger if exists trg_user_review_session_questions_set_updated_at on public.user_review_session_questions;
create trigger trg_user_review_session_questions_set_updated_at
before update on public.user_review_session_questions
for each row execute function public.set_updated_at();

commit;
