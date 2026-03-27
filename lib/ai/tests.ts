import { z } from "zod";
import {
  normalizeDifficultyBand,
  sha256Hash,
  toNumberValue,
  toStringValue,
  type DifficultyBand,
} from "@/lib/ai/common";
import { generateStructuredJson, type AiProvenance } from "@/lib/ai/provider";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type GenericRecord = Record<string, unknown>;

function logPrettyJson(label: string, payload: unknown) {
  try {
    console.info(label, JSON.stringify(payload, null, 2));
  } catch (error) {
    console.info(label, {
      message: "Unable to stringify payload.",
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

export type GeneratedAiQuestion = {
  question_order: number;
  question_type: "multiple_choice" | "fill_blank" | "short_answer";
  question_text: string;
  options: string[];
  correct_answer_text: string;
  acceptable_answers: string[];
  score: number;
  explanation: string;
  external_question_key: string | null;
  skill_tags: string[];
  concept_tags: string[];
};

const generatedQuestionSchema = z.object({
  question_id: z.string().optional(),

  question_type: z
    .enum(["multiple_choice", "fill_blank", "short_answer"])
    .optional(),

  question_text: z.string().min(1),

  options: z
    .union([z.array(z.string()), z.null(), z.undefined()])
    .transform((value) => value ?? []),

  correct_answer: z
    .union([z.string(), z.boolean(), z.null()])
    .optional(),

  acceptable_answers: z
    .union([z.array(z.string()), z.null(), z.undefined()])
    .transform((value) => value ?? []),

  explanation: z.string().optional().nullable(),

  score: z.number().int().positive().optional(),
  points: z.number().int().positive().optional(),

  skill_tags: z
    .union([z.array(z.string()), z.null(), z.undefined()])
    .transform((value) => value ?? []),

  concept_tags: z
    .union([z.array(z.string()), z.null(), z.undefined()])
    .transform((value) => value ?? []),
});
const OBJECTIVE_QUESTION_COUNT = 7;
const SHORT_ANSWER_QUESTION_COUNT = 2;
const TOTAL_QUESTION_COUNT = OBJECTIVE_QUESTION_COUNT + SHORT_ANSWER_QUESTION_COUNT;
const OBJECTIVE_QUESTION_SCORE = 10;
const SHORT_ANSWER_QUESTION_SCORE = 15;

const generatedResourceContextSchema = z.object({
  selected_resource_option_id: z.string().nullable(),
  selected_resource_title: z.string().nullable(),
  selected_resource_type: z.string().nullable(),
  selected_resource_provider: z.string().nullable(),
  selected_resource_url: z.string().nullable(),
  selected_resource_summary: z.string().nullable(),
});

const generatedTestTemplateSchema = z.object({
  test_template: z.object({
    course_id: z.string().min(1),
    course_title: z.string().min(1),
    difficulty_band: z.string().optional().default("basic"),
    resource_context: generatedResourceContextSchema,
    questions: z.array(generatedQuestionSchema).min(1),
    metadata: z.record(z.string(), z.unknown()).optional().default({}),
  }),
});

function determineDifficultyBand(attemptNumber: number): DifficultyBand {
  if (attemptNumber <= 1) {
    return "basic";
  }
  if (attemptNumber === 2) {
    return "intermediate";
  }
  if (attemptNumber === 3) {
    return "advanced";
  }
  return "expert";
}

function extractParsedKeys(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [] as string[];
  }
  return Object.keys(value as Record<string, unknown>);
}

function parseVariantNo(value: unknown, fallback: number) {
  const parsed = Math.floor(toNumberValue(value));
  if (parsed > 0) {
    return parsed;
  }
  return Math.max(1, Math.floor(fallback || 1));
}

function normalizeQuestionType(value: unknown) {
  const normalized = toStringValue(value).trim().toLowerCase();

  if (
    normalized === "multiple_choice" ||
    normalized === "single_choice" ||
    normalized === "mcq"
  ) {
    return "multiple_choice" as const;
  }

  if (normalized === "fill_blank" || normalized === "fill-blank") {
    return "fill_blank" as const;
  }

  if (
    normalized === "short_answer" ||
    normalized === "short-answer" ||
    normalized === "essay"
  ) {
    return "short_answer" as const;
  }

  return "multiple_choice" as const;
}

function normalizeDifficultyWithLog(value: unknown, fallback: DifficultyBand) {
  const original = toStringValue(value).trim() || fallback;
  const normalized = normalizeDifficultyBand(original || fallback);
  console.info("[ai_test_template] difficulty_normalized", {
    original,
    normalized,
  });
  return normalized;
}

function firstNonEmpty(values: unknown[]) {
  for (const value of values) {
    const normalized = toStringValue(value).trim();
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function normalizeUnknownItemToString(value: unknown) {
  if (typeof value === "string") {
    return value.trim();
  }
  if (typeof value === "boolean") {
    return value ? "True" : "False";
  }
  if (value && typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return "";
}

function normalizeCorrectAnswerText(params: {
  questionType: ReturnType<typeof normalizeQuestionType>;
  rawCorrectAnswer: unknown;
  fallback: string;
  questionIndex: number;
}) {
  const rawPrimary = params.rawCorrectAnswer ?? null;
  console.info("[ai_test_template] question_type_for_answer_normalization", {
    index: params.questionIndex,
    question_type: params.questionType,
  });
  console.info("[ai_test_template] correct_answer_before_normalization", {
    index: params.questionIndex,
    value:
      typeof rawPrimary === "string" || typeof rawPrimary === "boolean" || rawPrimary === null
        ? rawPrimary
        : "[non-primitive]",
  });

  let normalized = "";
  if (params.questionType === "multiple_choice") {
    if (typeof rawPrimary === "boolean") {
      normalized = rawPrimary ? "True" : "False";
    } else if (typeof rawPrimary === "string") {
      const lowered = rawPrimary.trim().toLowerCase();
      if (lowered === "true") {
        normalized = "True";
      } else if (lowered === "false") {
        normalized = "False";
      }
    }
  }

  if (!normalized) {
    normalized = firstNonEmpty([
      normalizeUnknownItemToString(params.rawCorrectAnswer),
      params.fallback,
    ]);
  }

  console.info("[ai_test_template] correct_answer_after_normalization", {
    index: params.questionIndex,
    value: normalized || null,
  });
  return normalized || null;
}

function isMissingRelationOrColumnError(error: unknown) {
  const record = (error ?? {}) as GenericRecord;
  const code = toStringValue(record.code).trim();
  return code === "42P01" || code === "42703";
}

function getFallbackTemplate(params: {
  courseId: string;
  courseTitle: string;
  attemptNumber: number;
  difficultyBand: DifficultyBand;
  selectedResourceOptionId?: string | null;
  selectedResourceTitle?: string | null;
  selectedResourceType?: string | null;
  selectedResourceProvider?: string | null;
  selectedResourceUrl?: string | null;
  selectedResourceSummary?: string | null;
}) {
  const totalQuestions = TOTAL_QUESTION_COUNT;
  const questions: Array<z.infer<typeof generatedQuestionSchema>> = [];

  for (let index = 0; index < totalQuestions; index += 1) {
    const questionNo = index + 1;
    const questionType =
      questionNo <= OBJECTIVE_QUESTION_COUNT
        ? questionNo % 2 === 0
          ? "fill_blank"
          : "multiple_choice"
        : "short_answer";

    questions.push({
      question_id: `q${questionNo}_v${Math.max(1, Math.floor(params.attemptNumber || 1))}`,
      question_type: questionType,
      question_text:
        questionType === "short_answer"
          ? `Provide a short answer for ${params.courseTitle} concept ${questionNo}.`
          : questionType === "fill_blank"
          ? `Fill in the blank for ${params.courseTitle} concept ${questionNo}.`
          : `Which option best matches ${params.courseTitle} concept ${questionNo}?`,
      options:
        questionType === "multiple_choice"
          ? ["Option A", "Option B", "Option C", "Option D"]
          : [],
      correct_answer:
        questionType === "multiple_choice"
          ? "Option A"
          : questionType === "fill_blank"
          ? `${params.courseTitle} concept ${questionNo}`
          : questionType === "short_answer"
          ? `${params.courseTitle} concept ${questionNo}`
          : `${params.courseTitle} concept ${questionNo}`,
      acceptable_answers:
        questionType === "short_answer" || questionType === "fill_blank"
          ? [`${params.courseTitle} concept ${questionNo}`]
          : [],
      score:
        questionType === "short_answer"
          ? SHORT_ANSWER_QUESTION_SCORE
          : OBJECTIVE_QUESTION_SCORE,
      explanation: `Review ${params.courseTitle} concept ${questionNo} and its practical usage.`,
      skill_tags: [`${params.courseTitle.toLowerCase().replace(/\s+/g, "-")}-skill-${questionNo}`],
      concept_tags: [`${params.courseTitle.toLowerCase().replace(/\s+/g, "-")}-concept-${questionNo}`],
    });
  }

  return {
    test_template: {
      course_id: params.courseId,
      course_title: params.courseTitle,
      difficulty_band: params.difficultyBand,
      resource_context: {
        selected_resource_option_id: params.selectedResourceOptionId ?? null,
        selected_resource_title: params.selectedResourceTitle ?? null,
        selected_resource_type: params.selectedResourceType ?? null,
        selected_resource_provider: params.selectedResourceProvider ?? null,
        selected_resource_url: params.selectedResourceUrl ?? null,
        selected_resource_summary: params.selectedResourceSummary ?? null,
      },
      questions,
      metadata: {
        variant_no: Math.max(1, Math.floor(params.attemptNumber || 1)),
        generated_by: "deterministic-fallback",
      },
    },
  } satisfies z.infer<typeof generatedTestTemplateSchema>;
}

function createDeterministicFallbackQuestion(params: {
  courseTitle: string;
  questionOrder: number;
  type: "multiple_choice" | "fill_blank" | "short_answer";
  difficultyBand: DifficultyBand;
  variantNo: number;
}) {
  const suffix = `${params.courseTitle} concept ${params.questionOrder}`;
  const baseSkill = `${params.courseTitle.toLowerCase().replace(/\s+/g, "-")}-skill-${params.questionOrder}`;
  const baseConcept = `${params.courseTitle.toLowerCase().replace(/\s+/g, "-")}-concept-${params.questionOrder}`;
  if (params.type === "multiple_choice") {
    return {
      question_order: params.questionOrder,
      question_type: "multiple_choice" as const,
      question_text: `Which option best matches ${suffix}?`,
      options: ["Option A", "Option B", "Option C", "Option D"],
      correct_answer_text: "Option A",
      acceptable_answers: [],
      score: OBJECTIVE_QUESTION_SCORE,
      explanation: `Review ${suffix} at ${params.difficultyBand} level (variant ${params.variantNo}).`,
      external_question_key: `fallback_mc_${params.variantNo}_${params.questionOrder}`,
      skill_tags: [baseSkill],
      concept_tags: [baseConcept],
    } satisfies GeneratedAiQuestion;
  }
  if (params.type === "fill_blank") {
    return {
      question_order: params.questionOrder,
      question_type: "fill_blank" as const,
      question_text: `Fill in the blank for ${suffix}.`,
      options: [],
      correct_answer_text: suffix,
      acceptable_answers: [suffix],
      score: OBJECTIVE_QUESTION_SCORE,
      explanation: `Focus on core terminology for ${suffix}.`,
      external_question_key: `fallback_fb_${params.variantNo}_${params.questionOrder}`,
      skill_tags: [baseSkill],
      concept_tags: [baseConcept],
    } satisfies GeneratedAiQuestion;
  }
  return {
    question_order: params.questionOrder,
    question_type: "short_answer" as const,
    question_text: `Provide a short answer for ${suffix}.`,
    options: [],
    correct_answer_text: suffix,
    acceptable_answers: [suffix],
    score: SHORT_ANSWER_QUESTION_SCORE,
    explanation: `Apply ${suffix} with your own words.`,
    external_question_key: `fallback_sa_${params.variantNo}_${params.questionOrder}`,
    skill_tags: [baseSkill],
    concept_tags: [baseConcept],
  } satisfies GeneratedAiQuestion;
}

function normalizeGeneratedQuestions(params: {
  rawQuestions: Array<z.infer<typeof generatedQuestionSchema>>;
  difficultyBand: DifficultyBand;
  courseTitle: string;
}) {
  const normalized: GeneratedAiQuestion[] = [];

  params.rawQuestions.forEach((question, index) => {
    console.info("[ai_test_template] question_type_before_normalization", {
      index,
      value: toStringValue(question.question_type) || null,
    });
    const questionType = normalizeQuestionType(question.question_type);
    console.info("[ai_test_template] question_type_after_normalization", {
      index,
      value: questionType,
    });
    const questionText = toStringValue(question.question_text).trim() || `Question ${index + 1}`;
    console.info("[ai_test_template] options_before_normalization", {
      index,
      value: question.options ?? null,
    });
    const rawOptions = Array.isArray(question.options) ? question.options : [];
    const options = Array.from(
      new Set(
        rawOptions
          .map((item) => normalizeUnknownItemToString(item))
          .filter(Boolean),
      ),
    ).slice(0, 6);
    console.info("[ai_test_template] options_after_normalization", {
      index,
      value: options,
    });
    let normalizedOptions = questionType === "multiple_choice" ? options : [];
    if (questionType === "multiple_choice") {
      if (normalizedOptions.length === 0) {
        normalizedOptions = ["Option A", "Option B", "Option C", "Option D"];
      } else if (normalizedOptions.length < 4) {
        const seed = [...normalizedOptions];
        while (seed.length < 4) {
          seed.push(`Option ${String.fromCharCode(65 + seed.length)}`);
        }
        normalizedOptions = seed.slice(0, 4);
      } else {
        normalizedOptions = normalizedOptions.slice(0, 4);
      }
    }
  const correctAnswerText = normalizeCorrectAnswerText({
    questionType,
    rawCorrectAnswer: question.correct_answer,
    fallback: firstNonEmpty([
      questionType === "multiple_choice" ? normalizedOptions[0] : "",
      (questionType === "short_answer" || questionType === "fill_blank")
        ? `${params.courseTitle} concept ${index + 1}`
        : "",
      `See explanation for ${params.courseTitle}.`,
    ]),
    questionIndex: index,
    });
    console.info("[ai_test_template] acceptable_answers_before_normalization", {
      index,
      value: question.acceptable_answers ?? null,
    });
    const rawAcceptableAnswers = Array.isArray(question.acceptable_answers)
      ? question.acceptable_answers
      : [];
    const acceptableAnswers = Array.from(
      new Set(
        [...rawAcceptableAnswers]
          .map((item) => normalizeUnknownItemToString(item))
          .filter(Boolean),
      ),
    );
    console.info("[ai_test_template] acceptable_answers_after_normalization", {
      index,
      value: acceptableAnswers,
    });
    if (
      (questionType === "short_answer" || questionType === "fill_blank") &&
      acceptableAnswers.length === 0 &&
      correctAnswerText
    ) {
      acceptableAnswers.push(correctAnswerText);
    }
    const rawScoreValue = toNumberValue(question.score);
    const rawPointsValue = toNumberValue(question.points);
    if (rawScoreValue > 0) {
      console.info("[ai_test_template] raw_score_detected", {
        index,
        value: Math.floor(rawScoreValue),
      });
    }
    if (rawPointsValue > 0) {
      console.info("[ai_test_template] raw_points_detected", {
        index,
        value: Math.floor(rawPointsValue),
      });
    }
    const normalizedRawScore = Math.max(
      1,
      Math.floor(rawScoreValue > 0 ? rawScoreValue : rawPointsValue > 0 ? rawPointsValue : OBJECTIVE_QUESTION_SCORE),
    );
    const explanation =
      toStringValue(question.explanation).trim() ||
      `Review this ${params.difficultyBand} question carefully.`;

    const fullSkillTags = Array.from(
      new Set(
        (Array.isArray(question.skill_tags) ? question.skill_tags : [])
          .map((item) => normalizeUnknownItemToString(item))
          .filter(Boolean),
      ),
    );
    const fullConceptTags = Array.from(
      new Set(
        (Array.isArray(question.concept_tags) ? question.concept_tags : [])
          .map((item) => normalizeUnknownItemToString(item))
          .filter(Boolean),
      ),
    );

    if (!questionText.trim()) {
      logPrettyJson("[ai_test_prepare] skipped_question", {
        reason: "question_text is empty after normalization",
        index,
        original_question: question,
      });
      return;
    }

    if (questionType === "multiple_choice" && normalizedOptions.length === 0) {
      logPrettyJson("[ai_test_prepare] skipped_question", {
        reason: "multiple_choice question has no options",
        index,
        original_question: question,
      });
      return;
    }

    normalized.push({
      question_order: index + 1,
      question_type: questionType,
      question_text: questionText,
      options: normalizedOptions,
      correct_answer_text: correctAnswerText || "",
      acceptable_answers: acceptableAnswers,
      score: normalizedRawScore,
      explanation,
      external_question_key: toStringValue(question.question_id).trim() || null,
      skill_tags:
        fullSkillTags.length > 0
          ? fullSkillTags
          : [`${params.courseTitle.toLowerCase().replace(/\s+/g, "-")}-skill-${index + 1}`],
      concept_tags:
        fullConceptTags.length > 0
          ? fullConceptTags
          : [`${params.courseTitle.toLowerCase().replace(/\s+/g, "-")}-concept-${index + 1}`],
    } satisfies GeneratedAiQuestion);
  });

  logPrettyJson("[ai_test_prepare] normalized_question_rows", normalized);
  console.info("[ai_test_prepare] normalized_question_rows_count", {
    raw_count: params.rawQuestions.length,
    normalized_count: normalized.length,
    skipped_count: Math.max(0, params.rawQuestions.length - normalized.length),
  });

  return normalized;
}

function enforceQuestionComposition(params: {
  questions: GeneratedAiQuestion[];
  courseTitle: string;
  difficultyBand: DifficultyBand;
  variantNo: number;
}) {
  const objectiveCandidates = params.questions.filter(
    (question) =>
      question.question_type === "multiple_choice" || question.question_type === "fill_blank",
  );
  const shortAnswerCandidates = params.questions.filter(
    (question) => question.question_type === "short_answer",
  );

  const selectedObjective = objectiveCandidates.slice(0, OBJECTIVE_QUESTION_COUNT);
  const selectedShortAnswers = shortAnswerCandidates.slice(0, SHORT_ANSWER_QUESTION_COUNT);

  const fallbackQuestions: GeneratedAiQuestion[] = [];
  while (selectedObjective.length < OBJECTIVE_QUESTION_COUNT) {
    const index = selectedObjective.length + 1;
    const type: "multiple_choice" | "fill_blank" = index % 2 === 0 ? "fill_blank" : "multiple_choice";
    const fallbackQuestion = createDeterministicFallbackQuestion({
      courseTitle: params.courseTitle,
      questionOrder: index,
      type,
      difficultyBand: params.difficultyBand,
      variantNo: params.variantNo,
    });
    selectedObjective.push(fallbackQuestion);
    fallbackQuestions.push(fallbackQuestion);
  }

  while (selectedShortAnswers.length < SHORT_ANSWER_QUESTION_COUNT) {
    const index = OBJECTIVE_QUESTION_COUNT + selectedShortAnswers.length + 1;
    const fallbackQuestion = createDeterministicFallbackQuestion({
      courseTitle: params.courseTitle,
      questionOrder: index,
      type: "short_answer",
      difficultyBand: params.difficultyBand,
      variantNo: params.variantNo,
    });
    selectedShortAnswers.push(fallbackQuestion);
    fallbackQuestions.push(fallbackQuestion);
  }

  const finalQuestions = [...selectedObjective, ...selectedShortAnswers].map((question, index) => {
    const order = index + 1;
    const isShortAnswer = order > OBJECTIVE_QUESTION_COUNT;
    return {
      ...question,
      question_order: order,
      score: isShortAnswer ? SHORT_ANSWER_QUESTION_SCORE : OBJECTIVE_QUESTION_SCORE,
      options: question.question_type === "multiple_choice" ? question.options.slice(0, 4) : [],
      acceptable_answers:
        question.question_type === "fill_blank" || question.question_type === "short_answer"
          ? (question.acceptable_answers.length > 0
              ? question.acceptable_answers
              : [question.correct_answer_text]).filter(Boolean)
          : [],
    } satisfies GeneratedAiQuestion;
  });

  const compositionBreakdown = {
    multiple_choice: finalQuestions.filter((question) => question.question_type === "multiple_choice").length,
    fill_blank: finalQuestions.filter((question) => question.question_type === "fill_blank").length,
    short_answer: finalQuestions.filter((question) => question.question_type === "short_answer").length,
  };
  const totalScore = finalQuestions.reduce((sum, question) => sum + question.score, 0);

  console.info("[ai_test_template] final_composition_count", {
    count: finalQuestions.length,
  });
  console.info("[ai_test_template] composition_breakdown", compositionBreakdown);
  console.info("[ai_test_template] fallback_questions_added", {
    count: fallbackQuestions.length,
  });
  console.info("[ai_test_template] final_score_distribution", {
    objective_score_each: OBJECTIVE_QUESTION_SCORE,
    short_answer_score_each: SHORT_ANSWER_QUESTION_SCORE,
    objective_question_count: OBJECTIVE_QUESTION_COUNT,
    short_answer_question_count: SHORT_ANSWER_QUESTION_COUNT,
  });
  console.info("[ai_test_template] final_total_score", {
    total_score: totalScore,
  });

  return {
    finalQuestions,
    fallbackQuestions,
    compositionBreakdown,
    totalScore,
  };
}

async function hasReusableTemplateComposition(params: {
  templateId: string;
  courseId: string;
}) {
  const { data: questionRows, error: questionRowsError } = await supabaseAdmin
    .from("ai_test_template_questions")
    .select("question_type, score")
    .eq("template_id", params.templateId);

  if (questionRowsError) {
    throw questionRowsError;
  }

  const rows = (questionRows ?? []) as Array<{
    question_type?: string | null;
    score?: number | null;
  }>;

  if (rows.length <= 0) {
    console.warn("[ai_test_template] reusable_template_missing_questions", {
      template_id: params.templateId,
      course_id: params.courseId,
    });
    return false;
  }

  const objectiveCount = rows.filter(
    (row) =>
      row.question_type === "multiple_choice" ||
      row.question_type === "fill_blank",
  ).length;
  const shortAnswerCount = rows.filter(
    (row) => row.question_type === "short_answer",
  ).length;
  const totalScore = rows.reduce(
    (sum, row) => sum + Math.max(0, Math.floor(toNumberValue(row.score))),
    0,
  );
  const hasOnlyAllowedTypes = rows.every(
    (row) =>
      row.question_type === "multiple_choice" ||
      row.question_type === "fill_blank" ||
      row.question_type === "short_answer",
  );

  if (
    rows.length !== TOTAL_QUESTION_COUNT ||
    objectiveCount !== OBJECTIVE_QUESTION_COUNT ||
    shortAnswerCount !== SHORT_ANSWER_QUESTION_COUNT ||
    totalScore !== 100 ||
    !hasOnlyAllowedTypes
  ) {
    console.warn("[ai_test_template] reusable_template_invalid_composition", {
      template_id: params.templateId,
      course_id: params.courseId,
      total_questions: rows.length,
      objective_count: objectiveCount,
      short_answer_count: shortAnswerCount,
      total_score: totalScore,
      has_only_allowed_types: hasOnlyAllowedTypes,
    });
    return false;
  }

  return true;
}

async function findReusableTemplate(params: {
  userId: string;
  courseId: string;
  difficultyBand: DifficultyBand;
  variantNo: number;
  basedOnResourceOptionId?: string | null;
}) {
  console.info("[ai_test] template_reuse_search_started", {
    user_id: params.userId,
    course_id: params.courseId,
    difficulty_band: params.difficultyBand,
    variant_no: params.variantNo,
    selected_resource_option_id: params.basedOnResourceOptionId ?? null,
  });

  const { data, error } = await supabaseAdmin
    .from("ai_test_templates")
    .select("id, difficulty_band, variant_no, based_on_resource_option_id, created_at")
    .eq("course_id", params.courseId)
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    throw error;
  }

  const { data: userAttempts, error: userAttemptsError } = await supabaseAdmin
    .from("ai_user_tests")
    .select("template_id")
    .eq("user_id", params.userId)
    .eq("course_id", params.courseId)
    .not("template_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(200);
  if (userAttemptsError) {
    throw userAttemptsError;
  }

  const usedTemplateIds = new Set(
    ((userAttempts ?? []) as GenericRecord[])
      .map((row) => toStringValue(row.template_id))
      .filter(Boolean),
  );
  const hasPreviousAttempts = usedTemplateIds.size > 0;

  console.info("[ai_test] template_reuse_user_history", {
    user_id: params.userId,
    course_id: params.courseId,
    has_previous_attempts: hasPreviousAttempts,
    used_template_count: usedTemplateIds.size,
  });

  const rows = ((data ?? []) as GenericRecord[])
    .map((row) => {
      const id = toStringValue(row.id);
      if (!id) {
        return null;
      }
      const rowDifficulty = normalizeDifficultyBand(row.difficulty_band || "basic");
      const rowVariant = Math.max(1, Math.floor(toNumberValue(row.variant_no) || 1));
      const rowResourceOptionId = toStringValue(row.based_on_resource_option_id) || null;
      const matchesDesiredResource =
        !params.basedOnResourceOptionId || rowResourceOptionId === params.basedOnResourceOptionId;
      const matchesDesired =
        rowDifficulty === params.difficultyBand &&
        rowVariant === params.variantNo &&
        matchesDesiredResource;
      return {
        id,
        matchesDesired,
      };
    })
    .filter((row): row is { id: string; matchesDesired: boolean } => Boolean(row));

  const orderedCandidates = [
    ...rows.filter((row) => row.matchesDesired),
    ...rows.filter((row) => !row.matchesDesired),
  ];

  const candidates = hasPreviousAttempts
    ? orderedCandidates.filter((row) => !usedTemplateIds.has(row.id))
    : orderedCandidates;

  if (hasPreviousAttempts && candidates.length === 0) {
    console.info("[ai_test] template_reuse_no_alternative", {
      user_id: params.userId,
      course_id: params.courseId,
      reason: "all_existing_templates_already_used_by_user",
    });
    return null;
  }

  for (const candidate of candidates) {
    const isReusable = await hasReusableTemplateComposition({
      templateId: candidate.id,
      courseId: params.courseId,
    });
    if (!isReusable) {
      continue;
    }
    console.info("[ai_test] template_reuse_candidate_selected", {
      user_id: params.userId,
      course_id: params.courseId,
      template_id: candidate.id,
      matches_desired: candidate.matchesDesired,
      has_previous_attempts: hasPreviousAttempts,
    });
    return {
      id: candidate.id,
    };
  }

  console.info("[ai_test] template_reuse_candidates_exhausted", {
    user_id: params.userId,
    course_id: params.courseId,
    has_previous_attempts: hasPreviousAttempts,
    candidate_count: candidates.length,
  });

  return null;
}

function buildTemplateDescription(params: {
  resourceContext: GenericRecord;
  difficultyBand: DifficultyBand;
}) {
  const resourceTitle = toStringValue(params.resourceContext.selected_resource_title).trim();
  const resourceType = toStringValue(params.resourceContext.selected_resource_type).trim();
  if (resourceTitle || resourceType) {
    const prefix = resourceTitle || "Selected resource";
    const suffix = resourceType ? ` (${resourceType})` : "";
    return `AI test template based on ${prefix}${suffix} at ${params.difficultyBand} difficulty.`;
  }
  return `AI test template at ${params.difficultyBand} difficulty.`;
}

async function insertTemplateRow(params: {
  courseId: string;
  courseTitle: string;
  description: string | null;
  difficultyBand: DifficultyBand;
  variantNo: number;
  basedOnResourceOptionId?: string | null;
  sourceHash: string;
}) {
  const nowIso = new Date().toISOString();

  console.info("[ai_test_template] template_insert_started", {
    course_id: params.courseId,
    difficulty_band: params.difficultyBand,
    variant_no: params.variantNo,
    based_on_resource_option_id: params.basedOnResourceOptionId ?? null,
  });

  // 1️⃣ 查询是否已有模板
  const { data: existingTemplates, error: existingError } = await supabaseAdmin
    .from("ai_test_templates")
    .select("id")
    .eq("course_id", params.courseId)
    .eq("version", params.variantNo)
    .limit(1);

  if (existingError) {
    console.error("[ai_test_template] template_check_failed", {
      course_id: params.courseId,
      variant_no: params.variantNo,
      reason: existingError.message,
      details: existingError.details ?? null,
    });
  }

  if (existingTemplates?.length && existingTemplates[0]?.id) {
    const existingId = existingTemplates[0].id;
    console.info("[ai_test_template] template_already_exists", {
      course_id: params.courseId,
      variant_no: params.variantNo,
      template_id: existingId,
    });
    return existingId; // 直接返回现有模板 ID
  }

  // 2️⃣ 准备插入 payload
  const insertPayload: Record<string, unknown> = {
    course_id: params.courseId,
    version: params.variantNo,
    title: params.courseTitle,
    description: params.description,
    total_score: 100,
    status: "ready",
    generated_by: "ai",
    source_hash: params.sourceHash,
    created_at: nowIso,
    updated_at: nowIso,
    difficulty_band: params.difficultyBand,
    variant_no: params.variantNo,
    based_on_resource_option_id: params.basedOnResourceOptionId ?? null,
    reuse_scope: "course",
  };

  console.info("[ai_test_template] template_insert_payload", insertPayload);

  // 3️⃣ 插入模板
  let insertResult = await supabaseAdmin
    .from("ai_test_templates")
    .insert(insertPayload)
    .select("id")
    .limit(1)
    .maybeSingle();

  if (insertResult.error) {
    const firstError = insertResult.error as unknown as GenericRecord;
    console.error("[ai_test_template] template_insert_failed", {
      course_id: params.courseId,
      variant_no: params.variantNo,
      payload_keys: Object.keys(insertPayload),
      reason: insertResult.error.message,
      code: firstError.code ?? null,
      details: firstError.details ?? null,
      hint: firstError.hint ?? null,
    });

    // fallback payload
    const fallbackPayload: Record<string, unknown> = {
      course_id: params.courseId,
      title: params.courseTitle,
      status: "ready",
      generated_by: "ai",
      source_hash: params.sourceHash,
      created_at: nowIso,
      difficulty_band: params.difficultyBand,
      variant_no: params.variantNo,
      based_on_resource_option_id: params.basedOnResourceOptionId ?? null,
    };
    console.info("[ai_test_template] template_insert_payload_fallback", fallbackPayload);

    insertResult = await supabaseAdmin
      .from("ai_test_templates")
      .insert(fallbackPayload)
      .select("id")
      .limit(1)
      .maybeSingle();

    if (insertResult.error) {
      const fallbackError = insertResult.error as unknown as GenericRecord;
      console.error("[ai_test_template] template_insert_failed_fallback", {
        course_id: params.courseId,
        variant_no: params.variantNo,
        reason: insertResult.error.message,
        code: fallbackError.code ?? null,
        details: fallbackError.details ?? null,
        hint: fallbackError.hint ?? null,
      });
    }
  }

  if (insertResult.error || !insertResult.data) {
    throw insertResult.error ?? new Error("Unable to insert AI test template.");
  }

  const templateId = toStringValue((insertResult.data as GenericRecord).id);
  console.info("[ai_test_template] template_insert_succeeded", {
    template_id: templateId,
    course_id: params.courseId,
    difficulty_band: params.difficultyBand,
    variant_no: params.variantNo,
    based_on_resource_option_id: params.basedOnResourceOptionId ?? null,
  });

  return templateId;
}

async function insertTemplateQuestions(params: {
  templateId: string;
  courseId: string;
  difficultyBand: DifficultyBand;
  questions: GeneratedAiQuestion[];
}) {
  if (!Array.isArray(params.questions) || params.questions.length === 0) {
    throw new Error("Failed to insert AI test questions");
  }
  const nowIso = new Date().toISOString();
  const unsupported = params.questions.filter(
    (question) =>
      question.question_type !== "multiple_choice" &&
      question.question_type !== "fill_blank" &&
      question.question_type !== "short_answer",
  );
  if (unsupported.length > 0) {
    logPrettyJson("[ai_test_template] unsupported_question_types_detected", unsupported);
    throw new Error("Invalid question type in normalized AI test questions.");
  }

  if (params.questions.length !== TOTAL_QUESTION_COUNT) {
    throw new Error("Invalid AI test composition: expected exactly 9 questions.");
  }
  const totalScore = params.questions.reduce((sum, question) => sum + question.score, 0);
  if (totalScore !== 100) {
    throw new Error("Invalid AI test composition: total score must equal 100.");
  }

  const { count: existingCount } = await supabaseAdmin
    .from("ai_test_template_questions")
    .select("id", { count: "exact", head: true })
    .eq("template_id", params.templateId);

  if (existingCount && existingCount > 0) {
    console.info("[ai_test_template_questions] template already has questions, skipping insert", {
      template_id: params.templateId,
      existing_count: existingCount,
    });
    return; 
  }

  console.info("[ai_test_template] question_insert_started", {
    template_id: params.templateId,
    course_id: params.courseId,
    questions_count: params.questions.length,
  });
  
  const baseRows = params.questions.map((question) => ({
  template_id: params.templateId,
  course_id: params.courseId,
  question_order: question.question_order,
  question_type: question.question_type,
  question_text: question.question_text,
  options_json: question.options.length > 0 ? question.options : null,
  correct_answer_text: question.correct_answer_text || null,
  acceptable_answers_json:
    question.acceptable_answers.length > 0 ? question.acceptable_answers : null,
  explanation: question.explanation || null,
  score: question.score,
  difficulty: params.difficultyBand,
  created_at: nowIso,
  skill_tags: question.skill_tags.length > 0 ? question.skill_tags : null,
  concept_tags: question.concept_tags.length > 0 ? question.concept_tags : null,
  external_question_key: question.external_question_key,
}));
  logPrettyJson("[ai_test_prepare] normalized_question_rows", baseRows);
  console.info("[ai_test_template] question_insert_payload_sample", {
    template_id: params.templateId,
    sample:
      baseRows.length > 0
        ? {
            ...baseRows[0],
            question_text: String(baseRows[0].question_text).slice(0, 120),
            explanation: String(baseRows[0].explanation ?? "").slice(0, 120),
          }
        : null,
  });
  console.info("[ai_test_template] question_insert_batch_size", {
    template_id: params.templateId,
    batch_size: baseRows.length,
  });
  logPrettyJson("[ai_test_prepare] insert_ready", {
    template_id: params.templateId,
    course_id: params.courseId,
    total_rows: baseRows.length,
    per_question_summary: baseRows.map((row) => ({
      question_order: row.question_order,
      question_type: row.question_type,
      has_options: Array.isArray(row.options_json) ? row.options_json.length > 0 : false,
      has_acceptable_answers: Array.isArray(row.acceptable_answers_json)
        ? row.acceptable_answers_json.length > 0
        : false,
      score: row.score,
      external_question_key: row.external_question_key,
    })),
  });
  logPrettyJson("[ai_test_prepare] insert_payload", baseRows);

  const { error: insertError } = await supabaseAdmin
    .from("ai_test_template_questions")
    .insert(baseRows);

  if (insertError) {
    const errorRecord = insertError as unknown as GenericRecord;
    console.error("[ai_test_template] question_insert_db_error", {
      template_id: params.templateId,
      course_id: params.courseId,
      question_count: baseRows.length,
      reason: insertError.message,
      code: errorRecord.code ?? null,
      details: errorRecord.details ?? null,
      hint: errorRecord.hint ?? null,
      payload_sample:
        baseRows.length > 0
          ? {
              template_id: baseRows[0].template_id,
              question_type: baseRows[0].question_type,
              difficulty: baseRows[0].difficulty,
              score: baseRows[0].score,
            }
          : null,
    });
    console.error("[ai_test_template] question_insert_failed", {
      template_id: params.templateId,
      course_id: params.courseId,
      question_count: baseRows.length,
      reason: insertError.message,
      code: errorRecord.code ?? null,
      details: errorRecord.details ?? null,
      hint: errorRecord.hint ?? null,
      payload_sample:
        baseRows.length > 0
          ? {
              template_id: baseRows[0].template_id,
              question_type: baseRows[0].question_type,
              difficulty: baseRows[0].difficulty,
              score: baseRows[0].score,
            }
          : null,
    });
    logPrettyJson("[ai_test_prepare] insert_failed", {
      error: {
        message: insertError.message,
        code: errorRecord.code ?? null,
        details: errorRecord.details ?? null,
        hint: errorRecord.hint ?? null,
      },
      insert_payload: baseRows,
    });
    throw new Error("Failed to insert AI test questions");
  }

  const { count: insertedCount, error: insertedCountError } = await supabaseAdmin
    .from("ai_test_template_questions")
    .select("id", { count: "exact", head: true })
    .eq("template_id", params.templateId);
  if (insertedCountError) {
    console.error("[ai_test_template] question_insert_db_error", {
      template_id: params.templateId,
      course_id: params.courseId,
      reason: insertedCountError.message,
      code: (insertedCountError as unknown as GenericRecord).code ?? null,
      details: (insertedCountError as unknown as GenericRecord).details ?? null,
      hint: (insertedCountError as unknown as GenericRecord).hint ?? null,
      phase: "post_insert_count_verification",
    });
    console.error("[ai_test_template] question_insert_failed", {
      template_id: params.templateId,
      course_id: params.courseId,
      reason: insertedCountError.message,
      code: (insertedCountError as unknown as GenericRecord).code ?? null,
      details: (insertedCountError as unknown as GenericRecord).details ?? null,
      hint: (insertedCountError as unknown as GenericRecord).hint ?? null,
    });
    throw new Error("Failed to insert AI test questions");
  }
  if (Number(insertedCount ?? 0) <= 0) {
    console.error("[ai_test_template] question_insert_failed", {
      template_id: params.templateId,
      course_id: params.courseId,
      reason: "No rows found after insert verification",
    });
    throw new Error("Failed to insert AI test questions");
  }

  console.info("[ai_test_template] inserted_question_count", {
    template_id: params.templateId,
    count: Number(insertedCount ?? 0),
  });
  console.info("[ai_test_template] question_insert_succeeded", {
    template_id: params.templateId,
    course_id: params.courseId,
    question_count: baseRows.length,
    inserted_count: Number(insertedCount ?? 0),
  });
  logPrettyJson("[ai_test_prepare] insert_succeeded", {
    template_id: params.templateId,
    course_id: params.courseId,
    inserted_row_count: Number(insertedCount ?? 0),
  });
}

async function upsertTemplateValidationSummary(params: {
  templateId: string;
  courseId: string;
  version: number;
  status: string;
  templateTotalScore: number;
  questions: GeneratedAiQuestion[];
}) {
  const totalQuestions = params.questions.length;
  const summedQuestionScore = params.questions.reduce(
    (sum, question) => sum + Math.max(0, Math.floor(toNumberValue(question.score))),
    0,
  );
  const multipleChoiceCount = params.questions.filter(
    (question) => question.question_type === "multiple_choice",
  ).length;
  const fillBlankCount = params.questions.filter(
    (question) => question.question_type === "fill_blank",
  ).length;
  const shortAnswerCount = params.questions.filter(
    (question) => question.question_type === "short_answer",
  ).length;
  const objectiveCount = multipleChoiceCount + fillBlankCount;

  const nowIso = new Date().toISOString();
  const payload = {
    template_id: params.templateId,
    course_id: params.courseId,
    version: params.version,
    status: params.status,
    template_total_score: params.templateTotalScore,
    total_questions: totalQuestions,
    summed_question_score: summedQuestionScore,
    multiple_choice_count: multipleChoiceCount,
    fill_blank_count: fillBlankCount,
    short_answer_count: shortAnswerCount,
    objective_count: objectiveCount,
    updated_at: nowIso,
  };

  console.info("[ai_test_template] validation_update_started", {
    template_id: params.templateId,
    course_id: params.courseId,
    version: params.version,
    status: params.status,
    template_total_score: params.templateTotalScore,
    total_questions: totalQuestions,
    summed_question_score: summedQuestionScore,
    multiple_choice_count: multipleChoiceCount,
    fill_blank_count: fillBlankCount,
    short_answer_count: shortAnswerCount,
    objective_count: objectiveCount,
  });

  const { error } = await supabaseAdmin
    .from("ai_test_template_validation")
    .upsert(payload, { onConflict: "template_id" });

  if (error) {
    if (isMissingRelationOrColumnError(error)) {
      console.warn("[ai_test_template] validation_update_skipped_schema_missing", {
        template_id: params.templateId,
        reason: error.message,
        code: (error as unknown as GenericRecord).code ?? null,
      });
      return;
    }
    console.error("[ai_test_template] validation_update_failed", {
      template_id: params.templateId,
      reason: error.message,
      code: (error as unknown as GenericRecord).code ?? null,
      details: (error as unknown as GenericRecord).details ?? null,
      hint: (error as unknown as GenericRecord).hint ?? null,
    });
    throw error;
  }

  console.info("[ai_test_template] validation_update_succeeded", {
    template_id: params.templateId,
    course_id: params.courseId,
    total_questions: totalQuestions,
  });
}

export async function resolveAiTestTemplateForAttempt(params: {
  userId: string;
  courseId: string;
  courseTitle: string;
  courseDescription?: string | null;
  selectedResourceOptionId?: string | null;
  selectedResourceTitle?: string | null;
  selectedResourceType?: string | null;
  selectedResourceProvider?: string | null;
  selectedResourceUrl?: string | null;
  selectedResourceSummary?: string | null;
  resourceMetadata?: Array<{
    id: string;
    title: string;
    resource_type: string;
    provider: string | null;
    url: string | null;
    summary: string | null;
  }>;
  attemptNumber: number;
}): Promise<{
  templateId: string;
  reusedExisting: boolean;
  difficultyBand: DifficultyBand;
  variantNo: number;
  resourceContext: {
    selected_resource_option_id: string | null;
    selected_resource_title: string | null;
    selected_resource_type: string | null;
    selected_resource_provider: string | null;
    selected_resource_url: string | null;
    selected_resource_summary: string | null;
  };
  metadata: {
    generated_at: string;
    attempt_number: number;
    variant_no: number;
    prompt_version: string;
    requirements_met: {
      include_concept_and_skill_tags: boolean;
      vary_from_previous_attempts: boolean;
    };
    ai_provider: string | null;
    ai_model: string | null;
    fallback_used: boolean;
    reused_existing: boolean;
  };
  aiProvenance: AiProvenance | null;
}> {
  console.info("[ai_test_template] request_started", {
    user_id: params.userId,
    course_id: params.courseId,
    attempt_number: params.attemptNumber,
    selected_resource_option_id: params.selectedResourceOptionId ?? null,
    selected_resource_title: params.selectedResourceTitle ?? null,
    selected_resource_type: params.selectedResourceType ?? null,
    selected_resource_provider: params.selectedResourceProvider ?? null,
    resource_metadata_count: params.resourceMetadata?.length ?? 0,
  });
  const desiredDifficultyBand = determineDifficultyBand(params.attemptNumber);
  const desiredVariantNo = Math.max(1, Math.floor(params.attemptNumber));

  try {
    const existingTemplate = await findReusableTemplate({
      userId: params.userId,
      courseId: params.courseId,
      difficultyBand: desiredDifficultyBand,
      variantNo: desiredVariantNo,
      basedOnResourceOptionId: params.selectedResourceOptionId ?? null,
    });

    if (existingTemplate?.id) {
      console.info("[ai_test] template_reuse_decision", {
        decision: "reuse",
        course_id: params.courseId,
        template_id: existingTemplate.id,
        difficulty_band: desiredDifficultyBand,
        variant_no: desiredVariantNo,
      });
      return {
        templateId: existingTemplate.id,
        reusedExisting: true,
        difficultyBand: desiredDifficultyBand,
        variantNo: desiredVariantNo,
        resourceContext: {
          selected_resource_option_id: params.selectedResourceOptionId ?? null,
          selected_resource_title: params.selectedResourceTitle ?? null,
          selected_resource_type: params.selectedResourceType ?? null,
          selected_resource_provider: params.selectedResourceProvider ?? null,
          selected_resource_url: params.selectedResourceUrl ?? null,
          selected_resource_summary: params.selectedResourceSummary ?? null,
        },
        metadata: {
          generated_at: new Date().toISOString(),
          attempt_number: Math.max(1, Math.floor(params.attemptNumber || 1)),
          variant_no: desiredVariantNo,
          prompt_version: "ai_test_template_v3",
          requirements_met: {
            include_concept_and_skill_tags: true,
            vary_from_previous_attempts: true,
          },
          ai_provider: null,
          ai_model: null,
          fallback_used: false,
          reused_existing: true,
        },
        aiProvenance: null,
      };
    }
  } catch (error) {
    console.warn("[ai_test] template_lookup_failed", {
      course_id: params.courseId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  const { output, provenance, debug } = await generateStructuredJson({
    feature: "ai_test_template",
    promptVersion: "ai_test_template_v3",
    systemInstruction: [
      "Generate a reusable course test template.",
      "Return JSON with root key test_template.",
      "test_template must include: course_id, course_title, difficulty_band, resource_context, questions, metadata.",
      "Generate exactly 9 questions.",
      "Composition must be: 7 objective questions (multiple_choice or fill_blank) and 2 short_answer questions.",
      "Allowed question_type values are only: multiple_choice, fill_blank, short_answer.",
      "Do not output true_false, matching, essay, or any other type.",
      "For multiple_choice questions, include exactly 4 options.",
      "For fill_blank and short_answer questions, do not include options; use an empty array for options.",
      "Each question must use these exact field names only: question_id, question_type, question_text, options, correct_answer, acceptable_answers, explanation, score, concept_tags, skill_tags.",
      "Use field name score for per-question points. Do not use points.",
      "Scoring must be exact: the 7 objective questions must each have score 10, and the 2 short_answer questions must each have score 15.",
      "Total score must be 100.",
      "Passing score in this product is 80 out of 100. Do not mention 60 as a passing score.",
      "options must always be an array, never null.",
      "acceptable_answers must always be an array, never null.",
      "skill_tags must always be an array, never null.",
      "concept_tags must always be an array, never null.",
      "resource_context must always be an object, never a string.",
      "resource_context object must include exactly these keys: selected_resource_option_id, selected_resource_title, selected_resource_type, selected_resource_provider, selected_resource_url, selected_resource_summary.",
      "If no saved DB resource exists, set all resource_context fields to null.",
      "Do not use explanatory text in resource_context.",
      "Generate questions from course-level concepts and skills based on course title, course description, and resource metadata.",
      "Do not depend on extracting content from a single selected resource.",
      "selected_resource_option_id may be null; still generate coherent questions.",
      "Use resource metadata (type/provider/title/url/summary) only as supportive context.",
      "Question design principles are mandatory: practice-oriented, operationally specific, and case-driven.",
      "Strongly avoid purely conceptual definition questions unless they are embedded in a concrete operation or troubleshooting scenario.",
      "At least 80% of questions must require concrete actions such as writing commands, choosing APIs, interpreting code output, debugging steps, or handling real business/product incidents.",
      "For multiple_choice, prefer scenario-based prompts with code snippets, command lines, logs, tabular outputs, or workflow decisions.",
      "For fill_blank, prefer executable tokens such as command names, function names, parameters, SQL clauses, or pipeline steps.",
      "For short_answer, ask for actionable steps, investigation plans, or decision criteria in a real case context; avoid abstract theory prompts.",
      "Example style only: DataFrame groupby result type judgment, git pull command completion, e-commerce conversion drop troubleshooting steps.",
      "Increase conceptual depth for higher difficulty bands.",
      "Return structured JSON only.",
    ].join(" "),
    input: {
      user_id: params.userId,
      course_id: params.courseId,
      course_title: params.courseTitle,
      course_description: params.courseDescription ?? null,
      resource_context: {
        selected_resource_option_id: params.selectedResourceOptionId ?? null,
        selected_resource_title: params.selectedResourceTitle ?? null,
        selected_resource_type: params.selectedResourceType ?? null,
        selected_resource_provider: params.selectedResourceProvider ?? null,
        selected_resource_url: params.selectedResourceUrl ?? null,
        selected_resource_summary: params.selectedResourceSummary ?? null,
      },
      resource_metadata: params.resourceMetadata ?? [],
      attempt_number: params.attemptNumber,
      difficulty_band: desiredDifficultyBand,
      variant_no: desiredVariantNo,
      requirements: {
        include_concept_and_skill_tags: true,
        vary_from_previous_attempts: true,
      },
    },
    outputSchema: generatedTestTemplateSchema,
    fallback: () =>
      getFallbackTemplate({
        courseId: params.courseId,
        courseTitle: params.courseTitle,
        attemptNumber: params.attemptNumber,
        difficultyBand: desiredDifficultyBand,
        selectedResourceOptionId: params.selectedResourceOptionId ?? null,
        selectedResourceTitle: params.selectedResourceTitle ?? null,
        selectedResourceType: params.selectedResourceType ?? null,
        selectedResourceProvider: params.selectedResourceProvider ?? null,
        selectedResourceUrl: params.selectedResourceUrl ?? null,
        selectedResourceSummary: params.selectedResourceSummary ?? null,
      }),
  });

  const parsedKeys = extractParsedKeys(debug.parsed_output_json);
  const outputRecord = (output ?? {}) as GenericRecord;
  logPrettyJson("[ai_test_template] generated_template_json_pretty", {
    course_id: params.courseId,
    test_template: outputRecord.test_template ?? null,
  });
  logPrettyJson("[ai_test_template] parsed_output_json_pretty", debug.parsed_output_json);  
  
  const testTemplate = (outputRecord.test_template ?? null) as GenericRecord | null;
  const hasTestTemplate = Boolean(testTemplate && typeof testTemplate === "object");
  const rawQuestions = Array.isArray(testTemplate?.questions)
    ? (testTemplate?.questions as Array<z.infer<typeof generatedQuestionSchema>>)
    : [];
  logPrettyJson("[ai_test_prepare] raw_questions_extracted", rawQuestions);

  console.info("[ai_test_template] parsed_keys", {
    keys: parsedKeys,
    fallback_used: provenance.fallback_used,
  });
  console.info("[ai_test_template] has_test_template", {
    value: hasTestTemplate,
  });
  console.info("[ai_test_template] questions_count", {
    count: rawQuestions.length,
  });
  console.info("[ai_test_template] raw_questions_count", {
    count: rawQuestions.length,
  });

  if (!testTemplate) {
    throw new Error("AI test template payload missing test_template.");
  }
  if (!Array.isArray(testTemplate.questions)) {
    throw new Error("AI test template payload missing questions array.");
  }

  const resolvedCourseId = toStringValue(testTemplate.course_id) || params.courseId;
  const resolvedCourseTitle = toStringValue(testTemplate.course_title) || params.courseTitle;
  const resolvedDifficultyBand = normalizeDifficultyWithLog(
    toStringValue(testTemplate.difficulty_band) || desiredDifficultyBand,
    desiredDifficultyBand,
  );
  const metadata = (testTemplate.metadata ?? {}) as GenericRecord;
  const resolvedVariantNo = parseVariantNo(metadata.variant_no, desiredVariantNo);
  const resolvedBasedOnResourceOptionId = params.selectedResourceOptionId ?? null;
  const resourceContext = {
    selected_resource_option_id: resolvedBasedOnResourceOptionId,
    selected_resource_title: params.selectedResourceTitle ?? null,
    selected_resource_type: params.selectedResourceType ?? null,
    selected_resource_provider: params.selectedResourceProvider ?? null,
    selected_resource_url: params.selectedResourceUrl ?? null,
    selected_resource_summary: params.selectedResourceSummary ?? null,
  } satisfies z.infer<typeof generatedResourceContextSchema>;

  const normalizedQuestions = normalizeGeneratedQuestions({
    rawQuestions,
    difficultyBand: resolvedDifficultyBand,
    courseTitle: resolvedCourseTitle,
  });
  console.info("[ai_test_template] normalized_questions_count", {
    count: normalizedQuestions.length,
  });

  const composition = enforceQuestionComposition({
    questions: normalizedQuestions,
    courseTitle: resolvedCourseTitle,
    difficultyBand: resolvedDifficultyBand,
    variantNo: resolvedVariantNo,
  });
  const finalQuestions = composition.finalQuestions;
  const sourceHash = sha256Hash({
    course_id: resolvedCourseId,
    difficulty_band: resolvedDifficultyBand,
    variant_no: resolvedVariantNo,
    based_on_resource_option_id: resolvedBasedOnResourceOptionId,
    questions: finalQuestions,
  });

  try {
    const templateId = await insertTemplateRow({
      courseId: resolvedCourseId,
      courseTitle: resolvedCourseTitle,
      description: buildTemplateDescription({
        resourceContext,
        difficultyBand: resolvedDifficultyBand,
      }),
      difficultyBand: resolvedDifficultyBand,
      variantNo: resolvedVariantNo,
      basedOnResourceOptionId: resolvedBasedOnResourceOptionId,
      sourceHash,
    });
    await insertTemplateQuestions({
      templateId,
      courseId: resolvedCourseId,
      difficultyBand: resolvedDifficultyBand,
      questions: finalQuestions,
    });
    await upsertTemplateValidationSummary({
      templateId,
      courseId: resolvedCourseId,
      version: resolvedVariantNo,
      status: "ready",
      templateTotalScore: 100,
      questions: finalQuestions,
    });

    console.info("[ai_test] template_reuse_decision", {
      decision: "regenerate",
      course_id: resolvedCourseId,
      template_id: templateId,
      difficulty_band: resolvedDifficultyBand,
      variant_no: resolvedVariantNo,
      based_on_resource_option_id: resolvedBasedOnResourceOptionId,
      question_count: finalQuestions.length,
      ai_provider: provenance.provider,
      ai_model: provenance.model,
      fallback_used: provenance.fallback_used,
    });

    return {
      templateId,
      reusedExisting: false,
      difficultyBand: resolvedDifficultyBand,
      variantNo: resolvedVariantNo,
      resourceContext: {
        selected_resource_option_id: resolvedBasedOnResourceOptionId,
        selected_resource_title: resourceContext.selected_resource_title,
        selected_resource_type: resourceContext.selected_resource_type,
        selected_resource_provider: resourceContext.selected_resource_provider,
        selected_resource_url: resourceContext.selected_resource_url,
        selected_resource_summary: resourceContext.selected_resource_summary,
      },
      metadata: {
        generated_at: new Date().toISOString(),
        attempt_number: Math.max(1, Math.floor(params.attemptNumber || 1)),
        variant_no: resolvedVariantNo,
        prompt_version: "ai_test_template_v3",
        requirements_met: {
          include_concept_and_skill_tags: true,
          vary_from_previous_attempts: true,
        },
        ai_provider: provenance.provider,
        ai_model: provenance.model,
        fallback_used: provenance.fallback_used,
        reused_existing: false,
      },
      aiProvenance: provenance,
    };
  } catch (error) {
    const errorRecord = (error ?? {}) as Record<string, unknown>;

    const originalErrorMessage =
      error instanceof Error
        ? error.message
        : typeof error === "string"
        ? error
        : toStringValue(errorRecord.message) ||
          toStringValue(errorRecord.details) ||
          toStringValue(errorRecord.hint) ||
          JSON.stringify(errorRecord);

    console.error("[ai_test] template_creation_failed_full", {
      raw_error: error,
      normalized_message: originalErrorMessage,
    });

    try {
      console.error(
        "[ai_test] template_creation_failed_full_pretty",
        JSON.stringify(error, null, 2),
      );
    } catch {}
    console.error("[ai_test] template_creation_failed", {
      course_id: resolvedCourseId,
      difficulty_band: resolvedDifficultyBand,
      variant_no: resolvedVariantNo,
      reason: originalErrorMessage,
    });
    if (originalErrorMessage === "Failed to insert AI test questions") {
      throw new Error(`AI test template generation failed: ${originalErrorMessage}`);
    }

    const fallback = await supabaseAdmin
      .from("ai_test_templates")
      .select("id")
      .eq("course_id", resolvedCourseId)
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(20);

    if (fallback.error || !fallback.data) {
      throw new Error(
        `No ready AI test template found for this course. Original error: ${originalErrorMessage}`,
      );
    }

    const fallbackRows = (fallback.data ?? []) as GenericRecord[];
    let fallbackTemplateId = "";
    for (const row of fallbackRows) {
      const candidateId = toStringValue(row.id);
      if (!candidateId) {
        continue;
      }
      const { count: questionCount, error: questionCountError } = await supabaseAdmin
        .from("ai_test_template_questions")
        .select("id", { count: "exact", head: true })
        .eq("template_id", candidateId);
      if (questionCountError) {
        continue;
      }
      if (Number(questionCount ?? 0) > 0) {
        fallbackTemplateId = candidateId;
        break;
      }
    }
    if (!fallbackTemplateId) {
      throw new Error(
        `No ready AI test template found for this course. Original error: ${originalErrorMessage}`,
      );
    }

    return {
      templateId: fallbackTemplateId,
      reusedExisting: true,
      difficultyBand: resolvedDifficultyBand,
      variantNo: resolvedVariantNo,
      resourceContext: {
        selected_resource_option_id: resolvedBasedOnResourceOptionId,
        selected_resource_title: resourceContext.selected_resource_title,
        selected_resource_type: resourceContext.selected_resource_type,
        selected_resource_provider: resourceContext.selected_resource_provider,
        selected_resource_url: resourceContext.selected_resource_url,
        selected_resource_summary: resourceContext.selected_resource_summary,
      },
      metadata: {
        generated_at: new Date().toISOString(),
        attempt_number: Math.max(1, Math.floor(params.attemptNumber || 1)),
        variant_no: resolvedVariantNo,
        prompt_version: "ai_test_template_v3",
        requirements_met: {
          include_concept_and_skill_tags: true,
          vary_from_previous_attempts: true,
        },
        ai_provider: provenance.provider,
        ai_model: provenance.model,
        fallback_used: provenance.fallback_used,
        reused_existing: true,
      },
      aiProvenance: provenance,
    };
  }
}
