import { z } from "zod";
import {
  normalizeDifficultyBand,
  sha256Hash,
  toNumberValue,
  toStringValue,
  type DifficultyBand,
} from "@/lib/ai/common";
import { generateStructuredJson, type AiProvenance } from "@/lib/ai/provider";
import { extractConceptTags, formatConceptLabel, normalizeConceptTag } from "@/lib/conceptTags";
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

  skill_tags: z
    .union([z.array(z.string()), z.null(), z.undefined()])
    .transform((value) => value ?? []),

  concept_tags: z
    .union([z.array(z.string()), z.null(), z.undefined()])
    .transform((value) => value ?? []),
});
const OBJECTIVE_QUESTION_COUNT = 14;
const SHORT_ANSWER_QUESTION_COUNT = 2;
const TOTAL_QUESTION_COUNT = OBJECTIVE_QUESTION_COUNT + SHORT_ANSWER_QUESTION_COUNT;
const OBJECTIVE_QUESTION_SCORE = 5;
const SHORT_ANSWER_QUESTION_SCORE = 15;
const PASS_SCORE_THRESHOLD = 80;
const AI_TEST_BLUEPRINT_PROMPT_VERSION = "ai_test_blueprint_v1";
const AI_TEST_BATCH_PROMPT_VERSION = "ai_test_batch_v1";
const BLUEPRINT_CACHE_TTL_MS = 1000 * 60 * 30;
const CONTEXT_CACHE_TTL_MS = 1000 * 60 * 60;
const COURSE_CONTEXT_CACHE_TABLE = "ai_test_course_context_cache";
const BLUEPRINT_CACHE_TABLE = "ai_test_blueprint_cache";

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

const blueprintQuestionPlanItemSchema = z.object({
  question_index: z.number().int().min(1).max(TOTAL_QUESTION_COUNT),
  question_type: z.enum(["multiple_choice", "fill_blank", "short_answer"]),
  concept_tag: z.string().min(1),
  skill_tag: z.string().min(1),
  intent: z.string().min(8),
});

const generatedBlueprintSchema = z.object({
  test_blueprint: z.object({
    core_concepts: z.array(z.string().min(1)).min(1),
    skill_tags: z.array(z.string().min(1)).min(1),
    question_plan: z.array(blueprintQuestionPlanItemSchema).min(1),
    metadata: z.record(z.string(), z.unknown()).optional().default({}),
  }),
});

type TestBlueprintQuestionPlanItem = z.infer<typeof blueprintQuestionPlanItemSchema>;

type TestBlueprint = {
  core_concepts: string[];
  skill_tags: string[];
  question_plan: TestBlueprintQuestionPlanItem[];
  metadata: Record<string, unknown>;
};

type CourseTestContextSummary = {
  course_title: string;
  concise_summary: string;
  core_concepts: string[];
  skill_tags: string[];
  course_description_summary: string | null;
  top_resource_summaries: string[];
  distilled_concepts: string[];
  distilled_skills: string[];
};

type CachedBlueprintEntry = {
  created_at_ms: number;
  blueprint: TestBlueprint;
  provenance: AiProvenance;
};

type CachedContextEntry = {
  created_at_ms: number;
  context: CourseTestContextSummary;
};

const aiTestBlueprintCache = new Map<string, CachedBlueprintEntry>();
const aiTestContextCache = new Map<string, CachedContextEntry>();

const courseContextSummarySchema = z.object({
  course_title: z.string().min(1),
  concise_summary: z.string().min(1),
  core_concepts: z.array(z.string()).min(1),
  skill_tags: z.array(z.string()).min(1),
  course_description_summary: z.string().nullable(),
  top_resource_summaries: z.array(z.string()),
  distilled_concepts: z.array(z.string()),
  distilled_skills: z.array(z.string()),
});

