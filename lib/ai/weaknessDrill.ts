import { z } from "zod";
import { generateStructuredJson } from "@/lib/ai/provider";
import { toNumberValue, toStringValue } from "@/lib/ai/common";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getTavilyClient } from "@/lib/tavilyClient";
import { formatConceptLabel, resolveWeaknessConcept } from "@/lib/weaknessProfiles";

type GenericRecord = Record<string, unknown>;
type WeaknessSessionStatus = "open" | "completed" | "skipped" | "failed";

type WeaknessDrillQuestionType = "multiple_choice" | "fill_blank";

type WeaknessDrillQuestion = {
  id: string;
  question_order: number;
  question_type: WeaknessDrillQuestionType;
  question_text: string;
  options: string[];
  correct_answer_text: string;
  acceptable_answers: string[];
  explanation: string;
  score: number;
  concept_tags: string[];
  skill_tags: string[];
};

type WeaknessStoredQuestion = {
  id: string;
  question_order: number;
  question_type: WeaknessDrillQuestionType;
  question_text: string;
  options: string[];
  correct_answer: string;
  acceptable_answers: string[];
  explanation: string;
  score: number;
  concept_tags: string[];
  skill_tags: string[];
};

type WeaknessSubmitAnswerInput = {
  question_id?: string;
  question_order?: number;
  selected_option_index?: number | null;
  answer_text?: string | null;
};

export type WeaknessConceptDrillPayload = {
  concept_tag: string;
  concept_label: string;
  concept_explanation: string;
  resources: Array<{
    title: string;
    url: string;
    summary: string;
    provider: string;
  }>;
  test: {
    weakness_test_session_id: string;
    required_score: number;
    metadata: {
      generated_at: string;
      total_questions: number;
      objective_questions: number;
      multiple_choice_questions: number;
      fill_blank_questions: number;
      total_score: number;
      reused_existing: boolean;
      fallback_used: boolean;
    };
    questions: Array<{
      id: string;
      question_order: number;
      question_type: WeaknessDrillQuestionType;
      question_text: string;
      options: string[];
      correct_answer: string;
      acceptable_answers: string[];
      explanation: string;
      score: number;
      concept_tags: string[];
      skill_tags: string[];
    }>;
  } | null;
};

export type WeaknessDrillSubmissionResult = {
  weakness_test_session_id: string;
  score: number;
  max_score: number;
  earned_score: number;
  total_score: number;
  required_score: number;
  passed: boolean;
  resolved: boolean;
  resolved_concept_tag: string | null;
  question_results: Array<{
    question_id: string;
    question_order: number;
    question_type: WeaknessDrillQuestionType;
    score: number;
    earned_score: number;
    result_status: "correct" | "incorrect" | "partial";
    expected_answer: string;
    submitted_answer: string;
    explanation: string;
  }>;
  completed_at: string;
};

const REQUIRED_SCORE_PERCENT = 90;
const MC_COUNT = 6;
const FILL_COUNT = 4;
const TOTAL_QUESTION_COUNT = MC_COUNT + FILL_COUNT;
const MC_QUESTION_SCORE = 10;
const FILL_QUESTION_SCORE = 15;
const SHORT_QUESTION_SCORE = 20;
const QUESTION_SCORE = 10;
const TOTAL_SCORE = TOTAL_QUESTION_COUNT * QUESTION_SCORE
const DISALLOWED_FILL_BLANK_PHRASES = [
  "complete the css",
  "complete the code",
  "fill in the function",
  "write the missing code block",
  "fill in the full rule",
] as const;

const oneQuestionSchema = z.object({
  question_batch: z.array(
    z.object({
      question_id: z.string().optional(),
      question_type: z.enum(["multiple_choice", "fill_blank"]).optional(),
      question_text: z.string().min(1),
      options: z.array(z.string()).optional().default([]),
      correct_answer: z.string().optional().default(""),
      acceptable_answers: z.array(z.string()).optional().default([]),
      explanation: z.string().optional().default(""),
      score: z.number().int().positive().optional(),
      concept_tags: z.array(z.string()).optional().default([]),
      skill_tags: z.array(z.string()).optional().default([]),
    }),
  ),
});

const weaknessBlueprintSchema = z.object({
  weakness_blueprint: z.object({
    concept_tag: z.string().min(1),
    subtopics: z.array(z.string().min(1)).min(8).max(10),
    question_plan: z.array(
      z.object({
        question_order: z.number().int().min(1),
        question_type: z.enum(["multiple_choice", "fill_blank"]),
        subtopic: z.string().min(1),
        skill_tag: z.string().min(1),
        intent: z.string().min(1),
        style: z.string().min(1).optional(),
      }),
    ),
  }),
});

const resourceSelectionSchema = z.object({
  resource_selection: z.object({
    selected_option_nos: z.array(z.number().int().min(1)).min(1).max(3),
  }),
});

const conceptSummarySchema = z.object({
  concept_page: z.object({
    concept_title: z.string().min(1),
    concept_explanation: z.string().min(1),
  }),
});

type ResourceCandidate = {
  option_no: number;
  title: string;
  url: string;
  summary: string;
  provider: string;
};

type WeaknessQuestionPlanItem = {
  questionOrder: number;
  questionType: WeaknessDrillQuestionType;
  subtopic: string;
  subtopicTag: string;
  skillTag: string;
  intent: string;
  style: string;
};

