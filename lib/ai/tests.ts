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
const MULTIPLE_CHOICE_QUESTION_COUNT = 5;
const FILL_BLANK_QUESTION_COUNT = 3;
const OBJECTIVE_QUESTION_COUNT = MULTIPLE_CHOICE_QUESTION_COUNT + FILL_BLANK_QUESTION_COUNT;
const SHORT_ANSWER_QUESTION_COUNT = 2;
const TOTAL_QUESTION_COUNT = OBJECTIVE_QUESTION_COUNT + SHORT_ANSWER_QUESTION_COUNT;
const OBJECTIVE_QUESTION_SCORE = 10;
const SHORT_ANSWER_QUESTION_SCORE = 10;
const PASS_SCORE_THRESHOLD = 80;
const SHORT_ANSWER_MAX_LINES = 2;
const SHORT_ANSWER_MAX_QUESTION_WORDS = 30;
const SHORT_ANSWER_MAX_CORRECT_ANSWER_WORDS = 25;
const SHORT_ANSWER_MAX_EXPLANATION_WORDS = 15;
const SHORT_ANSWER_RETRY_RESPONSE_MAX_CHARS = 420;
const BATCH_MAX_RETRIES = 2;
const MIN_BLUEPRINT_ALIGNMENT_COUNT = 4;
const CONCEPT_TAG_RELAXED_MATCH_THRESHOLD = 0.34;
const DEFAULT_SPECIFIC_CONCEPT_TAGS = [
  "debugging",
  "implementation_logic",
  "data_validation",
  "error_handling",
  "edge_case_testing",
  "algorithm_design",
] as const;
const AI_TEST_BLUEPRINT_PROMPT_VERSION = "ai_test_blueprint_v1";
const AI_TEST_BATCH_PROMPT_VERSION = "ai_test_batch_v2";
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
  difficulty_level: z.enum(["medium", "hard"]),
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

function clampToMaxLines(value: string, maxLines: number) {
  const normalized = toStringValue(value).replace(/\r\n/g, "\n").trim();
  if (!normalized) {
    return "";
  }
  return normalized
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .join("\n");
}

function toCompactShortField(value: unknown, fallback: string, maxWords: number) {
  const clamped = clampToMaxLines(toStringValue(value), SHORT_ANSWER_MAX_LINES);
  const base = clamped || fallback;
  return truncateWords(compactWhitespace(base), maxWords);
}

const generatedObjectiveBatchQuestionSchema = z.object({
  question_id: z.string().optional(),
  question_type: z.enum(["multiple_choice", "fill_blank"]).optional(),
  question_text: z.string().min(1),
  options: z
    .union([z.array(z.string()), z.null(), z.undefined()])
    .transform((value) => value ?? []),
  correct_answer: z
    .union([z.string(), z.boolean(), z.null()])
    .optional(),
  score: z.number().int().positive().optional(),
  concept_tags: z
    .union([z.array(z.string()), z.null(), z.undefined()])
    .transform((value) => value ?? []),
  skill_tags: z
    .union([z.array(z.string()), z.null(), z.undefined()])
    .transform((value) => value ?? []),
  explanation: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) =>
      truncateWords(compactWhitespace(typeof value === "string" ? value : ""), 10),
    )
    .optional(),
});

const generatedObjectiveBatchSchema = z.object({
  question_batch: z.array(generatedObjectiveBatchQuestionSchema).length(1),
});

const generatedShortAnswerBatchQuestionSchema = z.object({
  question_id: z.string().optional(),
  question_type: z.enum(["short_answer"]).optional(),
  question_text: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) =>
      toCompactShortField(
        value,
        "State one practical fix for the issue.",
        SHORT_ANSWER_MAX_QUESTION_WORDS,
      ),
    )
    .refine((value) => value.length > 0, {
      message: "question_text is required",
    }),
  options: z
    .union([z.array(z.string()), z.null(), z.undefined()])
    .transform(() => [] as string[]),
  correct_answer: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) =>
      toCompactShortField(
        value,
        "Apply the key fix and verify once.",
        SHORT_ANSWER_MAX_CORRECT_ANSWER_WORDS,
      ),
    ),
  acceptable_answers: z
    .union([z.array(z.string()), z.null(), z.undefined()])
    .transform(() => [] as string[]),
  explanation: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((value) =>
      toCompactShortField(
        value,
        "Keep the fix practical and concise.",
        SHORT_ANSWER_MAX_EXPLANATION_WORDS,
      ),
    ),
  score: z.number().int().positive().optional(),
  skill_tags: z
    .union([z.array(z.string()), z.null(), z.undefined()])
    .transform((value) => value ?? []),
  concept_tags: z
    .union([z.array(z.string()), z.null(), z.undefined()])
    .transform((value) => value ?? []),
});