const generatedQuestionBatchSchema = z.object({
  question_batch: z.array(generatedQuestionSchema).length(4),
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

type AiResourceMetadata = {
  id: string;
  title: string;
  resource_type: string;
  provider: string | null;
  url: string | null;
  summary: string | null;
};

type FallbackContentContext = {
  courseTitle: string;
  courseDescription?: string | null;
  selectedResourceTitle?: string | null;
  selectedResourceType?: string | null;
  selectedResourceSummary?: string | null;
  resourceMetadata?: AiResourceMetadata[];
};

function compactWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function buildConceptPool(params: FallbackContentContext) {
  const extracted = extractConceptTags({
    texts: [
      params.courseTitle,
      params.courseDescription ?? "",
      params.selectedResourceTitle ?? "",
      params.selectedResourceType ?? "",
      params.selectedResourceSummary ?? "",
      ...(params.resourceMetadata ?? []).flatMap((resource) => [
        resource.title,
        resource.resource_type,
        resource.summary ?? "",
      ]),
    ],
    maxTags: 16,
  });
  if (extracted.length > 0) {
    return extracted;
  }
  return ["debugging", "implementation_logic", "data_validation", "problem_solving"];
}

function truncateText(value: string, maxLength: number) {
  const normalized = compactWhitespace(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}\u2026`;
}

function normalizeSkillTag(value: unknown) {
  const normalized = normalizeConceptTag(value);
  if (!normalized) {
    return "";
  }
  return normalized.endsWith("_application") || normalized.endsWith("_debugging")
    ? normalized
    : `${normalized}_application`;
}

function buildCourseTestContextSummary(params: {
  courseId: string;
  courseTitle: string;
  courseDescription?: string | null;
  selectedResourceTitle?: string | null;
  selectedResourceType?: string | null;
  selectedResourceSummary?: string | null;
  resourceMetadata?: AiResourceMetadata[];
}) {
  const resourceCandidates = [
    params.selectedResourceSummary ?? "",
    ...(params.resourceMetadata ?? []).map((resource) => resource.summary ?? ""),
  ]
    .map((item) => compactWhitespace(toStringValue(item)))
    .filter(Boolean)
    .slice(0, 5)
    .map((summary) => truncateText(summary, 260));

  const distilledConcepts = buildConceptPool({
    courseTitle: params.courseTitle,
    courseDescription: params.courseDescription ?? null,
    selectedResourceTitle: params.selectedResourceTitle ?? null,
    selectedResourceType: params.selectedResourceType ?? null,
    selectedResourceSummary: params.selectedResourceSummary ?? null,
    resourceMetadata: params.resourceMetadata ?? [],
  }).slice(0, 10);

  const distilledSkills = Array.from(
    new Set(
      distilledConcepts
        .map((conceptTag) => normalizeSkillTag(conceptTag))
        .filter(Boolean),
    ),
  ).slice(0, 8);

  const conciseSummary = [
    truncateText(toStringValue(params.courseDescription), 220),
    ...resourceCandidates.slice(0, 2).map((summary) => truncateText(summary, 130)),
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  const resolvedConciseSummary =
    conciseSummary || `Focused ${params.courseTitle} assessment context for practical final-exam style questions.`;

  return {
    course_title: params.courseTitle,
    concise_summary: resolvedConciseSummary,
    core_concepts: distilledConcepts,
    skill_tags:
      distilledSkills.length > 0
        ? distilledSkills
        : ["problem_solving_application", "debugging_application"],
    course_description_summary: truncateText(toStringValue(params.courseDescription), 420) || null,
    top_resource_summaries: resourceCandidates,
    distilled_concepts: distilledConcepts,
    distilled_skills:
      distilledSkills.length > 0
        ? distilledSkills
        : ["problem_solving_application", "debugging_application"],
  } satisfies CourseTestContextSummary;
}

function normalizeCourseContextSummary(value: unknown) {
  const parsed = courseContextSummarySchema.safeParse(value);
  if (!parsed.success) {
    return null;
  }
  const data = parsed.data;
  return {
    ...data,
    core_concepts: data.core_concepts.map((item) => normalizeConceptTag(item)).filter(Boolean),
    skill_tags: data.skill_tags.map((item) => normalizeSkillTag(item)).filter(Boolean),
    distilled_concepts: data.distilled_concepts
      .map((item) => normalizeConceptTag(item))
      .filter(Boolean),
    distilled_skills: data.distilled_skills
      .map((item) => normalizeSkillTag(item))
      .filter(Boolean),
  } satisfies CourseTestContextSummary;
}

function buildContextSourceHash(params: {
  courseId: string;
  courseTitle: string;
  courseDescription?: string | null;
  selectedResourceTitle?: string | null;
  selectedResourceType?: string | null;
  selectedResourceSummary?: string | null;
  resourceMetadata?: AiResourceMetadata[];
}) {
  return sha256Hash({
    course_id: params.courseId,
    course_title: params.courseTitle,
    course_description: params.courseDescription ?? null,
    selected_resource_title: params.selectedResourceTitle ?? null,
    selected_resource_type: params.selectedResourceType ?? null,
    selected_resource_summary: params.selectedResourceSummary ?? null,
    resource_metadata: (params.resourceMetadata ?? []).map((resource) => ({
      id: resource.id,
      title: resource.title,
      type: resource.resource_type,
      summary: resource.summary ?? null,
    })),
  });
}

async function loadCourseContextSummaryFromDb(params: {
  courseId: string;
  sourceHash: string;
}) {
  const { data, error } = await supabaseAdmin
    .from(COURSE_CONTEXT_CACHE_TABLE)
    .select("context_json, source_hash")
    .eq("course_id", params.courseId)
    .eq("source_hash", params.sourceHash)
    .limit(1);
  if (error) {
    if (!isMissingRelationOrColumnError(error)) {
      console.warn("[ai_test] context_cache_db_read_failed", {
        course_id: params.courseId,
        reason: error.message,
      });
    }
    return null;
  }
  const row = ((data ?? []) as GenericRecord[])[0];
  if (!row) {
    return null;
  }
  return normalizeCourseContextSummary((row.context_json ?? null) as unknown);
}

async function storeCourseContextSummaryToDb(params: {
  courseId: string;
  sourceHash: string;
  context: CourseTestContextSummary;
}) {
  const nowIso = new Date().toISOString();
  const { error } = await supabaseAdmin.from(COURSE_CONTEXT_CACHE_TABLE).insert({
    course_id: params.courseId,
    source_hash: params.sourceHash,
    context_json: params.context,
    created_at: nowIso,
    updated_at: nowIso,
  });
  if (error && !isMissingRelationOrColumnError(error)) {
    console.warn("[ai_test] context_cache_db_write_failed", {
      course_id: params.courseId,
      reason: error.message,
    });
  }
}

async function getCachedCourseTestContext(params: {
  courseId: string;
  courseTitle: string;
  courseDescription?: string | null;
  selectedResourceTitle?: string | null;
  selectedResourceType?: string | null;
  selectedResourceSummary?: string | null;
  resourceMetadata?: AiResourceMetadata[];
}): Promise<{ context: CourseTestContextSummary; sourceHash: string }> {
  const sourceHash = buildContextSourceHash(params);
  const cacheKey = `${params.courseId}::${sourceHash}`;
  const now = Date.now();
  const cached = aiTestContextCache.get(cacheKey);
  if (cached && now - cached.created_at_ms <= CONTEXT_CACHE_TTL_MS) {
    console.info("[ai_test] context_cache_hit", {
      course_id: params.courseId,
      age_ms: now - cached.created_at_ms,
    });
    return {
      context: cached.context,
      sourceHash,
    };
  }

  const dbContext = await loadCourseContextSummaryFromDb({
    courseId: params.courseId,
    sourceHash,
  });
  if (dbContext) {
    aiTestContextCache.set(cacheKey, {
      created_at_ms: now,
      context: dbContext,
    });
    console.info("[ai_test] context_cache_db_hit", {
      course_id: params.courseId,
    });
    return {
      context: dbContext,
      sourceHash,
    };
  }

  const context = buildCourseTestContextSummary(params);
  aiTestContextCache.set(cacheKey, {
    created_at_ms: now,
    context,
  });
  await storeCourseContextSummaryToDb({
    courseId: params.courseId,
    sourceHash,
    context,
  });
  console.info("[ai_test] context_cache_miss", {
    course_id: params.courseId,
    context_concept_count: context.distilled_concepts.length,
    context_resource_summary_count: context.top_resource_summaries.length,
  });
  return {
    context,
    sourceHash,
  };
}

function buildDeterministicBlueprint(params: {
  difficultyBand: DifficultyBand;
  context: CourseTestContextSummary;
}) {
  const coreConcepts = Array.from(
    new Set(params.context.distilled_concepts.map((item) => normalizeConceptTag(item)).filter(Boolean)),
  )
    .slice(0, 10);
  while (coreConcepts.length < 6) {
    coreConcepts.push(
      ["debugging", "problem_solving", "data_validation", "implementation_logic"][
        coreConcepts.length % 4
      ],
    );
  }

  const skillTags = Array.from(
    new Set(
      [...params.context.distilled_skills, ...coreConcepts.map((item) => `${item}_application`)]
        .map((item) => normalizeSkillTag(item))
        .filter(Boolean),
    ),
  ).slice(0, 8);

  const resolvedSkillTags =
    skillTags.length >= 4
      ? skillTags
      : Array.from(
          new Set([
            ...skillTags,
            "debugging_application",
            "implementation_logic_application",
            "problem_solving_application",
            "edge_case_validation_application",
          ]),
        ).slice(0, 8);

  const questionPlan: TestBlueprintQuestionPlanItem[] = [];
  for (let index = 1; index <= TOTAL_QUESTION_COUNT; index += 1) {
    const questionType: TestBlueprintQuestionPlanItem["question_type"] =
      index <= OBJECTIVE_QUESTION_COUNT
        ? index % 2 === 0
          ? "fill_blank"
          : "multiple_choice"
        : "short_answer";
    const conceptTag = coreConcepts[(index - 1) % coreConcepts.length];
    const skillTag = resolvedSkillTags[(index - 1) % resolvedSkillTags.length];
    const intent =
      questionType === "short_answer"
        ? `Solve a realistic ${formatConceptLabel(conceptTag)} implementation/debugging task with clear correction steps.`
        : questionType === "fill_blank"
        ? `Complete a concrete ${formatConceptLabel(conceptTag)} step/token used in practical work.`
        : `Choose the best concrete workflow for applying ${formatConceptLabel(conceptTag)} in a real scenario.`;
    questionPlan.push({
      question_index: index,
      question_type: questionType,
      concept_tag: conceptTag,
      skill_tag: skillTag,
      intent,
    });
  }

  return {
    core_concepts: coreConcepts,
    skill_tags: resolvedSkillTags,
    question_plan: questionPlan,
    metadata: {
      generated_by: "deterministic-blueprint-fallback",
      difficulty_band: params.difficultyBand,
    },
  } satisfies TestBlueprint;
}

function normalizeBlueprint(params: {
  blueprint: GenericRecord;
  difficultyBand: DifficultyBand;
  context: CourseTestContextSummary;
}) {
  const deterministic = buildDeterministicBlueprint({
    difficultyBand: params.difficultyBand,
    context: params.context,
  });

  const rawConcepts = Array.isArray(params.blueprint.core_concepts)
    ? params.blueprint.core_concepts
    : [];
  const normalizedConcepts = Array.from(
    new Set(
      [
        ...rawConcepts.map((item) => normalizeConceptTag(item)).filter(Boolean),
        ...params.context.distilled_concepts.map((item) => normalizeConceptTag(item)).filter(Boolean),
      ].filter(
        (item) =>
          item &&
          !/\bconcept\b/.test(item) &&
          !/\d+$/.test(item),
      ),
    ),
  ).slice(0, 10);

  const coreConcepts = (normalizedConcepts.length >= 6
    ? normalizedConcepts
    : Array.from(new Set([...normalizedConcepts, ...deterministic.core_concepts])).slice(0, 10)
  ).slice(0, 10);

  const rawSkills = Array.isArray(params.blueprint.skill_tags)
    ? params.blueprint.skill_tags
    : [];
  const normalizedSkills = Array.from(
    new Set(
      [
        ...rawSkills.map((item) => normalizeSkillTag(item)).filter(Boolean),
        ...params.context.distilled_skills.map((item) => normalizeSkillTag(item)).filter(Boolean),
      ].filter(Boolean),
    ),
  ).slice(0, 8);
  const skillTags =
    normalizedSkills.length >= 4
      ? normalizedSkills
      : Array.from(new Set([...normalizedSkills, ...deterministic.skill_tags])).slice(0, 8);

  const rawPlan = Array.isArray(params.blueprint.question_plan)
    ? (params.blueprint.question_plan as GenericRecord[])
    : [];

  const pickPlanRow = (index: number) =>
    rawPlan.find((item) => Math.floor(toNumberValue(item.question_index)) === index) ?? null;

  const questionPlan: TestBlueprintQuestionPlanItem[] = [];
  for (let index = 1; index <= TOTAL_QUESTION_COUNT; index += 1) {
    const fallbackRow = deterministic.question_plan[index - 1];
    const source = pickPlanRow(index);
    const rawType = source ? normalizeQuestionType(source.question_type) : fallbackRow.question_type;
    const forcedType: TestBlueprintQuestionPlanItem["question_type"] =
      index <= OBJECTIVE_QUESTION_COUNT
        ? rawType === "short_answer"
          ? fallbackRow.question_type
          : rawType
        : "short_answer";
    const conceptTag = normalizeConceptTag(source?.concept_tag) || fallbackRow.concept_tag;
    const skillTag = normalizeSkillTag(source?.skill_tag) || fallbackRow.skill_tag;
    const rawIntent = compactWhitespace(toStringValue(source?.intent));
    const intent =
      rawIntent && !/\bconcept\s*\d+\b/i.test(rawIntent)
        ? rawIntent
        : fallbackRow.intent;

    questionPlan.push({
      question_index: index,
      question_type: forcedType,
      concept_tag: conceptTag,
      skill_tag: skillTag,
      intent,
    });
  }

  return {
    core_concepts: coreConcepts,
    skill_tags: skillTags,
    question_plan: questionPlan,
    metadata:
      params.blueprint.metadata && typeof params.blueprint.metadata === "object"
        ? (params.blueprint.metadata as Record<string, unknown>)
        : {},
  } satisfies TestBlueprint;
}

function pickConceptTag(tags: string[], index: number) {
  if (tags.length === 0) {
    return "problem_solving";
  }
  return tags[index % tags.length];
}

function buildMeaningfulMultipleChoiceOptions(params: {
  conceptLabel: string;
}) {
  return [
    `Analyze the ${params.conceptLabel} requirement, implement the core logic, and verify output with edge cases.`,
    `Apply ${params.conceptLabel} without checking assumptions or validating intermediate states.`,
    `Select tools by popularity instead of fitness for ${params.conceptLabel} tasks.`,
    `Optimize runtime before confirming ${params.conceptLabel} correctness and failure handling.`,
  ];
}

function getFallbackTemplate(params: {
  courseId: string;
  courseTitle: string;
  courseDescription?: string | null;
  attemptNumber: number;
  difficultyBand: DifficultyBand;
  selectedResourceOptionId?: string | null;
  selectedResourceTitle?: string | null;
  selectedResourceType?: string | null;
  selectedResourceProvider?: string | null;
  selectedResourceUrl?: string | null;
  selectedResourceSummary?: string | null;
  resourceMetadata?: AiResourceMetadata[];
}) {
  const totalQuestions = TOTAL_QUESTION_COUNT;
  const questions: Array<z.infer<typeof generatedQuestionSchema>> = [];
  const conceptPool = buildConceptPool({
    courseTitle: params.courseTitle,
    courseDescription: params.courseDescription ?? null,
    selectedResourceTitle: params.selectedResourceTitle ?? null,
    selectedResourceType: params.selectedResourceType ?? null,
    selectedResourceSummary: params.selectedResourceSummary ?? null,
    resourceMetadata: params.resourceMetadata ?? [],
  });

  for (let index = 0; index < totalQuestions; index += 1) {
    const questionNo = index + 1;
    const questionType =
      questionNo <= OBJECTIVE_QUESTION_COUNT
        ? questionNo % 2 === 0
          ? "fill_blank"
          : "multiple_choice"
        : "short_answer";
    const conceptTag = pickConceptTag(conceptPool, index);
    const conceptLabel = formatConceptLabel(conceptTag);
    const options = buildMeaningfulMultipleChoiceOptions({
      conceptLabel,
    });

    questions.push({
      question_id: `q${questionNo}_v${Math.max(1, Math.floor(params.attemptNumber || 1))}`,
      question_type: questionType,
      question_text:
        questionType === "short_answer"
          ? `Case ${questionNo}: In ${params.courseTitle}, a learner keeps making mistakes on ${conceptLabel}. Provide a practical fix plan with root-cause analysis, corrected logic or pseudocode, and concrete test cases.`
          : questionType === "fill_blank"
          ? `Case ${questionNo}: For ${params.courseTitle}, fill in the blank: before finalizing a solution involving ${conceptLabel}, always ____ against realistic edge cases.`
          : `Case ${questionNo}: In ${params.courseTitle}, which approach best applies ${conceptLabel} in a real workflow?`,
      options: questionType === "multiple_choice" ? options : [],
      correct_answer:
        questionType === "multiple_choice"
          ? options[0]
          : questionType === "fill_blank"
          ? "validate assumptions"
          : questionType === "short_answer"
          ? `Identify the ${conceptLabel} failure mode, implement corrected logic, and verify with targeted tests.`
          : "validate assumptions",
      acceptable_answers:
        questionType === "short_answer" || questionType === "fill_blank"
          ? [
              "validate assumptions",
              "verify with edge cases",
              `correct ${conceptLabel} logic`,
            ]
          : [],
      score:
        questionType === "short_answer"
          ? SHORT_ANSWER_QUESTION_SCORE
          : OBJECTIVE_QUESTION_SCORE,
      explanation: `Focus on practical decision quality for ${conceptLabel} in ${params.courseTitle}.`,
      skill_tags: [`${conceptTag}_application`],
      concept_tags: [conceptTag],
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
  courseDescription?: string | null;
  selectedResourceTitle?: string | null;
  selectedResourceType?: string | null;
  selectedResourceSummary?: string | null;
  resourceMetadata?: AiResourceMetadata[];
  questionOrder: number;
  type: "multiple_choice" | "fill_blank" | "short_answer";
  difficultyBand: DifficultyBand;
  variantNo: number;
}) {
  const conceptPool = buildConceptPool({
    courseTitle: params.courseTitle,
    courseDescription: params.courseDescription ?? null,
    selectedResourceTitle: params.selectedResourceTitle ?? null,
    selectedResourceType: params.selectedResourceType ?? null,
    selectedResourceSummary: params.selectedResourceSummary ?? null,
    resourceMetadata: params.resourceMetadata ?? [],
  });
  const conceptTag = pickConceptTag(conceptPool, params.questionOrder - 1);
  const conceptLabel = formatConceptLabel(conceptTag);
  const baseSkill = `${conceptTag}_application`;
  const baseConcept = conceptTag;
  if (params.type === "multiple_choice") {
    const options = buildMeaningfulMultipleChoiceOptions({
      conceptLabel,
    });
    return {
      question_order: params.questionOrder,
      question_type: "multiple_choice" as const,
      question_text: `Case ${params.questionOrder}: In ${params.courseTitle}, which workflow best applies ${conceptLabel} under realistic constraints?`,
      options,
      correct_answer_text: options[0],
      acceptable_answers: [],
      score: OBJECTIVE_QUESTION_SCORE,
      explanation: `Evaluate each option by implementation quality and verification depth for ${conceptLabel}.`,
      external_question_key: `fallback_mc_${params.variantNo}_${params.questionOrder}`,
      skill_tags: [baseSkill],
      concept_tags: [baseConcept],
    } satisfies GeneratedAiQuestion;
  }
  if (params.type === "fill_blank") {
    return {
      question_order: params.questionOrder,
      question_type: "fill_blank" as const,
      question_text: `Case ${params.questionOrder}: Fill in the blank for ${params.courseTitle}: when handling ${conceptLabel}, always ____ results against representative edge cases.`,
      options: [],
      correct_answer_text: "validate",
      acceptable_answers: ["validate", "verify"],
      score: OBJECTIVE_QUESTION_SCORE,
      explanation: `The blank should represent validation behavior that improves reliability.`,
      external_question_key: `fallback_fb_${params.variantNo}_${params.questionOrder}`,
      skill_tags: [baseSkill],
      concept_tags: [baseConcept],
    } satisfies GeneratedAiQuestion;
  }
  return {
    question_order: params.questionOrder,
    question_type: "short_answer" as const,
    question_text: `Case ${params.questionOrder}: A learner in ${params.courseTitle} fails tasks related to ${conceptLabel}. Provide a concrete remediation: identify the root cause, write corrected core logic/pseudocode, and define how to test the fix.`,
    options: [],
    correct_answer_text: `Explain corrected ${conceptLabel} logic with targeted validation.`,
    acceptable_answers: [
      "root cause",
      "corrected logic",
      "test cases",
    ],
    score: SHORT_ANSWER_QUESTION_SCORE,
    explanation: `Strong answers must include practical implementation and debugging details.`,
    external_question_key: `fallback_sa_${params.variantNo}_${params.questionOrder}`,
    skill_tags: [baseSkill],
    concept_tags: [baseConcept],
  } satisfies GeneratedAiQuestion;
}

function deriveConceptTagsForQuestion(params: {
  explicitConceptTags: unknown[];
  questionText: string;
  explanation: string;
  courseTitle: string;
  courseDescription?: string | null;
  selectedResourceTitle?: string | null;
  selectedResourceSummary?: string | null;
  resourceMetadata?: AiResourceMetadata[];
  fallbackConceptTag: string;
}) {
  const explicit = params.explicitConceptTags
    .map((item) => normalizeConceptTag(normalizeUnknownItemToString(item)))
    .filter(Boolean);
  if (explicit.length > 0) {
    return Array.from(new Set(explicit));
  }

  const extracted = extractConceptTags({
    texts: [
      params.questionText,
      params.explanation,
      params.courseTitle,
      params.courseDescription ?? "",
      params.selectedResourceTitle ?? "",
      params.selectedResourceSummary ?? "",
      ...(params.resourceMetadata ?? []).flatMap((resource) => [
        resource.title,
        resource.resource_type,
        resource.summary ?? "",
      ]),
    ],
    maxTags: 3,
  });
  if (extracted.length > 0) {
    return extracted;
  }

  return [params.fallbackConceptTag];
}

function normalizeGeneratedQuestions(params: {
  rawQuestions: Array<z.infer<typeof generatedQuestionSchema>>;
  difficultyBand: DifficultyBand;
  courseTitle: string;
  courseDescription?: string | null;
  selectedResourceTitle?: string | null;
  selectedResourceType?: string | null;
  selectedResourceSummary?: string | null;
  resourceMetadata?: AiResourceMetadata[];
}) {
  const normalized: GeneratedAiQuestion[] = [];
  const conceptPool = buildConceptPool({
    courseTitle: params.courseTitle,
    courseDescription: params.courseDescription ?? null,
    selectedResourceTitle: params.selectedResourceTitle ?? null,
    selectedResourceType: params.selectedResourceType ?? null,
    selectedResourceSummary: params.selectedResourceSummary ?? null,
    resourceMetadata: params.resourceMetadata ?? [],
  });

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
      const fallbackConceptTag = pickConceptTag(conceptPool, index);
      const fallbackConceptLabel = formatConceptLabel(fallbackConceptTag);
      const fallbackOptions = buildMeaningfulMultipleChoiceOptions({
        conceptLabel: fallbackConceptLabel,
      });
      if (normalizedOptions.length === 0) {
        normalizedOptions = fallbackOptions;
      } else if (normalizedOptions.length < 4) {
        const seed = [...normalizedOptions];
        while (seed.length < 4) {
          seed.push(fallbackOptions[seed.length]);
        }
        normalizedOptions = seed.slice(0, 4);
      } else {
        normalizedOptions = normalizedOptions.slice(0, 4);
      }
    }
    const fallbackConceptTag = pickConceptTag(conceptPool, index);
    const fallbackConceptLabel = formatConceptLabel(fallbackConceptTag);
    const correctAnswerText = normalizeCorrectAnswerText({
      questionType,
      rawCorrectAnswer: question.correct_answer,
      fallback: firstNonEmpty([
        questionType === "multiple_choice" ? normalizedOptions[0] : "",
        questionType === "short_answer" || questionType === "fill_blank"
          ? `apply ${fallbackConceptLabel} with explicit validation`
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
    if (rawScoreValue > 0) {
      console.info("[ai_test_template] raw_score_detected", {
        index,
        value: Math.floor(rawScoreValue),
      });
    }
    const normalizedRawScore = Math.max(
      1,
      Math.floor(rawScoreValue > 0 ? rawScoreValue : OBJECTIVE_QUESTION_SCORE),
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
        fullSkillTags
          .map((item) => normalizeConceptTag(item))
          .filter(Boolean).length > 0
          ? Array.from(
              new Set(
                fullSkillTags
                  .map((item) => normalizeConceptTag(item))
                  .filter(Boolean),
              ),
            )
          : [`${fallbackConceptTag}_application`],
      concept_tags: deriveConceptTagsForQuestion({
        explicitConceptTags: fullConceptTags,
        questionText,
        explanation,
        courseTitle: params.courseTitle,
        courseDescription: params.courseDescription ?? null,
        selectedResourceTitle: params.selectedResourceTitle ?? null,
        selectedResourceSummary: params.selectedResourceSummary ?? null,
        resourceMetadata: params.resourceMetadata ?? [],
        fallbackConceptTag,
      }),
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
  courseDescription?: string | null;
  selectedResourceTitle?: string | null;
  selectedResourceType?: string | null;
  selectedResourceSummary?: string | null;
  resourceMetadata?: AiResourceMetadata[];
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
      courseDescription: params.courseDescription ?? null,
      selectedResourceTitle: params.selectedResourceTitle ?? null,
      selectedResourceType: params.selectedResourceType ?? null,
      selectedResourceSummary: params.selectedResourceSummary ?? null,
      resourceMetadata: params.resourceMetadata ?? [],
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
      courseDescription: params.courseDescription ?? null,
      selectedResourceTitle: params.selectedResourceTitle ?? null,
      selectedResourceType: params.selectedResourceType ?? null,
      selectedResourceSummary: params.selectedResourceSummary ?? null,
      resourceMetadata: params.resourceMetadata ?? [],
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
  if (fallbackQuestions.length > 0) {
    console.warn("[ai_test] fallback_used", {
      fallback_question_count: fallbackQuestions.length,
      total_questions: finalQuestions.length,
      course_title: params.courseTitle,
      variant_no: params.variantNo,
    });
    console.warn("[pipeline] fallback_used", {
      pipeline: "ai_test_template",
      source: "composition_fallback",
      fallback_question_count: fallbackQuestions.length,
      total_questions: finalQuestions.length,
      variant_no: params.variantNo,
    });
  }
  console.info("[ai_test] validation_summary", {
    expected_total_questions: TOTAL_QUESTION_COUNT,
    actual_total_questions: finalQuestions.length,
    expected_objective_count: OBJECTIVE_QUESTION_COUNT,
    actual_objective_count: compositionBreakdown.multiple_choice + compositionBreakdown.fill_blank,
    expected_short_answer_count: SHORT_ANSWER_QUESTION_COUNT,
    actual_short_answer_count: compositionBreakdown.short_answer,
    expected_objective_score_each: OBJECTIVE_QUESTION_SCORE,
    expected_short_answer_score_each: SHORT_ANSWER_QUESTION_SCORE,
    total_score: totalScore,
    pass_threshold: PASS_SCORE_THRESHOLD,
    per_question_scores: finalQuestions.map((question) => ({
      order: question.question_order,
      type: question.question_type,
      score: question.score,
    })),
  });

  return {
    finalQuestions,
    fallbackQuestions,
    compositionBreakdown,
    totalScore,
  };
}

function evaluateGeneratedTestQuality(params: {
  questions: GeneratedAiQuestion[];
  blueprint: TestBlueprint;
}) {
  const reasons: string[] = [];
  const normalizedQuestionTexts = params.questions
    .map((question) => compactWhitespace(question.question_text.toLowerCase()))
    .filter(Boolean);
  const uniqueQuestionTextCount = new Set(normalizedQuestionTexts).size;
  if (uniqueQuestionTextCount < Math.max(14, TOTAL_QUESTION_COUNT - 1)) {
    reasons.push("question_text_repetition_high");
  }

  const repeatedStemCount = (() => {
    const prefixMap = new Map<string, number>();
    for (const text of normalizedQuestionTexts) {
      const key = text.slice(0, 56);
      prefixMap.set(key, (prefixMap.get(key) ?? 0) + 1);
    }
    return Array.from(prefixMap.values()).filter((count) => count > 1).length;
  })();
  if (repeatedStemCount > 4) {
    reasons.push("question_stem_repetition_high");
  }

  const placeholderQuestionCount = normalizedQuestionTexts.filter(
    (text) =>
      /\bconcept\s*\d+\b/i.test(text) ||
      /\bquestion\s*\d+\b/i.test(text) ||
      /\bwhich option best matches\b/i.test(text),
  ).length;
  if (placeholderQuestionCount > 0) {
    reasons.push("placeholder_question_text_detected");
  }

  const placeholderOptionCount = params.questions.filter((question) => {
    if (question.question_type !== "multiple_choice" || question.options.length !== 4) {
      return false;
    }
    return question.options.every((option) => /^option\s*[a-d]$/i.test(compactWhitespace(option)));
  }).length;
  if (placeholderOptionCount > 0) {
    reasons.push("placeholder_multiple_choice_options_detected");
  }

  const conceptTags = params.questions
    .map((question) => normalizeConceptTag(question.concept_tags[0] ?? ""))
    .filter(Boolean);
  const uniqueConceptCount = new Set(conceptTags).size;
  if (uniqueConceptCount < 6) {
    reasons.push("concept_coverage_too_narrow");
  }

  const conceptFrequency = conceptTags.reduce<Record<string, number>>((acc, tag) => {
    acc[tag] = (acc[tag] ?? 0) + 1;
    return acc;
  }, {});
  const dominantConceptCount = Object.values(conceptFrequency).reduce(
    (max, count) => (count > max ? count : max),
    0,
  );
  if (dominantConceptCount > 4) {
    reasons.push("single_concept_overused");
  }

  const genericConceptTagCount = conceptTags.filter(
    (tag) =>
      /(^|_)(machine|learning|course|lesson|concept|topic|general|foundation)($|_)/.test(tag) ||
      /_concept$/.test(tag),
  ).length;
  if (genericConceptTagCount > 0) {
    reasons.push("generic_concept_tags_detected");
  }

  const blueprintIntentCoverage = params.blueprint.question_plan.filter((planItem) =>
    params.questions.some(
      (question) =>
        question.question_order === planItem.question_index &&
        normalizeConceptTag(question.concept_tags[0] ?? "") === normalizeConceptTag(planItem.concept_tag),
    ),
  ).length;
  if (blueprintIntentCoverage < 12) {
    reasons.push("blueprint_alignment_low");
  }

  const metrics = {
    question_count: params.questions.length,
    unique_question_text_count: uniqueQuestionTextCount,
    repeated_stem_count: repeatedStemCount,
    placeholder_question_count: placeholderQuestionCount,
    placeholder_option_count: placeholderOptionCount,
    unique_concept_count: uniqueConceptCount,
    dominant_concept_count: dominantConceptCount,
    generic_concept_tag_count: genericConceptTagCount,
    blueprint_alignment_count: blueprintIntentCoverage,
  };

  console.info("[ai_test] quality_check", {
    passed: reasons.length === 0,
    reasons,
    ...metrics,
  });

  return {
    passed: reasons.length === 0,
    reasons,
    metrics,
  };
}

async function generateBlueprintForAiTest(params: {
  courseId: string;
  courseTitle: string;
  courseDescription?: string | null;
  difficultyBand: DifficultyBand;
  context: CourseTestContextSummary;
  contextSourceHash: string;
}) {
  const sourceHash = sha256Hash({
    course_id: params.courseId,
    difficulty_band: params.difficultyBand,
    context_source_hash: params.contextSourceHash,
    prompt_version: AI_TEST_BLUEPRINT_PROMPT_VERSION,
  });
  const cacheKey = `${params.courseId}::${params.difficultyBand}::${sourceHash}`;
  const now = Date.now();
  const cached = aiTestBlueprintCache.get(cacheKey);
  if (cached && now - cached.created_at_ms <= BLUEPRINT_CACHE_TTL_MS) {
    console.info("[ai_test] blueprint_cache_hit", {
      course_id: params.courseId,
      difficulty_band: params.difficultyBand,
      age_ms: now - cached.created_at_ms,
    });
    return {
      blueprint: cached.blueprint,
      provenance: cached.provenance,
      fromCache: true,
    };
  }

  const { data: cachedRows, error: cachedReadError } = await supabaseAdmin
    .from(BLUEPRINT_CACHE_TABLE)
    .select("blueprint_json, source_hash")
    .eq("course_id", params.courseId)
    .eq("difficulty_band", params.difficultyBand)
    .eq("source_hash", sourceHash)
    .limit(1);
  if (cachedReadError) {
    if (!isMissingRelationOrColumnError(cachedReadError)) {
      console.warn("[ai_test] blueprint_cache_db_read_failed", {
        course_id: params.courseId,
        difficulty_band: params.difficultyBand,
        reason: cachedReadError.message,
      });
    }
  } else {
    const row = ((cachedRows ?? []) as GenericRecord[])[0];
    if (row && row.blueprint_json && typeof row.blueprint_json === "object") {
      const normalizedCachedBlueprint = normalizeBlueprint({
        blueprint: row.blueprint_json as GenericRecord,
        difficultyBand: params.difficultyBand,
        context: params.context,
      });
      const cachedProvenance: AiProvenance = {
        provider: "deterministic",
        model: "db-blueprint-cache",
        prompt_version: AI_TEST_BLUEPRINT_PROMPT_VERSION,
        generated_at: new Date().toISOString(),
        fallback_used: false,
        failure_reason: null,
      };
      aiTestBlueprintCache.set(cacheKey, {
        created_at_ms: now,
        blueprint: normalizedCachedBlueprint,
        provenance: cachedProvenance,
      });
      console.info("[ai_test] blueprint_cache_db_hit", {
        course_id: params.courseId,
        difficulty_band: params.difficultyBand,
      });
      return {
        blueprint: normalizedCachedBlueprint,
        provenance: cachedProvenance,
        fromCache: true,
      };
    }
  }

  const deterministicBlueprint = buildDeterministicBlueprint({
    difficultyBand: params.difficultyBand,
    context: params.context,
  });

  const { output, provenance } = await generateStructuredJson({
    feature: "ai_test_blueprint",
    promptVersion: AI_TEST_BLUEPRINT_PROMPT_VERSION,
    systemInstruction: [
      "Generate AI test blueprint JSON only.",
      "Return root key test_blueprint.",
      "test_blueprint must include core_concepts, skill_tags, question_plan, metadata.",
      "Generate 6 to 10 specific core_concepts in lowercase underscore format.",
      "Generate 4 to 8 concrete skill_tags in lowercase underscore format.",
      "Generate exactly 16 question_plan items.",
      "question_plan item fields: question_index, question_type, concept_tag, skill_tag, intent.",
      "question_index must be 1..16.",
      "question_type composition must be 14 objective (multiple_choice or fill_blank) and 2 short_answer.",
      "concept_tag must be educationally meaningful and specific.",
      "Do not output generic tags such as machine, course, lesson, concept, or tags ending with _concept.",
      "Do not output numbered placeholders such as concept_1.",
      "question_plan intents must be practical, scenario-based, and non-repetitive.",
      "This is a university-level exam blueprint.",
    ].join(" "),
    input: {
      course_id: params.courseId,
      course_title: params.courseTitle,
      course_description: params.courseDescription ?? null,
      difficulty_band: params.difficultyBand,
      context_summary: params.context,
      target_composition: {
        total_questions: TOTAL_QUESTION_COUNT,
        objective_questions: OBJECTIVE_QUESTION_COUNT,
        short_answer_questions: SHORT_ANSWER_QUESTION_COUNT,
      },
    },
    outputSchema: generatedBlueprintSchema,
    fallback: () => ({
      test_blueprint: deterministicBlueprint,
    }),
    maxOutputTokens: 1600,
  });

  const blueprintRecord = ((output as GenericRecord).test_blueprint ?? {}) as GenericRecord;
  const normalizedBlueprint = normalizeBlueprint({
    blueprint: blueprintRecord,
    difficultyBand: params.difficultyBand,
    context: params.context,
  });

  aiTestBlueprintCache.set(cacheKey, {
    created_at_ms: now,
    blueprint: normalizedBlueprint,
    provenance,
  });
  const nowIso = new Date().toISOString();
  const { error: cachedWriteError } = await supabaseAdmin.from(BLUEPRINT_CACHE_TABLE).insert({
    course_id: params.courseId,
    difficulty_band: params.difficultyBand,
    source_hash: sourceHash,
    blueprint_json: normalizedBlueprint,
    prompt_version: AI_TEST_BLUEPRINT_PROMPT_VERSION,
    created_at: nowIso,
    updated_at: nowIso,
  });
  if (cachedWriteError && !isMissingRelationOrColumnError(cachedWriteError)) {
    console.warn("[ai_test] blueprint_cache_db_write_failed", {
      course_id: params.courseId,
      difficulty_band: params.difficultyBand,
      reason: cachedWriteError.message,
    });
  }
  console.info("[ai_test] blueprint_cache_write", {
    course_id: params.courseId,
    difficulty_band: params.difficultyBand,
    fallback_used: provenance.fallback_used,
    core_concept_count: normalizedBlueprint.core_concepts.length,
    skill_tag_count: normalizedBlueprint.skill_tags.length,
    plan_count: normalizedBlueprint.question_plan.length,
  });

  return {
    blueprint: normalizedBlueprint,
    provenance,
    fromCache: false,
  };
}

function createFallbackQuestionFromPlanItem(params: {
  courseTitle: string;
  difficultyBand: DifficultyBand;
  variantNo: number;
  planItem: TestBlueprintQuestionPlanItem;
}) {
  const conceptTag = normalizeConceptTag(params.planItem.concept_tag) || "problem_solving";
  const conceptLabel = formatConceptLabel(conceptTag);
  const skillTag = normalizeSkillTag(params.planItem.skill_tag) || `${conceptTag}_application`;
  const questionType = params.planItem.question_type;
  const qNo = params.planItem.question_index;
  if (questionType === "multiple_choice") {
    const options = buildMeaningfulMultipleChoiceOptions({ conceptLabel });
    return {
      question_id: `batch_fallback_q${qNo}_v${params.variantNo}`,
      question_type: "multiple_choice",
      question_text: `Case ${qNo}: In ${params.courseTitle}, which approach best applies ${conceptLabel} to solve a practical task with constraints?`,
      options,
      correct_answer: options[0],
      acceptable_answers: [],
      explanation: `Choose the option that validates assumptions and verifies outcomes for ${conceptLabel}.`,
      score: OBJECTIVE_QUESTION_SCORE,
      concept_tags: [conceptTag],
      skill_tags: [skillTag],
    } satisfies z.infer<typeof generatedQuestionSchema>;
  }
  if (questionType === "fill_blank") {
    return {
      question_id: `batch_fallback_q${qNo}_v${params.variantNo}`,
      question_type: "fill_blank",
      question_text: `Case ${qNo}: Fill in the blank. When implementing ${conceptLabel} in ${params.courseTitle}, always ____ behavior on representative edge cases.`,
      options: [],
      correct_answer: "validate",
      acceptable_answers: ["validate", "verify"],
      explanation: `Reliable ${conceptLabel} implementation depends on explicit validation.`,
      score: OBJECTIVE_QUESTION_SCORE,
      concept_tags: [conceptTag],
      skill_tags: [skillTag],
    } satisfies z.infer<typeof generatedQuestionSchema>;
  }
  return {
    question_id: `batch_fallback_q${qNo}_v${params.variantNo}`,
    question_type: "short_answer",
    question_text: `Case ${qNo}: A student repeatedly fails ${conceptLabel} tasks in ${params.courseTitle}. Explain root cause, write corrected core logic/pseudocode, and define concrete tests to verify the fix.`,
    options: [],
    correct_answer: `Explain corrected ${conceptLabel} logic and validation strategy.`,
    acceptable_answers: ["root cause", "corrected logic", "tests"],
    explanation: `High-quality answers combine debugging, implementation, and verification details.`,
    score: SHORT_ANSWER_QUESTION_SCORE,
    concept_tags: [conceptTag],
    skill_tags: [skillTag],
  } satisfies z.infer<typeof generatedQuestionSchema>;
}

function chunkBlueprintPlan(plan: TestBlueprintQuestionPlanItem[]) {
  const chunks: TestBlueprintQuestionPlanItem[][] = [];
  for (let index = 0; index < plan.length; index += 4) {
    const chunk = plan.slice(index, index + 4);
    if (chunk.length > 0) {
      chunks.push(chunk);
    }
  }
  return chunks;
}

async function generateAiTestQuestionsInBatches(params: {
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
  resourceMetadata?: AiResourceMetadata[];
  attemptNumber: number;
  difficultyBand: DifficultyBand;
  variantNo: number;
  contextSummary: CourseTestContextSummary;
  blueprint: TestBlueprint;
  generationAttemptNo: number;
  retryReason?: string;
}) {
  const planBatches = chunkBlueprintPlan(params.blueprint.question_plan).slice(0, 4);
  const rawQuestions: Array<z.infer<typeof generatedQuestionSchema>> = [];
  const providers = new Set<string>();
  const models = new Set<string>();
  const promptVersions = new Set<string>();
  const failureReasons: string[] = [];
  let anyFallbackUsed = false;

  for (let batchIndex = 0; batchIndex < planBatches.length; batchIndex += 1) {
    const batchPlan = planBatches[batchIndex];
    const fallbackBatch = batchPlan.map((item) =>
      createFallbackQuestionFromPlanItem({
        courseTitle: params.courseTitle,
        difficultyBand: params.difficultyBand,
        variantNo: params.variantNo,
        planItem: item,
      }),
    );

    const priorQuestionSignals = rawQuestions.slice(-8).map((question) => ({
      question_type: question.question_type ?? null,
      question_text_prefix: truncateText(toStringValue(question.question_text), 96),
      concept_tag:
        Array.isArray(question.concept_tags) && question.concept_tags.length > 0
          ? normalizeConceptTag(question.concept_tags[0])
          : null,
    }));

    const { output, provenance } = await generateStructuredJson({
      feature: "ai_test_question_batch",
      promptVersion: AI_TEST_BATCH_PROMPT_VERSION,
      systemInstruction: [
        "Generate JSON only with root key question_batch.",
        "Return exactly 4 questions.",
        "Each question must include: question_id, question_type, question_text, options, correct_answer, acceptable_answers, explanation, score, concept_tags, skill_tags.",
        "Follow the provided question_plan_batch strictly by question_index, question_type, concept_tag, and skill_tag.",
        "No placeholder wording (no concept 1, question 1, which option best matches).",
        "No placeholder options (no Option A/B/C/D literal text).",
        "Use concrete university-level scenario questions with practical reasoning.",
        "For multiple_choice: exactly 4 meaningful options.",
        "For fill_blank and short_answer: options must be empty array.",
        "Scores must be 5 for objective and 15 for short_answer.",
        params.generationAttemptNo > 1
          ? "Retry mode: maximize variation from previous batches, avoid repeated stems, diversify scenarios and verbs."
          : "",
        params.retryReason ? `Fix previous quality issues: ${params.retryReason}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
      input: {
        user_id: params.userId,
        course_id: params.courseId,
        course_title: params.courseTitle,
        course_description: params.courseDescription ?? null,
        difficulty_band: params.difficultyBand,
        variant_no: params.variantNo,
        generation_attempt_no: params.generationAttemptNo,
        batch_no: batchIndex + 1,
        question_plan_batch: batchPlan,
        course_context_summary: params.contextSummary,
        recent_generated_question_signals: priorQuestionSignals,
      },
      outputSchema: generatedQuestionBatchSchema,
      fallback: () => ({
        question_batch: fallbackBatch,
      }),
      maxOutputTokens: 1100,
    });

    providers.add(provenance.provider);
    models.add(provenance.model);
    promptVersions.add(provenance.prompt_version);
    if (provenance.failure_reason) {
      failureReasons.push(provenance.failure_reason);
    }
    if (provenance.fallback_used) {
      anyFallbackUsed = true;
      console.warn("[pipeline] fallback_used", {
        pipeline: "ai_test_question_batch",
        source: "provider_fallback",
        course_id: params.courseId,
        batch_no: batchIndex + 1,
        generation_attempt_no: params.generationAttemptNo,
      });
    }

    const outputRecord = (output ?? {}) as GenericRecord;
    const batchQuestions = Array.isArray(outputRecord.question_batch)
      ? (outputRecord.question_batch as Array<z.infer<typeof generatedQuestionSchema>>)
      : [];

    rawQuestions.push(...batchQuestions);
    console.info("[ai_test] batch_generation_result", {
      course_id: params.courseId,
      batch_no: batchIndex + 1,
      generation_attempt_no: params.generationAttemptNo,
      question_count: batchQuestions.length,
      fallback_used: provenance.fallback_used,
    });
  }

  const aggregatedProvenance: AiProvenance = {
    provider: providers.has("deepseek") ? "deepseek" : "deterministic",
    model: Array.from(models).join(",") || "deterministic-fallback",
    prompt_version: Array.from(promptVersions).join(",") || AI_TEST_BATCH_PROMPT_VERSION,
    generated_at: new Date().toISOString(),
    fallback_used: anyFallbackUsed,
    failure_reason: failureReasons.length > 0 ? Array.from(new Set(failureReasons)).join("; ") : null,
  };

  return {
    rawQuestions,
    provenance: aggregatedProvenance,
  };
}