function normalizeConceptTag(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function normalizeWeaknessStatus(input: unknown): WeaknessSessionStatus {
  const allowed: WeaknessSessionStatus[] = ["open", "completed", "skipped", "failed"];
  const normalized = toStringValue(input).trim().toLowerCase();
  return allowed.includes(normalized as WeaknessSessionStatus)
    ? (normalized as WeaknessSessionStatus)
    : "open";
}

function parseJsonArray(value: unknown) {
  if (Array.isArray(value)) {
    return value;
  }
  const raw = toStringValue(value).trim();
  if (!raw) {
    return [] as unknown[];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function getUnknownErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  const record = (error ?? {}) as GenericRecord;
  const message = toStringValue(record.message).trim();
  if (message) {
    return message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function hasMissingColumnError(error: unknown, columns: string[]) {
  const record = (error ?? {}) as GenericRecord;
  const code = toStringValue(record.code).trim();
  const message = toStringValue(record.message).toLowerCase();
  if (code !== "PGRST204" && code !== "42703") {
    return false;
  }
  return columns.some((column) => message.includes(column.toLowerCase()));
}

function normalizeQuestionType(value: unknown): WeaknessDrillQuestionType {
  const normalized = toStringValue(value).trim().toLowerCase();
  return normalized === "fill_blank" || normalized === "fill-blank"
    ? "fill_blank"
    : "multiple_choice";
}

function ensureFourOptions(options: string[]) {
  const seeded = options.map((item) => item.trim()).filter(Boolean).slice(0, 4);
  while (seeded.length < 4) {
    seeded.push(`Option ${String.fromCharCode(65 + seeded.length)}`);
  }
  return seeded;
}

function isDisallowedFillBlankPrompt(text: string) {
  const normalized = text.trim().toLowerCase();
  return DISALLOWED_FILL_BLANK_PHRASES.some((phrase) => normalized.includes(phrase));
}

function buildFallbackQuestion(params: {
  conceptTag: string;
  conceptLabel: string;
  subtopic: string;
  subtopicTag: string;
  intent: string;
  courseTitle: string;
  questionOrder: number;
  questionType: WeaknessDrillQuestionType;
}) {
  const id = `weakness_${params.conceptTag}_${params.subtopicTag}_${params.questionOrder}`;
  const skill = `apply_${params.subtopicTag || params.conceptTag}`;
  if (params.questionType === "multiple_choice") {
    return {
      id,
      question_order: params.questionOrder,
      question_type: "multiple_choice" as const,
      question_text: `A layout bug involves ${params.subtopic}. Which fix is most appropriate in ${params.courseTitle}?`,
      options: [
        `Apply ${params.subtopic} with a concrete debugging step`,
        `Rely only on definition recall without checking runtime behavior`,
        "Ignore container/context rules and keep the same code",
        "Change unrelated styles without verifying root cause",
      ],
      correct_answer_text: `Apply ${params.subtopic} with a concrete debugging step`,
      acceptable_answers: [],
      explanation: "Choose the fix tied to the actual runtime cause.",
      score: QUESTION_SCORE,
      concept_tags: [params.conceptTag, params.subtopicTag].filter(Boolean),
      skill_tags: [skill],
    } satisfies WeaknessDrillQuestion;
  }

  return {
    id,
    question_order: params.questionOrder,
    question_type: "fill_blank" as const,
    question_text: `Fill in the blank: For ${params.subtopic}, the key term is ___.`,
    options: [],
    correct_answer_text: params.subtopicTag.replace(/_/g, " "),
    acceptable_answers: [params.subtopicTag.replace(/_/g, " ")],
    explanation: "Use the exact technical term.",
    score: QUESTION_SCORE,
    concept_tags: [params.conceptTag, params.subtopicTag].filter(Boolean),
    skill_tags: [skill],
  } satisfies WeaknessDrillQuestion;
}

function normalizeGeneratedQuestion(params: {
  raw: GenericRecord;
  questionOrder: number;
  questionType: WeaknessDrillQuestionType;
  conceptTag: string;
  conceptLabel: string;
  subtopic: string;
  subtopicTag: string;
  intendedSkillTag: string;
  intent: string;
  courseTitle: string;
}) {
  const fallback = buildFallbackQuestion({
    conceptTag: params.conceptTag,
    conceptLabel: params.conceptLabel,
    subtopic: params.subtopic,
    subtopicTag: params.subtopicTag,
    intent: params.intent,
    courseTitle: params.courseTitle,
    questionOrder: params.questionOrder,
    questionType: params.questionType,
  });

  const rawQuestionText = toStringValue(params.raw.question_text).trim() || fallback.question_text;
  const questionText =
    params.questionType === "fill_blank" && isDisallowedFillBlankPrompt(rawQuestionText)
      ? fallback.question_text
      : rawQuestionText;

  const rawOptions = Array.isArray(params.raw.options)
    ? params.raw.options.map((item) => toStringValue(item).trim()).filter(Boolean)
    : [];
  const options =
    params.questionType === "multiple_choice"
      ? ensureFourOptions(rawOptions.length > 0 ? rawOptions : fallback.options)
      : [];

  const correctAnswer =
    (params.questionType === "fill_blank" && isDisallowedFillBlankPrompt(rawQuestionText)
      ? fallback.correct_answer_text
      : toStringValue(params.raw.correct_answer).trim()) || fallback.correct_answer_text;

  const acceptableAnswers =
    params.questionType === "multiple_choice"
      ? []
      : Array.from(
          new Set(
            (Array.isArray(params.raw.acceptable_answers)
              ? params.raw.acceptable_answers
              : [correctAnswer]
            )
              .map((item) => toStringValue(item).trim())
              .filter(Boolean),
          ),
        ).slice(0, 2);

  const explanation = (toStringValue(params.raw.explanation).trim() || fallback.explanation).slice(0, 220);
  const skillTags = Array.from(
    new Set(
      (
        Array.isArray(params.raw.skill_tags)
          ? params.raw.skill_tags
          : [params.intendedSkillTag, ...fallback.skill_tags]
      )
        .map((tag) => normalizeConceptTag(toStringValue(tag)))
        .filter(Boolean),
    ),
  );

  return {
    id: toStringValue(params.raw.question_id).trim() || fallback.id,
    question_order: params.questionOrder,
    question_type: params.questionType,
    question_text: questionText,
    options,
    correct_answer_text: correctAnswer || fallback.correct_answer_text,
    acceptable_answers: acceptableAnswers.length > 0 ? acceptableAnswers : fallback.acceptable_answers,
    explanation,
    score: QUESTION_SCORE,
    concept_tags: Array.from(new Set([params.conceptTag, params.subtopicTag].filter(Boolean))),
    skill_tags:
      skillTags.length > 0
        ? skillTags
        : [params.intendedSkillTag, ...fallback.skill_tags].filter(Boolean),
  } satisfies WeaknessDrillQuestion;
}

function normalizeTextForSimilarity(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ");
}

function computeJaccardSimilarity(a: string, b: string) {
  const aTokens = new Set(normalizeTextForSimilarity(a).split(" ").filter((token) => token.length >= 3));
  const bTokens = new Set(normalizeTextForSimilarity(b).split(" ").filter((token) => token.length >= 3));
  if (aTokens.size === 0 || bTokens.size === 0) {
    return 0;
  }
  let intersection = 0;
  aTokens.forEach((token) => {
    if (bTokens.has(token)) {
      intersection += 1;
    }
  });
  const union = aTokens.size + bTokens.size - intersection;
  return union <= 0 ? 0 : intersection / union;
}

function hasVariationWording(text: string) {
  const normalized = text.toLowerCase();
  return /\bvariation\b/.test(normalized) || /\brewrite\b/.test(normalized);
}

function isQuestionNearDuplicate(candidate: WeaknessDrillQuestion, existing: WeaknessDrillQuestion[]) {
  const normalizedCandidate = normalizeTextForSimilarity(candidate.question_text);
  if (!normalizedCandidate) {
    return false;
  }
  for (const question of existing) {
    const normalizedExisting = normalizeTextForSimilarity(question.question_text);
    if (!normalizedExisting) {
      continue;
    }
    if (normalizedCandidate === normalizedExisting) {
      return true;
    }
    if (computeJaccardSimilarity(normalizedCandidate, normalizedExisting) >= 0.72) {
      return true;
    }
  }
  return false;
}

function evaluateWeaknessQuestionSetQuality(params: {
  questions: WeaknessDrillQuestion[];
  plan: WeaknessQuestionPlanItem[];
}) {
  const reasons: string[] = [];
  const variationCount = params.questions.filter((q) => hasVariationWording(q.question_text)).length;
  if (variationCount > 0) {
    reasons.push("variation_wording_detected");
  }

  let highSimilarityPairs = 0;
  for (let i = 0; i < params.questions.length; i += 1) {
    for (let j = i + 1; j < params.questions.length; j += 1) {
      const similarity = computeJaccardSimilarity(
        params.questions[i]?.question_text ?? "",
        params.questions[j]?.question_text ?? "",
      );
      if (similarity >= 0.72) {
        highSimilarityPairs += 1;
      }
    }
  }
  if (highSimilarityPairs >= 1) {
    reasons.push("high_similarity_questions_detected");
  }

  const answerFrequency = new Map<string, number>();
  params.questions.forEach((question) => {
    const key = normalizeTextForSimilarity(question.correct_answer_text);
    if (!key) {
      return;
    }
    answerFrequency.set(key, (answerFrequency.get(key) ?? 0) + 1);
  });
  if ([...answerFrequency.values()].some((count) => count >= 2)) {
    reasons.push("same_answer_repeated_too_many_times");
  }

  const distinctSubtopics = new Set(params.plan.map((item) => item.subtopicTag).filter(Boolean));
  if (distinctSubtopics.size < params.questions.length) {
    reasons.push("subtopic_coverage_too_narrow");
  }
  const distinctStyles = new Set(
    params.plan
      .map((item) => normalizeTextForSimilarity(item.style))
      .filter((style) => style.length > 0),
  );
  if (distinctStyles.size < params.questions.length) {
    reasons.push("style_diversity_insufficient");
  }

  const wordingStemFrequency = new Map<string, number>();
  params.questions.forEach((question) => {
    const stem = normalizeTextForSimilarity(question.question_text)
      .split(" ")
      .filter((token) => token.length >= 3)
      .slice(0, 5)
      .join(" ");
    if (!stem) {
      return;
    }
    wordingStemFrequency.set(stem, (wordingStemFrequency.get(stem) ?? 0) + 1);
  });
  if ([...wordingStemFrequency.values()].some((count) => count >= 2)) {
    reasons.push("question_wording_patterns_repeat");
  }

  const definitionLikeCount = params.questions.filter((question) =>
    /^(what is|define|which definition|fill in the blank: .*definition)/i.test(
      question.question_text.trim(),
    ),
  ).length;
  if (definitionLikeCount >= 4) {
    reasons.push("too_many_definition_only_questions");
  }

  const fillQuestions = params.questions.filter((question) => question.question_type === "fill_blank");
  const fillAnswers = fillQuestions.map((question) => normalizeTextForSimilarity(question.correct_answer_text));
  if (new Set(fillAnswers.filter(Boolean)).size !== fillAnswers.filter(Boolean).length) {
    reasons.push("fill_blank_answers_repeated");
  }

  return reasons;
}

async function selectTopResourceCandidates(params: {
  courseId: string;
  courseTitle: string;
  courseDescription: string | null;
  conceptTag: string;
  conceptLabel: string;
  candidates: ResourceCandidate[];
}) {
  const { output } = await generateStructuredJson({
    feature: "weakness_resource_selection",
    promptVersion: "weakness_resource_selection_v1",
    systemInstruction: [
      "Select the best resources for one specific weakness concept.",
      "Return JSON only with root key resource_selection.",
      "resource_selection must include selected_option_nos.",
      "Choose exactly 3 option_no values when possible; otherwise choose as many valid options as available.",
      "Only choose option_no from candidate_resources.",
      "Prioritize resources that directly teach the exact concept in practical detail.",
      "Prefer resources with examples, debugging guidance, and implementation details.",
    ].join(" "),
    input: {
      course_id: params.courseId,
      course_title: params.courseTitle,
      course_description: params.courseDescription,
      concept_tag: params.conceptTag,
      concept_label: params.conceptLabel,
      candidate_resources: params.candidates,
    },
    outputSchema: resourceSelectionSchema,
    fallback: () => ({
      resource_selection: {
        selected_option_nos: params.candidates.slice(0, 3).map((candidate) => candidate.option_no),
      },
    }),
    maxOutputTokens: 260,
  });

  const selection = (output as GenericRecord).resource_selection as GenericRecord;
  const selectedNos = Array.isArray(selection?.selected_option_nos)
    ? (selection.selected_option_nos as unknown[])
        .map((value) => Math.floor(toNumberValue(value)))
        .filter((value) => value > 0)
    : [];

  const chosen = Array.from(new Set(selectedNos))
    .map((optionNo) => params.candidates.find((candidate) => candidate.option_no === optionNo))
    .filter((candidate): candidate is ResourceCandidate => Boolean(candidate));

  return chosen.length > 0 ? chosen.slice(0, 3) : params.candidates.slice(0, 3);
}

async function searchTargetedResources(params: {
  userId: string;
  courseId: string;
  courseTitle: string;
  courseDescription: string | null;
  conceptTag: string;
  conceptLabel: string;
}) {
  console.info("[weakness] resource_search:start", {
    user_id: params.userId,
    course_id: params.courseId,
    concept_tag: params.conceptTag,
  });

  const client = getTavilyClient();
  if (!client) {
    console.warn("[weakness] resource_search:result", {
      user_id: params.userId,
      course_id: params.courseId,
      concept_tag: params.conceptTag,
      resource_count: 0,
      reason: "TAVILY_API_KEY is not configured.",
    });
    return [] as WeaknessConceptDrillPayload["resources"];
  }

  const query = [
    params.courseTitle,
    params.courseDescription ? `course context: ${params.courseDescription.slice(0, 140)}` : "",
    `focus concept: ${params.conceptLabel}`,
    "practical explanation",
    "real examples",
    "common mistakes",
    "debugging checklist",
    "implementation guide",
  ]
    .filter(Boolean)
    .join(" ");

  try {
    const response = await client.search(query, {
      maxResults: 8,
      includeRawContent: false,
      searchDepth: "advanced",
    });

    const uniqueByUrl = new Map<string, ResourceCandidate>();
    let optionNo = 1;
    ((response.results ?? []) as Array<Record<string, unknown>>).forEach((row) => {
      const title = toStringValue(row.title).trim();
      const url = toStringValue(row.url).trim();
      if (!title || !url || uniqueByUrl.has(url)) {
        return;
      }
      uniqueByUrl.set(url, {
        option_no: optionNo,
        title,
        url,
        provider: "tavily",
        summary:
          toStringValue(row.content).trim().slice(0, 260) ||
          `Targeted reference for ${params.conceptLabel} in ${params.courseTitle}.`,
      });
      optionNo += 1;
    });

    const candidates = Array.from(uniqueByUrl.values()).slice(0, 8);
    if (candidates.length === 0) {
      console.info("[weakness] resource_search:result", {
        user_id: params.userId,
        course_id: params.courseId,
        concept_tag: params.conceptTag,
        candidate_count: 0,
        resource_count: 0,
      });
      return [] as WeaknessConceptDrillPayload["resources"];
    }

    const selected = await selectTopResourceCandidates({
      courseId: params.courseId,
      courseTitle: params.courseTitle,
      courseDescription: params.courseDescription,
      conceptTag: params.conceptTag,
      conceptLabel: params.conceptLabel,
      candidates,
    });

    const resources = selected.map((candidate) => ({
      title: candidate.title,
      url: candidate.url,
      provider: candidate.provider,
      summary: candidate.summary,
    }));

    console.info("[weakness] resource_search:result", {
      user_id: params.userId,
      course_id: params.courseId,
      concept_tag: params.conceptTag,
      candidate_count: candidates.length,
      resource_count: resources.length,
    });

    return resources;
  } catch (error) {
    console.error("[weakness] resource_search:result", {
      user_id: params.userId,
      course_id: params.courseId,
      concept_tag: params.conceptTag,
      resource_count: 0,
      reason: error instanceof Error ? error.message : String(error),
    });
    return [] as WeaknessConceptDrillPayload["resources"];
  }
}

async function generateConceptSummary(params: {
  userId: string;
  courseId: string;
  courseTitle: string;
  courseDescription: string | null;
  conceptTag: string;
  conceptLabel: string;
  resources: WeaknessConceptDrillPayload["resources"];
}) {
  const { output } = await generateStructuredJson({
    feature: "weakness_concept_summary",
    promptVersion: "weakness_concept_summary_v1",
    systemInstruction: [
      "Return JSON only with root key concept_page.",
      "concept_page must include concept_title and concept_explanation.",
      "Write a concise practical explanation in 2-4 sentences.",
      "Explain what the concept is, why it matters in this course, and why more practice is needed.",
    ].join(" "),
    input: {
      course_id: params.courseId,
      course_title: params.courseTitle,
      course_description: params.courseDescription,
      concept_tag: params.conceptTag,
      concept_label: params.conceptLabel,
      resources: params.resources,
    },
    outputSchema: conceptSummarySchema,
    fallback: () => ({
      concept_page: {
        concept_title: params.conceptLabel,
        concept_explanation:
          `${params.conceptLabel} is a core concept in ${params.courseTitle}. ` +
          "You likely need more practice because incorrect answers indicate unstable execution and debugging decisions.",
      },
    }),
    maxOutputTokens: 350,
  });

  const conceptPage = (output as GenericRecord).concept_page as GenericRecord;
  console.info("[weakness] concept_summary:generated", {
    user_id: params.userId,
    course_id: params.courseId,
    concept_tag: params.conceptTag,
  });

  return {
    title: toStringValue(conceptPage?.concept_title).trim() || params.conceptLabel,
    explanation:
      toStringValue(conceptPage?.concept_explanation).trim() ||
      `${params.conceptLabel} requires focused practice.`,
  };
}

function buildFallbackSubtopics(conceptLabel: string) {
  const base = conceptLabel.trim().toLowerCase();
  const normalized = normalizeConceptTag(base) || "core_concept";
  return [
    `${normalized}_fundamentals`,
    `${normalized}_behavior_in_runtime`,
    `${normalized}_scenario_based_selection`,
    `${normalized}_common_mistakes`,
    `${normalized}_debugging_steps`,
    `${normalized}_edge_cases`,
    `${normalized}_interaction_with_related_rules`,
    `${normalized}_real_world_layout_decision`,
  ];
}

function buildFallbackQuestionPlan(params: {
  conceptTag: string;
  conceptLabel: string;
  subtopics: string[];
}) {
  const plan: WeaknessQuestionPlanItem[] = [];
  const styles = [
    "concept question",
    "scenario-based question",
    "debugging question",
    "behavior prediction",
    "comparison",
    "code completion",
    "rule application",
    "layout scenario usage",
  ] as const;
  const allTypes: WeaknessDrillQuestionType[] = [
    ...Array.from({ length: MC_COUNT }, () => "multiple_choice" as const),
    ...Array.from({ length: FILL_COUNT }, () => "fill_blank" as const),
  ];
  allTypes.forEach((questionType, index) => {
    const questionOrder = index + 1;
    const subtopicTag = normalizeConceptTag(params.subtopics[index % params.subtopics.length]) || params.conceptTag;
    const fillKind =
      questionType === "fill_blank" && index === MC_COUNT
        ? "concept"
        : questionType === "fill_blank" && index === MC_COUNT + 1
        ? "rule"
        : questionType === "fill_blank"
        ? "behavior"
        : "";
    plan.push({
      questionOrder,
      questionType,
      subtopic: formatConceptLabel(subtopicTag),
      subtopicTag,
      skillTag: `apply_${subtopicTag}`,
      intent:
        questionType === "multiple_choice"
          ? `Choose the most appropriate implementation decision for ${formatConceptLabel(subtopicTag)}`
          : fillKind === "concept"
          ? `Recall one exact concept token for ${formatConceptLabel(subtopicTag)}`
          : fillKind === "rule"
          ? `Fill one exact rule token for ${formatConceptLabel(subtopicTag)}`
          : `Predict one behavior token for ${formatConceptLabel(subtopicTag)}`,
      style: styles[index] ?? "scenario-based question",
    });
  });
  return plan;
}

function normalizeBlueprintPlan(params: {
  conceptTag: string;
  rawSubtopics: string[];
  rawPlan: Array<{
    question_order: number;
    question_type: WeaknessDrillQuestionType;
    subtopic: string;
    skill_tag: string;
    intent: string;
    style?: string;
  }>;
}) {
  const fallbackSubtopics = buildFallbackSubtopics(formatConceptLabel(params.conceptTag));
  const normalizedSubtopics = Array.from(
    new Set(
      [...params.rawSubtopics, ...fallbackSubtopics]
        .map((item) => normalizeConceptTag(item))
        .filter(Boolean),
    ),
  ).slice(0, 8);

  if (normalizedSubtopics.length < TOTAL_QUESTION_COUNT) {
    return buildFallbackQuestionPlan({
      conceptTag: params.conceptTag,
      conceptLabel: formatConceptLabel(params.conceptTag),
      subtopics: fallbackSubtopics,
    });
  }

  const byOrder = new Map<number, WeaknessQuestionPlanItem>();
  params.rawPlan.forEach((rawItem, index) => {
    const questionOrder = Math.max(1, Math.floor(toNumberValue(rawItem.question_order) || index + 1));
    if (questionOrder > TOTAL_QUESTION_COUNT) {
      return;
    }
    const questionType = normalizeQuestionType(rawItem.question_type);
    const subtopicTag =
      normalizeConceptTag(toStringValue(rawItem.subtopic)) || normalizedSubtopics[index % normalizedSubtopics.length];
    const skillTag =
      normalizeConceptTag(toStringValue(rawItem.skill_tag)) || `apply_${subtopicTag || params.conceptTag}`;
    const intent =
      toStringValue(rawItem.intent).trim() ||
      `Apply ${formatConceptLabel(subtopicTag || params.conceptTag)} in a practical scenario.`;
    byOrder.set(questionOrder, {
      questionOrder,
      questionType,
      subtopic: formatConceptLabel(subtopicTag || params.conceptTag),
      subtopicTag: subtopicTag || params.conceptTag,
      skillTag,
      intent,
      style: toStringValue(rawItem.style).trim() || "",
    });
  });

  const expectedTypes: WeaknessDrillQuestionType[] = [
    ...Array.from({ length: MC_COUNT }, () => "multiple_choice" as const),
    ...Array.from({ length: FILL_COUNT }, () => "fill_blank" as const),
  ];
  const fallbackStyles = buildFallbackQuestionPlan({
    conceptTag: params.conceptTag,
    conceptLabel: formatConceptLabel(params.conceptTag),
    subtopics: normalizedSubtopics,
  }).map((item) => item.style);

  const normalizedPlan: WeaknessQuestionPlanItem[] = expectedTypes.map((expectedType, index) => {
    const questionOrder = index + 1;
    const existing = byOrder.get(questionOrder);
    const subtopicTag =
      normalizeConceptTag(existing?.subtopicTag ?? "") || normalizedSubtopics[index % normalizedSubtopics.length];
    return {
      questionOrder,
      questionType: expectedType,
      subtopic: formatConceptLabel(subtopicTag),
      subtopicTag,
      skillTag: normalizeConceptTag(existing?.skillTag ?? "") || `apply_${subtopicTag}`,
      intent:
        expectedType === "multiple_choice"
          ? toStringValue(existing?.intent).trim() ||
            `Choose the best implementation decision for ${formatConceptLabel(subtopicTag)}`
          : index === MC_COUNT
          ? `Recall one exact concept token for ${formatConceptLabel(subtopicTag)}`
          : index === MC_COUNT + 1
          ? `Fill one exact rule token for ${formatConceptLabel(subtopicTag)}`
          : `Predict one behavior token for ${formatConceptLabel(subtopicTag)}`,
      style: toStringValue(existing?.style).trim() || fallbackStyles[index] || "scenario-based question",
    };
  });

  const usedSubtopics = new Set<string>();
  return normalizedPlan.map((item, index) => {
    if (!usedSubtopics.has(item.subtopicTag)) {
      usedSubtopics.add(item.subtopicTag);
      return item;
    }
    const replacement =
      normalizedSubtopics.find((candidate) => !usedSubtopics.has(candidate)) ||
      `${params.conceptTag}_${index + 1}`;
    usedSubtopics.add(replacement);
    return {
      ...item,
      subtopicTag: replacement,
      subtopic: formatConceptLabel(replacement),
      skillTag: `apply_${replacement}`,
    };
  });
}

async function generateWeaknessBlueprint(params: {
  userId: string;
  courseId: string;
  conceptTag: string;
  conceptLabel: string;
  courseTitle: string;
  courseDescription: string | null;
  resources: WeaknessConceptDrillPayload["resources"];
}) {
  console.info("[weakness] blueprint:start", {
    user_id: params.userId,
    course_id: params.courseId,
    concept_tag: params.conceptTag,
  });

  const fallbackSubtopics = buildFallbackSubtopics(params.conceptLabel);
  const fallbackPlan = buildFallbackQuestionPlan({
    conceptTag: params.conceptTag,
    conceptLabel: params.conceptLabel,
    subtopics: fallbackSubtopics,
  });

  const { output } = await generateStructuredJson({
    feature: "weakness_concept_blueprint",
    promptVersion: "weakness_concept_blueprint_v2",
    systemInstruction: [
      "Generate a weakness drill blueprint and return JSON only.",
      "Root key must be weakness_blueprint.",
      "weakness_blueprint must include concept_tag, subtopics, question_plan.",
      `Generate exactly ${TOTAL_QUESTION_COUNT} distinct subtopics and exactly ${TOTAL_QUESTION_COUNT} plan items.`,
      `question_plan must contain exactly ${TOTAL_QUESTION_COUNT} items with question_order 1..${TOTAL_QUESTION_COUNT}.`,
      `Question type distribution must be exactly: ${MC_COUNT} multiple_choice, ${FILL_COUNT} fill_blank, and no short_answer.`,
      "Subtopics must be concrete and practical, not generic labels like concept_1.",
      "Do not use variation wording or duplicate subtopics.",
      "Each question_plan item must include question_order, question_type, subtopic, skill_tag, intent, style.",
      "Each question must use a different style. Allowed styles: concept question, scenario-based question, debugging question, behavior prediction, comparison, code completion.",
      "Prefer debugging, behavior prediction, and implementation intents.",
    ].join(" "),
    input: {
      course_id: params.courseId,
      course_title: params.courseTitle,
      course_description: params.courseDescription,
      concept_tag: params.conceptTag,
      concept_label: params.conceptLabel,
      resources: params.resources,
      target_distribution: {
        multiple_choice: MC_COUNT,
        fill_blank: FILL_COUNT,
        short_answer: 0,
      },
    },
    outputSchema: weaknessBlueprintSchema,
    fallback: () => ({
      weakness_blueprint: {
        concept_tag: params.conceptTag,
        subtopics: fallbackSubtopics,
        question_plan: fallbackPlan.map((item) => ({
          question_order: item.questionOrder,
          question_type: item.questionType,
          subtopic: item.subtopic,
          skill_tag: item.skillTag,
          intent: item.intent,
          style: item.style,
        })),
      },
    }),
    maxOutputTokens: 700,
  });

  const blueprint = (output as GenericRecord).weakness_blueprint as GenericRecord;
  const rawSubtopics = Array.isArray(blueprint?.subtopics)
    ? blueprint.subtopics.map((item) => toStringValue(item).trim()).filter(Boolean)
    : [];
  const rawPlan = Array.isArray(blueprint?.question_plan)
    ? (blueprint.question_plan as Array<Record<string, unknown>>).map((item) => ({
        question_order: Math.floor(toNumberValue(item.question_order) || 0),
        question_type: normalizeQuestionType(item.question_type),
        subtopic: toStringValue(item.subtopic).trim(),
        skill_tag: toStringValue(item.skill_tag).trim(),
        intent: toStringValue(item.intent).trim(),
        style: toStringValue(item.style).trim(),
      }))
    : [];

  const normalizedPlan = normalizeBlueprintPlan({
    conceptTag: params.conceptTag,
    rawSubtopics,
    rawPlan,
  });

  console.info("[weakness] blueprint:result", {
    user_id: params.userId,
    course_id: params.courseId,
    concept_tag: params.conceptTag,
    subtopic_count: new Set(normalizedPlan.map((item) => item.subtopicTag)).size,
    plan_count: normalizedPlan.length,
  });

  return normalizedPlan;
}

async function generateQuestionForPlanItem(params: {
  userId: string;
  courseId: string;
  courseTitle: string;
  courseDescription: string | null;
  conceptTag: string;
  conceptLabel: string;
  resources: WeaknessConceptDrillPayload["resources"];
  planItem: WeaknessQuestionPlanItem;
  existingQuestions: WeaknessDrillQuestion[];
  strictMode?: boolean;
}) {
  const systemInstruction = [
    "Generate exactly one question and return strict JSON only.",
    "Root key must be question_batch and contain exactly one object.",
    "Allowed question_type values: multiple_choice, fill_blank.",
    "Use the requested question_type exactly.",
    "All strings must use double quotes; escape internal quotes.",
    "Do not include markdown, comments, or any text outside JSON.",
    "Question must be practical, concrete, and concept-focused.",
    "Question must map to the requested subtopic and style.",
    "Never generate variation labels such as Variation 1 / Variation 2.",
    "Do not paraphrase an existing question.",
    "Do not use the phrase 'first step is'.",
    params.planItem.questionType === "multiple_choice"
      ? "For multiple_choice include exactly 4 concise options."
      : "For non-multiple_choice use an empty options array.",
    params.planItem.questionType === "fill_blank"
      ? "fill_blank must be a short atomic blank only and must not require hidden code templates."
      : "Keep explanation concise.",
    "Include fields: question_id, question_type, question_text, options, correct_answer, acceptable_answers, explanation, score, concept_tags, skill_tags.",
    params.strictMode
      ? "Strict anti-repetition mode: avoid sentence patterns similar to prior questions and avoid repeated correct answers."
      : "",
  ].join(" ");

  const fallback = buildFallbackQuestion({
    conceptTag: params.conceptTag,
    conceptLabel: params.conceptLabel,
    subtopic: params.planItem.subtopic,
    subtopicTag: params.planItem.subtopicTag,
    intent: params.planItem.intent,
    courseTitle: params.courseTitle,
    questionOrder: params.planItem.questionOrder,
    questionType: params.planItem.questionType,
  });

  const { output, provenance } = await generateStructuredJson({
    feature: "weakness_concept_test_question",
    promptVersion: "weakness_concept_test_question_v1",
    systemInstruction,
    input: {
      course_id: params.courseId,
      course_title: params.courseTitle,
      course_description: params.courseDescription,
      concept_tag: params.conceptTag,
      concept_label: params.conceptLabel,
      subtopic: params.planItem.subtopic,
      subtopic_tag: params.planItem.subtopicTag,
      style: params.planItem.style,
      intent: params.planItem.intent,
      skill_tag: params.planItem.skillTag,
      resources: params.resources,
      existing_questions: params.existingQuestions.map((question) => ({
        question_order: question.question_order,
        question_text: question.question_text,
        question_type: question.question_type,
        correct_answer: question.correct_answer_text,
      })),
      requested_question_order: params.planItem.questionOrder,
      requested_question_type: params.planItem.questionType,
      requested_score: QUESTION_SCORE,
    },
    outputSchema: oneQuestionSchema,
    fallback: () => ({
      question_batch: [
        {
          question_id: fallback.id,
          question_type: fallback.question_type,
          question_text: fallback.question_text,
          options: fallback.options,
          correct_answer: fallback.correct_answer_text,
          acceptable_answers: fallback.acceptable_answers,
          explanation: fallback.explanation,
          score: fallback.score,
          concept_tags: fallback.concept_tags,
          skill_tags: fallback.skill_tags,
        },
      ],
    }),
    maxOutputTokens: 500,
  });

  const record = output as GenericRecord;
  const first = Array.isArray(record.question_batch)
    ? ((record.question_batch[0] ?? {}) as GenericRecord)
    : ({} as GenericRecord);

  return {
    question: normalizeGeneratedQuestion({
      raw: first,
      questionOrder: params.planItem.questionOrder,
      questionType: params.planItem.questionType,
      conceptTag: params.conceptTag,
      conceptLabel: params.conceptLabel,
      subtopic: params.planItem.subtopic,
      subtopicTag: params.planItem.subtopicTag,
      intendedSkillTag: params.planItem.skillTag,
      intent: params.planItem.intent,
      courseTitle: params.courseTitle,
    }),
    fallbackUsed: provenance.fallback_used,
  };
}

function hasValidComposition(questions: Array<{ question_type: string; score: number }>) {
  if (questions.length !== TOTAL_QUESTION_COUNT) {
    return false;
  }
  const mcCount = questions.filter((q) => q.question_type === "multiple_choice").length;
  const fillCount = questions.filter((q) => q.question_type === "fill_blank").length;
  const invalidTypeCount = questions.filter(
    (q) =>
      q.question_type !== "multiple_choice" &&
      q.question_type !== "fill_blank",
  ).length;
  const invalidScoreCount = questions.filter((q) => q.score !== QUESTION_SCORE).length;
  const totalScore = questions.reduce((sum, q) => sum + q.score, 0);
  return (
    mcCount === MC_COUNT &&
    fillCount === FILL_COUNT &&
    invalidTypeCount === 0 &&
    invalidScoreCount === 0 &&
    totalScore === TOTAL_SCORE
  );
}

function parseStoredCorrectAnswer(row: GenericRecord) {
  const payload = row.correct_answer_json;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as GenericRecord;
    return {
      correctAnswer:
        toStringValue(record.correct_answer).trim() || toStringValue(record.value).trim(),
      acceptableAnswers: parseJsonArray(record.acceptable_answers)
        .map((item) => toStringValue(item).trim())
        .filter(Boolean),
    };
  }
  return {
    correctAnswer: toStringValue(payload).trim(),
    acceptableAnswers: [] as string[],
  };
}

function mapQuestionRow(row: GenericRecord): WeaknessStoredQuestion {
  const parsed = parseStoredCorrectAnswer(row);
  const conceptTag = normalizeConceptTag(toStringValue(row.concept_tag)) || "core_concept";
  const skillTag = normalizeConceptTag(toStringValue(row.skill_tag)) || `apply_${conceptTag}`;
  return {
    id: toStringValue(row.id),
    question_order: Math.max(1, Math.floor(toNumberValue(row.question_order) || 1)),
    question_type: normalizeQuestionType(row.question_type),
    question_text: toStringValue(row.question_text).trim(),
    options: parseJsonArray(row.options_json).map((item) => toStringValue(item)).filter(Boolean),
    correct_answer: parsed.correctAnswer,
    acceptable_answers: parsed.acceptableAnswers,
    explanation: toStringValue(row.explanation).trim(),
    score: Math.max(1, Math.floor(toNumberValue(row.max_score) || QUESTION_SCORE)),
    concept_tags: [conceptTag],
    skill_tags: [skillTag],
  };
}

async function getOrCreateWeaknessResourceSession(params: {
  userId: string;
  courseId: string;
  conceptTag: string;
  searchQuery: string;
  summaryText: string;
}) {
  console.info("[weakness] resource_session:create:start", {
    user_id: params.userId,
    course_id: params.courseId,
    concept_tag: params.conceptTag,
  });

  const existing = await supabaseAdmin
    .from("weakness_resource_sessions")
    .select("*")
    .eq("user_id", params.userId)
    .eq("course_id", params.courseId)
    .eq("concept_tag", params.conceptTag)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing.error) {
    throw new Error(`[weakness][resource_session_lookup] ${getUnknownErrorMessage(existing.error)}`);
  }

  if (existing.data) {
    const existingSessionId = toStringValue((existing.data as GenericRecord).id);
    if (existingSessionId) {
      console.info("[weakness] resource_session:create:success", {
        user_id: params.userId,
        course_id: params.courseId,
        concept_tag: params.conceptTag,
        weakness_resource_session_id: existingSessionId,
        created_new: false,
      });
      return existingSessionId;
    }
  }

  const nowIso = new Date().toISOString();
  const inserted = await supabaseAdmin
    .from("weakness_resource_sessions")
    .insert({
      user_id: params.userId,
      course_id: params.courseId,
      concept_tag: params.conceptTag,
      search_query: params.searchQuery,
      summary_text: params.summaryText,
      status: "ready",
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select("id")
    .limit(1)
    .maybeSingle();

  if (inserted.error || !inserted.data) {
    throw new Error(`[weakness][resource_session_insert] ${getUnknownErrorMessage(inserted.error)}`);
  }

  const sessionId = toStringValue((inserted.data as GenericRecord).id);
  if (!sessionId) {
    throw new Error("[weakness][resource_session_insert] Inserted session id is empty.");
  }

  console.info("[weakness] resource_session:create:success", {
    user_id: params.userId,
    course_id: params.courseId,
    concept_tag: params.conceptTag,
    weakness_resource_session_id: sessionId,
    created_new: true,
  });

  return sessionId;
}

async function loadWeaknessResourceItems(params: { weaknessResourceSessionId: string }) {
  let result = await supabaseAdmin
    .from("weakness_resource_items")
    .select("*")
    .eq("weakness_resource_session_id", params.weaknessResourceSessionId)
    .order("created_at", { ascending: true });

  if (result.error && hasMissingColumnError(result.error, ["created_at"])) {
    result = await supabaseAdmin
      .from("weakness_resource_items")
      .select("*")
      .eq("weakness_resource_session_id", params.weaknessResourceSessionId);
  }

  if (result.error) {
    throw new Error(`[weakness][resource_items_lookup] ${getUnknownErrorMessage(result.error)}`);
  }

  return ((result.data ?? []) as GenericRecord[])
    .map((row) => ({
      title: toStringValue(row.title).trim() || toStringValue(row.resource_title).trim(),
      url: toStringValue(row.url).trim() || toStringValue(row.resource_url).trim(),
      summary: toStringValue(row.summary).trim() || toStringValue(row.snippet).trim(),
      provider:
        toStringValue(row.provider).trim() ||
        toStringValue(row.source).trim() ||
        "tavily",
    }))
    .filter((row) => row.title && row.url);
}

async function insertWeaknessResourceItems(params: {
  userId: string;
  courseId: string;
  conceptTag: string;
  weaknessResourceSessionId: string;
  resources: WeaknessConceptDrillPayload["resources"];
}) {
  console.info("[weakness] resource_items:insert:start", {
    user_id: params.userId,
    course_id: params.courseId,
    concept_tag: params.conceptTag,
    weakness_resource_session_id: params.weaknessResourceSessionId,
    insert_count: params.resources.length,
  });

  const nowIso = new Date().toISOString();
  const fullRows = params.resources.map((resource) => ({
    weakness_resource_session_id: params.weaknessResourceSessionId,
    title: resource.title,
    url: resource.url,
    summary: resource.summary,
    provider: resource.provider,
    created_at: nowIso,
  }));
  const mediumRows = params.resources.map((resource) => ({
    weakness_resource_session_id: params.weaknessResourceSessionId,
    title: resource.title,
    url: resource.url,
    summary: resource.summary,
    provider: resource.provider,
  }));
  const summaryRows = params.resources.map((resource) => ({
    weakness_resource_session_id: params.weaknessResourceSessionId,
    title: resource.title,
    url: resource.url,
    summary: resource.summary,
  }));
  const minimalRows = params.resources.map((resource) => ({
    weakness_resource_session_id: params.weaknessResourceSessionId,
    title: resource.title,
    url: resource.url,
  }));

  const insertAttempts: Array<{
    rows: Array<Record<string, unknown>>;
    missingColumns: string[];
  }> = [
    { rows: fullRows, missingColumns: ["created_at", "provider", "summary"] },
    { rows: mediumRows, missingColumns: ["provider", "summary"] },
    { rows: summaryRows, missingColumns: ["summary"] },
    { rows: minimalRows, missingColumns: [] },
  ];

  let inserted = false;
  let lastError: unknown = null;
  for (const attempt of insertAttempts) {
    const result = await supabaseAdmin.from("weakness_resource_items").insert(attempt.rows);
    if (!result.error) {
      inserted = true;
      break;
    }
    lastError = result.error;
    if (
      attempt.missingColumns.length === 0 ||
      !hasMissingColumnError(result.error, attempt.missingColumns)
    ) {
      throw new Error(`[weakness][resource_items_insert] ${getUnknownErrorMessage(result.error)}`);
    }
  }

  if (!inserted) {
    throw new Error(`[weakness][resource_items_insert] ${getUnknownErrorMessage(lastError)}`);
  }

  console.info("[weakness] resource_items:insert:success", {
    user_id: params.userId,
    course_id: params.courseId,
    concept_tag: params.conceptTag,
    weakness_resource_session_id: params.weaknessResourceSessionId,
    inserted_row_count: params.resources.length,
  });
}

async function getOrCreateWeaknessTestSession(params: {
  userId: string;
  courseId: string;
  conceptTag: string;
  weaknessResourceSessionId: string;
}) {
  console.info("[weakness] test_session:create:start", {
    user_id: params.userId,
    course_id: params.courseId,
    concept_tag: params.conceptTag,
  });

  const nowIso = new Date().toISOString();
  const initialStatus: WeaknessSessionStatus = "open";
  const insertPayload = {
    user_id: params.userId,
    course_id: params.courseId,
    concept_tag: params.conceptTag,
    weakness_resource_session_id: params.weaknessResourceSessionId,
    status: initialStatus,
    score: 0,
    created_at: nowIso,
  };
  console.info("[weakness] test_session_insert:payload", insertPayload);
  console.info("[weakness] test_session:create:payload", {
    user_id: params.userId,
    course_id: params.courseId,
    concept_tag: params.conceptTag,
    weakness_resource_session_id: params.weaknessResourceSessionId,
    payload_keys: Object.keys(insertPayload),
  });

  const inserted = await supabaseAdmin
    .from("weakness_test_sessions")
    .insert(insertPayload)
    .select("id")
    .limit(1)
    .maybeSingle();

  if (inserted.error || !inserted.data) {
    throw new Error(`[weakness][test_session_insert] ${getUnknownErrorMessage(inserted.error)}`);
  }

  const sessionId = toStringValue((inserted.data as GenericRecord).id);
  if (!sessionId) {
    throw new Error("[weakness][test_session_insert] Inserted test session id is empty.");
  }

  console.info("[weakness] test_session:create:success", {
    user_id: params.userId,
    course_id: params.courseId,
    concept_tag: params.conceptTag,
    weakness_test_session_id: sessionId,
  });

  return sessionId;
}

async function loadWeaknessTestQuestions(params: { weaknessTestSessionId: string }) {
  const result = await supabaseAdmin
    .from("weakness_test_questions")
    .select("*")
    .eq("weakness_test_session_id", params.weaknessTestSessionId)
    .order("question_order", { ascending: true });

  if (result.error) {
    throw new Error(`[weakness][test_questions_lookup] ${getUnknownErrorMessage(result.error)}`);
  }

  return ((result.data ?? []) as GenericRecord[]).map(mapQuestionRow);
}

async function insertWeaknessTestQuestions(params: {
  userId: string;
  courseId: string;
  conceptTag: string;
  weaknessTestSessionId: string;
  questions: WeaknessDrillQuestion[];
}) {
  console.info("[weakness] test_questions:insert:start", {
    user_id: params.userId,
    course_id: params.courseId,
    concept_tag: params.conceptTag,
    weakness_test_session_id: params.weaknessTestSessionId,
    insert_count: params.questions.length,
  });

  const nowIso = new Date().toISOString();
  const rows = params.questions.map((question) => ({
    weakness_test_session_id: params.weaknessTestSessionId,
    question_order: question.question_order,
    question_type: question.question_type,
    question_text: question.question_text,
    options_json: question.options,
    correct_answer_json: {
      correct_answer: question.correct_answer_text,
      acceptable_answers: question.acceptable_answers,
    },
    concept_tag: params.conceptTag,
    max_score: question.score,
    earned_score: 0,
    user_answer_json: {},
    result_status: "pending",
    explanation: question.explanation,
    created_at: nowIso,
  }));
  rows.forEach((row) => {
    console.info("[weakness] test_questions_insert:payload_keys", {
      payload_keys: Object.keys(row),
      weakness_test_session_id: row.weakness_test_session_id,
      question_order: row.question_order,
      question_type: row.question_type,
      concept_tag: row.concept_tag,
    });
    console.info("[weakness] test_questions_insert:user_answer_init", {
      question_order: row.question_order,
      user_answer_json: row.user_answer_json,
    });
  });

  const result = await supabaseAdmin.from("weakness_test_questions").insert(rows);
  if (result.error) {
    console.error("[weakness] test_questions:insert:failed", {
      user_id: params.userId,
      course_id: params.courseId,
      concept_tag: params.conceptTag,
      weakness_test_session_id: params.weaknessTestSessionId,
      inserted_row_count: 0,
      db_error: getUnknownErrorMessage(result.error),
    });
    throw new Error(`[weakness][test_questions_insert] ${getUnknownErrorMessage(result.error)}`);
  }

  console.info("[weakness] test_questions:insert:success", {
    user_id: params.userId,
    course_id: params.courseId,
    concept_tag: params.conceptTag,
    weakness_test_session_id: params.weaknessTestSessionId,
    inserted_row_count: rows.length,
  });
}

function buildWeaknessTestPayload(params: {
  weaknessTestSessionId: string;
  questions: WeaknessStoredQuestion[];
  fallbackUsed: boolean;
}) {
  const objectiveCount = params.questions.filter(
    (question) =>
      question.question_type === "multiple_choice" || question.question_type === "fill_blank",
  ).length;
  const multipleChoiceCount = params.questions.filter(
    (question) => question.question_type === "multiple_choice",
  ).length;
  const fillBlankCount = params.questions.filter(
    (question) => question.question_type === "fill_blank",
  ).length;
  const totalScore = params.questions.reduce((sum, question) => sum + question.score, 0);
  const requiredScore = calculateRequiredScore(totalScore);

  return {
    weakness_test_session_id: params.weaknessTestSessionId,
    required_score: requiredScore,
    metadata: {
      generated_at: new Date().toISOString(),
      total_questions: params.questions.length,
      objective_questions: objectiveCount,
      multiple_choice_questions: multipleChoiceCount,
      fill_blank_questions: fillBlankCount,
      total_score: totalScore,
      reused_existing: false,
      fallback_used: params.fallbackUsed,
    },
    questions: params.questions.map((question) => ({
      id: question.id,
      question_order: question.question_order,
      question_type: question.question_type,
      question_text: question.question_text,
      options: question.options,
      correct_answer: question.correct_answer,
      acceptable_answers: question.acceptable_answers,
      explanation: question.explanation,
      score: question.score,
      concept_tags: question.concept_tags,
      skill_tags: question.skill_tags,
    })),
  };
}

async function getOrCreateWeaknessResources(params: {
  userId: string;
  courseId: string;
  conceptTag: string;
  conceptLabel: string;
  summaryText: string;
  courseTitle: string;
  courseDescription: string | null;
}) {
  const searchQuery = [
    params.courseTitle,
    params.courseDescription ? `course context: ${params.courseDescription.slice(0, 140)}` : "",
    `focus concept: ${params.conceptLabel}`,
    "practical explanation",
    "real examples",
    "common mistakes",
    "debugging checklist",
    "implementation guide",
  ]
    .filter(Boolean)
    .join(" ");

  const weaknessResourceSessionId = await getOrCreateWeaknessResourceSession({
    userId: params.userId,
    courseId: params.courseId,
    conceptTag: params.conceptTag,
    searchQuery,
    summaryText: params.summaryText,
  });

  let resources = await loadWeaknessResourceItems({ weaknessResourceSessionId });
  if (resources.length > 0) {
    return { weaknessResourceSessionId, resources };
  }

  const searchedResources = await searchTargetedResources({
    userId: params.userId,
    courseId: params.courseId,
    conceptTag: params.conceptTag,
    conceptLabel: params.conceptLabel,
    courseTitle: params.courseTitle,
    courseDescription: params.courseDescription,
  });

  if (searchedResources.length > 0) {
    await insertWeaknessResourceItems({
      userId: params.userId,
      courseId: params.courseId,
      conceptTag: params.conceptTag,
      weaknessResourceSessionId,
      resources: searchedResources,
    });
    resources = await loadWeaknessResourceItems({ weaknessResourceSessionId });
  }

  return {
    weaknessResourceSessionId,
    resources: resources.length > 0 ? resources : searchedResources,
  };
}

export async function createWeaknessConceptDrill(params: {
  userId: string;
  courseId: string;
  conceptTag: string;
  courseTitle: string;
  courseDescription: string | null;
  generateTest?: boolean;
}) {
  const normalizedConceptTag = normalizeConceptTag(params.conceptTag) || "core_concept";
  const conceptLabel = formatConceptLabel(normalizedConceptTag);

  console.info("[weakness] concept_click:start", {
    user_id: params.userId,
    course_id: params.courseId,
    concept_tag: normalizedConceptTag,
    action: params.generateTest ? "improve" : "open",
  });

  const summary = await generateConceptSummary({
    userId: params.userId,
    courseId: params.courseId,
    conceptTag: normalizedConceptTag,
    conceptLabel,
    courseTitle: params.courseTitle,
    courseDescription: params.courseDescription,
    resources: [],
  });

  const { weaknessResourceSessionId, resources } = await getOrCreateWeaknessResources({
    userId: params.userId,
    courseId: params.courseId,
    conceptTag: normalizedConceptTag,
    conceptLabel: summary.title || conceptLabel,
    summaryText: summary.explanation,
    courseTitle: params.courseTitle,
    courseDescription: params.courseDescription,
  });

  if (!params.generateTest) {
    console.info("[weakness] concept_test:deferred", {
      user_id: params.userId,
      course_id: params.courseId,
      concept_tag: normalizedConceptTag,
      weakness_resource_session_id: weaknessResourceSessionId,
    });
    return {
      concept_tag: normalizedConceptTag,
      concept_label: summary.title || conceptLabel,
      concept_explanation: summary.explanation,
      resources,
      test: null,
    } satisfies WeaknessConceptDrillPayload;
  }

  const plan = await generateWeaknessBlueprint({
    userId: params.userId,
    courseId: params.courseId,
    conceptTag: normalizedConceptTag,
    conceptLabel,
    courseTitle: params.courseTitle,
    courseDescription: params.courseDescription,
    resources,
  });

  let fallbackUsed = false;
  let generatedQuestions: WeaknessDrillQuestion[] = [];
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    generatedQuestions = [];
    let attemptFallbackUsed = false;
    for (const item of plan) {
      let generated = await generateQuestionForPlanItem({
        userId: params.userId,
        courseId: params.courseId,
        courseTitle: params.courseTitle,
        courseDescription: params.courseDescription,
        conceptTag: normalizedConceptTag,
        conceptLabel,
        resources,
        planItem: item,
        existingQuestions: generatedQuestions,
        strictMode: attempt > 1,
      });

      let candidateQuestion = generated.question;
      let qualityBlocked =
        hasVariationWording(candidateQuestion.question_text) ||
        isQuestionNearDuplicate(candidateQuestion, generatedQuestions);
      if (qualityBlocked) {
        console.warn("[weakness] question_quality:retry_single", {
          user_id: params.userId,
          course_id: params.courseId,
          concept_tag: normalizedConceptTag,
          question_order: item.questionOrder,
          attempt,
        });
        generated = await generateQuestionForPlanItem({
          userId: params.userId,
          courseId: params.courseId,
          courseTitle: params.courseTitle,
          courseDescription: params.courseDescription,
          conceptTag: normalizedConceptTag,
          conceptLabel,
          resources,
          planItem: item,
          existingQuestions: generatedQuestions,
          strictMode: true,
        });
        candidateQuestion = generated.question;
        qualityBlocked =
          hasVariationWording(candidateQuestion.question_text) ||
          isQuestionNearDuplicate(candidateQuestion, generatedQuestions);
      }

      if (qualityBlocked) {
        attemptFallbackUsed = true;
        candidateQuestion = buildFallbackQuestion({
          conceptTag: normalizedConceptTag,
          conceptLabel,
          subtopic: item.subtopic,
          subtopicTag: item.subtopicTag,
          intent: item.intent,
          courseTitle: params.courseTitle,
          questionOrder: item.questionOrder,
          questionType: item.questionType,
        });
      }

      generatedQuestions.push(candidateQuestion);
      attemptFallbackUsed = attemptFallbackUsed || generated.fallbackUsed;
    }

    const qualityReasons = evaluateWeaknessQuestionSetQuality({
      questions: generatedQuestions,
      plan,
    });
    fallbackUsed = fallbackUsed || attemptFallbackUsed;
    if (qualityReasons.length === 0) {
      break;
    }

    console.warn("[weakness] question_quality:failed", {
      user_id: params.userId,
      course_id: params.courseId,
      concept_tag: normalizedConceptTag,
      attempt,
      quality_reasons: qualityReasons,
    });
  }

  const deduped: WeaknessDrillQuestion[] = [];
  for (let index = 0; index < generatedQuestions.length; index += 1) {
    const question = generatedQuestions[index];
    const planItem = plan[index];
    if (!question || !planItem) {
      continue;
    }
    if (hasVariationWording(question.question_text) || isQuestionNearDuplicate(question, deduped)) {
      fallbackUsed = true;
      deduped.push(
        buildFallbackQuestion({
          conceptTag: normalizedConceptTag,
          conceptLabel,
          subtopic: planItem.subtopic,
          subtopicTag: planItem.subtopicTag,
          intent: planItem.intent,
          courseTitle: params.courseTitle,
          questionOrder: planItem.questionOrder,
          questionType: planItem.questionType,
        }),
      );
      continue;
    }
    deduped.push(question);
  }

  console.info("[weakness] concept_test:create", {
    user_id: params.userId,
    course_id: params.courseId,
    concept_tag: normalizedConceptTag,
    weakness_resource_session_id: weaknessResourceSessionId,
    question_count: deduped.length,
  });

  const weaknessTestSessionId = await getOrCreateWeaknessTestSession({
    userId: params.userId,
    courseId: params.courseId,
    conceptTag: normalizedConceptTag,
    weaknessResourceSessionId,
  });

  await insertWeaknessTestQuestions({
    userId: params.userId,
    courseId: params.courseId,
    conceptTag: normalizedConceptTag,
    weaknessTestSessionId,
    questions: deduped,
  });

  const storedQuestions = await loadWeaknessTestQuestions({ weaknessTestSessionId });
  if (!hasValidComposition(storedQuestions)) {
    throw new Error("Weakness question composition is invalid after persistence.");
  }

  return {
    concept_tag: normalizedConceptTag,
    concept_label: summary.title || conceptLabel,
    concept_explanation: summary.explanation,
    resources,
    test: buildWeaknessTestPayload({
      weaknessTestSessionId,
      questions: storedQuestions,
      fallbackUsed,
    }),
  } satisfies WeaknessConceptDrillPayload;
}

async function loadWeaknessTestSession(params: {
  userId: string;
  courseId: string;
  conceptTag?: string;
  weaknessTestSessionId: string;
}) {
  const result = await supabaseAdmin
    .from("weakness_test_sessions")
    .select("*")
    .eq("id", params.weaknessTestSessionId)
    .limit(1)
    .maybeSingle();

  if (result.error) {
    throw new Error(`[weakness][submit_session_lookup] ${getUnknownErrorMessage(result.error)}`);
  }
  if (!result.data) {
    throw buildWeaknessSubmitError("Weakness test session not found.", 404, "WEAKNESS_SESSION_NOT_FOUND");
  }

  const row = result.data as GenericRecord;
  const sessionUserId = toStringValue(row.user_id).trim();
  const sessionCourseId = toStringValue(row.course_id).trim();
  const sessionConceptTag = normalizeConceptTag(toStringValue(row.concept_tag)) || "core_concept";
  const expectedConceptTag = normalizeConceptTag(params.conceptTag ?? "");

  if (!sessionUserId || sessionUserId !== params.userId) {
    throw buildWeaknessSubmitError(
      "You are not allowed to submit this weakness test session.",
      403,
      "WEAKNESS_SESSION_FORBIDDEN",
    );
  }
  if (!sessionCourseId || sessionCourseId !== params.courseId) {
    throw buildWeaknessSubmitError(
      "Weakness test session does not belong to this course.",
      403,
      "WEAKNESS_SESSION_COURSE_MISMATCH",
    );
  }
  if (expectedConceptTag && expectedConceptTag !== sessionConceptTag) {
    throw buildWeaknessSubmitError(
      "concept_tag does not match this weakness test session.",
      400,
      "WEAKNESS_SESSION_CONCEPT_MISMATCH",
    );
  }

  return {
    id: toStringValue(row.id).trim(),
    userId: sessionUserId,
    courseId: sessionCourseId,
    conceptTag: sessionConceptTag,
  };
}

function gradeWeaknessAnswer(params: {
  submittedAnswer: string;
  expectedAnswers: string[];
  maxScore: number;
}) {
  const normalizedSubmitted = normalizeAnswerText(params.submittedAnswer);
  const normalizedExpected = params.expectedAnswers.map((answer) => normalizeAnswerText(answer));
  const expectedSet = new Set(normalizedExpected.filter(Boolean));

  if (normalizedSubmitted && expectedSet.has(normalizedSubmitted)) {
    return {
      earnedScore: params.maxScore,
      resultStatus: "correct" as const,
    };
  }

  return {
    earnedScore: 0,
    resultStatus: "incorrect" as const,
  };
}

function normalizeAnswerText(value: unknown) {
  return toStringValue(value)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "");
}

function calculateRequiredScore(totalScore: number) {
  return Math.ceil(totalScore * (REQUIRED_SCORE_PERCENT / 100));
}

function buildWeaknessSubmitError(message: string, status: number, code: string) {
  const error = new Error(message) as Error & {
    status?: number;
    code?: string;
  };
  error.status = status;
  error.code = code;
  return error;
}

export async function submitWeaknessConceptDrillTest(params: {
  userId: string;
  courseId: string;
  conceptTag?: string;
  weaknessTestSessionId: string;
  answers: WeaknessSubmitAnswerInput[];
}): Promise<WeaknessDrillSubmissionResult> {
  const normalizedRequestedConceptTag = normalizeConceptTag(params.conceptTag ?? "");
  console.info("[weakness] submit_test:start", {
    user_id: params.userId,
    course_id: params.courseId,
    concept_tag: normalizedRequestedConceptTag || null,
    weakness_test_session_id: params.weaknessTestSessionId,
  });

  let normalizedConceptTag = normalizedRequestedConceptTag || "core_concept";
  try {
    const session = await loadWeaknessTestSession({
      userId: params.userId,
      courseId: params.courseId,
      conceptTag: normalizedRequestedConceptTag || undefined,
      weaknessTestSessionId: params.weaknessTestSessionId,
    });
    normalizedConceptTag = session.conceptTag;
    console.info("[weakness] submit_test:load_session:success", {
      user_id: params.userId,
      course_id: params.courseId,
      concept_tag: normalizedConceptTag,
      weakness_test_session_id: params.weaknessTestSessionId,
    });

    const questions = await loadWeaknessTestQuestions({
      weaknessTestSessionId: params.weaknessTestSessionId,
    });
    console.info("[weakness] submit_test:load_questions:success", {
      user_id: params.userId,
      course_id: params.courseId,
      concept_tag: normalizedConceptTag,
      weakness_test_session_id: params.weaknessTestSessionId,
      question_count: questions.length,
    });

    if (questions.length === 0) {
      throw buildWeaknessSubmitError(
        "Weakness test questions not found.",
        404,
        "WEAKNESS_TEST_QUESTIONS_NOT_FOUND",
      );
    }
    if (!hasValidComposition(questions)) {
      throw buildWeaknessSubmitError(
        "Weakness test composition is invalid.",
        500,
        "WEAKNESS_TEST_COMPOSITION_INVALID",
      );
    }

    const answersByQuestionId = new Map<string, WeaknessSubmitAnswerInput>();
    const answersByQuestionOrder = new Map<number, WeaknessSubmitAnswerInput>();
    params.answers.forEach((answer) => {
      const questionId = toStringValue(answer.question_id).trim();
      const questionOrder = Math.floor(toNumberValue(answer.question_order) || 0);
      if (questionId) {
        answersByQuestionId.set(questionId, answer);
      }
      if (questionOrder > 0) {
        answersByQuestionOrder.set(questionOrder, answer);
      }
    });

    const nowIso = new Date().toISOString();
    const questionResults: WeaknessDrillSubmissionResult["question_results"] = [];
    let earnedScore = 0;
    const totalScore = questions.reduce((sum, question) => sum + question.score, 0);
    const requiredScore = calculateRequiredScore(totalScore);

    for (const question of questions) {
      const answer =
        answersByQuestionId.get(question.id) ??
        answersByQuestionOrder.get(question.question_order) ??
        null;
      const selectedOptionIndex =
        answer && typeof answer.selected_option_index === "number"
          ? Math.floor(answer.selected_option_index)
          : null;
      const submittedAnswerRaw =
        question.question_type === "multiple_choice" && selectedOptionIndex !== null
          ? question.options[selectedOptionIndex] ?? ""
          : toStringValue(answer?.answer_text ?? "");
      const submittedAnswer = submittedAnswerRaw.trim();

      const expectedAnswers = Array.from(
        new Set(
          [question.correct_answer, ...(question.acceptable_answers ?? [])]
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      );

      const graded = gradeWeaknessAnswer({
        submittedAnswer,
        expectedAnswers,
        maxScore: question.score,
      });
      const earned = graded.earnedScore;
      const resultStatus = graded.resultStatus;
      const userAnswerJson = { answer: submittedAnswer };

      console.info("[weakness] submit_test:grade_question", {
        user_id: params.userId,
        course_id: params.courseId,
        concept_tag: normalizedConceptTag,
        weakness_test_session_id: params.weaknessTestSessionId,
        question_order: question.question_order,
        question_type: question.question_type,
        earned_score: earned,
        max_score: question.score,
        result_status: resultStatus,
      });

      const updated = await supabaseAdmin
        .from("weakness_test_questions")
        .update({
          user_answer_json: userAnswerJson,
          earned_score: earned,
          result_status: resultStatus,
        })
        .eq("id", question.id)
        .eq("weakness_test_session_id", params.weaknessTestSessionId);

      if (updated.error) {
        throw new Error(`[weakness][submit_question_update] ${getUnknownErrorMessage(updated.error)}`);
      }

      console.info("[weakness] submit_test:update_question:success", {
        user_id: params.userId,
        course_id: params.courseId,
        concept_tag: normalizedConceptTag,
        weakness_test_session_id: params.weaknessTestSessionId,
        question_order: question.question_order,
        earned_score: earned,
        result_status: resultStatus,
      });

      earnedScore += earned;
      questionResults.push({
        question_id: question.id,
        question_order: question.question_order,
        question_type: question.question_type,
        score: question.score,
        earned_score: earned,
        result_status: resultStatus,
        expected_answer: expectedAnswers[0] ?? "",
        submitted_answer: submittedAnswer,
        explanation: question.explanation,
      });
    }

    const passed = totalScore > 0 && (earnedScore / totalScore) * 100 >= REQUIRED_SCORE_PERCENT;
    const sessionUpdatePayload = {
      status: normalizeWeaknessStatus("completed"),
      score: earnedScore,
      completed_at: nowIso,
    };
    console.info("[weakness] submit_test:update_session:start", {
      user_id: params.userId,
      course_id: params.courseId,
      concept_tag: normalizedConceptTag,
      weakness_test_session_id: params.weaknessTestSessionId,
      total_score: totalScore,
      earned_score: earnedScore,
      passed,
      payload_keys: Object.keys(sessionUpdatePayload),
    });

    const sessionUpdated = await supabaseAdmin
      .from("weakness_test_sessions")
      .update(sessionUpdatePayload)
      .eq("id", params.weaknessTestSessionId)
      .eq("user_id", params.userId)
      .eq("course_id", params.courseId)
      .eq("concept_tag", normalizedConceptTag);

    if (sessionUpdated.error) {
      throw new Error(`[weakness][submit_session_update] ${getUnknownErrorMessage(sessionUpdated.error)}`);
    }

    console.info("[weakness] submit_test:update_session:success", {
      user_id: params.userId,
      course_id: params.courseId,
      concept_tag: normalizedConceptTag,
      weakness_test_session_id: params.weaknessTestSessionId,
      total_score: totalScore,
      earned_score: earnedScore,
      passed,
    });

    let resolved = false;
    if (passed) {
      const resolvedResult = await resolveWeaknessConcept({
        userId: params.userId,
        courseId: params.courseId,
        conceptTag: normalizedConceptTag,
      });

      if (!resolvedResult.success) {
        throw new Error(resolvedResult.message || "Unable to resolve weakness concept.");
      }

      resolved = true;
      console.info("[weakness] submit_test:resolve_weakness:success", {
        user_id: params.userId,
        course_id: params.courseId,
        concept_tag: normalizedConceptTag,
        weakness_test_session_id: params.weaknessTestSessionId,
        updated_count: resolvedResult.updatedCount,
      });
    }

    return {
      weakness_test_session_id: params.weaknessTestSessionId,
      score: earnedScore,
      max_score: totalScore,
      earned_score: earnedScore,
      total_score: totalScore,
      required_score: requiredScore,
      passed,
      resolved,
      resolved_concept_tag: resolved ? normalizedConceptTag : null,
      question_results: questionResults,
      completed_at: nowIso,
    };
  } catch (error) {
    console.error("[weakness] submit_test:failed", {
      user_id: params.userId,
      course_id: params.courseId,
      concept_tag: normalizedConceptTag,
      weakness_test_session_id: params.weaknessTestSessionId,
      reason: getUnknownErrorMessage(error),
    });
    throw error;
  }
}
