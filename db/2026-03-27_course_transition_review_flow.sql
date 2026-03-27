create table if not exists public.course_transition_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  journey_path_id uuid not null references public.user_learning_journey_paths(id) on delete cascade,
  learning_field_id uuid not null references public.learning_fields(id) on delete cascade,
  from_course_id uuid not null references public.courses(id) on delete cascade,
  to_course_id uuid not null references public.courses(id) on delete cascade,
  status text not null default 'open',
  review_payload jsonb not null default '{}'::jsonb,
  generated_from_test_attempt_id uuid null references public.ai_user_tests(id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null,
  selected_action text null,
  score numeric(5, 2) null,
  constraint course_transition_reviews_status_check
    check (status in ('open', 'completed')),
  constraint course_transition_reviews_selected_action_check
    check (selected_action is null or selected_action in ('continue', 'go_back'))
);

create index if not exists idx_course_transition_reviews_user_pair_created
  on public.course_transition_reviews (user_id, from_course_id, to_course_id, created_at desc);

create index if not exists idx_course_transition_reviews_journey_status
  on public.course_transition_reviews (journey_path_id, status, created_at desc);

create unique index if not exists uq_course_transition_reviews_open_pair
  on public.course_transition_reviews (user_id, journey_path_id, from_course_id, to_course_id)
  where status = 'open';

create table if not exists public.course_transition_review_answers (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.course_transition_reviews(id) on delete cascade,
  question_index integer not null,
  user_answer text null,
  is_correct boolean not null default false,
  correct_answer text not null default '',
  explanation text not null default '',
  created_at timestamptz not null default now(),
  constraint course_transition_review_answers_question_index_check
    check (question_index >= 1),
  constraint uq_course_transition_review_answers_review_question
    unique (review_id, question_index)
);

create index if not exists idx_course_transition_review_answers_review_created
  on public.course_transition_review_answers (review_id, created_at desc);
