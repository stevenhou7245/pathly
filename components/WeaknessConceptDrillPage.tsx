"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

type WeaknessConceptDrillPageProps = {
  courseId: string;
  conceptTag: string;
};

type WeaknessConceptDetailsResponse = {
  success: boolean;
  message?: string;
  concept?: {
    course_id: string;
    course_title: string;
    course_description: string | null;
    concept_tag: string;
    concept_title: string;
    concept_explanation: string;
    search_query: string;
    session_id: string | null;
    cached: boolean;
    resources: Array<{
      id: string;
      title: string;
      url: string;
      snippet: string;
      source: string;
      score: number;
    }>;
  };
};

type StartWeaknessTestResponse = {
  success: boolean;
  message?: string;
  test?: {
    test_session_id: string;
    course_id: string;
    concept_tag: string;
    concept_title: string;
    total_score: number;
    cached: boolean;
    questions: Array<{
      id: string;
      question_order: number;
      question_type: "multiple_choice" | "fill_blank" | "short_answer";
      question_text: string;
      options: string[];
      score: number;
    }>;
  };
};

type SubmitWeaknessTestResponse = {
  success: boolean;
  message?: string;
  result?: {
    test_session_id: string;
    total_score: number;
    earned_score: number;
    percentage: number;
    pass_status: "passed" | "failed";
    question_results: Array<{
      question_id: string;
      question_order: number;
      question_type: "multiple_choice" | "fill_blank" | "short_answer";
      question_text: string;
      user_answer: string;
      correct_answer: string;
      earned_score: number;
      max_score: number;
      result_status: "correct" | "partial" | "incorrect";
      explanation: string;
    }>;
  };
};

