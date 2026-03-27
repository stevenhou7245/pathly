import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { generateStructuredJson } from "@/lib/ai/provider";
import { trackWeaknessProfilesForIncorrectAnswers } from "@/lib/weaknessProfiles";

type GenericRecord = Record<string, unknown>;

const TRANSITION_REVIEW_PERFORMANCE_PASS_SCORE = 70;
const TRANSITION_REVIEW_QUESTION_COUNT = 3;
const TRANSITION_REVIEW_PROMPT_VERSION = "transition_review_questions_v1";

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
    resource_summaries: string[];
    weak_concepts: string[];
    latest_test_score: number | null;
  };
  questions: TransitionReviewQuestion[];
};

const generatedTransitionReviewQuestionSchema = z.object({
  question_type: z.enum(["single_choice", "fill_blank", "short_answer"]),
  question_text: z.string().min(1),
  options: z
    .union([z.array(z.string()), z.null(), z.undefined()])
    .transform((value) => value ?? []),
  correct_answer: z.union([z.string(), z.number(), z.boolean()]),
  explanation: z.string().optional().nullable(),
});

const generatedTransitionReviewSchema = z.object({
  review_questions: z.array(generatedTransitionReviewQuestionSchema).min(1),
});

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

function toCleanString(value: unknown) {
  return toStringValue(value).replace(/\s+/g, " ").trim();
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

function normalizeGeneratedTransitionReviewQuestions(value: unknown): TransitionReviewQuestion[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item, index) => {
      const row = (item ?? {}) as GenericRecord;
      const questionTypeRaw = toCleanString(row.question_type).toLowerCase();
      const questionType: TransitionReviewQuestion["question_type"] =
        questionTypeRaw === "single_choice" ||
        questionTypeRaw === "fill_blank" ||
        questionTypeRaw === "short_answer"
          ? questionTypeRaw
          : "single_choice";
      const questionText = toCleanString(row.question_text);
      const correctAnswer = toCleanString(
        typeof row.correct_answer === "string"
          ? row.correct_answer
          : String(row.correct_answer ?? ""),
      );
      if (!questionText || !correctAnswer) {
        return null;
      }
      const options = Array.isArray(row.options)
        ? row.options.map((option) => toCleanString(option)).filter(Boolean)
        : [];
      return {
        question_index: index + 1,
        question_type: questionType,
        question_text: questionText,
        options: questionType === "single_choice" ? options.slice(0, 6) : [],
        correct_answer: correctAnswer,
        explanation:
          toCleanString(row.explanation) ||
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
      resource_summaries: Array.isArray(contextSummary.resource_summaries)
        ? contextSummary.resource_summaries.map((item) => toStringValue(item).trim()).filter(Boolean)
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

function buildContentBasedQuestions(params: {
  fromCourseTitle: string;
  fromCourseDescription: string | null;
  resourceTitles: string[];
  resourceSummaries: string[];
  weakConcepts: string[];
}): TransitionReviewQuestion[] {
  const normalizedDescription = params.fromCourseDescription?.trim() || "";
  const resourceTitle = params.resourceTitles[0]?.trim() || "";
  const resourceSummary = params.resourceSummaries[0]?.trim() || "";
  const weakConcept = params.weakConcepts[0]?.trim() || "";
  const primaryConcept =
    weakConcept ||
    resourceTitle ||
    normalizedDescription ||
    params.fromCourseTitle;
  const secondaryContext =
    resourceSummary ||
    params.resourceTitles[1]?.trim() ||
    normalizedDescription ||
    params.fromCourseTitle;
  const firstResource = params.resourceTitles[0] ?? "the key resource from the previous lesson";
  const coreDescription = normalizedDescription || params.fromCourseTitle;

  const questions: TransitionReviewQuestion[] = [
    {
      question_index: 1,
      question_type: "single_choice",
      question_text: `Which option best reviews "${primaryConcept}" from ${params.fromCourseTitle}?`,
      options: [
        `Explain ${primaryConcept} in one sentence and give one practical usage example.`,
        `Skip ${primaryConcept} and focus on unrelated advanced topics.`,
        `Memorize random keywords without applying ${primaryConcept}.`,
        `Only read titles without checking how ${primaryConcept} is used.`,
      ],
      correct_answer: `Explain ${primaryConcept} in one sentence and give one practical usage example.`,
      explanation: `Reinforcing ${primaryConcept} with a concrete example improves retention for the next lesson.`,
    },
    {
      question_index: 2,
      question_type: "fill_blank",
      question_text: `Fill in the blank: A key lesson resource or topic to review before the next step is "____".`,
      options: [],
      correct_answer: firstResource,
      explanation: `Reviewing "${firstResource}" before the next lesson helps bridge concepts smoothly.`,
    },
    {
      question_index: 3,
      question_type: "short_answer",
      question_text: `In one practical sentence, what should you carry from ${params.fromCourseTitle} into the next lesson based on "${secondaryContext}"?`,
      options: [],
      correct_answer: coreDescription,
      explanation:
        "Summarizing one practical takeaway from the previous lesson improves transition confidence.",
    },
  ];

  return questions.slice(0, TRANSITION_REVIEW_QUESTION_COUNT);
}

function buildTrueFallbackQuestions(params: {
  fromCourseTitle: string;
}): TransitionReviewQuestion[] {
  const normalizedTitle = params.fromCourseTitle.trim() || "the previous lesson";
  return [
    {
      question_index: 1,
      question_type: "single_choice",
      question_text: `Which option best prepares you to continue after ${normalizedTitle}?`,
      options: [
        `Explain one main idea from ${normalizedTitle} and apply it in a simple example.`,
        "Skip review and move directly to unrelated topics.",
        "Memorize random terms without context.",
        "Avoid connecting previous and next lesson concepts.",
      ],
      correct_answer: `Explain one main idea from ${normalizedTitle} and apply it in a simple example.`,
      explanation: "A short concept + application review creates a smoother transition.",
    },
    {
      question_index: 2,
      question_type: "fill_blank",
      question_text: "Fill in the blank: Before moving on, I should review ____ from the previous lesson.",
      options: [],
      correct_answer: "one key concept",
      explanation: "Naming one key concept helps consolidate retention before progressing.",
    },
    {
      question_index: 3,
      question_type: "short_answer",
      question_text: "What is one practical action you will take to apply the previous lesson?",
      options: [],
      correct_answer: "apply one key concept in a small example",
      explanation: "Practical application reinforces understanding better than passive review.",
    },
  ];
}

function ensureTransitionQuestionComposition(params: {
  generated: TransitionReviewQuestion[];
  fallback: TransitionReviewQuestion[];
}): TransitionReviewQuestion[] {
  const expectedOrder: TransitionReviewQuestion["question_type"][] = [
    "single_choice",
    "fill_blank",
    "short_answer",
  ];
  return expectedOrder.map((questionType, index) => {
    const generated =
      params.generated.find((item) => item.question_type === questionType) ?? null;
    const fallback =
      params.fallback.find((item) => item.question_type === questionType) ??
      params.fallback[index];
    const selected = generated ?? fallback;
    const safeSelected = selected ?? buildTrueFallbackQuestions({ fromCourseTitle: "Previous lesson" })[index];
    return {
      question_index: index + 1,
      question_type: questionType,
      question_text: toCleanString(safeSelected.question_text) || `Review question ${index + 1}`,
      options:
        questionType === "single_choice"
          ? (safeSelected.options ?? []).map((item) => toCleanString(item)).filter(Boolean).slice(0, 6)
          : [],
      correct_answer: toCleanString(safeSelected.correct_answer) || "Review the previous lesson.",
      explanation:
        toCleanString(safeSelected.explanation) ||
        "Review the previous lesson summary and try again.",
    };
  });
}

async function generateTransitionReviewQuestions(params: {
  userId: string;
  journeyPathId: string;
  fromCourseId: string;
  toCourseId: string;
  fromCourseTitle: string;
  fromCourseDescription: string | null;
  resourceTitles: string[];
  resourceSummaries: string[];
  weakConcepts: string[];
  latestTestScore: number | null;
}): Promise<TransitionReviewQuestion[]> {
  const hasWeaknessData = params.weakConcepts.length > 0;
  const hasLessonContent =
    Boolean(params.fromCourseDescription?.trim()) ||
    params.resourceTitles.length > 0 ||
    params.resourceSummaries.length > 0;

  const deterministicContentBased = buildContentBasedQuestions({
    fromCourseTitle: params.fromCourseTitle,
    fromCourseDescription: params.fromCourseDescription,
    resourceTitles: params.resourceTitles,
    resourceSummaries: params.resourceSummaries,
    weakConcepts: params.weakConcepts,
  });
  const deterministicTrueFallback = buildTrueFallbackQuestions({
    fromCourseTitle: params.fromCourseTitle,
  });

  if (!hasLessonContent && !hasWeaknessData) {
    console.info("[transitionReview] generation_mode:true_fallback", {
      userId: params.userId,
      journeyPathId: params.journeyPathId,
      fromCourseId: params.fromCourseId,
      toCourseId: params.toCourseId,
    });
    return deterministicTrueFallback.slice(0, TRANSITION_REVIEW_QUESTION_COUNT);
  }

  const mode = hasWeaknessData ? "ai_weakness_enhanced" : "ai_content_based";
  console.info(`[transitionReview] generation_mode:${mode}`, {
    userId: params.userId,
    journeyPathId: params.journeyPathId,
    fromCourseId: params.fromCourseId,
    toCourseId: params.toCourseId,
  });

  const promptInput = {
    user_id: params.userId,
    journey_path_id: params.journeyPathId,
    from_course_id: params.fromCourseId,
    to_course_id: params.toCourseId,
    from_course_title: params.fromCourseTitle,
    from_course_description: params.fromCourseDescription ?? null,
    resource_titles: params.resourceTitles.slice(0, 5),
    resource_summaries: params.resourceSummaries.slice(0, 5),
    latest_test_score: params.latestTestScore,
    weak_concepts: params.weakConcepts.slice(0, 5),
    mode,
    requirements: {
      question_count: 3,
      allowed_question_types: ["single_choice", "fill_blank", "short_answer"],
      style: "lightweight_transition_review",
      not_formal_exam: true,
      short_answer_one_sentence: true,
    },
  };
  console.info("[transitionReview] generation_prompt:input", {
    userId: params.userId,
    journeyPathId: params.journeyPathId,
    fromCourseId: params.fromCourseId,
    toCourseId: params.toCourseId,
    has_course_description: Boolean(params.fromCourseDescription?.trim()),
    resource_title_count: params.resourceTitles.length,
    resource_summary_count: params.resourceSummaries.length,
    weak_concept_count: params.weakConcepts.length,
    latest_test_score: params.latestTestScore,
    mode,
  });

  const { output, provenance } = await generateStructuredJson({
    feature: "transition_review_questions",
    promptVersion: TRANSITION_REVIEW_PROMPT_VERSION,
    systemInstruction: [
      "You generate lightweight transition-review questions between two adjacent lessons.",
      "This is not a formal exam.",
      "Always ground questions in the previous lesson context (description, resources, summaries).",
      "If weak_concepts exist, emphasize them while still using lesson context.",
      "If weak_concepts are empty, still use lesson content to generate practical review questions.",
      "Generate exactly 3 questions with these exact types and order: single_choice, fill_blank, short_answer.",
      "Use only these question_type values: single_choice, fill_blank, short_answer.",
      "single_choice must include 4 options.",
      "fill_blank and short_answer must use empty options array.",
      "short_answer must be answerable in one sentence.",
      "Avoid generic placeholders and avoid using course title alone as concept.",
      "Return JSON only with root key review_questions.",
      "Each question must include: question_type, question_text, options, correct_answer, explanation.",
    ].join(" "),
    input: promptInput,
    outputSchema: generatedTransitionReviewSchema,
    fallback: () => ({
      review_questions: deterministicContentBased.map((item) => ({
        question_type: item.question_type,
        question_text: item.question_text,
        options: item.options,
        correct_answer: item.correct_answer,
        explanation: item.explanation,
      })),
    }),
    temperature: 0.3,
    maxOutputTokens: 900,
  });
  console.info("[transitionReview] generation_prompt:result", {
    userId: params.userId,
    journeyPathId: params.journeyPathId,
    fromCourseId: params.fromCourseId,
    toCourseId: params.toCourseId,
    provider: provenance.provider,
    model: provenance.model,
    fallback_used: provenance.fallback_used,
    failure_reason: provenance.failure_reason,
  });

  const aiQuestions = normalizeGeneratedTransitionReviewQuestions(
    (output as GenericRecord).review_questions,
  );
  const composed = ensureTransitionQuestionComposition({
    generated: aiQuestions,
    fallback: deterministicContentBased.length > 0 ? deterministicContentBased : deterministicTrueFallback,
  });
  return composed.slice(0, TRANSITION_REVIEW_QUESTION_COUNT);
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
  const logContext = {
    userId: params.userId,
    journeyPathId: params.journeyPathId,
    fromCourseId: params.fromCourseId,
    toCourseId: params.toCourseId,
  };
  const normalizedFromCourseId = normalizeUuidForCompare(params.fromCourseId);
  const normalizedToCourseId = normalizeUuidForCompare(params.toCourseId);
  console.info("[transitionReview] resolve_context:start", logContext);

  const { data: journeyPathRow, error: journeyPathError } = await supabaseAdmin
    .from("journey_paths")
    .select("id, user_id, learning_field_id")
    .eq("id", params.journeyPathId)
    .eq("user_id", params.userId)
    .limit(1)
    .maybeSingle();
  console.info("[transitionReview] resolve_context:journey_path_result", {
    ...logContext,
    found: Boolean(journeyPathRow),
    error: journeyPathError?.message ?? null,
  });
  if (journeyPathError) {
    throw new Error(`Journey path query failed: ${journeyPathError.message}`);
  }
  if (!journeyPathRow) {
    throw new Error(
      `Journey path not found for user_id=${params.userId} journey_path_id=${params.journeyPathId}`,
    );
  }

  const { data: pathCoursesRows, error: pathCoursesError } = await supabaseAdmin
    .from("journey_path_courses")
    .select("course_id, step_number")
    .eq("journey_path_id", params.journeyPathId)
    .order("step_number", { ascending: true });
  console.info("[transitionReview] resolve_context:path_courses_result", {
    ...logContext,
    rowCount: (pathCoursesRows ?? []).length,
    error: pathCoursesError?.message ?? null,
  });
  if (pathCoursesError) {
    throw new Error(`Journey path courses query failed: ${pathCoursesError.message}`);
  }

  const pathCourses = (pathCoursesRows ?? []) as GenericRecord[];
  const fromPathCourse =
    pathCourses.find((row) => normalizeUuidForCompare(row.course_id) === normalizedFromCourseId) ?? null;
  const toPathCourse =
    pathCourses.find((row) => normalizeUuidForCompare(row.course_id) === normalizedToCourseId) ?? null;
  console.info("[transitionReview] resolve_context:path_courses_resolved", {
    ...logContext,
    fromFound: Boolean(fromPathCourse),
    toFound: Boolean(toPathCourse),
  });
  if (!fromPathCourse) {
    throw new Error(
      `from_course_id=${params.fromCourseId} not found in journey_path_courses for journey_path_id=${params.journeyPathId}`,
    );
  }
  if (!toPathCourse) {
    throw new Error(
      `to_course_id=${params.toCourseId} not found in journey_path_courses for journey_path_id=${params.journeyPathId}`,
    );
  }

  const fromStepNumberFromPath = Math.max(1, Math.floor(toNumberValue(fromPathCourse.step_number) || 1));
  const toStepNumberFromPath = Math.max(1, Math.floor(toNumberValue(toPathCourse.step_number) || 1));
  if (toStepNumberFromPath !== fromStepNumberFromPath + 1) {
    throw new Error(
      `Transition review is only available for adjacent lessons. from_step_number=${fromStepNumberFromPath} to_step_number=${toStepNumberFromPath}`,
    );
  }

  const { data: progressRows, error: progressError } = await supabaseAdmin
    .from("user_course_progress")
    .select("*")
    .eq("user_id", params.userId)
    .in("course_id", [params.fromCourseId, params.toCourseId]);
  if (progressError) {
    throw new Error(`User course progress query failed: ${progressError.message}`);
  }
  console.info("[transitionReview] resolve_context:user_progress_result", {
    ...logContext,
    rowCount: (progressRows ?? []).length,
    error: null,
  });

  const allProgressRows = (progressRows ?? []) as GenericRecord[];
  const resolveProgressRowByCourseId = (courseId: string) => {
    const normalizedCourseId = normalizeUuidForCompare(courseId);
    const candidates = allProgressRows.filter(
      (row) => normalizeUuidForCompare(row.course_id) === normalizedCourseId,
    );
    if (candidates.length === 0) {
      return null;
    }
    const preferredByPath = candidates.find(
      (row) => normalizeUuidForCompare(row.journey_path_id) === normalizeUuidForCompare(params.journeyPathId),
    );
    if (preferredByPath) {
      return preferredByPath;
    }
    return candidates[0] ?? null;
  };

  const fromProgressRow = resolveProgressRowByCourseId(params.fromCourseId);
  const toProgressRow = resolveProgressRowByCourseId(params.toCourseId);
  console.info("[transitionReview] resolve_context:user_progress_resolved", {
    ...logContext,
    fromFound: Boolean(fromProgressRow),
    toFound: Boolean(toProgressRow),
    fromJourneyPathId: normalizeUuidForCompare(fromProgressRow?.journey_path_id),
    toJourneyPathId: normalizeUuidForCompare(toProgressRow?.journey_path_id),
  });
  if (!fromProgressRow) {
    throw new Error(
      `from_course_id=${params.fromCourseId} not found in user_course_progress for user_id=${params.userId}`,
    );
  }
  if (!toProgressRow) {
    throw new Error(
      `to_course_id=${params.toCourseId} not found in user_course_progress for user_id=${params.userId}`,
    );
  }

  const fromStatus = toStringValue(fromProgressRow.status).toLowerCase() || "locked";
  const toStatus = toStringValue(toProgressRow.status).toLowerCase() || "locked";
  console.info("[transitionReview] resolve_context:user_progress_statuses", {
    ...logContext,
    fromStatus,
    toStatus,
  });
  const previousLessonPassStatuses = new Set(["passed", "completed"]);
  if (!previousLessonPassStatuses.has(fromStatus)) {
    throw new Error(
      `Previous lesson status is "${fromStatus}", expected passed/completed for course_id=${params.fromCourseId}`,
    );
  }
  if (toStatus === "locked") {
    throw new Error(
      `Next lesson status is "${toStatus}", cannot open transition review for course_id=${params.toCourseId}`,
    );
  }

  const { data: courseRows, error: courseError } = await supabaseAdmin
    .from("courses")
    .select("id, title, description")
    .in("id", [params.fromCourseId, params.toCourseId]);
  if (courseError) {
    throw new Error(`Course details query failed: ${courseError.message}`);
  }
  console.info("[transitionReview] resolve_context:course_details_result", {
    ...logContext,
    rowCount: (courseRows ?? []).length,
    error: null,
  });
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
    throw new Error(
      `Previous lesson not found in courses table for course_id=${params.fromCourseId}`,
    );
  }
  if (!toCourseRow) {
    throw new Error(
      `Next lesson not found in courses table for course_id=${params.toCourseId}`,
    );
  }
  const fromCourseTitle = toStringValue(fromCourseRow.title).trim();

  const { data: resourceRows, error: resourceError } = await supabaseAdmin
    .from("course_resource_options")
    .select("title, summary")
    .eq("course_id", params.fromCourseId)
    .order("created_at", { ascending: false })
    .limit(5);
  if (resourceError) {
    throw new Error(`Course resource query failed: ${resourceError.message}`);
  }
  console.info("[transitionReview] resolve_context:resource_result", {
    ...logContext,
    rowCount: (resourceRows ?? []).length,
    error: null,
  });
  const optionResourceRows = (resourceRows ?? []) as GenericRecord[];
  const resourceTitles = optionResourceRows
    .map((row) => toStringValue(row.title).trim())
    .filter(Boolean);
  const optionResourceSummaries = optionResourceRows
    .map((row) => toStringValue(row.summary).trim())
    .filter(Boolean);

  let summaryTableResourceSummaries: string[] = [];
  try {
    const { data: courseResourcesRows, error: courseResourcesError } = await supabaseAdmin
      .from("course_resources")
      .select("id")
      .eq("course_id", params.fromCourseId)
      .order("created_at", { ascending: false })
      .limit(5);
    if (courseResourcesError) {
      throw courseResourcesError;
    }
    const resourceIds = ((courseResourcesRows ?? []) as GenericRecord[])
      .map((row) => toStringValue(row.id).trim())
      .filter(Boolean);
    if (resourceIds.length > 0) {
      const { data: summaryRows, error: summaryError } = await supabaseAdmin
        .from("resource_content_summaries")
        .select("summary")
        .in("resource_id", resourceIds)
        .order("generated_at", { ascending: false })
        .limit(5);
      if (summaryError) {
        throw summaryError;
      }
      summaryTableResourceSummaries = ((summaryRows ?? []) as GenericRecord[])
        .map((row) => toStringValue(row.summary).trim())
        .filter(Boolean);
    }
  } catch (error) {
    console.warn("[transitionReview] resolve_context:resource_summary_lookup_failed", {
      ...logContext,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  const resourceSummaries = Array.from(
    new Set([...optionResourceSummaries, ...summaryTableResourceSummaries].filter(Boolean)),
  ).slice(0, 5);
  console.info("[transitionReview] resolve_context:resource_summary_result", {
    ...logContext,
    option_summary_count: optionResourceSummaries.length,
    summary_table_count: summaryTableResourceSummaries.length,
    combined_summary_count: resourceSummaries.length,
  });

  const { data: weaknessRows, error: weaknessError } = await supabaseAdmin
    .from("weakness_profiles")
    .select("concept_tag, weakness_score")
    .eq("user_id", params.userId)
    .eq("course_id", params.fromCourseId)
    .order("weakness_score", { ascending: false })
    .limit(3);
  const weaknessRowCount = weaknessError ? 0 : (weaknessRows ?? []).length;
  console.info("[transitionReview] weakness_profiles:query_result", {
    ...logContext,
    row_count: weaknessRowCount,
    error: weaknessError?.message ?? null,
  });
  if (weaknessError) {
    console.warn("[transitionReview] resolve_context:weakness_query_failed", {
      ...logContext,
      reason: weaknessError.message,
    });
  }
  console.info("[transitionReview] resolve_context:weakness_result", {
    ...logContext,
    rowCount: weaknessError ? 0 : (weaknessRows ?? []).length,
    error: weaknessError?.message ?? null,
  });
  const weakConcepts = (weaknessError ? [] : ((weaknessRows ?? []) as GenericRecord[]))
    .map((row) => toStringValue(row.concept_tag).trim())
    .filter(Boolean);
  if (weakConcepts.length === 0) {
    console.info("[transitionReview] weakness_profiles:empty_using_fallback", {
      ...logContext,
      reason: weaknessError ? "query_error" : "no_rows",
    });
  }

  const { data: latestTestRow, error: latestTestError } = await supabaseAdmin
    .from("ai_user_tests")
    .select("id, earned_score")
    .eq("user_id", params.userId)
    .eq("course_id", params.fromCourseId)
    .eq("status", "graded")
    .order("graded_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (latestTestError) {
    throw new Error(`Latest AI test query failed: ${latestTestError.message}`);
  }
  console.info("[transitionReview] resolve_context:latest_test_result", {
    ...logContext,
    found: Boolean(latestTestRow),
    error: null,
  });

  return {
    learningFieldId: toStringValue((journeyPathRow as GenericRecord).learning_field_id),
    fromCourseTitle: fromCourseTitle || "Previous lesson",
    fromCourseDescription: toNullableString(fromCourseRow.description),
    resourceTitles,
    resourceSummaries,
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

  console.info("[transitionReview] latest_review_query:start", {
    userId: params.userId,
    journeyPathId: params.journeyPathId,
    fromCourseId: params.fromCourseId,
    toCourseId: params.toCourseId,
  });
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
  console.info("[transitionReview] latest_review_query:result", {
    userId: params.userId,
    journeyPathId: params.journeyPathId,
    fromCourseId: params.fromCourseId,
    toCourseId: params.toCourseId,
    found: Boolean(latestRow),
    error: latestError?.message ?? null,
  });
  if (latestError) {
    throw new Error(`Unable to load transition review state: ${latestError.message}`);
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

  const hasWeaknessData = context.weakConcepts.length > 0;
  console.info("[transitionReview] context:loaded", {
    userId: params.userId,
    journeyPathId: params.journeyPathId,
    fromCourseId: params.fromCourseId,
    toCourseId: params.toCourseId,
    has_course_description: Boolean(context.fromCourseDescription?.trim()),
    resource_title_count: context.resourceTitles.length,
    resource_summary_count: context.resourceSummaries.length,
    weakness_count: context.weakConcepts.length,
    latest_test_score: context.latestTestScore,
  });
  if (hasWeaknessData) {
    console.info("[transitionReview] weakness_profiles:found", {
      userId: params.userId,
      journeyPathId: params.journeyPathId,
      fromCourseId: params.fromCourseId,
      toCourseId: params.toCourseId,
      weakness_count: context.weakConcepts.length,
    });
  } else {
    console.info("[transitionReview] weakness_profiles:empty", {
      userId: params.userId,
      journeyPathId: params.journeyPathId,
      fromCourseId: params.fromCourseId,
      toCourseId: params.toCourseId,
    });
  }

  const questions = await generateTransitionReviewQuestions({
    userId: params.userId,
    journeyPathId: params.journeyPathId,
    fromCourseId: params.fromCourseId,
    toCourseId: params.toCourseId,
    fromCourseTitle: context.fromCourseTitle,
    fromCourseDescription: context.fromCourseDescription,
    resourceTitles: context.resourceTitles,
    resourceSummaries: context.resourceSummaries,
    weakConcepts: context.weakConcepts,
    latestTestScore: context.latestTestScore,
  });

  const payload: TransitionReviewPayload = {
    version: "course_transition_review_v1",
    generated_at: new Date().toISOString(),
    context_summary: {
      from_course_title: context.fromCourseTitle,
      from_course_description: context.fromCourseDescription,
      resource_titles: context.resourceTitles,
      resource_summaries: context.resourceSummaries,
      weak_concepts: context.weakConcepts,
      latest_test_score: context.latestTestScore,
    },
    questions,
  };

  console.info("[transitionReview] create_review:insert", {
    userId: params.userId,
    journeyPathId: params.journeyPathId,
    fromCourseId: params.fromCourseId,
    toCourseId: params.toCourseId,
    questionCount: payload.questions.length,
  });
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
    console.error("[transitionReview] create_review:failed", {
      userId: params.userId,
      journeyPathId: params.journeyPathId,
      fromCourseId: params.fromCourseId,
      toCourseId: params.toCourseId,
      error: insertError?.message ?? null,
    });
    throw new Error(
      `Unable to create transition review: ${insertError?.message ?? "insert returned no row."}`,
    );
  }
  console.info("[transitionReview] create_review:result", {
    userId: params.userId,
    journeyPathId: params.journeyPathId,
    fromCourseId: params.fromCourseId,
    toCourseId: params.toCourseId,
    reviewId: toStringValue((insertedRow as GenericRecord).id) || null,
  });

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
  if (reviewError) {
    throw new Error(`Transition review lookup failed: ${reviewError.message}`);
  }
  if (!reviewRow) {
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
      throw new Error(`Unable to update transition review action: ${updateError.message}`);
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
    throw new Error(
      `Unable to reset transition review answers: ${deleteAnswersError.message}`,
    );
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
      throw new Error(
        `Unable to store transition review answers: ${insertAnswersError.message}`,
      );
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
    throw new Error(`Unable to finalize transition review: ${updateError.message}`);
  }

  const fromCourseId = toStringValue(review.from_course_id).trim();
  if (fromCourseId) {
    await trackWeaknessProfilesForIncorrectAnswers({
      userId: params.userId,
      courseId: fromCourseId,
      source: "transition_review_submission",
      evaluations: evaluations.map((item) => {
        const question = questions.find((entry) => entry.question_index === item.question_index);
        return {
          isCorrect: item.is_correct,
          questionIndex: item.question_index,
          questionText: question?.question_text ?? "",
          explanation: item.explanation,
        };
      }),
    });
  } else {
    console.warn("[weakness_profiles] failed", {
      source: "transition_review_submission",
      user_id: params.userId,
      review_id: params.reviewId,
      reason: "Missing from_course_id on transition review row.",
    });
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
