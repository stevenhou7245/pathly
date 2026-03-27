import { supabaseAdmin } from "@/lib/supabaseAdmin";

type GenericRecord = Record<string, unknown>;

const TRANSITION_REVIEW_PERFORMANCE_PASS_SCORE = 70;
const TRANSITION_REVIEW_QUESTION_COUNT = 3;

export type TransitionReviewQuestion = {
  question_index: number;
  question_type: "single_choice" | "fill_blank" | "short_answer";
  question_text: string;
  options: string[];
  correct_answer: string;
  explanation: string;
};

type TransitionReviewPayload = {
  version: "course_transition_review_v1";
  generated_at: string;
  context_summary: {
    from_course_title: string;
    from_course_description: string | null;
    resource_titles: string[];
    weak_concepts: string[];
    latest_test_score: number | null;
  };
  questions: TransitionReviewQuestion[];
};

export type TransitionReviewPopup = {
  should_show: boolean;
  review_id: string | null;
  from_course_id: string | null;
  to_course_id: string | null;
  instructions: string;
  questions: TransitionReviewQuestion[];
};

export type TransitionReviewSubmitResult = {
  review_id: string;
  selected_action: "continue" | "go_back";
  score: number | null;
  total_questions: number;
  correct_count: number;
  performance: "good" | "weak";
  evaluations: Array<{
    question_index: number;
    user_answer: string;
    is_correct: boolean;
    correct_answer: string;
    explanation: string;
  }>;
};

function toStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function toNumberValue(value: unknown) {
  const normalized = typeof value === "number" ? value : Number(value);
  return Number.isFinite(normalized) ? normalized : 0;
}

function normalizeForCompare(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeUuidForCompare(value: unknown) {
  return toStringValue(value).trim().toLowerCase();
}

function parseQuestionArray(value: unknown): TransitionReviewQuestion[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item, index) => {
      const row = (item ?? {}) as GenericRecord;
      const questionText = toStringValue(row.question_text).trim();
      const correctAnswer = toStringValue(row.correct_answer).trim();
      if (!questionText || !correctAnswer) {
        return null;
      }
      const rawType = toStringValue(row.question_type).trim().toLowerCase();
      const questionType: TransitionReviewQuestion["question_type"] =
        rawType === "fill_blank" || rawType === "short_answer" || rawType === "single_choice"
          ? rawType
          : "single_choice";
      return {
        question_index: Math.max(1, Math.floor(toNumberValue(row.question_index) || index + 1)),
        question_type: questionType,
        question_text: questionText,
        options: Array.isArray(row.options)
          ? row.options.map((option) => toStringValue(option).trim()).filter(Boolean)
          : [],
        correct_answer: correctAnswer,
        explanation:
          toStringValue(row.explanation).trim() ||
          "Review the previous lesson summary and try again.",
      } satisfies TransitionReviewQuestion;
    })
    .filter((item): item is TransitionReviewQuestion => Boolean(item));
}

function parseReviewPayload(value: unknown): TransitionReviewPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as GenericRecord;
  const questions = parseQuestionArray(row.questions);
  if (questions.length === 0) {
    return null;
  }
  const contextSummary = (row.context_summary ?? {}) as GenericRecord;
  return {
    version: "course_transition_review_v1",
    generated_at: toStringValue(row.generated_at) || new Date().toISOString(),
    context_summary: {
      from_course_title: toStringValue(contextSummary.from_course_title) || "Previous lesson",
      from_course_description: toNullableString(contextSummary.from_course_description),
      resource_titles: Array.isArray(contextSummary.resource_titles)
        ? contextSummary.resource_titles.map((item) => toStringValue(item).trim()).filter(Boolean)
        : [],
      weak_concepts: Array.isArray(contextSummary.weak_concepts)
        ? contextSummary.weak_concepts.map((item) => toStringValue(item).trim()).filter(Boolean)
        : [],
      latest_test_score: Number.isFinite(toNumberValue(contextSummary.latest_test_score))
        ? Math.floor(toNumberValue(contextSummary.latest_test_score))
        : null,
    },
    questions,
  };
}