async function hasReusableTemplateComposition(params: {
  templateId: string;
  courseId: string;
}) {
  const { data: questionRows, error: questionRowsError } = await supabaseAdmin
    .from("ai_test_template_questions")
    .select("question_type, score, question_text, options_json")
    .eq("template_id", params.templateId);

  if (questionRowsError) {
    throw questionRowsError;
  }

  const rows = (questionRows ?? []) as Array<{
    question_type?: string | null;
    score?: number | null;
    question_text?: string | null;
    options_json?: unknown;
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
  const hasObjectiveScores = rows
    .filter(
      (row) =>
        row.question_type === "multiple_choice" ||
        row.question_type === "fill_blank",
    )
    .every((row) => Math.floor(toNumberValue(row.score)) === OBJECTIVE_QUESTION_SCORE);
  const hasShortAnswerScores = rows
    .filter((row) => row.question_type === "short_answer")
    .every((row) => Math.floor(toNumberValue(row.score)) === SHORT_ANSWER_QUESTION_SCORE);
  const normalizedQuestionTexts = rows
    .map((row) => compactWhitespace(toStringValue(row.question_text).toLowerCase()))
    .filter(Boolean);
  const uniqueQuestionTextCount = new Set(normalizedQuestionTexts).size;
  const hasPlaceholderQuestionText = normalizedQuestionTexts.some(
    (text) =>
      /\bconcept\s*\d+\b/i.test(text) ||
      /\bquestion\s*\d+\b/i.test(text) ||
      /\bwhich option best matches\b/i.test(text),
  );
  const hasPlaceholderOptions = rows.some((row) => {
    if (!Array.isArray(row.options_json)) {
      return false;
    }
    const options = (row.options_json as unknown[])
      .map((option) => compactWhitespace(toStringValue(option)))
      .filter(Boolean);
    if (options.length === 0) {
      return false;
    }
    return options.every((option) => /^option\s*[a-d]$/i.test(option));
  });

  if (
    rows.length !== TOTAL_QUESTION_COUNT ||
    objectiveCount !== OBJECTIVE_QUESTION_COUNT ||
    shortAnswerCount !== SHORT_ANSWER_QUESTION_COUNT ||
    totalScore !== 100 ||
    !hasOnlyAllowedTypes ||
    !hasObjectiveScores ||
    !hasShortAnswerScores ||
    uniqueQuestionTextCount < TOTAL_QUESTION_COUNT ||
    hasPlaceholderQuestionText ||
    hasPlaceholderOptions
  ) {
    console.warn("[ai_test_template] reusable_template_invalid_composition", {
      template_id: params.templateId,
      course_id: params.courseId,
      total_questions: rows.length,
      objective_count: objectiveCount,
      short_answer_count: shortAnswerCount,
      total_score: totalScore,
      has_only_allowed_types: hasOnlyAllowedTypes,
      has_objective_scores: hasObjectiveScores,
      has_short_answer_scores: hasShortAnswerScores,
      unique_question_text_count: uniqueQuestionTextCount,
      has_placeholder_question_text: hasPlaceholderQuestionText,
      has_placeholder_options: hasPlaceholderOptions,
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

  const { data: existingTemplates, error: existingError } = await supabaseAdmin
    .from("ai_test_templates")
    .select("id, created_at")
    .eq("course_id", params.courseId)
    .eq("version", params.variantNo)
    .order("created_at", { ascending: false })
    .limit(10);

  if (existingError) {
    console.error("[ai_test_template] template_check_failed", {
      course_id: params.courseId,
      variant_no: params.variantNo,
      reason: existingError.message,
      details: existingError.details ?? null,
    });
  }

  for (const row of (existingTemplates ?? []) as GenericRecord[]) {
    const existingId = toStringValue(row.id);
    if (!existingId) {
      continue;
    }
    const reusable = await hasReusableTemplateComposition({
      templateId: existingId,
      courseId: params.courseId,
    });
    if (!reusable) {
      console.warn("[ai_test_template] template_existing_invalid", {
        course_id: params.courseId,
        variant_no: params.variantNo,
        template_id: existingId,
        reason: "invalid_composition_or_placeholder_content",
      });
      continue;
    }
    console.info("[ai_test_template] template_already_exists", {
      course_id: params.courseId,
      variant_no: params.variantNo,
      template_id: existingId,
      reused: true,
    });
    return existingId;
  }

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
    throw new Error(
      `Invalid AI test composition: expected exactly ${TOTAL_QUESTION_COUNT} questions.`,
    );
  }
  const objectiveQuestions = params.questions.filter(
    (question) =>
      question.question_type === "multiple_choice" || question.question_type === "fill_blank",
  );
  const shortAnswerQuestions = params.questions.filter(
    (question) => question.question_type === "short_answer",
  );
  if (
    objectiveQuestions.length !== OBJECTIVE_QUESTION_COUNT ||
    shortAnswerQuestions.length !== SHORT_ANSWER_QUESTION_COUNT
  ) {
    throw new Error(
      `Invalid AI test composition: expected ${OBJECTIVE_QUESTION_COUNT} objective and ${SHORT_ANSWER_QUESTION_COUNT} short_answer questions.`,
    );
  }
  const hasObjectiveScores = objectiveQuestions.every(
    (question) => question.score === OBJECTIVE_QUESTION_SCORE,
  );
  const hasShortAnswerScores = shortAnswerQuestions.every(
    (question) => question.score === SHORT_ANSWER_QUESTION_SCORE,
  );
  if (!hasObjectiveScores || !hasShortAnswerScores) {
    throw new Error(
      `Invalid AI test composition: expected objective score ${OBJECTIVE_QUESTION_SCORE} and short_answer score ${SHORT_ANSWER_QUESTION_SCORE}.`,
    );
  }
  const totalScore = params.questions.reduce((sum, question) => sum + question.score, 0);
  if (totalScore !== 100) {
    throw new Error("Invalid AI test composition: total score must equal 100.");
  }
  console.info("[ai_test] generation_result", {
    template_id: params.templateId,
    course_id: params.courseId,
    question_count: params.questions.length,
    objective_count: objectiveQuestions.length,
    short_answer_count: shortAnswerQuestions.length,
    total_score: totalScore,
    pass_threshold: PASS_SCORE_THRESHOLD,
    per_question_scores: params.questions.map((question) => ({
      order: question.question_order,
      type: question.question_type,
      score: question.score,
    })),
  });

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
  resourceMetadata?: AiResourceMetadata[];
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
  const promptVersion = `${AI_TEST_BLUEPRINT_PROMPT_VERSION}+${AI_TEST_BATCH_PROMPT_VERSION}`;

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
          prompt_version: promptVersion,
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

  const { context: contextSummary, sourceHash: contextSourceHash } = await getCachedCourseTestContext({
    courseId: params.courseId,
    courseTitle: params.courseTitle,
    courseDescription: params.courseDescription ?? null,
    selectedResourceTitle: params.selectedResourceTitle ?? null,
    selectedResourceType: params.selectedResourceType ?? null,
    selectedResourceSummary: params.selectedResourceSummary ?? null,
    resourceMetadata: params.resourceMetadata ?? [],
  });
  const blueprintResult = await generateBlueprintForAiTest({
    courseId: params.courseId,
    courseTitle: params.courseTitle,
    courseDescription: params.courseDescription ?? null,
    difficultyBand: desiredDifficultyBand,
    context: contextSummary,
    contextSourceHash,
  });
  const blueprint = blueprintResult.blueprint;

  type AttemptResult = {
    courseId: string;
    courseTitle: string;
    difficultyBand: DifficultyBand;
    variantNo: number;
    resourceContext: z.infer<typeof generatedResourceContextSchema>;
    finalQuestions: GeneratedAiQuestion[];
    composition: ReturnType<typeof enforceQuestionComposition>;
    provenance: AiProvenance;
    quality: ReturnType<typeof evaluateGeneratedTestQuality>;
    outputRecord: GenericRecord;
    parsedKeys: string[];
  };

  const runQuestionGenerationAttempt = async (
    attemptNo: number,
    retryReason?: string,
  ): Promise<AttemptResult> => {
    const batchResult = await generateAiTestQuestionsInBatches({
      userId: params.userId,
      courseId: params.courseId,
      courseTitle: params.courseTitle,
      courseDescription: params.courseDescription ?? null,
      selectedResourceOptionId: params.selectedResourceOptionId ?? null,
      selectedResourceTitle: params.selectedResourceTitle ?? null,
      selectedResourceType: params.selectedResourceType ?? null,
      selectedResourceProvider: params.selectedResourceProvider ?? null,
      selectedResourceUrl: params.selectedResourceUrl ?? null,
      selectedResourceSummary: params.selectedResourceSummary ?? null,
      resourceMetadata: params.resourceMetadata ?? [],
      attemptNumber: params.attemptNumber,
      difficultyBand: desiredDifficultyBand,
      variantNo: desiredVariantNo,
      contextSummary,
      blueprint,
      generationAttemptNo: attemptNo,
      retryReason,
    });
    const resolvedCourseId = params.courseId;
    const resolvedCourseTitle = params.courseTitle;
    const resolvedDifficultyBand = desiredDifficultyBand;
    const resolvedVariantNo = desiredVariantNo;
    const resourceContext = {
      selected_resource_option_id: params.selectedResourceOptionId ?? null,
      selected_resource_title: params.selectedResourceTitle ?? null,
      selected_resource_type: params.selectedResourceType ?? null,
      selected_resource_provider: params.selectedResourceProvider ?? null,
      selected_resource_url: params.selectedResourceUrl ?? null,
      selected_resource_summary: params.selectedResourceSummary ?? null,
    } satisfies z.infer<typeof generatedResourceContextSchema>;

    const normalizedQuestions = normalizeGeneratedQuestions({
      rawQuestions: batchResult.rawQuestions,
      difficultyBand: resolvedDifficultyBand,
      courseTitle: resolvedCourseTitle,
      courseDescription: params.courseDescription ?? null,
      selectedResourceTitle: params.selectedResourceTitle ?? null,
      selectedResourceType: params.selectedResourceType ?? null,
      selectedResourceSummary: params.selectedResourceSummary ?? null,
      resourceMetadata: params.resourceMetadata ?? [],
    });
    const composition = enforceQuestionComposition({
      questions: normalizedQuestions,
      courseTitle: resolvedCourseTitle,
      courseDescription: params.courseDescription ?? null,
      selectedResourceTitle: params.selectedResourceTitle ?? null,
      selectedResourceType: params.selectedResourceType ?? null,
      selectedResourceSummary: params.selectedResourceSummary ?? null,
      resourceMetadata: params.resourceMetadata ?? [],
      difficultyBand: resolvedDifficultyBand,
      variantNo: resolvedVariantNo,
    });
    const quality = evaluateGeneratedTestQuality({
      questions: composition.finalQuestions,
      blueprint,
    });
    console.info("[ai_test] generation_result", {
      course_id: resolvedCourseId,
      generation_attempt_no: attemptNo,
      question_count: composition.finalQuestions.length,
      objective_count:
        composition.compositionBreakdown.multiple_choice +
        composition.compositionBreakdown.fill_blank,
      short_answer_count: composition.compositionBreakdown.short_answer,
      total_score: composition.totalScore,
      pass_threshold: PASS_SCORE_THRESHOLD,
      fallback_used: batchResult.provenance.fallback_used || composition.fallbackQuestions.length > 0,
      fallback_question_count: composition.fallbackQuestions.length,
      quality_passed: quality.passed,
      quality_reasons: quality.reasons,
    });
    console.info("[ai_test] question_count", {
      course_id: resolvedCourseId,
      generation_attempt_no: attemptNo,
      question_count: composition.finalQuestions.length,
    });
    return {
      courseId: resolvedCourseId,
      courseTitle: resolvedCourseTitle,
      difficultyBand: resolvedDifficultyBand,
      variantNo: resolvedVariantNo,
      resourceContext,
      finalQuestions: composition.finalQuestions,
      composition,
      provenance: batchResult.provenance,
      quality,
      outputRecord: {
        question_batch_count: Math.ceil(batchResult.rawQuestions.length / 4),
      },
      parsedKeys: ["question_batch"],
    };
  };

  let attemptResult = await runQuestionGenerationAttempt(1);
  if (!attemptResult.quality.passed) {
    console.warn("[ai_test] quality_retry_triggered", {
      course_id: params.courseId,
      reasons: attemptResult.quality.reasons,
    });
    attemptResult = await runQuestionGenerationAttempt(2, attemptResult.quality.reasons.join(","));
  }

  if (!attemptResult.quality.passed) {
    const fallbackTemplate = getFallbackTemplate({
      courseId: params.courseId,
      courseTitle: params.courseTitle,
      courseDescription: params.courseDescription ?? null,
      attemptNumber: params.attemptNumber,
      difficultyBand: desiredDifficultyBand,
      selectedResourceOptionId: params.selectedResourceOptionId ?? null,
      selectedResourceTitle: params.selectedResourceTitle ?? null,
      selectedResourceType: params.selectedResourceType ?? null,
      selectedResourceProvider: params.selectedResourceProvider ?? null,
      selectedResourceUrl: params.selectedResourceUrl ?? null,
      selectedResourceSummary: params.selectedResourceSummary ?? null,
      resourceMetadata: params.resourceMetadata ?? [],
    });
    const fallbackTestTemplate = (fallbackTemplate.test_template ?? {}) as GenericRecord;
    const fallbackRawQuestions = Array.isArray(fallbackTestTemplate.questions)
      ? (fallbackTestTemplate.questions as Array<z.infer<typeof generatedQuestionSchema>>)
      : [];
    const normalizedFallbackQuestions = normalizeGeneratedQuestions({
      rawQuestions: fallbackRawQuestions,
      difficultyBand: desiredDifficultyBand,
      courseTitle: params.courseTitle,
      courseDescription: params.courseDescription ?? null,
      selectedResourceTitle: params.selectedResourceTitle ?? null,
      selectedResourceType: params.selectedResourceType ?? null,
      selectedResourceSummary: params.selectedResourceSummary ?? null,
      resourceMetadata: params.resourceMetadata ?? [],
    });
    const fallbackComposition = enforceQuestionComposition({
      questions: normalizedFallbackQuestions,
      courseTitle: params.courseTitle,
      courseDescription: params.courseDescription ?? null,
      selectedResourceTitle: params.selectedResourceTitle ?? null,
      selectedResourceType: params.selectedResourceType ?? null,
      selectedResourceSummary: params.selectedResourceSummary ?? null,
      resourceMetadata: params.resourceMetadata ?? [],
      difficultyBand: desiredDifficultyBand,
      variantNo: desiredVariantNo,
    });
    const deterministicProvenance: AiProvenance = {
      provider: "deterministic",
      model: "deterministic-quality-fallback",
      prompt_version: AI_TEST_BATCH_PROMPT_VERSION,
      generated_at: new Date().toISOString(),
      fallback_used: true,
      failure_reason: "quality_gate_failed_after_retry",
    };
    attemptResult = {
      courseId: params.courseId,
      courseTitle: params.courseTitle,
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
      finalQuestions: fallbackComposition.finalQuestions,
      composition: fallbackComposition,
      provenance: deterministicProvenance,
      quality: evaluateGeneratedTestQuality({
        questions: fallbackComposition.finalQuestions,
        blueprint,
      }),
      outputRecord: {
        test_template: fallbackTemplate.test_template,
      },
      parsedKeys: ["test_template"],
    };
    console.warn("[pipeline] fallback_used", {
      pipeline: "ai_test_template",
      source: "quality_gate_fallback",
      course_id: params.courseId,
      attempt_number: params.attemptNumber,
      quality_reasons: attemptResult.quality.reasons,
    });
  }

  const resolvedCourseId = attemptResult.courseId;
  const resolvedCourseTitle = attemptResult.courseTitle;
  const resolvedDifficultyBand = attemptResult.difficultyBand;
  const resolvedVariantNo = attemptResult.variantNo;
  const resolvedBasedOnResourceOptionId = params.selectedResourceOptionId ?? null;
  const resourceContext = attemptResult.resourceContext;
  const finalQuestions = attemptResult.finalQuestions;
  const provenance = attemptResult.provenance;

  const sourceHash = sha256Hash({
    course_id: resolvedCourseId,
    difficulty_band: resolvedDifficultyBand,
    variant_no: resolvedVariantNo,
    based_on_resource_option_id: resolvedBasedOnResourceOptionId,
    blueprint,
    context_summary: contextSummary,
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
      fallback_used: provenance.fallback_used || attemptResult.composition.fallbackQuestions.length > 0,
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
        prompt_version: promptVersion,
        requirements_met: {
          include_concept_and_skill_tags: true,
          vary_from_previous_attempts: true,
        },
        ai_provider: provenance.provider,
        ai_model: provenance.model,
        fallback_used: provenance.fallback_used || attemptResult.composition.fallbackQuestions.length > 0,
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
      let isReusable = false;
      try {
        isReusable = await hasReusableTemplateComposition({
          templateId: candidateId,
          courseId: resolvedCourseId,
        });
      } catch {
        isReusable = false;
      }
      if (!isReusable) {
        continue;
      }
      fallbackTemplateId = candidateId;
      break;
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
        prompt_version: promptVersion,
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