export default function WeaknessConceptDrillPage({
  courseId,
  conceptTag,
}: WeaknessConceptDrillPageProps) {
  const [isLoadingConcept, setIsLoadingConcept] = useState(true);
  const [conceptError, setConceptError] = useState("");
  const [conceptDetails, setConceptDetails] = useState<NonNullable<WeaknessConceptDetailsResponse["concept"]> | null>(null);

  const [isPreparingTest, setIsPreparingTest] = useState(false);
  const [testError, setTestError] = useState("");
  const [testSession, setTestSession] = useState<NonNullable<StartWeaknessTestResponse["test"]> | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitResult, setSubmitResult] = useState<NonNullable<SubmitWeaknessTestResponse["result"]> | null>(null);
  const [answers, setAnswers] = useState<
    Record<string, { selectedOptionIndex: number | null; answerText: string }>
  >({});

  useEffect(() => {
    let alive = true;
    async function load() {
      setIsLoadingConcept(true);
      setConceptError("");
      try {
        const response = await fetch(
          `/api/weakness/${encodeURIComponent(courseId)}/${encodeURIComponent(conceptTag)}`,
          {
            method: "GET",
            cache: "no-store",
          },
        );
        const payload = (await response.json()) as WeaknessConceptDetailsResponse;
        if (!response.ok || !payload.success || !payload.concept) {
          throw new Error(payload.message ?? "Unable to load weakness concept.");
        }
        if (!alive) {
          return;
        }
        setConceptDetails(payload.concept);
      } catch (error) {
        if (!alive) {
          return;
        }
        setConceptError(error instanceof Error ? error.message : "Unable to load weakness concept.");
      } finally {
        if (alive) {
          setIsLoadingConcept(false);
        }
      }
    }
    void load();
    return () => {
      alive = false;
    };
  }, [conceptTag, courseId]);

  const handleStartPractice = useCallback(async () => {
    setIsPreparingTest(true);
    setTestError("");
    setSubmitResult(null);
    try {
      const response = await fetch("/api/weakness/test/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          course_id: courseId,
          concept_tag: conceptTag,
        }),
      });
      const payload = (await response.json()) as StartWeaknessTestResponse;
      if (!response.ok || !payload.success || !payload.test) {
        throw new Error(payload.message ?? "Unable to prepare concept practice test.");
      }
      setTestSession(payload.test);
      const nextAnswers: Record<string, { selectedOptionIndex: number | null; answerText: string }> = {};
      payload.test.questions.forEach((question) => {
        nextAnswers[question.id] = {
          selectedOptionIndex: null,
          answerText: "",
        };
      });
      setAnswers(nextAnswers);
    } catch (error) {
      setTestError(error instanceof Error ? error.message : "Unable to prepare concept practice test.");
    } finally {
      setIsPreparingTest(false);
    }
  }, [conceptTag, courseId]);

  const totalQuestionScore = useMemo(() => {
    return testSession?.questions.reduce((sum, question) => sum + question.score, 0) ?? 0;
  }, [testSession?.questions]);

  const handleSubmitPractice = useCallback(async () => {
    if (!testSession) {
      return;
    }
    setIsSubmitting(true);
    setTestError("");
    try {
      const response = await fetch("/api/weakness/test/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          course_id: courseId,
          concept_tag: conceptTag,
          test_session_id: testSession.test_session_id,
          answers: testSession.questions.map((question) => ({
            question_id: question.id,
            selected_option_index: answers[question.id]?.selectedOptionIndex ?? undefined,
            answer_text: answers[question.id]?.answerText ?? "",
          })),
        }),
      });
      const payload = (await response.json()) as SubmitWeaknessTestResponse;
      if (!response.ok || !payload.success || !payload.result) {
        throw new Error(payload.message ?? "Unable to submit concept practice test.");
      }
      setSubmitResult(payload.result);
    } catch (error) {
      setTestError(error instanceof Error ? error.message : "Unable to submit concept practice test.");
    } finally {
      setIsSubmitting(false);
    }
  }, [answers, conceptTag, courseId, testSession]);

  return (
    <section className="mx-auto w-full max-w-6xl px-5 pb-12 pt-28 sm:px-8 sm:pt-32">
      <div className="rounded-3xl border-2 border-[#1F2937]/12 bg-white p-6 shadow-[0_10px_25px_rgba(31,41,55,0.08)] sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[#1F2937]/60">
              Weakness Concept Drill
            </p>
            <h1 className="mt-1 text-2xl font-extrabold text-[#1F2937] sm:text-3xl">
              {conceptDetails?.concept_title ?? "Loading concept..."}
            </h1>
            <p className="mt-2 text-sm font-semibold text-[#1F2937]/70">
              {conceptDetails?.course_title ?? "Course context"}
            </p>
          </div>
          <Link
            href="/dashboard"
            className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-5 !text-sm"
          >
            Back to Dashboard
          </Link>
        </div>

        {isLoadingConcept ? (
          <p className="mt-5 rounded-xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] px-4 py-3 text-sm font-semibold text-[#1F2937]/70">
            Loading concept drill...
          </p>
        ) : null}
        {conceptError ? (
          <p className="mt-5 rounded-xl bg-[#fff1f1] px-4 py-3 text-sm font-semibold text-[#c62828]">
            {conceptError}
          </p>
        ) : null}

        {conceptDetails ? (
          <>
            <p className="mt-5 text-sm font-semibold leading-7 text-[#1F2937]/80">
              {conceptDetails.concept_explanation}
            </p>

            <div className="mt-6">
              <h2 className="text-sm font-extrabold uppercase tracking-wide text-[#1F2937]/70">
                Targeted Resources
              </h2>
              {conceptDetails.resources.length === 0 ? (
                <p className="mt-2 text-sm font-semibold text-[#1F2937]/65">
                  No targeted resources found yet. You can still start concept practice below.
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {conceptDetails.resources.map((resource, index) => (
                    <article
                      key={resource.id}
                      className="rounded-2xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] p-4"
                    >
                      <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/60">
                        Resource {index + 1} · {resource.source}
                      </p>
                      <a
                        href={resource.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block text-sm font-extrabold text-[#1F2937] underline-offset-2 hover:underline"
                      >
                        {resource.title}
                      </a>
                      {resource.snippet ? (
                        <p className="mt-2 text-sm font-semibold text-[#1F2937]/70">{resource.snippet}</p>
                      ) : null}
                    </article>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-7 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  void handleStartPractice();
                }}
                disabled={isPreparingTest}
                className="btn-3d btn-3d-green inline-flex h-11 items-center justify-center px-6 disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isPreparingTest ? "Preparing..." : "Start Concept Practice"}
              </button>
              {testSession ? (
                <p className="text-xs font-semibold text-[#1F2937]/65">
                  {testSession.questions.length} questions · total score {totalQuestionScore}
                </p>
              ) : null}
            </div>
          </>
        ) : null}

        {testError ? (
          <p className="mt-4 rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]">
            {testError}
          </p>
        ) : null}

        {testSession ? (
          <div className="mt-6 rounded-2xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] p-4 sm:p-5">
            <h3 className="text-lg font-extrabold text-[#1F2937]">Concept Practice Test</h3>
            <div className="mt-3 space-y-4">
              {testSession.questions.map((question) => (
                <article key={question.id} className="rounded-xl border-2 border-[#1F2937]/10 bg-white p-3">
                  <p className="text-sm font-extrabold text-[#1F2937]">
                    Q{question.question_order}. {question.question_text}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-[#1F2937]/65">Score: {question.score}</p>
                  {question.question_type === "multiple_choice" ? (
                    <div className="mt-3 space-y-1.5">
                      {question.options.map((option, optionIndex) => (
                        <label
                          key={`${question.id}-${optionIndex}`}
                          className="flex items-center gap-2 text-xs font-semibold text-[#1F2937]/80"
                        >
                          <input
                            type="radio"
                            name={`concept-question-${question.id}`}
                            checked={answers[question.id]?.selectedOptionIndex === optionIndex}
                            onChange={() =>
                              setAnswers((previous) => ({
                                ...previous,
                                [question.id]: {
                                  selectedOptionIndex: optionIndex,
                                  answerText: option,
                                },
                              }))
                            }
                            className="h-4 w-4 accent-[#58CC02]"
                          />
                          <span>{option}</span>
                        </label>
                      ))}
                    </div>
                  ) : question.question_type === "short_answer" ? (
                    <textarea
                      value={answers[question.id]?.answerText ?? ""}
                      onChange={(event) =>
                        setAnswers((previous) => ({
                          ...previous,
                          [question.id]: {
                            selectedOptionIndex: null,
                            answerText: event.target.value,
                          },
                        }))
                      }
                      rows={6}
                      className="mt-3 w-full resize-y rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-xs font-semibold text-[#1F2937]"
                      placeholder="Write your answer here..."
                    />
                  ) : (
                    <input
                      type="text"
                      value={answers[question.id]?.answerText ?? ""}
                      onChange={(event) =>
                        setAnswers((previous) => ({
                          ...previous,
                          [question.id]: {
                            selectedOptionIndex: null,
                            answerText: event.target.value,
                          },
                        }))
                      }
                      className="mt-3 w-full rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-xs font-semibold text-[#1F2937]"
                      placeholder="Type your answer..."
                    />
                  )}
                </article>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  void handleSubmitPractice();
                }}
                disabled={isSubmitting}
                className="btn-3d btn-3d-green inline-flex h-10 items-center justify-center px-5 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSubmitting ? "Submitting..." : "Submit Practice"}
              </button>
            </div>
          </div>
        ) : null}

        {submitResult ? (
          <div className="mt-6 rounded-2xl border-2 border-[#1F2937]/12 bg-white p-4 sm:p-5">
            <p className="text-base font-extrabold text-[#1F2937]">
              Result: {submitResult.earned_score}/{submitResult.total_score} ({submitResult.percentage}%)
            </p>
            <p className="mt-1 text-sm font-semibold text-[#1F2937]/75">
              Status: {submitResult.pass_status === "passed" ? "Passed" : "Need more practice"}
            </p>
            <div className="mt-3 space-y-2">
              {submitResult.question_results.map((item) => (
                <article key={item.question_id} className="rounded-xl border border-[#1F2937]/15 bg-[#F8FCFF] p-3">
                  <p className="text-sm font-bold text-[#1F2937]">
                    Q{item.question_order} · {item.result_status} · {item.earned_score}/{item.max_score}
                  </p>
                  <p className="mt-1 text-xs font-semibold text-[#1F2937]/75">Your answer: {item.user_answer || "(empty)"}</p>
                  <p className="mt-1 text-xs font-semibold text-[#1F2937]/75">Expected: {item.correct_answer || "N/A"}</p>
                  <p className="mt-1 text-xs font-semibold text-[#1F2937]/75">{item.explanation}</p>
                </article>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