function buildFallbackQuestions(params: {
  fromCourseTitle: string;
  fromCourseDescription: string | null;
  resourceTitles: string[];
  weakConcepts: string[];
}): TransitionReviewQuestion[] {
  const weakConcept = params.weakConcepts[0] ?? `${params.fromCourseTitle} fundamentals`;
  const firstResource = params.resourceTitles[0] ?? "the key resource from the previous lesson";
  const coreDescription = params.fromCourseDescription?.trim() || params.fromCourseTitle;

  const questions: TransitionReviewQuestion[] = [
    {
      question_index: 1,
      question_type: "single_choice",
      question_text: `Which option best reviews the weak concept "${weakConcept}" from ${params.fromCourseTitle}?`,
      options: [
        `Explain ${weakConcept} in one sentence and give one practical usage example.`,
        `Skip ${weakConcept} and focus on unrelated advanced topics.`,
        `Memorize random keywords without applying ${weakConcept}.`,
        `Only read titles without checking how ${weakConcept} is used.`,
      ],
      correct_answer: `Explain ${weakConcept} in one sentence and give one practical usage example.`,
      explanation: `Reinforcing ${weakConcept} with a concrete example improves retention for the next lesson.`,
    },
    {
      question_index: 2,
      question_type: "fill_blank",
      question_text: `Fill in the blank: A key review resource from the previous lesson is "____".`,
      options: [],
      correct_answer: firstResource,
      explanation: `Reviewing "${firstResource}" before the next lesson helps bridge concepts smoothly.`,
    },
    {
      question_index: 3,
      question_type: "short_answer",
      question_text: `In one practical sentence, what should you carry from ${params.fromCourseTitle} into the next lesson?`,
      options: [],
      correct_answer: coreDescription,
      explanation:
        "Summarizing one practical takeaway from the previous lesson improves transition confidence.",
    },
  ];

  return questions.slice(0, TRANSITION_REVIEW_QUESTION_COUNT);
}

function gradeTransitionAnswer(params: {
  question: TransitionReviewQuestion;
  userAnswer: string;
}) {
  const normalizedUserAnswer = normalizeForCompare(params.userAnswer);
  const normalizedCorrectAnswer = normalizeForCompare(params.question.correct_answer);
  if (!normalizedUserAnswer) {
    return false;
  }

  if (params.question.question_type === "single_choice") {
    return normalizedUserAnswer === normalizedCorrectAnswer;
  }

  if (normalizedUserAnswer === normalizedCorrectAnswer) {
    return true;
  }

  const keywordCandidates = normalizedCorrectAnswer
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 4);
  if (keywordCandidates.length === 0) {
    return normalizedUserAnswer.includes(normalizedCorrectAnswer);
  }

  const matchedKeywords = keywordCandidates.filter((token) =>
    normalizedUserAnswer.includes(token),
  ).length;
  return matchedKeywords >= Math.min(2, keywordCandidates.length);
}

