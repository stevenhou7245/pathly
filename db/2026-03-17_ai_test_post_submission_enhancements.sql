alter table public.ai_user_test_answers
add column if not exists result_status text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ai_user_test_answers_result_status_check'
  ) then
    alter table public.ai_user_test_answers
    add constraint ai_user_test_answers_result_status_check
    check (result_status in ('correct', 'partial', 'incorrect'));
  end if;
end $$;

alter table public.ai_user_tests
add column if not exists completion_awarded boolean not null default false;

create index if not exists idx_ai_user_tests_user_course_graded_score
on public.ai_user_tests(user_id, course_id, status, earned_score desc, graded_at desc);

create index if not exists idx_ai_user_tests_user_course_graded_at
on public.ai_user_tests(user_id, course_id, graded_at desc);