const generatedShortAnswerBatchSchema = z.object({
  question_batch: z.array(generatedShortAnswerBatchQuestionSchema).min(1).max(1),
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

function truncateWords(value: string, maxWords: number) {
  const normalized = compactWhitespace(value);
  if (!normalized) {
    return "";
  }
  const words = normalized.split(" ");
  if (words.length <= maxWords) {
    return normalized;
  }
  return words.slice(0, maxWords).join(" ");
}

function toSingleShortSentence(value: string, fallback: string, maxWords: number) {
  const source = compactWhitespace(value || fallback);
  if (!source) {
    return fallback;
  }
  const firstSentence = source.split(/[.!?]\s+/)[0] || source;
  return truncateWords(firstSentence, maxWords);
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
  const specificExtracted = extracted.filter((tag) => isSpecificConceptTag(tag));
  if (specificExtracted.length > 0) {
    return specificExtracted;
  }
  return [...DEFAULT_SPECIFIC_CONCEPT_TAGS];
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

const GENERIC_CONCEPT_TAGS = new Set([
  "concept",
  "general",
  "general_concept",
  "course",
  "lesson",
  "topic",
  "skill",
  "css",
  "javascript",
  "python",
  "java",
  "frontend",
  "backend",
  "web",
  "data",
  "machine_learning",
]);

function isSpecificConceptTag(value: string) {
  const normalized = normalizeConceptTag(value);
  if (!normalized) {
    return false;
  }
  if (GENERIC_CONCEPT_TAGS.has(normalized)) {
    return false;
  }
  if (/_concept$/.test(normalized)) {
    return false;
  }
  if (/^general_/.test(normalized)) {
    return false;
  }
  return true;
}

function pickDefaultSpecificConceptTag(index: number) {
  return DEFAULT_SPECIFIC_CONCEPT_TAGS[index % DEFAULT_SPECIFIC_CONCEPT_TAGS.length];
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
      index <= MULTIPLE_CHOICE_QUESTION_COUNT
        ? "multiple_choice"
        : index <= OBJECTIVE_QUESTION_COUNT
        ? "fill_blank"
        : "short_answer";
    const conceptTag = coreConcepts[(index - 1) % coreConcepts.length];
    const skillTag = resolvedSkillTags[(index - 1) % resolvedSkillTags.length];
    const difficultyLevel: TestBlueprintQuestionPlanItem["difficulty_level"] =
      questionType === "short_answer" ? "hard" : index % 2 === 0 ? "hard" : "medium";
    const intent =
      questionType === "short_answer"
        ? `Solve a real-world ${formatConceptLabel(conceptTag)} debugging or implementation task with corrected logic and verification.`
        : questionType === "fill_blank"
        ? `Complete a concrete ${formatConceptLabel(conceptTag)} step/token used in practical work.`
        : `Choose the best concrete workflow for applying ${formatConceptLabel(conceptTag)} in a real scenario.`;
    questionPlan.push({
      question_index: index,
      question_type: questionType,
      concept_tag: conceptTag,
      skill_tag: skillTag,
      intent,
      difficulty_level: difficultyLevel,
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
      ].filter((item) => isSpecificConceptTag(item)),
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
      index <= MULTIPLE_CHOICE_QUESTION_COUNT
        ? rawType === "multiple_choice"
          ? "multiple_choice"
          : "multiple_choice"
        : index <= OBJECTIVE_QUESTION_COUNT
        ? rawType === "fill_blank"
          ? "fill_blank"
          : "fill_blank"
        : "short_answer";
    const conceptTag = normalizeConceptTag(source?.concept_tag) || fallbackRow.concept_tag;
    const skillTag = normalizeSkillTag(source?.skill_tag) || fallbackRow.skill_tag;
    const rawDifficulty = toStringValue(source?.difficulty_level).toLowerCase();
    const difficultyLevel: TestBlueprintQuestionPlanItem["difficulty_level"] =
      rawDifficulty === "hard" || rawDifficulty === "medium"
        ? (rawDifficulty as "medium" | "hard")
        : fallbackRow.difficulty_level;
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
      difficulty_level: difficultyLevel,
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
      questionNo <= MULTIPLE_CHOICE_QUESTION_COUNT
        ? "multiple_choice"
        : questionNo <= OBJECTIVE_QUESTION_COUNT
        ? "fill_blank"
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
          ? `Case ${questionNo}: In one sentence, what key action would you take first to fix a ${conceptLabel} issue in ${params.courseTitle}?`
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
          ? `Name the key fix and one validation check.`
          : "validate assumptions",
      acceptable_answers:
        questionType === "short_answer"
          ? ["key fix plus validation"]
          : questionType === "fill_blank"
          ? [
              "validate assumptions",
              "verify with edge cases",
            ]
          : [],
      score:
        questionType === "short_answer"
          ? SHORT_ANSWER_QUESTION_SCORE
          : OBJECTIVE_QUESTION_SCORE,
      explanation:
        questionType === "short_answer"
          ? "Keep the answer concise and action-oriented."
          : `Focus on concrete decisions for ${conceptLabel} in ${params.courseTitle}.`,
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
    question_text: `Case ${params.questionOrder}: In one sentence, what first fix would you apply for a ${conceptLabel} issue in ${params.courseTitle}?`,
    options: [],
    correct_answer_text: `State the key fix and one validation step.`,
    acceptable_answers: ["key fix and validate"],
    score: SHORT_ANSWER_QUESTION_SCORE,
    explanation: `Keep the response brief, practical, and verifiable.`,
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
    .filter((item) => isSpecificConceptTag(item));
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
  const specificExtracted = extracted.filter((tag) => isSpecificConceptTag(tag));
  if (specificExtracted.length > 0) {
    return specificExtracted;
  }
  const normalizedFallback = normalizeConceptTag(params.fallbackConceptTag);
  if (isSpecificConceptTag(normalizedFallback)) {
    return [normalizedFallback];
  }
  return [pickDefaultSpecificConceptTag(0)];
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
    const conciseQuestionText =
      questionType === "short_answer"
        ? truncateWords(toSingleShortSentence(questionText, questionText, SHORT_ANSWER_MAX_QUESTION_WORDS), SHORT_ANSWER_MAX_QUESTION_WORDS)
        : truncateWords(toSingleShortSentence(questionText, questionText, 26), 26);
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
    )
      .map((option) => truncateWords(option, 12))
      .slice(0, 6);
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
    if (questionType === "fill_blank" && acceptableAnswers.length === 0 && correctAnswerText) {
      acceptableAnswers.push(correctAnswerText);
    }
    const conciseCorrectAnswerText = truncateWords(
      correctAnswerText || "",
      questionType === "short_answer" ? SHORT_ANSWER_MAX_CORRECT_ANSWER_WORDS : 28,
    );
    const conciseAcceptableAnswers = Array.from(
      new Set(
        acceptableAnswers
          .map((item) =>
            truncateWords(
              item,
              questionType === "short_answer" ? 8 : questionType === "fill_blank" ? 4 : 12,
            ),
          )
          .filter(Boolean),
      ),
    );
    const resolvedAcceptableAnswers =
      questionType === "short_answer"
        ? conciseAcceptableAnswers.slice(0, 1)
        : conciseAcceptableAnswers;
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
    const explanation = toSingleShortSentence(
      toStringValue(question.explanation).trim(),
      `Review this ${params.difficultyBand} question carefully.`,
      questionType === "short_answer" ? SHORT_ANSWER_MAX_EXPLANATION_WORDS : 12,
    );

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

    const derivedConceptTags = deriveConceptTagsForQuestion({
      explicitConceptTags: fullConceptTags,
      questionText,
      explanation,
      courseTitle: params.courseTitle,
      courseDescription: params.courseDescription ?? null,
      selectedResourceTitle: params.selectedResourceTitle ?? null,
      selectedResourceSummary: params.selectedResourceSummary ?? null,
      resourceMetadata: params.resourceMetadata ?? [],
      fallbackConceptTag,
    });
    const sanitizedConceptTags = Array.from(
      new Set(derivedConceptTags.map((tag) => normalizeConceptTag(tag)).filter((tag) => isSpecificConceptTag(tag))),
    );
    const resolvedConceptTag =
      sanitizedConceptTags[0] ||
      (isSpecificConceptTag(fallbackConceptTag)
        ? normalizeConceptTag(fallbackConceptTag)
        : pickDefaultSpecificConceptTag(index));
    const resolvedSkillTag =
      normalizeSkillTag(fullSkillTags[0]) || `${resolvedConceptTag}_application`;
    console.info("[concept] normalized_tag", {
      source: "ai_test_question_normalization",
      question_order: index + 1,
      raw_concept_tags: fullConceptTags,
      derived_concept_tags: derivedConceptTags,
      resolved_concept_tag: resolvedConceptTag,
    });

    normalized.push({
      question_order: index + 1,
      question_type: questionType,
      question_text: conciseQuestionText,
      options: normalizedOptions,
      correct_answer_text: conciseCorrectAnswerText || "",
      acceptable_answers: resolvedAcceptableAnswers,
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
          : [resolvedSkillTag],
      concept_tags: [resolvedConceptTag],
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
  const pickByConceptDiversity = (
    candidates: GeneratedAiQuestion[],
    targetCount: number,
  ) => {
    const selected: GeneratedAiQuestion[] = [];
    const usedConcepts = new Set<string>();
    const pool = [...candidates];
    while (selected.length < targetCount && pool.length > 0) {
      const nextUniqueIdx = pool.findIndex((candidate) => {
        const concept = normalizeConceptTag(candidate.concept_tags[0] ?? "");
        return concept && !usedConcepts.has(concept);
      });
      const candidate = nextUniqueIdx >= 0 ? pool.splice(nextUniqueIdx, 1)[0] : pool.shift();
      if (!candidate) {
        break;
      }
      const concept = normalizeConceptTag(candidate.concept_tags[0] ?? "");
      if (concept) {
        usedConcepts.add(concept);
      }
      selected.push(candidate);
    }
    return selected;
  };

  const mcCandidates = params.questions.filter(
    (question) => question.question_type === "multiple_choice",
  );
  const fbCandidates = params.questions.filter(
    (question) => question.question_type === "fill_blank",
  );
  const shortAnswerCandidates = params.questions.filter(
    (question) => question.question_type === "short_answer",
  );

  const selectedMc = pickByConceptDiversity(mcCandidates, MULTIPLE_CHOICE_QUESTION_COUNT);
  const selectedFb = pickByConceptDiversity(fbCandidates, FILL_BLANK_QUESTION_COUNT);
  const selectedShortAnswers = pickByConceptDiversity(
    shortAnswerCandidates,
    SHORT_ANSWER_QUESTION_COUNT,
  );

  const fallbackQuestions: GeneratedAiQuestion[] = [];
  while (selectedMc.length < MULTIPLE_CHOICE_QUESTION_COUNT) {
    const index = selectedMc.length + 1;
    const fallbackQuestion = createDeterministicFallbackQuestion({
      courseTitle: params.courseTitle,
      courseDescription: params.courseDescription ?? null,
      selectedResourceTitle: params.selectedResourceTitle ?? null,
      selectedResourceType: params.selectedResourceType ?? null,
      selectedResourceSummary: params.selectedResourceSummary ?? null,
      resourceMetadata: params.resourceMetadata ?? [],
      questionOrder: index,
      type: "multiple_choice",
      difficultyBand: params.difficultyBand,
      variantNo: params.variantNo,
    });
    selectedMc.push(fallbackQuestion);
    fallbackQuestions.push(fallbackQuestion);
  }

  while (selectedFb.length < FILL_BLANK_QUESTION_COUNT) {
    const index = MULTIPLE_CHOICE_QUESTION_COUNT + selectedFb.length + 1;
    const fallbackQuestion = createDeterministicFallbackQuestion({
      courseTitle: params.courseTitle,
      courseDescription: params.courseDescription ?? null,
      selectedResourceTitle: params.selectedResourceTitle ?? null,
      selectedResourceType: params.selectedResourceType ?? null,
      selectedResourceSummary: params.selectedResourceSummary ?? null,
      resourceMetadata: params.resourceMetadata ?? [],
      questionOrder: index,
      type: "fill_blank",
      difficultyBand: params.difficultyBand,
      variantNo: params.variantNo,
    });
    selectedFb.push(fallbackQuestion);
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

  const finalQuestions = [...selectedMc, ...selectedFb, ...selectedShortAnswers].map(
    (question, index) => {
      const order = index + 1;
      const isShortAnswer = order > OBJECTIVE_QUESTION_COUNT;
      const normalizedAcceptableAnswers =
        question.question_type === "short_answer"
          ? question.acceptable_answers.filter(Boolean).slice(0, 1)
          : question.question_type === "fill_blank"
          ? (question.acceptable_answers.length > 0
              ? question.acceptable_answers
              : [question.correct_answer_text]).filter(Boolean)
          : [];
      return {
        ...question,
        question_order: order,
        score: isShortAnswer ? SHORT_ANSWER_QUESTION_SCORE : OBJECTIVE_QUESTION_SCORE,
        options: question.question_type === "multiple_choice" ? question.options.slice(0, 4) : [],
        acceptable_answers: normalizedAcceptableAnswers,
      } satisfies GeneratedAiQuestion;
    },
  );

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
    expected_multiple_choice_count: MULTIPLE_CHOICE_QUESTION_COUNT,
    actual_multiple_choice_count: compositionBreakdown.multiple_choice,
    expected_fill_blank_count: FILL_BLANK_QUESTION_COUNT,
    actual_fill_blank_count: compositionBreakdown.fill_blank,
    expected_objective_count: OBJECTIVE_QUESTION_COUNT,
    actual_objective_count:
      compositionBreakdown.multiple_choice + compositionBreakdown.fill_blank,
    expected_short_answer_count: SHORT_ANSWER_QUESTION_COUNT,
    actual_short_answer_count: compositionBreakdown.short_answer,
    expected_objective_score_each: OBJECTIVE_QUESTION_SCORE,
    expected_short_answer_score_each: SHORT_ANSWER_QUESTION_SCORE,
    total_score: totalScore,
    pass_threshold: PASS_SCORE_THRESHOLD,
    per_question_scores: finalQuestions.map((question) => ({
      order: question.question_order,
      type: question.question_type,
      score: OBJECTIVE_QUESTION_SCORE,
    })),
  });

  return {
    finalQuestions,
    fallbackQuestions,
    compositionBreakdown,
    totalScore,
  };
}

function tokenizeConceptTag(value: string) {
  return normalizeConceptTag(value)
    .split("_")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function conceptTagSimilarityScore(a: string, b: string) {
  const left = normalizeConceptTag(a);
  const right = normalizeConceptTag(b);
  if (!left || !right) {
    return 0;
  }
  if (left === right) {
    return 1;
  }
  if ((left.includes(right) || right.includes(left)) && Math.min(left.length, right.length) >= 4) {
    return 0.6;
  }
  const leftTokens = tokenizeConceptTag(left);
  const rightTokens = tokenizeConceptTag(right);
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return 0;
  }
  const leftSet = new Set(leftTokens);
  const rightSet = new Set(rightTokens);
  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }
  const union = leftSet.size + rightSet.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function computeBlueprintAlignmentMetrics(params: {
  questions: GeneratedAiQuestion[];
  blueprint: TestBlueprint;
}) {
  const strict = params.blueprint.question_plan.filter((planItem) =>
    params.questions.some(
      (question) =>
        question.question_order === planItem.question_index &&
        question.question_type === planItem.question_type &&
        normalizeConceptTag(question.concept_tags[0] ?? "") === normalizeConceptTag(planItem.concept_tag),
    ),
  ).length;

  const usedQuestionIndexes = new Set<number>();
  let relaxed = 0;
  const orderedPlan = [...params.blueprint.question_plan].sort(
    (a, b) => a.question_index - b.question_index,
  );
  for (const planItem of orderedPlan) {
    const expectedConceptTag = normalizeConceptTag(planItem.concept_tag);
    if (!expectedConceptTag) {
      continue;
    }
    let bestQuestionIndex = -1;
    let bestSimilarity = 0;
    params.questions.forEach((question, questionIndex) => {
      if (usedQuestionIndexes.has(questionIndex)) {
        return;
      }
      if (question.question_type !== planItem.question_type) {
        return;
      }
      const questionConceptTag = normalizeConceptTag(question.concept_tags[0] ?? "");
      const similarity = conceptTagSimilarityScore(expectedConceptTag, questionConceptTag);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestQuestionIndex = questionIndex;
      }
    });
    if (bestQuestionIndex >= 0 && bestSimilarity >= CONCEPT_TAG_RELAXED_MATCH_THRESHOLD) {
      usedQuestionIndexes.add(bestQuestionIndex);
      relaxed += 1;
    }
  }

  return {
    strict,
    relaxed,
    effective: Math.max(strict, relaxed),
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
  if (uniqueQuestionTextCount < Math.max(9, TOTAL_QUESTION_COUNT - 1)) {
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
  if (repeatedStemCount > 2) {
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
  if (uniqueConceptCount < 8) {
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
  if (dominantConceptCount > 2) {
    reasons.push("single_concept_overused");
  }

  const genericConceptTagCount = conceptTags.filter((tag) => !isSpecificConceptTag(tag)).length;
  if (genericConceptTagCount > 0) {
    reasons.push("generic_concept_tags_detected");
  }

  const alignmentMetrics = computeBlueprintAlignmentMetrics({
    questions: params.questions,
    blueprint: params.blueprint,
  });
  if (alignmentMetrics.effective < MIN_BLUEPRINT_ALIGNMENT_COUNT) {
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
    blueprint_alignment_count: alignmentMetrics.effective,
    blueprint_alignment_strict_count: alignmentMetrics.strict,
    blueprint_alignment_relaxed_count: alignmentMetrics.relaxed,
    blueprint_alignment_min_required: MIN_BLUEPRINT_ALIGNMENT_COUNT,
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

function normalizeQuestionTextForSimilarity(value: string) {
  return compactWhitespace(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\b(case|question|q)\s*\d+\b/g, " ")
      .replace(/\s+/g, " "),
  );
}

function tokenJaccardSimilarity(a: string, b: string) {
  const setA = new Set(a.split(" ").filter(Boolean));
  const setB = new Set(b.split(" ").filter(Boolean));
  if (setA.size === 0 || setB.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      intersection += 1;
    }
  }
  const union = setA.size + setB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function dedupeQuestionsBySimilarity(questions: GeneratedAiQuestion[]) {
  const kept: GeneratedAiQuestion[] = [];
  const signatures: Array<{ type: GeneratedAiQuestion["question_type"]; text: string }> = [];
  const removed: Array<{ order: number; question_type: string; reason: string }> = [];

  for (const question of questions) {
    const normalizedText = normalizeQuestionTextForSimilarity(question.question_text);
    let duplicateReason = "";
    for (const signature of signatures) {
      if (signature.type !== question.question_type) {
        continue;
      }
      if (!normalizedText || !signature.text) {
        continue;
      }
      if (normalizedText === signature.text) {
        duplicateReason = "exact_normalized_match";
        break;
      }
      const similarity = tokenJaccardSimilarity(normalizedText, signature.text);
      if (similarity >= 0.86) {
        duplicateReason = `high_similarity_${similarity.toFixed(2)}`;
        break;
      }
    }
    if (duplicateReason) {
      removed.push({
        order: question.question_order,
        question_type: question.question_type,
        reason: duplicateReason,
      });
      continue;
    }
    kept.push(question);
    signatures.push({
      type: question.question_type,
      text: normalizedText,
    });
  }

  console.info("[ai_test] dedupe_summary", {
    original_count: questions.length,
    kept_count: kept.length,
    removed_count: removed.length,
    removed,
  });
  return kept;
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
      "Generate exactly 10 question_plan items.",
      "question_plan item fields: question_index, question_type, concept_tag, skill_tag, intent, difficulty_level.",
      "question_index must be 1..10.",
      "question_type composition must be exactly: 5 multiple_choice, 3 fill_blank, 2 short_answer.",
      "difficulty_level must be medium or hard for every item.",
      "concept_tag must be educationally meaningful and specific.",
      "Do not output generic tags such as machine, course, lesson, concept, or tags ending with _concept.",
      "Do not output numbered placeholders such as concept_1.",
      "Maximize concept coverage and avoid repeated concepts whenever possible.",
      "question_plan intents must be practical, scenario-based, and non-repetitive.",
      "short_answer intents must be real-world implementation or debugging tasks, not abstract theory.",
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
        multiple_choice_questions: MULTIPLE_CHOICE_QUESTION_COUNT,
        fill_blank_questions: FILL_BLANK_QUESTION_COUNT,
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
  const rawPlanConceptTag = normalizeConceptTag(params.planItem.concept_tag);
  const conceptTag = isSpecificConceptTag(rawPlanConceptTag)
    ? rawPlanConceptTag
    : pickDefaultSpecificConceptTag(Math.max(0, params.planItem.question_index - 1));
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
    question_text: `Case ${qNo}: In one sentence, what key fix would you apply to resolve a recurring ${conceptLabel} bug in ${params.courseTitle}?`,
    options: [],
    correct_answer: `Apply the key fix and verify with one targeted check.`,
    acceptable_answers: ["fix then validate"],
    explanation: `Answer briefly with one practical action.`,
    score: SHORT_ANSWER_QUESTION_SCORE,
    concept_tags: [conceptTag],
    skill_tags: [skillTag],
  } satisfies z.infer<typeof generatedQuestionSchema>;
}

type QuestionBatchPlan = {
  batch_no: number;
  batch_type: "objective" | "short_answer";
  plan_items: TestBlueprintQuestionPlanItem[];
};

function buildQuestionBatches(plan: TestBlueprintQuestionPlanItem[]) {
  const ordered = [...plan].sort((a, b) => a.question_index - b.question_index);
  const objectivePlan = ordered.filter((item) => item.question_type !== "short_answer");
  const shortAnswerPlan = ordered.filter((item) => item.question_type === "short_answer");

  const batches: QuestionBatchPlan[] = [];
  let batchNo = 1;

  for (let index = 0; index < objectivePlan.length; index += 1) {
    const batchItems = objectivePlan.slice(index, index + 1);
    if (batchItems.length > 0) {
      batches.push({
        batch_no: batchNo,
        batch_type: "objective",
        plan_items: batchItems,
      });
      batchNo += 1;
    }
  }

  for (const shortItem of shortAnswerPlan) {
    batches.push({
      batch_no: batchNo,
      batch_type: "short_answer",
      plan_items: [shortItem],
    });
    batchNo += 1;
  }

  return batches;
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
  const planBatches = buildQuestionBatches(params.blueprint.question_plan);
  const rawQuestions: Array<z.infer<typeof generatedQuestionSchema>> = [];
  const providers = new Set<string>();
  const models = new Set<string>();
  const promptVersions = new Set<string>();
  const failureReasons: string[] = [];
  const failedBatches: Array<{
    batch_no: number;
    batch_type: "objective" | "short_answer";
    reason: string;
  }> = [];
  let anyFallbackUsed = false;

  for (const batch of planBatches) {
    const batchPlan = batch.plan_items;
    const expectedCount = batchPlan.length;
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

    const runBatchCall = async (
      retryCount: number,
      strictMode: boolean,
      previousFailureReason?: string | null,
    ) => {
      const isShortBatch = batch.batch_type === "short_answer";
      const systemInstruction = [
        "Generate JSON only with root key question_batch.",
        "DO NOT include backticks, comments, or explanations outside JSON.",
        "JSON syntax rules are mandatory: all keys and string values must use double quotes only.",
        "Escape every internal double quote as \\\" and every backslash as \\\\ inside string values.",
        "Do not output trailing commas. Every array must close with ] and every object must close with }.",
        `Return exactly ${expectedCount} questions.`,
        "Return question_batch as an array containing exactly one question object for this request.",
        isShortBatch
          ? "Each question must include: question_id, question_type, question_text, options, correct_answer, acceptable_answers, explanation, score, concept_tags, skill_tags."
          : "Each question must include only: question_id, question_type, question_text, options, correct_answer, score, concept_tags, skill_tags. Do not include acceptable_answers for objective questions.",
        "Follow question_plan_batch strictly by question_index, question_type, concept_tag, and skill_tag.",
        "Use score=10 for multiple_choice, fill_blank, and short_answer.",
        "No placeholder wording (no concept 1, question 1, which option best matches).",
        "No placeholder options (no Option A/B/C/D literal text).",
        "Keep question_text concise and direct.",
        "Keep options concise and short.",
        "Keep each explanation to one short sentence.",
        isShortBatch
          ? "Short-answer batch rules: question_type must be short_answer; options must be []; question_text/correct_answer/explanation must each be at most 2 lines; question_text must be <=14 words; correct_answer must be <=12 words; acceptable_answers must be []; explanation must be <=6 words; do not output code blocks, declarations, or multi-step solutions; create one practical debugging or implementation task and do not repeat objective questions."
          : "Objective batch rules: only multiple_choice or fill_blank; multiple_choice must have exactly 4 concise meaningful options; fill_blank must use options []; explanation is optional and must be very short (<=12 words).",
        strictMode
          ? isShortBatch
            ? `Strict short-output mode: ultra-compact JSON only; all text fields minimal; entire JSON response must stay under about ${SHORT_ANSWER_RETRY_RESPONSE_MAX_CHARS} characters.`
            : "Strict objective-output mode: ultra-compact wording for question_text/options and minimal JSON fields."
          : "",
        strictMode && previousFailureReason
          ? `Previous attempt failed with: ${previousFailureReason}. Prevent truncation by using much shorter strings.`
          : "",
        params.generationAttemptNo > 1
          ? "Retry mode: diversify scenario phrasing from previous batches and avoid repeated stems."
          : "",
        params.retryReason ? `Fix previous quality issues: ${params.retryReason}.` : "",
      ]
        .filter(Boolean)
        .join(" ");

      const sharedRequest = {
        feature: "ai_test_question_batch",
        promptVersion: `${AI_TEST_BATCH_PROMPT_VERSION}_${batch.batch_type}`,
        systemInstruction,
        input: {
          user_id: params.userId,
          course_id: params.courseId,
          course_title: params.courseTitle,
          course_description: params.courseDescription ?? null,
          difficulty_band: params.difficultyBand,
          variant_no: params.variantNo,
          generation_attempt_no: params.generationAttemptNo,
          batch_no: batch.batch_no,
          batch_type: batch.batch_type,
          retry_count: retryCount,
          question_plan_batch: batchPlan,
          course_context_summary: params.contextSummary,
          recent_generated_question_signals: priorQuestionSignals,
        },
      } as const;

      let generated:
        | Awaited<ReturnType<typeof generateStructuredJson<z.infer<typeof generatedShortAnswerBatchSchema>>>>
        | Awaited<ReturnType<typeof generateStructuredJson<z.infer<typeof generatedObjectiveBatchSchema>>>>;

      if (isShortBatch) {
        generated = await generateStructuredJson({
          ...sharedRequest,
          outputSchema: generatedShortAnswerBatchSchema,
          fallback: () => ({
            question_batch:
              fallbackBatch as unknown as z.infer<typeof generatedShortAnswerBatchSchema>["question_batch"],
          }),
          temperature: strictMode ? 0.05 : 0.1,
          maxOutputTokens: strictMode ? 320 : 240,
        });
      } else {
        generated = await generateStructuredJson({
          ...sharedRequest,
          outputSchema: generatedObjectiveBatchSchema,
          fallback: () => ({
            question_batch:
              fallbackBatch as unknown as z.infer<typeof generatedObjectiveBatchSchema>["question_batch"],
          }),
          temperature: strictMode ? 0.1 : 0.2,
          maxOutputTokens: strictMode ? 480 : 380,
        });
      }

      const { output, provenance, debug } = generated;

      providers.add(provenance.provider);
      models.add(provenance.model);
      promptVersions.add(provenance.prompt_version);
      if (provenance.failure_reason) {
        failureReasons.push(provenance.failure_reason);
      }

      const outputRecord = (output ?? {}) as GenericRecord;
      const batchQuestions = Array.isArray(outputRecord.question_batch)
        ? (outputRecord.question_batch as Array<z.infer<typeof generatedQuestionSchema>>)
        : [];
      const rawResponseLength = debug.raw_response_text?.length ?? 0;
      const parseFailedReason = provenance.fallback_used
        ? provenance.failure_reason || "provider_parse_failed"
        : batchQuestions.length !== expectedCount
        ? `question_count_mismatch_expected_${expectedCount}_actual_${batchQuestions.length}`
        : null;

      console.info("[ai_test] batch_call_result", {
        course_id: params.courseId,
        batch_no: batch.batch_no,
        batch_type: batch.batch_type,
        raw_response_length: rawResponseLength,
        retry_count: retryCount,
        parse_failed_reason: parseFailedReason,
        fallback_used: provenance.fallback_used,
        response_preview:
          debug.raw_response_text && debug.raw_response_text.length > 0
            ? debug.raw_response_text.slice(0, 120)
            : null,
      });

      return {
        batchQuestions,
        provenance,
        rawResponseLength,
        parseFailedReason,
      };
    };

    let selectedQuestions: Array<z.infer<typeof generatedQuestionSchema>> = [];
    let selectedProvenance: AiProvenance | null = null;
    let retryCount = 0;
    let parseFailedReason: string | null = null;
    let finalRawResponseLength = 0;
    let fallbackUsedAfterRetry = false;

    for (let attempt = 0; attempt <= BATCH_MAX_RETRIES; attempt += 1) {
      const attemptResult = await runBatchCall(
        attempt,
        attempt > 0,
        parseFailedReason,
      );
      selectedQuestions = attemptResult.batchQuestions;
      selectedProvenance = attemptResult.provenance;
      parseFailedReason = attemptResult.parseFailedReason;
      finalRawResponseLength = attemptResult.rawResponseLength;
      retryCount = attempt;

      if (!parseFailedReason) {
        break;
      }

      if (attempt < BATCH_MAX_RETRIES) {
        console.warn("[ai_test] batch_parse_failed", {
          course_id: params.courseId,
          batch_no: batch.batch_no,
          batch_type: batch.batch_type,
          raw_response_length: attemptResult.rawResponseLength,
          retry_count: attempt,
          parse_failed_reason: parseFailedReason,
        });
      }
    }

    if (parseFailedReason) {
      selectedQuestions = fallbackBatch;
      fallbackUsedAfterRetry = true;
      anyFallbackUsed = true;
      failedBatches.push({
        batch_no: batch.batch_no,
        batch_type: batch.batch_type,
        reason: parseFailedReason,
      });
      console.warn("[pipeline] fallback_used", {
        pipeline: "ai_test_question_batch",
        source: "provider_fallback_after_retry",
        course_id: params.courseId,
        batch_no: batch.batch_no,
        batch_type: batch.batch_type,
        retry_count: retryCount,
        parse_failed_reason: parseFailedReason,
        fallback_used_after_retry: true,
      });
    }

    rawQuestions.push(...selectedQuestions);
    console.info("[ai_test] batch_generation_result", {
      course_id: params.courseId,
      batch_no: batch.batch_no,
      batch_type: batch.batch_type,
      generation_attempt_no: params.generationAttemptNo,
      question_count: selectedQuestions.length,
      raw_response_length: finalRawResponseLength,
      retry_count: retryCount,
      parse_failed_reason: parseFailedReason,
      fallback_used_after_retry: fallbackUsedAfterRetry,
      fallback_used: (selectedProvenance?.fallback_used ?? false) || fallbackUsedAfterRetry,
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
    questionBatch: rawQuestions,
    batchCount: planBatches.length,
    failedBatches,
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
  const multipleChoiceCount = rows.filter(
    (row) => row.question_type === "multiple_choice",
  ).length;
  const fillBlankCount = rows.filter((row) => row.question_type === "fill_blank").length;
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
    multipleChoiceCount !== MULTIPLE_CHOICE_QUESTION_COUNT ||
    fillBlankCount !== FILL_BLANK_QUESTION_COUNT ||
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
      multiple_choice_count: multipleChoiceCount,
      fill_blank_count: fillBlankCount,
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

  console.info("[ai_test] resolve_template:query", {
    course_id: params.courseId,
    version: params.variantNo,
    query_fields: {
      table: "ai_test_templates",
      select: "id, difficulty_band, variant_no, version, based_on_resource_option_id, created_at",
      filters: [
        { field: "course_id", op: "eq", value: params.courseId },
        { field: "status", op: "eq", value: "ready" },
        { field: "version", op: "eq", value: params.variantNo },
      ],
      order_by: "created_at.desc",
      order_field: "created_at",
      limit: 50,
    },
  });

  const { data, error } = await supabaseAdmin
    .from("ai_test_templates")
    .select("id, difficulty_band, variant_no, version, based_on_resource_option_id, created_at")
    .eq("course_id", params.courseId)
    .eq("status", "ready")
    .eq("version", params.variantNo)
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
      const rowVersion = Math.max(
        rowVariant,
        Math.floor(toNumberValue(row.version) || 0),
      );
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
        rowVersion,
        createdAtMs: Number.isFinite(Date.parse(toStringValue(row.created_at)))
          ? Date.parse(toStringValue(row.created_at))
          : 0,
      };
    })
    .filter(
      (
        row,
      ): row is {
        id: string;
        matchesDesired: boolean;
        rowVersion: number;
        createdAtMs: number;
      } => Boolean(row),
    )
    .sort((a, b) => {
      if (a.rowVersion !== b.rowVersion) {
        return b.rowVersion - a.rowVersion;
      }
      return b.createdAtMs - a.createdAtMs;
    });

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

type AiTestTemplateStatus = "draft" | "ready" | "failed";

type AiTestTemplateInsertRow = {
  course_id: string;
  version: number;
  title: string;
  description: string | null;
  total_score: number;
  status: AiTestTemplateStatus;
  generated_by: "ai";
  source_hash: string;
  created_at: string;
  updated_at: string;
  difficulty_band: DifficultyBand;
  variant_no: number;
  based_on_resource_option_id: string | null;
  reuse_scope: "course";
};

type AiTestTemplateUpdateRow = Partial<AiTestTemplateInsertRow> & {
  updated_at: string;
};

type AiTestTemplateQuestionInsertRow = {
  template_id: string;
  course_id: string;
  question_order: number;
  question_type: "multiple_choice" | "fill_blank" | "short_answer";
  question_text: string;
  options_json: string[] | null;
  correct_answer_text: string | null;
  acceptable_answers_json: string[] | null;
  explanation: string | null;
  score: number;
  difficulty: DifficultyBand;
  created_at: string;
  skill_tags: string[] | null;
  concept_tags: string[] | null;
  external_question_key: string | null;
};

type TemplateHeaderResolution = {
  templateId: string;
  templateVersion: number;
  createdNew: boolean;
  overwriteExistingQuestions: boolean;
};

function isDuplicateKeyError(error: unknown) {
  const record = (error ?? {}) as GenericRecord;
  const code = toStringValue(record.code).trim();
  const message = toStringValue(record.message).toLowerCase();
  return code === "23505" || message.includes("duplicate key");
}

function isMissingColumnError(error: unknown) {
  const record = (error ?? {}) as GenericRecord;
  const code = toStringValue(record.code).trim();
  return code === "42703";
}

function parseMissingColumnName(error: unknown) {
  const message = toStringValue((error as GenericRecord)?.message);
  const matched = message.match(/column\s+"([^"]+)"/i) || message.match(/column\s+([a-zA-Z0-9_]+)/i);
  return matched?.[1]?.trim() || "";
}

function isOnConflictSpecError(error: unknown) {
  const record = (error ?? {}) as GenericRecord;
  const code = toStringValue(record.code).trim();
  const message = toStringValue(record.message).toLowerCase();
  return (
    code === "42P10" ||
    message.includes("no unique or exclusion constraint matching") ||
    message.includes("there is no unique or exclusion constraint matching")
  );
}

function buildTemplateStorageMetadata(params: {
  generatedAt: string;
  attemptNumber: number;
  variantNo: number;
  promptVersion: string;
  sourceHash: string;
  questionCount: number;
}) {
  return {
    generated_at: params.generatedAt,
    attempt_number: params.attemptNumber,
    variant_no: params.variantNo,
    prompt_version: params.promptVersion,
    source_hash: params.sourceHash,
    question_count: params.questionCount,
  };
}

function toSafeQuestionBatchForStorage(questions: GeneratedAiQuestion[]) {
  const lightweight = questions.map((question) => ({
    question_order: question.question_order,
    question_type: question.question_type,
    question_text: question.question_text,
    options: question.options,
    score: OBJECTIVE_QUESTION_SCORE,
    concept_tags: question.concept_tags,
    skill_tags: question.skill_tags,
  }));
  const serialized = JSON.stringify(lightweight);
  return JSON.parse(serialized) as unknown;
}

async function insertTemplateRowWithOptionalColumns(
  payload: AiTestTemplateInsertRow,
): Promise<{ id: string }> {
  let mutablePayload: Record<string, unknown> = { ...payload };
  const removableOptionalColumns = new Set<string>();

  while (true) {
    const insertResult = await supabaseAdmin
      .from("ai_test_templates")
      .insert(mutablePayload)
      .select("id")
      .limit(1)
      .maybeSingle();
    if (!insertResult.error && insertResult.data) {
      const id = toStringValue((insertResult.data as GenericRecord).id);
      if (id) {
        return { id };
      }
    }
    if (!insertResult.error) {
      throw new Error("Unable to insert AI test template.");
    }

    if (isMissingColumnError(insertResult.error)) {
      const missingColumn = parseMissingColumnName(insertResult.error);
      if (missingColumn && removableOptionalColumns.has(missingColumn)) {
        delete mutablePayload[missingColumn];
        console.warn("[ai_test_template] template_insert_optional_column_removed", {
          missing_column: missingColumn,
        });
        continue;
      }
    }
    throw insertResult.error;
  }
}

async function updateTemplateRowWithOptionalColumns(params: {
  templateId: string;
  payload: AiTestTemplateUpdateRow;
}) {
  let mutablePayload: Record<string, unknown> = { ...params.payload };
  const removableOptionalColumns = new Set<string>();

  while (true) {
    const result = await supabaseAdmin
      .from("ai_test_templates")
      .update(mutablePayload)
      .eq("id", params.templateId);
    if (!result.error) {
      return;
    }
    if (isMissingColumnError(result.error)) {
      const missingColumn = parseMissingColumnName(result.error);
      if (missingColumn && removableOptionalColumns.has(missingColumn)) {
        delete mutablePayload[missingColumn];
        console.warn("[ai_test_template] template_update_optional_column_removed", {
          template_id: params.templateId,
          missing_column: missingColumn,
        });
        continue;
      }
    }
    throw result.error;
  }
}

async function upsertTemplateRowWithConflict(params: {
  payload: AiTestTemplateInsertRow;
  conflictCandidates: string[];
}): Promise<{ id: string; conflictKey: string } | null> {
  let mutablePayload: Record<string, unknown> = { ...params.payload };
  const removableOptionalColumns = new Set<string>();
  const candidates = [...params.conflictCandidates];

  while (candidates.length > 0) {
    const conflictKey = candidates[0];
    const result = await supabaseAdmin
      .from("ai_test_templates")
      .upsert(mutablePayload, { onConflict: conflictKey, ignoreDuplicates: false })
      .select("id")
      .limit(1)
      .maybeSingle();

    if (!result.error && result.data) {
      const id = toStringValue((result.data as GenericRecord).id);
      if (id) {
        return {
          id,
          conflictKey,
        };
      }
    }
    if (!result.error) {
      return null;
    }

    if (isMissingColumnError(result.error)) {
      const missingColumn = parseMissingColumnName(result.error);
      if (missingColumn && removableOptionalColumns.has(missingColumn)) {
        delete mutablePayload[missingColumn];
        console.warn("[ai_test_template] template_upsert_optional_column_removed", {
          missing_column: missingColumn,
          conflict_key: conflictKey,
        });
        if (conflictKey.split(",").map((item) => item.trim()).includes(missingColumn)) {
          candidates.shift();
        }
        continue;
      }
    }

    if (isOnConflictSpecError(result.error)) {
      console.warn("[ai_test_template] template_upsert_conflict_key_unavailable", {
        conflict_key: conflictKey,
        reason: result.error.message,
      });
      candidates.shift();
      continue;
    }

    throw result.error;
  }

  return null;
}

async function resolveTemplateHeaderForWrite(params: {
  courseId: string;
  courseTitle: string;
  description: string | null;
  difficultyBand: DifficultyBand;
  desiredVersion: number;
  basedOnResourceOptionId?: string | null;
  sourceHash: string;
}): Promise<TemplateHeaderResolution> {
  const nowIso = new Date().toISOString();
  let versionCandidate = Math.max(1, Math.floor(params.desiredVersion || 1));
  const maxRetries = 6;

  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    console.info("[ai_test] template_header_insert:start", {
      course_id: params.courseId,
      version: versionCandidate,
      title: params.courseTitle,
      status: "draft",
    });
    console.info("[ai_test] resolve_template:header_lookup", {
      course_id: params.courseId,
      version: versionCandidate,
      query_fields: {
        table: "ai_test_templates",
        select: "id, version, variant_no, created_at",
        filters: [
          { field: "course_id", op: "eq", value: params.courseId },
          { field: "version", op: "eq", value: versionCandidate },
        ],
      },
    });
    const { data: existingRows, error: existingError } = await supabaseAdmin
      .from("ai_test_templates")
      .select("id, version, variant_no, created_at")
      .eq("course_id", params.courseId)
      .eq("version", versionCandidate)
      .order("created_at", { ascending: false })
      .limit(1);
    if (existingError) {
      throw existingError;
    }

    const existingRow = ((existingRows ?? []) as GenericRecord[])[0];
    const existingId = toStringValue(existingRow?.id);
    if (existingId) {
      console.info("[ai_test] template_header_insert:payload", {
        mode: "update_existing",
        course_id: params.courseId,
        version: versionCandidate,
        payload_keys: [
          "title",
          "description",
          "total_score",
          "status",
          "generated_by",
          "source_hash",
          "updated_at",
          "difficulty_band",
          "variant_no",
          "version",
          "based_on_resource_option_id",
          "reuse_scope",
        ],
      });
      try {
        await updateTemplateRowWithOptionalColumns({
          templateId: existingId,
          payload: {
            title: params.courseTitle,
            description: params.description,
            total_score: 100,
            status: "draft",
            generated_by: "ai",
            source_hash: params.sourceHash,
            updated_at: nowIso,
            difficulty_band: params.difficultyBand,
            variant_no: versionCandidate,
            version: versionCandidate,
            based_on_resource_option_id: params.basedOnResourceOptionId ?? null,
            reuse_scope: "course",
          },
        });
      } catch (error) {
        console.error("[ai_test] template_header_insert:failed", {
          course_id: params.courseId,
          version: versionCandidate,
          title: params.courseTitle,
          template_id: existingId,
          status: "draft",
          db_error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }

      console.info("[ai_test] template_header_insert:success", {
        course_id: params.courseId,
        version: versionCandidate,
        title: params.courseTitle,
        template_id: existingId,
        status: "draft",
      });
      return {
        templateId: existingId,
        templateVersion: versionCandidate,
        createdNew: false,
        overwriteExistingQuestions: true,
      };
    }

    const insertPayload: AiTestTemplateInsertRow = {
      course_id: params.courseId,
      version: versionCandidate,
      title: params.courseTitle,
      description: params.description,
      total_score: 100,
      status: "draft",
      generated_by: "ai",
      source_hash: params.sourceHash,
      created_at: nowIso,
      updated_at: nowIso,
      difficulty_band: params.difficultyBand,
      variant_no: versionCandidate,
      based_on_resource_option_id: params.basedOnResourceOptionId ?? null,
      reuse_scope: "course",
    };
    console.info("[ai_test] template_header_insert:payload", {
      mode: "insert_or_upsert",
      course_id: params.courseId,
      version: versionCandidate,
      payload_keys: Object.keys(insertPayload).sort(),
    });

    try {
      const upserted = await upsertTemplateRowWithConflict({
        payload: insertPayload,
        conflictCandidates: ["course_id,version"],
      });
      if (upserted?.id) {
        console.info("[ai_test] template_header_insert:success", {
          course_id: params.courseId,
          version: versionCandidate,
          title: params.courseTitle,
          template_id: upserted.id,
          status: "draft",
        });
        return {
          templateId: upserted.id,
          templateVersion: versionCandidate,
          createdNew: false,
          overwriteExistingQuestions: true,
        };
      }

      const inserted = await insertTemplateRowWithOptionalColumns(insertPayload);
      console.info("[ai_test] template_header_insert:success", {
        course_id: params.courseId,
        version: versionCandidate,
        title: params.courseTitle,
        template_id: inserted.id,
        status: "draft",
      });
      return {
        templateId: inserted.id,
        templateVersion: versionCandidate,
        createdNew: true,
        overwriteExistingQuestions: false,
      };
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        console.error("[ai_test] template_header_insert:failed", {
          course_id: params.courseId,
          version: versionCandidate,
          title: params.courseTitle,
          status: "draft",
          db_error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
      console.error("[ai_test] template_header_insert:failed", {
        course_id: params.courseId,
        version: versionCandidate,
        title: params.courseTitle,
        status: "draft",
        db_error: error instanceof Error ? error.message : String(error),
      });
      console.warn("[ai_test_template] template_insert_duplicate_conflict", {
        course_id: params.courseId,
        attempted_version: versionCandidate,
        attempt_no: attempt + 1,
      });
      versionCandidate += 1;
      continue;
    }
  }

  throw new Error("Unable to allocate AI test template version after duplicate conflicts.");
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
  console.info("[ai_test_template] template_insert_started", {
    course_id: params.courseId,
    difficulty_band: params.difficultyBand,
    desired_variant_no: params.variantNo,
    based_on_resource_option_id: params.basedOnResourceOptionId ?? null,
  });


  const resolution = await resolveTemplateHeaderForWrite({
    courseId: params.courseId,
    courseTitle: params.courseTitle,
    description: params.description,
    difficultyBand: params.difficultyBand,
    desiredVersion: params.variantNo,
    basedOnResourceOptionId: params.basedOnResourceOptionId ?? null,
    sourceHash: params.sourceHash,
  });

  console.info("[ai_test_template] template_header_resolved", {
    template_id: resolution.templateId,
    course_id: params.courseId,
    difficulty_band: params.difficultyBand,
    version: resolution.templateVersion,
    created_new: resolution.createdNew,
    overwrite_existing_questions: resolution.overwriteExistingQuestions,
  });

  return resolution;
}

async function insertTemplateQuestions(params: {
  templateId: string;
  courseId: string;
  difficultyBand: DifficultyBand;
  questions: GeneratedAiQuestion[];
  overwriteExisting?: boolean;
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
  const multipleChoiceQuestions = params.questions.filter(
    (question) => question.question_type === "multiple_choice",
  );
  const fillBlankQuestions = params.questions.filter(
    (question) => question.question_type === "fill_blank",
  );
  const shortAnswerQuestions = params.questions.filter(
    (question) => question.question_type === "short_answer",
  );
  if (
    multipleChoiceQuestions.length !== MULTIPLE_CHOICE_QUESTION_COUNT ||
    fillBlankQuestions.length !== FILL_BLANK_QUESTION_COUNT ||
    objectiveQuestions.length !== OBJECTIVE_QUESTION_COUNT ||
    shortAnswerQuestions.length !== SHORT_ANSWER_QUESTION_COUNT
  ) {
    throw new Error(
      `Invalid AI test composition: expected ${MULTIPLE_CHOICE_QUESTION_COUNT} multiple_choice, ${FILL_BLANK_QUESTION_COUNT} fill_blank, and ${SHORT_ANSWER_QUESTION_COUNT} short_answer questions.`,
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
      `Invalid AI test composition: expected every question score to be ${OBJECTIVE_QUESTION_SCORE}.`,
    );
  }
  const totalScore = params.questions.reduce((sum, question) => sum + question.score, 0);
  console.info("[ai_test] composition_check", {
    template_id: params.templateId,
    course_id: params.courseId,
    total_questions: params.questions.length,
    multiple_choice: multipleChoiceQuestions.length,
    fill_blank: fillBlankQuestions.length,
    short_answer: shortAnswerQuestions.length,
    total_score: totalScore,
  });
  if (totalScore !== 100) {
    throw new Error("Invalid AI test composition: total score must equal 100.");
  }
  console.info("[ai_test] generation_result", {
    template_id: params.templateId,
    course_id: params.courseId,
    question_count: params.questions.length,
    multiple_choice_count: multipleChoiceQuestions.length,
    fill_blank_count: fillBlankQuestions.length,
    objective_count: objectiveQuestions.length,
    short_answer_count: shortAnswerQuestions.length,
    total_score: totalScore,
    pass_threshold: PASS_SCORE_THRESHOLD,
    per_question_scores: params.questions.map((question) => ({
      order: question.question_order,
      type: question.question_type,
      score: OBJECTIVE_QUESTION_SCORE,
    })),
  });

  const { count: existingCount } = await supabaseAdmin
    .from("ai_test_template_questions")
    .select("id", { count: "exact", head: true })
    .eq("template_id", params.templateId);

  if (existingCount && existingCount > 0 && !params.overwriteExisting) {
    console.info("[ai_test_template_questions] template already has questions, skipping insert", {
      template_id: params.templateId,
      existing_count: existingCount,
    });
    return; 
  }

  if (existingCount && existingCount > 0 && params.overwriteExisting) {
    const { error: deleteError } = await supabaseAdmin
      .from("ai_test_template_questions")
      .delete()
      .eq("template_id", params.templateId);
    if (deleteError) {
      throw new Error(`Failed to overwrite existing AI test questions: ${deleteError.message}`);
    }
    console.info("[ai_test_template_questions] existing_questions_deleted_for_overwrite", {
      template_id: params.templateId,
      deleted_count: existingCount,
    });
  }

  console.info("[ai_test_template] question_insert_started", {
    template_id: params.templateId,
    course_id: params.courseId,
    questions_count: params.questions.length,
  });
  
  const baseRows: AiTestTemplateQuestionInsertRow[] = params.questions.map((question) => ({
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
    score: OBJECTIVE_QUESTION_SCORE,
    difficulty: params.difficultyBand,
    created_at: nowIso,
    skill_tags: question.skill_tags.length > 0 ? question.skill_tags : null,
    concept_tags: question.concept_tags.length > 0 ? question.concept_tags : null,
    external_question_key: question.external_question_key,
  }));
  logPrettyJson("[ai_test_prepare] normalized_question_rows", baseRows);
  console.info("[ai_test] template_questions_insert:payload_keys", {
    course_id: params.courseId,
    template_id: params.templateId,
    payload_keys: baseRows.length > 0 ? Object.keys(baseRows[0]).sort() : [],
  });
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

async function finalizeTemplateHeader(params: {
  templateId: string;
  courseId: string;
  templateVersion: number;
  sourceHash: string;
}) {
  console.info("[ai_test] template_status_update:start", {
    course_id: params.courseId,
    version: params.templateVersion,
    template_id: params.templateId,
    status: "ready",
  });
  try {
    await updateTemplateRowWithOptionalColumns({
      templateId: params.templateId,
      payload: {
        status: "ready",
        source_hash: params.sourceHash,
        version: params.templateVersion,
        variant_no: params.templateVersion,
        updated_at: new Date().toISOString(),
      },
    });
    console.info("[ai_test] template_status_update:success", {
      course_id: params.courseId,
      version: params.templateVersion,
      template_id: params.templateId,
      status: "ready",
    });
  } catch (error) {
    console.error("[ai_test] template_status_update:failed", {
      course_id: params.courseId,
      version: params.templateVersion,
      template_id: params.templateId,
      status: "ready",
      db_error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

async function rollbackTemplatePersistence(params: {
  templateId: string;
  courseId: string;
  templateVersion: number;
  reason: string;
}) {
  console.info("[ai_test] template_status_update:start", {
    course_id: params.courseId,
    version: params.templateVersion,
    template_id: params.templateId,
    status: "failed",
  });
  try {
    await updateTemplateRowWithOptionalColumns({
      templateId: params.templateId,
      payload: {
        status: "failed",
        updated_at: new Date().toISOString(),
      },
    });
    console.info("[ai_test] template_status_update:success", {
      course_id: params.courseId,
      version: params.templateVersion,
      template_id: params.templateId,
      status: "failed",
      reason: params.reason,
    });
  } catch (error) {
    console.error("[ai_test] template_status_update:failed", {
      course_id: params.courseId,
      version: params.templateVersion,
      template_id: params.templateId,
      status: "failed",
      db_error: error instanceof Error ? error.message : String(error),
      reason: params.reason,
    });
  }
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
  totalQuestions: number;
  objectiveQuestions: number;
  shortAnswerQuestions: number;
  totalScore: number;
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

  console.info("[ai_test] resolve_template:start", {
    user_id: params.userId,
    course_id: params.courseId,
    version: Math.max(1, Math.floor(params.attemptNumber || 1)),
    query_fields: {
      table: "ai_test_templates",
      selected_fields: ["id", "difficulty_band", "variant_no", "version", "based_on_resource_option_id", "created_at"],
      filters: ["course_id", "status", "version"],
      order_by: "created_at.desc",
      order_field: "created_at",
    },
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
        totalQuestions: TOTAL_QUESTION_COUNT,
        objectiveQuestions: OBJECTIVE_QUESTION_COUNT,
        shortAnswerQuestions: SHORT_ANSWER_QUESTION_COUNT,
        totalScore: 100,
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
    const dedupedQuestions = dedupeQuestionsBySimilarity(normalizedQuestions);
    const composition = enforceQuestionComposition({
      questions: dedupedQuestions,
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
        question_batch_count: batchResult.batchCount,
        failed_batch_count: batchResult.failedBatches.length,
      },
      parsedKeys: ["question_batch"],
    };
  };

  const hasRecoverableQualityOnlyFailure = (
    quality: ReturnType<typeof evaluateGeneratedTestQuality>,
  ) =>
    !quality.passed &&
    quality.reasons.length === 1 &&
    (quality.reasons[0] === "blueprint_alignment_low" ||
      quality.reasons[0] === "generic_concept_tags_detected");

  let attemptResult = await runQuestionGenerationAttempt(1);
  if (!attemptResult.quality.passed) {
    console.warn("[ai_test] quality_retry_triggered", {
      course_id: params.courseId,
      reasons: attemptResult.quality.reasons,
    });
    attemptResult = await runQuestionGenerationAttempt(2, attemptResult.quality.reasons.join(","));
  }

  const shouldSoftPassQualityGate = hasRecoverableQualityOnlyFailure(attemptResult.quality);
  if (shouldSoftPassQualityGate) {
    console.warn("[ai_test] quality_gate_soft_pass", {
      course_id: params.courseId,
      reason: attemptResult.quality.reasons[0],
      quality_metrics: attemptResult.quality.metrics,
    });
  }

  if (!attemptResult.quality.passed && !shouldSoftPassQualityGate) {
    const failedQualityReasons = [...attemptResult.quality.reasons];
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
      quality_reasons: failedQualityReasons,
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
    const generatedAt = new Date().toISOString();
    const templateMetadata = buildTemplateStorageMetadata({
      generatedAt,
      attemptNumber: Math.max(1, Math.floor(params.attemptNumber || 1)),
      variantNo: resolvedVariantNo,
      promptVersion,
      sourceHash,
      questionCount: finalQuestions.length,
    });
    const headerResolution = await insertTemplateRow({
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
    const templateId = headerResolution.templateId;
    const templateVersion = headerResolution.templateVersion;

    console.info("[ai_test_template] transaction_started", {
      template_id: templateId,
      course_id: resolvedCourseId,
      version: templateVersion,
      created_new: headerResolution.createdNew,
      overwrite_existing_questions: headerResolution.overwriteExistingQuestions,
    });

    try {
      await insertTemplateQuestions({
        templateId,
        courseId: resolvedCourseId,
        difficultyBand: resolvedDifficultyBand,
        questions: finalQuestions,
        overwriteExisting: headerResolution.overwriteExistingQuestions,
      });
      await upsertTemplateValidationSummary({
        templateId,
        courseId: resolvedCourseId,
        version: templateVersion,
        status: "ready",
        templateTotalScore: 100,
        questions: finalQuestions,
      });
      await finalizeTemplateHeader({
        templateId,
        courseId: resolvedCourseId,
        templateVersion,
        sourceHash,
      });
      console.info("[ai_test_template] transaction_committed", {
        template_id: templateId,
        course_id: resolvedCourseId,
        version: templateVersion,
      });
      console.info("[ai_test] batch_insert_summary", {
        message: `${finalQuestions.length} questions generated in ${Math.max(
          1,
          Math.floor(toNumberValue(attemptResult.outputRecord.question_batch_count) || 0),
        )} batches, inserted into template ${templateId}.`,
        template_id: templateId,
        total_questions: finalQuestions.length,
        batch_count: Math.max(
          1,
          Math.floor(toNumberValue(attemptResult.outputRecord.question_batch_count) || 0),
        ),
        failed_batch_count: Math.max(
          0,
          Math.floor(toNumberValue(attemptResult.outputRecord.failed_batch_count) || 0),
        ),
      });
    } catch (persistError) {
      console.error("[ai_test_template] transaction_failed", {
        template_id: templateId,
        course_id: resolvedCourseId,
        version: templateVersion,
        reason: persistError instanceof Error ? persistError.message : String(persistError),
      });
      await rollbackTemplatePersistence({
        templateId,
        courseId: resolvedCourseId,
        templateVersion,
        reason: persistError instanceof Error ? persistError.message : String(persistError),
      });
      throw persistError;
    }

    console.info("[ai_test] template_reuse_decision", {
      decision: "regenerate",
      course_id: resolvedCourseId,
      template_id: templateId,
      difficulty_band: resolvedDifficultyBand,
      variant_no: templateVersion,
      based_on_resource_option_id: resolvedBasedOnResourceOptionId,
      question_count: finalQuestions.length,
      ai_provider: provenance.provider,
      ai_model: provenance.model,
      fallback_used: provenance.fallback_used || attemptResult.composition.fallbackQuestions.length > 0,
    });

    return {
      templateId,
      totalQuestions: finalQuestions.length,
      objectiveQuestions: finalQuestions.filter(
        (question) =>
          question.question_type === "multiple_choice" ||
          question.question_type === "fill_blank",
      ).length,
      shortAnswerQuestions: finalQuestions.filter(
        (question) => question.question_type === "short_answer",
      ).length,
      totalScore: finalQuestions.reduce((sum, question) => sum + question.score, 0),
      reusedExisting: false,
      difficultyBand: resolvedDifficultyBand,
      variantNo: templateVersion,
      resourceContext: {
        selected_resource_option_id: resolvedBasedOnResourceOptionId,
        selected_resource_title: resourceContext.selected_resource_title,
        selected_resource_type: resourceContext.selected_resource_type,
        selected_resource_provider: resourceContext.selected_resource_provider,
        selected_resource_url: resourceContext.selected_resource_url,
        selected_resource_summary: resourceContext.selected_resource_summary,
      },
      metadata: {
        generated_at: generatedAt,
        attempt_number: Math.max(1, Math.floor(params.attemptNumber || 1)),
        variant_no: templateVersion,
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
      .select("id, version, variant_no, created_at")
      .eq("course_id", resolvedCourseId)
      .eq("status", "ready")
      .limit(20);

    if (fallback.error || !fallback.data) {
      throw new Error(
        `No ready AI test template found for this course. Original error: ${originalErrorMessage}`,
      );
    }

    const fallbackRows = ((fallback.data ?? []) as GenericRecord[]).sort((a, b) => {
      const aVersion = Math.max(
        0,
        Math.floor(toNumberValue(a.variant_no) || toNumberValue(a.version) || 0),
      );
      const bVersion = Math.max(
        0,
        Math.floor(toNumberValue(b.variant_no) || toNumberValue(b.version) || 0),
      );
      if (aVersion !== bVersion) {
        return bVersion - aVersion;
      }
      const aCreated = Date.parse(toStringValue(a.created_at));
      const bCreated = Date.parse(toStringValue(b.created_at));
      return (Number.isFinite(bCreated) ? bCreated : 0) - (Number.isFinite(aCreated) ? aCreated : 0);
    });
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
      totalQuestions: TOTAL_QUESTION_COUNT,
      objectiveQuestions: OBJECTIVE_QUESTION_COUNT,
      shortAnswerQuestions: SHORT_ANSWER_QUESTION_COUNT,
      totalScore: 100,
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