async function resolveTransitionReviewContext(params: {
  userId: string;
  journeyPathId: string;
  fromCourseId: string;
  toCourseId: string;
}) {
  const normalizedFromCourseId = normalizeUuidForCompare(params.fromCourseId);
  const normalizedToCourseId = normalizeUuidForCompare(params.toCourseId);
  const { data: journeyPathRow, error: journeyPathError } = await supabaseAdmin
    .from("journey_paths")
    .select("id, user_id, learning_field_id")
    .eq("id", params.journeyPathId)
    .eq("user_id", params.userId)
    .limit(1)
    .maybeSingle();
  if (journeyPathError || !journeyPathRow) {
    throw new Error("Journey path not found.");
  }

  const { data: pathCoursesRows, error: pathCoursesError } = await supabaseAdmin
    .from("journey_path_courses")
    .select("course_id, step_number")
    .eq("journey_path_id", params.journeyPathId)
    .order("step_number", { ascending: true });
  if (pathCoursesError) {
    throw new Error("Unable to load journey courses.");
  }

  const pathCourses = (pathCoursesRows ?? []) as GenericRecord[];
  const fromPathCourse =
    pathCourses.find((row) => normalizeUuidForCompare(row.course_id) === normalizedFromCourseId) ?? null;
  const toPathCourse =
    pathCourses.find((row) => normalizeUuidForCompare(row.course_id) === normalizedToCourseId) ?? null;
  if (!fromPathCourse || !toPathCourse) {
    throw new Error("Selected lessons are not part of this journey.");
  }

  const fromStepNumberFromPath = Math.max(1, Math.floor(toNumberValue(fromPathCourse.step_number) || 1));
  const toStepNumberFromPath = Math.max(1, Math.floor(toNumberValue(toPathCourse.step_number) || 1));
  if (toStepNumberFromPath !== fromStepNumberFromPath + 1) {
    throw new Error("Transition review is only available for adjacent lessons.");
  }

  const { data: progressRows, error: progressError } = await supabaseAdmin
    .from("user_course_progress")
    .select("*")
    .eq("user_id", params.userId)
    .eq("journey_path_id", params.journeyPathId)
    .in("course_id", [params.fromCourseId, params.toCourseId]);
  if (progressError) {
    throw new Error("Unable to load user course progress.");
  }

  const progressByCourseId = new Map(
    ((progressRows ?? []) as GenericRecord[]).map((row) => [
      normalizeUuidForCompare(row.course_id),
      row,
    ]),
  );
  const fromProgressRow = progressByCourseId.get(normalizedFromCourseId) ?? null;
  const toProgressRow = progressByCourseId.get(normalizedToCourseId) ?? null;
  if (!fromProgressRow || !toProgressRow) {
    throw new Error("Selected lessons are not part of this journey.");
  }

  const fromStatus = toStringValue(fromProgressRow.status).toLowerCase() || "locked";
  const toStatus = toStringValue(toProgressRow.status).toLowerCase() || "locked";
  if (fromStatus !== "passed") {
    throw new Error("Please complete the previous lesson first.");
  }
  if (toStatus === "locked") {
    throw new Error("Please complete previous lessons before opening this lesson.");
  }

  const { data: courseRows, error: courseError } = await supabaseAdmin
    .from("courses")
    .select("id, title, description")
    .in("id", [params.fromCourseId, params.toCourseId]);
  if (courseError) {
    throw new Error("Unable to load lesson details.");
  }
  const normalizedCourseRows = (courseRows ?? []) as GenericRecord[];
  const fromCourseRow =
    normalizedCourseRows.find(
      (row) => normalizeUuidForCompare(row.id) === normalizedFromCourseId,
    ) ?? null;
  const toCourseRow =
    normalizedCourseRows.find(
      (row) => normalizeUuidForCompare(row.id) === normalizedToCourseId,
    ) ?? null;
  if (!fromCourseRow) {
    throw new Error("Previous lesson not found.");
  }
  if (!toCourseRow) {
    throw new Error("Next lesson not found.");
  }
  const fromCourseTitle = toStringValue(fromCourseRow.title).trim();

  const { data: resourceRows } = await supabaseAdmin
    .from("course_resource_options")
    .select("title")
    .eq("course_id", params.fromCourseId)
    .order("created_at", { ascending: false })
    .limit(3);
  const resourceTitles = ((resourceRows ?? []) as GenericRecord[])
    .map((row) => toStringValue(row.title).trim())
    .filter(Boolean);

  const { data: weaknessRows } = await supabaseAdmin
    .from("weakness_profiles")
    .select("concept_tag, weakness_score")
    .eq("user_id", params.userId)
    .eq("course_id", params.fromCourseId)
    .order("weakness_score", { ascending: false })
    .limit(3);
  const weakConcepts = ((weaknessRows ?? []) as GenericRecord[])
    .map((row) => toStringValue(row.concept_tag).trim())
    .filter(Boolean);

  const { data: latestTestRow } = await supabaseAdmin
    .from("ai_user_tests")
    .select("id, earned_score")
    .eq("user_id", params.userId)
    .eq("course_id", params.fromCourseId)
    .eq("status", "graded")
    .order("graded_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();

  return {
    learningFieldId: toStringValue((journeyPathRow as GenericRecord).learning_field_id),
    fromCourseTitle: fromCourseTitle || "Previous lesson",
    fromCourseDescription: toNullableString(fromCourseRow.description),
    resourceTitles,
    weakConcepts,
    generatedFromTestAttemptId: toNullableString((latestTestRow as GenericRecord | null)?.id),
    latestTestScore: Number.isFinite(
      toNumberValue((latestTestRow as GenericRecord | null)?.earned_score),
    )
      ? Math.floor(toNumberValue((latestTestRow as GenericRecord | null)?.earned_score))
      : null,
  };
}

function toPopupFromRow(row: GenericRecord): TransitionReviewPopup {
  const reviewPayload = parseReviewPayload(row.review_payload);
  const questions = reviewPayload?.questions ?? [];
  return {
    should_show: questions.length > 0,
    review_id: toStringValue(row.id) || null,
    from_course_id: toStringValue(row.from_course_id) || null,
    to_course_id: toStringValue(row.to_course_id) || null,
    instructions:
      "Quick transition review: answer a few lightweight questions before the next lesson.",
    questions,
  };
}

export async function getOrCreateTransitionReviewPopup(params: {
  userId: string;
  journeyPathId: string;
  fromCourseId: string;
  toCourseId: string;
}): Promise<TransitionReviewPopup> {
  const context = await resolveTransitionReviewContext(params);

  const { data: latestRow, error: latestError } = await supabaseAdmin
    .from("course_transition_reviews")
    .select("*")
    .eq("user_id", params.userId)
    .eq("journey_path_id", params.journeyPathId)
    .eq("from_course_id", params.fromCourseId)
    .eq("to_course_id", params.toCourseId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestError) {
    throw new Error("Unable to load transition review state.");
  }

  const latest = (latestRow ?? null) as GenericRecord | null;
  if (latest) {
    const status = toStringValue(latest.status).toLowerCase();
    const selectedAction = toStringValue(latest.selected_action).toLowerCase();
    if (status === "completed" && selectedAction === "continue") {
      return {
        should_show: false,
        review_id: null,
        from_course_id: params.fromCourseId,
        to_course_id: params.toCourseId,
        instructions:
          "Transition review already completed. You can continue to the next lesson.",
        questions: [],
      };
    }

    if (status === "open") {
      return toPopupFromRow(latest);
    }
  }

  const questions = buildFallbackQuestions({
    fromCourseTitle: context.fromCourseTitle,
    fromCourseDescription: context.fromCourseDescription,
    resourceTitles: context.resourceTitles,
    weakConcepts: context.weakConcepts,
  });

  const payload: TransitionReviewPayload = {
    version: "course_transition_review_v1",
    generated_at: new Date().toISOString(),
    context_summary: {
      from_course_title: context.fromCourseTitle,
      from_course_description: context.fromCourseDescription,
      resource_titles: context.resourceTitles,
      weak_concepts: context.weakConcepts,
      latest_test_score: context.latestTestScore,
    },
    questions,
  };

  const { data: insertedRow, error: insertError } = await supabaseAdmin
    .from("course_transition_reviews")
    .insert({
      user_id: params.userId,
      journey_path_id: params.journeyPathId,
      learning_field_id: context.learningFieldId,
      from_course_id: params.fromCourseId,
      to_course_id: params.toCourseId,
      status: "open",
      review_payload: payload,
      generated_from_test_attempt_id: context.generatedFromTestAttemptId,
    })
    .select("*")
    .limit(1)
    .maybeSingle();
  if (insertError || !insertedRow) {
    throw new Error("Unable to create transition review.");
  }

  return toPopupFromRow(insertedRow as GenericRecord);
}

export async function submitTransitionReview(params: {
  userId: string;
  reviewId: string;
  selectedAction: "continue" | "go_back";
  answers: Array<{
    question_index: number;
    user_answer: string;
  }>;
}): Promise<TransitionReviewSubmitResult> {
  const { data: reviewRow, error: reviewError } = await supabaseAdmin
    .from("course_transition_reviews")
    .select("*")
    .eq("id", params.reviewId)
    .eq("user_id", params.userId)
    .limit(1)
    .maybeSingle();
  if (reviewError || !reviewRow) {
    throw new Error("Transition review not found.");
  }

  const review = reviewRow as GenericRecord;
  const status = toStringValue(review.status).toLowerCase();
  if (status === "completed") {
    return {
      review_id: params.reviewId,
      selected_action:
        (toStringValue(review.selected_action).toLowerCase() as "continue" | "go_back") ||
        params.selectedAction,
      score: Number.isFinite(toNumberValue(review.score))
        ? Math.floor(toNumberValue(review.score))
        : null,
      total_questions: 0,
      correct_count: 0,
      performance: "good",
      evaluations: [],
    };
  }

  if (params.selectedAction === "go_back") {
    const { error: updateError } = await supabaseAdmin
      .from("course_transition_reviews")
      .update({
        status: "completed",
        selected_action: "go_back",
        completed_at: new Date().toISOString(),
        score: null,
      })
      .eq("id", params.reviewId)
      .eq("user_id", params.userId);
    if (updateError) {
      throw new Error("Unable to update transition review action.");
    }

    return {
      review_id: params.reviewId,
      selected_action: "go_back",
      score: null,
      total_questions: 0,
      correct_count: 0,
      performance: "good",
      evaluations: [],
    };
  }

  const parsedPayload = parseReviewPayload(review.review_payload);
  const questions = parsedPayload?.questions ?? [];
  if (questions.length === 0) {
    throw new Error("Transition review questions are missing.");
  }

  const answersByIndex = new Map(
    params.answers.map((answer) => [
      Math.max(1, Math.floor(toNumberValue(answer.question_index))),
      toStringValue(answer.user_answer).trim(),
    ]),
  );

  const evaluations = questions.map((question) => {
    const userAnswer = answersByIndex.get(question.question_index) ?? "";
    const isCorrect = gradeTransitionAnswer({
      question,
      userAnswer,
    });
    return {
      question_index: question.question_index,
      user_answer: userAnswer,
      is_correct: isCorrect,
      correct_answer: question.correct_answer,
      explanation: question.explanation,
    };
  });

  const totalQuestions = evaluations.length;
  const correctCount = evaluations.filter((item) => item.is_correct).length;
  const score = Math.round((correctCount / Math.max(1, totalQuestions)) * 100);
  const performance: "good" | "weak" =
    score >= TRANSITION_REVIEW_PERFORMANCE_PASS_SCORE ? "good" : "weak";

  const { error: deleteAnswersError } = await supabaseAdmin
    .from("course_transition_review_answers")
    .delete()
    .eq("review_id", params.reviewId);
  if (deleteAnswersError) {
    throw new Error("Unable to reset transition review answers.");
  }

  if (evaluations.length > 0) {
    const insertRows = evaluations.map((item) => ({
      review_id: params.reviewId,
      question_index: item.question_index,
      user_answer: item.user_answer,
      is_correct: item.is_correct,
      correct_answer: item.correct_answer,
      explanation: item.explanation,
    }));
    const { error: insertAnswersError } = await supabaseAdmin
      .from("course_transition_review_answers")
      .insert(insertRows);
    if (insertAnswersError) {
      throw new Error("Unable to store transition review answers.");
    }
  }

  const { error: updateError } = await supabaseAdmin
    .from("course_transition_reviews")
    .update({
      status: "completed",
      selected_action: "continue",
      completed_at: new Date().toISOString(),
      score,
    })
    .eq("id", params.reviewId)
    .eq("user_id", params.userId);
  if (updateError) {
    throw new Error("Unable to finalize transition review.");
  }

  return {
    review_id: params.reviewId,
    selected_action: "continue",
    score,
    total_questions: totalQuestions,
    correct_count: correctCount,
    performance,
    evaluations,
  };
}
