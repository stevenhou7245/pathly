import { randomUUID } from "crypto";
import { z } from "zod";
import { isMissingRelationOrColumnError, toNumberValue, toStringValue } from "@/lib/ai/common";
import { generateStructuredJson } from "@/lib/ai/provider";
import { formatConceptLabel, normalizeConceptTag } from "@/lib/conceptTags";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getTavilyClient } from "@/lib/tavilyClient";

type GenericRecord = Record<string, unknown>;
type WeaknessTestSessionStatus = "open" | "completed" | "skipped" | "failed";
const VALID_WEAKNESS_SESSION_STATUSES: WeaknessTestSessionStatus[] = ["open", "completed", "skipped", "failed"];

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
  raw_content?: string;
  rawContent?: string;
  score?: number;
};

export type WeaknessResourceItem = {
  id: string;
  title: string;
  url: string;
  snippet: string;
  source: string;
  score: number;
};

export type WeaknessConceptDetails = {
  course_id: string;
  course_title: string;
  course_description: string | null;
  concept_tag: string;
  concept_title: string;
  concept_explanation: string;
  search_query: string;
  session_id: string | null;
  cached: boolean;
  resources: WeaknessResourceItem[];
};

export type WeaknessTestQuestion = {
  id: string;
  question_order: number;
  question_type: "multiple_choice" | "fill_blank";
  question_text: string;
  options: string[];
  score: number;
};

type PersistedWeaknessQuestion = WeaknessTestQuestion & {
  correct_answer_text: string;
  acceptable_answers: string[];
  explanation: string;
};

export type WeaknessTestSessionPayload = {
  test_session_id: string;
  course_id: string;
  concept_tag: string;
  concept_title: string;
  total_score: number;
  cached: boolean;
  questions: WeaknessTestQuestion[];
};

export type WeaknessTestSubmitResult = {
  test_session_id: string;
  total_score: number;
  earned_score: number;
  percentage: number;
  pass_status: "passed" | "failed";
  question_results: Array<{
    question_id: string;
    question_order: number;
    question_type: "multiple_choice" | "fill_blank";
    question_text: string;
    user_answer: string;
    correct_answer: string;
    earned_score: number;
    max_score: number;
    result_status: "correct" | "partial" | "incorrect";
    explanation: string;
  }>;
};

const summarySchema = z
  .object({
    concept_title: z.string().min(1),
    concept_explanation: z.string().min(1),
  })
  .strict();

const generatedQuestionSchema = z
  .object({
    question_id: z.string().optional(),
    question_type: z.enum(["multiple_choice", "fill_blank"]).optional(),
    question_text: z.string().min(1),
    options: z.array(z.string()).optional().default([]),
    correct_answer: z.string().min(1),
    acceptable_answers: z.array(z.string()).optional().default([]),
    explanation: z.string().min(1),
    score: z.number().int().positive().optional(),
  })
  .strict();

const generatedTestSchema = z
  .object({
    questions: z.array(generatedQuestionSchema).min(1).max(1),
  })
  .strict();

const WEAKNESS_TOTAL_QUESTION_COUNT = 8;
const WEAKNESS_MULTIPLE_CHOICE_COUNT = 4;
const WEAKNESS_FILL_BLANK_COUNT = 4;
const WEAKNESS_MULTIPLE_CHOICE_SCORE = 10;
const WEAKNESS_FILL_BLANK_SCORE = 15;
const WEAKNESS_PASS_THRESHOLD_PERCENT = 90;

const WEAKNESS_STYLES = [
  "concept_question",
  "scenario_based_question",
  "debugging_question",
  "behavior_prediction",
  "comparison",
  "code_completion",
  "rule_application",
  "layout_decision",
] as const;

type WeaknessQuestionStyle = (typeof WEAKNESS_STYLES)[number];

type WeaknessQuestionPlanItem = {
  question_order: number;
  question_type: "multiple_choice" | "fill_blank";
  subtopic: string;
  style: WeaknessQuestionStyle;
  fill_blank_kind?: "concept" | "rule" | "behavior" | "code_completion";
};

const weaknessBlueprintSchema = z
  .object({
    subtopics: z.array(z.string().min(1)).min(7).max(12),
  })
  .strict();

function norm(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function err(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String((error as { message?: unknown })?.message ?? error);
}

function conceptKey(input: string) {
  return normalizeConceptTag(input);
}

export function normalizeWeaknessSessionStatus(
  status: unknown,
  fallback: WeaknessTestSessionStatus = "open",
): WeaknessTestSessionStatus {
  const normalized = norm(toStringValue(status)).toLowerCase();
  if ((VALID_WEAKNESS_SESSION_STATUSES as string[]).includes(normalized)) {
    return normalized as WeaknessTestSessionStatus;
  }
  return fallback;
}

async function updateWeaknessTestSessionRecord(params: {
  sessionId: string;
  userId: string;
  courseId: string;
  conceptTag: string;
  weaknessResourceSessionId?: string | null;
  payload: Partial<{
    status: WeaknessTestSessionStatus;
    score: number;
    completed_at: string | null;
  }>;
}) {
  const normalizedPayload: Partial<{
    status: WeaknessTestSessionStatus;
    score: number;
    completed_at: string | null;
  }> = {
    ...params.payload,
    ...(params.payload.status
      ? {
          status: normalizeWeaknessSessionStatus(params.payload.status, params.payload.status),
        }
      : {}),
  };
  console.info("[weakness] test_session_update:start", {
    user_id: params.userId,
    course_id: params.courseId,
    concept_tag: params.conceptTag,
    weakness_resource_session_id: params.weaknessResourceSessionId ?? null,
    status: normalizedPayload.status ?? null,
    score: typeof normalizedPayload.score === "number" ? normalizedPayload.score : null,
  });
  const { error } = await supabaseAdmin
    .from("weakness_test_sessions")
    .update(normalizedPayload)
    .eq("id", params.sessionId);
  if (error) {
    console.error("[weakness] test_session_update:failed", {
      user_id: params.userId,
      course_id: params.courseId,
      concept_tag: params.conceptTag,
      weakness_resource_session_id: params.weaknessResourceSessionId ?? null,
      status: normalizedPayload.status ?? null,
      score: typeof normalizedPayload.score === "number" ? normalizedPayload.score : null,
      db_error_message: error.message,
      db_error_code: error.code ?? null,
      db_error_details: error.details ?? null,
      db_error_hint: error.hint ?? null,
    });
    throw error;
  }
  console.info("[weakness] test_session_update:success", {
    user_id: params.userId,
    course_id: params.courseId,
    concept_tag: params.conceptTag,
    weakness_resource_session_id: params.weaknessResourceSessionId ?? null,
    status: normalizedPayload.status ?? null,
    score: typeof normalizedPayload.score === "number" ? normalizedPayload.score : null,
  });
}

function conceptTitle(input: string) {
  return formatConceptLabel(input);
}

function normalizeQuestionType(value: unknown): "multiple_choice" | "fill_blank" {
  const type = norm(toStringValue(value)).toLowerCase();
  if (type === "fill_blank" || type === "fill-blank") {
    return "fill_blank" as const;
  }
  return "multiple_choice" as const;
}

function isBadUrl(urlValue: string) {
  const lowered = urlValue.trim().toLowerCase();
  if (!/^https?:\/\//.test(lowered)) {
    return true;
  }
  if (/google\.[^/]+\/search|bing\.com\/search|duckduckgo\.com\/\?q=/.test(lowered)) {
    return true;
  }
  if (/example\.com/.test(lowered)) {
    return true;
  }
  try {
    const parsed = new URL(lowered);
    return (parsed.pathname || "/") === "/" && !parsed.search;
  } catch {
    return true;
  }
}

async function getCourseContext(courseId: string) {
  const { data, error } = await supabaseAdmin
    .from("courses")
    .select("id,title,description")
    .eq("id", courseId)
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error("Failed to load course context.");
  }
  if (!data) {
    throw new Error("Course not found.");
  }
  return {
    courseTitle: toStringValue((data as GenericRecord).title) || "Course",
    courseDescription: toStringValue((data as GenericRecord).description) || null,
  };
}

function buildSearchQuery(params: {
  courseTitle: string;
  courseDescription: string | null;
  conceptTag: string;
}) {
  const description = params.courseDescription ? norm(params.courseDescription).slice(0, 120) : "";
  return [
    params.courseTitle,
    formatConceptLabel(params.conceptTag),
    description,
    "tutorial explanation examples practice debugging",
  ]
    .filter(Boolean)
    .join(" ");
}

async function lookupResourcesWithTavily(params: {
  userId: string;
  courseId: string;
  conceptTag: string;
  query: string;
}) {
  console.info("[weakness] resource_search:start", {
    user_id: params.userId,
    course_id: params.courseId,
    concept_tag: params.conceptTag,
    query: params.query,
  });
  const client = getTavilyClient();
  if (!client) {
    console.warn("[weakness] resource_search:result", {
      user_id: params.userId,
      course_id: params.courseId,
      concept_tag: params.conceptTag,
      result_count: 0,
      reason: "TAVILY_API_KEY is not configured.",
    });
    return [] as WeaknessResourceItem[];
  }

  try {
    const response = await client.search(params.query, {
      maxResults: 5,
      includeRawContent: false,
      searchDepth: "advanced",
    });
    const seen = new Set<string>();
    const resources = ((response.results ?? []) as TavilyResult[])
      .map((item) => {
        const title = norm(toStringValue(item.title));
        const url = norm(toStringValue(item.url));
        if (!title || !url || isBadUrl(url) || seen.has(url)) {
          return null;
        }
        seen.add(url);
        const snippet = norm(
          toStringValue(item.content) || toStringValue(item.raw_content) || toStringValue(item.rawContent),
        ).slice(0, 320);
        let source = "web";
        try {
          source = new URL(url).hostname || "web";
        } catch {
          source = "web";
        }
        return {
          id: randomUUID(),
          title,
          url,
          snippet,
          source,
          score: Number.isFinite(item.score) ? Number(item.score) : 0,
        } satisfies WeaknessResourceItem;
      })
      .filter((item): item is Exclude<typeof item, null> => item !== null);

    console.info("[weakness] resource_search:result", {
      user_id: params.userId,
      course_id: params.courseId,
      concept_tag: params.conceptTag,
      result_count: resources.length,
    });
    return resources;
  } catch (error) {
    console.warn("[weakness] resource_search:result", {
      user_id: params.userId,
      course_id: params.courseId,
      concept_tag: params.conceptTag,
      result_count: 0,
      reason: err(error),
    });
    return [] as WeaknessResourceItem[];
  }
}

function normalizeResourceRows(rows: GenericRecord[]) {
  return rows
    .map((row, index) => ({
      id: toStringValue(row.id) || `resource-${index + 1}`,
      title: norm(toStringValue(row.title) || "Untitled resource"),
      url: norm(toStringValue(row.url)),
      snippet: norm(toStringValue(row.snippet)),
      source: norm(toStringValue(row.source) || "web"),
      score: toNumberValue(row.score),
      order: Math.max(1, Math.floor(toNumberValue(row.resource_order) || index + 1)),
    }))
    .filter((row) => Boolean(row.url))
    .sort((a, b) => a.order - b.order)
    .map((row) => ({
      id: row.id,
      title: row.title,
      url: row.url,
      snippet: row.snippet,
      source: row.source,
      score: row.score,
    }));
}

export async function getOrCreateWeaknessConceptDetails(params: {
  userId: string;
  courseId: string;
  conceptTag: string;
}): Promise<WeaknessConceptDetails> {
  const conceptTag = conceptKey(params.conceptTag) || "foundational_skills";
  console.info("[concept] normalized_tag", {
    source: "weakness_concept_details",
    input: params.conceptTag,
    normalized_tag: conceptTag,
  });
  console.info("[concept] display_label", {
    source: "weakness_concept_details",
    concept_tag: conceptTag,
    display_label: conceptTitle(conceptTag),
  });
  console.info("[weakness] concept_click:start", {
    user_id: params.userId,
    course_id: params.courseId,
    concept_tag: conceptTag,
  });

  const { courseTitle, courseDescription } = await getCourseContext(params.courseId);
  const searchQuery = buildSearchQuery({ courseTitle, courseDescription, conceptTag });
  const titleFallback = conceptTitle(conceptTag);
  const explanationFallback = `${titleFallback} is important in ${courseTitle}. Practice this concept to improve accuracy and implementation quality.`;

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("weakness_resource_sessions")
    .select("*")
    .eq("user_id", params.userId)
    .eq("course_id", params.courseId)
    .eq("concept_tag", conceptTag)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingError && !isMissingRelationOrColumnError(existingError)) {
    throw existingError;
  }
  const existingSession = (existing as GenericRecord | null) ?? null;

  if (existingSession?.id) {
    const { data: itemRows, error: itemError } = await supabaseAdmin
      .from("weakness_resource_items")
      .select("*")
      .eq("session_id", toStringValue(existingSession.id))
      .order("resource_order", { ascending: true });
    if (itemError && !isMissingRelationOrColumnError(itemError)) {
      throw itemError;
    }
    const resources = normalizeResourceRows((itemRows ?? []) as GenericRecord[]);
    const sessionStatus = norm(toStringValue(existingSession.status)).toLowerCase();
    if (sessionStatus === "ready" && (resources.length > 0 || toStringValue(existingSession.concept_explanation))) {
      return {
        course_id: params.courseId,
        course_title: courseTitle,
        course_description: courseDescription,
        concept_tag: conceptTag,
        concept_title: norm(toStringValue(existingSession.concept_title)) || titleFallback,
        concept_explanation: norm(toStringValue(existingSession.concept_explanation)) || explanationFallback,
        search_query: norm(toStringValue(existingSession.search_query)) || searchQuery,
        session_id: toStringValue(existingSession.id),
        cached: true,
        resources,
      };
    }
  }

  const resources = await lookupResourcesWithTavily({
    userId: params.userId,
    courseId: params.courseId,
    conceptTag,
    query: searchQuery,
  });

  const { output } = await generateStructuredJson({
    feature: "weakness_concept_summary",
    promptVersion: "weakness_concept_summary_v1",
    systemInstruction: [
      "Generate one concise concept drill summary.",
      "Return only JSON with keys concept_title and concept_explanation.",
      "Explain what this concept is, why it matters in this course, and why learner should practice.",
      "Keep concept_explanation to 2-4 sentences.",
    ].join(" "),
    input: {
      course_id: params.courseId,
      course_title: courseTitle,
      course_description: courseDescription,
      concept_tag: conceptTag,
      snippets: resources.map((item) => item.snippet).filter(Boolean),
    },
    outputSchema: summarySchema,
    fallback: () => ({
      concept_title: titleFallback,
      concept_explanation: explanationFallback,
    }),
    temperature: 0.2,
    maxOutputTokens: 600,
  });
  console.info("[weakness] concept_summary:generated", {
    user_id: params.userId,
    course_id: params.courseId,
    concept_tag: conceptTag,
  });

  const nowIso = new Date().toISOString();
  let sessionId = toStringValue(existingSession?.id) || null;
  try {
    if (!sessionId) {
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from("weakness_resource_sessions")
        .insert({
          user_id: params.userId,
          course_id: params.courseId,
          concept_tag: conceptTag,
          search_query: searchQuery,
          concept_title: norm(output.concept_title) || titleFallback,
          concept_explanation: norm(output.concept_explanation) || explanationFallback,
          status: "ready",
          created_at: nowIso,
          updated_at: nowIso,
        })
        .select("id")
        .limit(1)
        .maybeSingle();
      if (insertError && !isMissingRelationOrColumnError(insertError)) {
        throw insertError;
      }
      sessionId = toStringValue((inserted as GenericRecord | null)?.id) || null;
    } else {
      await supabaseAdmin
        .from("weakness_resource_sessions")
        .update({
          search_query: searchQuery,
          concept_title: norm(output.concept_title) || titleFallback,
          concept_explanation: norm(output.concept_explanation) || explanationFallback,
          status: "ready",
          updated_at: nowIso,
        })
        .eq("id", sessionId);
    }

    if (sessionId) {
      await supabaseAdmin.from("weakness_resource_items").delete().eq("session_id", sessionId);
      if (resources.length > 0) {
        await supabaseAdmin.from("weakness_resource_items").insert(
          resources.map((resource, index) => ({
            session_id: sessionId,
            resource_order: index + 1,
            title: resource.title,
            url: resource.url,
            snippet: resource.snippet,
            source: resource.source,
            score: resource.score,
            created_at: nowIso,
            updated_at: nowIso,
          })),
        );
      }
    }
  } catch (error) {
    console.warn("[weakness] concept_click:session_persist_failed", {
      user_id: params.userId,
      course_id: params.courseId,
      concept_tag: conceptTag,
      reason: err(error),
    });
  }

  return {
    course_id: params.courseId,
    course_title: courseTitle,
    course_description: courseDescription,
    concept_tag: conceptTag,
    concept_title: norm(output.concept_title) || titleFallback,
    concept_explanation: norm(output.concept_explanation) || explanationFallback,
    search_query: searchQuery,
    session_id: sessionId,
    cached: false,
    resources,
  };
}

function hasVariationWording(text: string) {
  const lowered = norm(text).toLowerCase();
  return /variation\s*\d+/i.test(lowered) || lowered.includes("variation 1") || lowered.includes("variation 2");
}

function toTokenSet(value: string) {
  return new Set(
    norm(value)
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 3),
  );
}

function textSimilarity(a: string, b: string) {
  const left = toTokenSet(a);
  const right = toTokenSet(b);
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let intersection = 0;
  left.forEach((token) => {
    if (right.has(token)) {
      intersection += 1;
    }
  });
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function normalizeSubtopic(input: string) {
  const normalized = conceptKey(input)
    .replace(/_concept$/g, "")
    .replace(/_variation_\d+$/g, "");
  if (!normalized) {
    return "";
  }
  const banned = new Set(["concept", "topic", "general", "overview", "basics", "basic", "practice"]);
  if (banned.has(normalized)) {
    return "";
  }
  return normalized;
}

function buildFallbackSubtopics(conceptTag: string) {
  const seed = normalizeSubtopic(conceptTag) || "core_skill";
  return [
    `${seed}_foundations`,
    `${seed}_scenario_selection`,
    `${seed}_debugging_signals`,
    `${seed}_behavior_prediction`,
    `${seed}_comparison_logic`,
    `${seed}_code_completion_token`,
    `${seed}_rule_constraints`,
    `${seed}_layout_decision`,
  ];
}

async function generateWeaknessSubtopics(params: {
  userId: string;
  courseId: string;
  conceptTag: string;
  courseTitle: string;
  courseDescription: string | null;
}) {
  const fallback = buildFallbackSubtopics(params.conceptTag);
  const { output } = await generateStructuredJson({
    feature: "weakness_concept_blueprint",
    promptVersion: "weakness_concept_blueprint_v2",
    systemInstruction: [
      "Generate weakness drill subtopics JSON only.",
      "Return root key subtopics.",
      "Generate exactly 8 distinct, concrete subtopics for the given concept.",
      "Subtopics must be practical and educationally meaningful.",
      "Do not output generic tags like concept, basics, topic, or variation labels.",
      "Use concise concept tags in lowercase underscore style.",
    ].join(" "),
    input: {
      user_id: params.userId,
      course_id: params.courseId,
      course_title: params.courseTitle,
      course_description: params.courseDescription,
      concept_tag: params.conceptTag,
    },
    outputSchema: weaknessBlueprintSchema,
    fallback: () => ({
      subtopics: fallback,
    }),
    temperature: 0.2,
    maxOutputTokens: 500,
  });

  const raw = Array.isArray(output.subtopics) ? output.subtopics : [];
  const normalized: string[] = [];
  const seen = new Set<string>();
  raw.forEach((item) => {
    const subtopic = normalizeSubtopic(toStringValue(item));
    if (!subtopic || seen.has(subtopic)) {
      return;
    }
    seen.add(subtopic);
    normalized.push(subtopic);
  });

  fallback.forEach((item) => {
    const subtopic = normalizeSubtopic(item);
    if (!subtopic || seen.has(subtopic)) {
      return;
    }
    seen.add(subtopic);
    normalized.push(subtopic);
  });

  while (normalized.length < WEAKNESS_TOTAL_QUESTION_COUNT) {
    const candidate = normalizeSubtopic(`${params.conceptTag}_${normalized.length + 1}`);
    if (!candidate || seen.has(candidate)) {
      break;
    }
    seen.add(candidate);
    normalized.push(candidate);
  }

  return normalized.slice(0, WEAKNESS_TOTAL_QUESTION_COUNT);
}

function buildWeaknessQuestionPlan(subtopics: string[]): WeaknessQuestionPlanItem[] {
  const safeSubtopics = [...subtopics];
  while (safeSubtopics.length < WEAKNESS_TOTAL_QUESTION_COUNT) {
    safeSubtopics.push(`subtopic_${safeSubtopics.length + 1}`);
  }
  return [
    {
      question_order: 1,
      question_type: "multiple_choice",
      subtopic: safeSubtopics[0],
      style: WEAKNESS_STYLES[0],
    },
    {
      question_order: 2,
      question_type: "multiple_choice",
      subtopic: safeSubtopics[1],
      style: WEAKNESS_STYLES[1],
    },
    {
      question_order: 3,
      question_type: "multiple_choice",
      subtopic: safeSubtopics[2],
      style: WEAKNESS_STYLES[2],
    },
    {
      question_order: 4,
      question_type: "multiple_choice",
      subtopic: safeSubtopics[3],
      style: WEAKNESS_STYLES[3],
    },
    {
      question_order: 5,
      question_type: "fill_blank",
      subtopic: safeSubtopics[4],
      style: WEAKNESS_STYLES[4],
      fill_blank_kind: "concept",
    },
    {
      question_order: 6,
      question_type: "fill_blank",
      subtopic: safeSubtopics[5],
      style: WEAKNESS_STYLES[5],
      fill_blank_kind: "rule",
    },
    {
      question_order: 7,
      question_type: "fill_blank",
      subtopic: safeSubtopics[6],
      style: WEAKNESS_STYLES[6],
      fill_blank_kind: "behavior",
    },
    {
      question_order: 8,
      question_type: "fill_blank",
      subtopic: safeSubtopics[7],
      style: WEAKNESS_STYLES[7],
      fill_blank_kind: "code_completion",
    },
  ];
}

function buildFillBlankAnswerToken(params: {
  conceptTag: string;
  subtopic: string;
  fillBlankKind: NonNullable<WeaknessQuestionPlanItem["fill_blank_kind"]>;
}) {
  const concept = normalizeSubtopic(params.conceptTag).split("_").filter(Boolean);
  const sub = normalizeSubtopic(params.subtopic).split("_").filter(Boolean);
  const candidate = [...sub, ...concept].find((part) => part.length >= 4) ?? "property";
  if (params.fillBlankKind === "rule") {
    return `${candidate}_rule`;
  }
  if (params.fillBlankKind === "behavior") {
    return `${candidate}_behavior`;
  }
  if (params.fillBlankKind === "code_completion") {
    return `${candidate}_token`;
  }
  return candidate;
}

function buildFallbackQuestionForPlanItem(params: {
  conceptTag: string;
  courseTitle: string;
  planItem: WeaknessQuestionPlanItem;
}) {
  const concept = conceptTitle(params.conceptTag);
  const subtopicLabel = conceptTitle(params.planItem.subtopic);
  if (params.planItem.question_type === "multiple_choice") {
    const options = [
      `Pick the approach that correctly applies ${subtopicLabel} in ${concept}.`,
      `Use a memorized definition only and skip implementation checks.`,
      "Apply an unrelated rule from another concept.",
      "Ignore behavior testing and ship directly.",
    ];
    return {
      question_id: `${params.conceptTag}-${params.planItem.question_order}`,
      question_type: "multiple_choice" as const,
      question_text: `In ${params.courseTitle}, which choice best handles ${subtopicLabel}?`,
      options,
      correct_answer: options[0],
      acceptable_answers: [] as string[],
      explanation: `This option correctly applies ${subtopicLabel} in practice.`,
      score: WEAKNESS_MULTIPLE_CHOICE_SCORE,
    };
  }

  const answer = buildFillBlankAnswerToken({
    conceptTag: params.conceptTag,
    subtopic: params.planItem.subtopic,
    fillBlankKind: params.planItem.fill_blank_kind ?? "concept",
  });
  return {
    question_id: `${params.conceptTag}-${params.planItem.question_order}`,
    question_type: "fill_blank" as const,
    question_text: `Fill in one token that best represents ${subtopicLabel} in ${concept}.`,
    options: [] as string[],
    correct_answer: answer,
    acceptable_answers: [answer],
    explanation: `${subtopicLabel} is validated with this key token.`,
    score: WEAKNESS_FILL_BLANK_SCORE,
  };
}

function normalizeGeneratedQuestion(params: {
  generated: GenericRecord;
  planItem: WeaknessQuestionPlanItem;
  conceptTag: string;
  courseTitle: string;
}) {
  const fallback = buildFallbackQuestionForPlanItem({
    conceptTag: params.conceptTag,
    courseTitle: params.courseTitle,
    planItem: params.planItem,
  });

  const questionType = params.planItem.question_type;
  const rawQuestionText = norm(toStringValue(params.generated.question_text));
  const rawCorrectAnswer = norm(toStringValue(params.generated.correct_answer));
  const rawExplanation = norm(toStringValue(params.generated.explanation));
  const questionText = rawQuestionText || fallback.question_text;
  const correctAnswer = rawCorrectAnswer || fallback.correct_answer;
  const explanation = rawExplanation || fallback.explanation;

  const options = questionType === "multiple_choice"
    ? (Array.isArray(params.generated.options) ? params.generated.options : [])
        .map((item) => norm(toStringValue(item)))
        .filter(Boolean)
        .slice(0, 4)
    : [];
  while (questionType === "multiple_choice" && options.length < 4) {
    options.push(`Choice ${options.length + 1}`);
  }

  const acceptableAnswers = questionType === "fill_blank"
    ? (Array.isArray(params.generated.acceptable_answers) ? params.generated.acceptable_answers : [])
        .map((item) => norm(toStringValue(item)))
        .filter(Boolean)
        .slice(0, 2)
    : [];

  const score = questionType === "multiple_choice" ? WEAKNESS_MULTIPLE_CHOICE_SCORE : WEAKNESS_FILL_BLANK_SCORE;

  return {
    id: norm(toStringValue(params.generated.question_id)) || randomUUID(),
    question_order: params.planItem.question_order,
    question_type: questionType,
    question_text: questionText,
    options,
    correct_answer_text: correctAnswer,
    acceptable_answers:
      questionType === "fill_blank"
        ? acceptableAnswers.length > 0
          ? acceptableAnswers
          : [correctAnswer]
        : [],
    explanation,
    score,
  } satisfies PersistedWeaknessQuestion;
}

function validateQuestionCandidate(params: {
  candidate: PersistedWeaknessQuestion;
  existing: PersistedWeaknessQuestion[];
}) {
  if (hasVariationWording(params.candidate.question_text) || hasVariationWording(params.candidate.explanation)) {
    return "variation_wording_detected";
  }
  const lowered = params.candidate.question_text.toLowerCase();
  if (
    lowered.includes("variation 1") ||
    lowered.includes("variation 2") ||
    lowered.includes("first step is")
  ) {
    return "repetitive_prompt_pattern";
  }
  for (const row of params.existing) {
    const similarity = textSimilarity(row.question_text, params.candidate.question_text);
    if (similarity >= 0.7) {
      return "high_similarity_question_text";
    }
  }
  const answerKey = normalizedAnswer(params.candidate.correct_answer_text);
  if (answerKey) {
    const duplicateAnswerCount = params.existing.filter(
      (row) => normalizedAnswer(row.correct_answer_text) === answerKey,
    ).length;
    if (duplicateAnswerCount >= 1) {
      return "duplicate_answer_pattern";
    }
  }
  return null;
}

function evaluateWeaknessQuestionSet(params: {
  rows: PersistedWeaknessQuestion[];
  plan: WeaknessQuestionPlanItem[];
}) {
  const reasons: string[] = [];
  if (params.rows.length !== WEAKNESS_TOTAL_QUESTION_COUNT) {
    reasons.push("invalid_question_count");
  }
  const multipleChoiceCount = params.rows.filter((row) => row.question_type === "multiple_choice").length;
  const fillBlankCount = params.rows.filter((row) => row.question_type === "fill_blank").length;
  if (multipleChoiceCount !== WEAKNESS_MULTIPLE_CHOICE_COUNT) {
    reasons.push("multiple_choice_count_mismatch");
  }
  if (fillBlankCount !== WEAKNESS_FILL_BLANK_COUNT) {
    reasons.push("fill_blank_count_mismatch");
  }
  const uniqueSubtopics = new Set(params.plan.map((item) => item.subtopic));
  if (uniqueSubtopics.size !== params.plan.length) {
    reasons.push("duplicate_subtopics");
  }

  for (let i = 0; i < params.rows.length; i += 1) {
    for (let j = i + 1; j < params.rows.length; j += 1) {
      if (textSimilarity(params.rows[i].question_text, params.rows[j].question_text) >= 0.7) {
        reasons.push("similar_questions_detected");
        break;
      }
    }
  }

  const fillAnswers = params.rows
    .filter((row) => row.question_type === "fill_blank")
    .map((row) => normalizedAnswer(row.correct_answer_text))
    .filter(Boolean);
  const seenFillAnswers = new Set<string>();
  fillAnswers.forEach((answer) => {
    if (seenFillAnswers.has(answer)) {
      reasons.push("repeated_fill_blank_answer");
    }
    seenFillAnswers.add(answer);
  });

  if (params.rows.some((row) => hasVariationWording(row.question_text))) {
    reasons.push("variation_wording_present");
  }

  return {
    passed: reasons.length === 0,
    reasons: Array.from(new Set(reasons)),
  };
}

async function generateQuestionForPlanItem(params: {
  userId: string;
  courseId: string;
  courseTitle: string;
  courseDescription: string | null;
  conceptTag: string;
  planItem: WeaknessQuestionPlanItem;
  existingQuestions: PersistedWeaknessQuestion[];
  strictRetryReason?: string;
}) {
  const fillBlankInstruction =
    params.planItem.question_type === "fill_blank"
      ? `Fill-blank kind: ${params.planItem.fill_blank_kind ?? "concept"}. The blank answer must be a short token/phrase only. Never require hidden full code blocks.`
      : "";

  const { output } = await generateStructuredJson({
    feature: "weakness_concept_test",
    promptVersion: "weakness_concept_test_v2",
    systemInstruction: [
      "Generate exactly one weakness drill question in JSON only.",
      "Return root key questions with exactly one item.",
      "No markdown, no commentary, no Variation labels.",
      "Question must map to the provided subtopic and style.",
      "Question must be unique from previous questions.",
      "Allowed question_type values: multiple_choice, fill_blank.",
      "For multiple_choice: exactly 4 meaningful options.",
      "For fill_blank: options must be an empty array.",
      "Avoid repetitive sentence patterns and avoid 'first step is'.",
      "Do not reuse the same correct answer from prior questions.",
      fillBlankInstruction,
      params.strictRetryReason ? `Fix previous issue: ${params.strictRetryReason}.` : "",
    ]
      .filter(Boolean)
      .join(" "),
    input: {
      user_id: params.userId,
      course_id: params.courseId,
      course_title: params.courseTitle,
      course_description: params.courseDescription,
      concept_tag: params.conceptTag,
      question_plan_item: params.planItem,
      existing_questions: params.existingQuestions.map((row) => ({
        question_type: row.question_type,
        question_text: row.question_text,
        correct_answer: row.correct_answer_text,
      })),
      scoring_rules: {
        multiple_choice_score: WEAKNESS_MULTIPLE_CHOICE_SCORE,
        fill_blank_score: WEAKNESS_FILL_BLANK_SCORE,
      },
    },
    outputSchema: generatedTestSchema,
    fallback: () => ({
      questions: [
        buildFallbackQuestionForPlanItem({
          conceptTag: params.conceptTag,
          courseTitle: params.courseTitle,
          planItem: params.planItem,
        }),
      ],
    }),
    temperature: 0.2,
    maxOutputTokens: 600,
  });

  const first = (output.questions?.[0] ?? {}) as GenericRecord;
  return normalizeGeneratedQuestion({
    generated: first,
    planItem: params.planItem,
    conceptTag: params.conceptTag,
    courseTitle: params.courseTitle,
  });
}

async function generateWeaknessTestQuestions(params: {
  userId: string;
  courseId: string;
  conceptTag: string;
  courseTitle: string;
  courseDescription: string | null;
}) {
  const subtopics = await generateWeaknessSubtopics({
    userId: params.userId,
    courseId: params.courseId,
    conceptTag: params.conceptTag,
    courseTitle: params.courseTitle,
    courseDescription: params.courseDescription,
  });
  console.info("[weakness] subtopics:generated", {
    user_id: params.userId,
    course_id: params.courseId,
    concept_tag: params.conceptTag,
    subtopic_count: subtopics.length,
    subtopics,
  });
  const plan = buildWeaknessQuestionPlan(subtopics);
  const rows: PersistedWeaknessQuestion[] = [];

  for (const planItem of plan) {
    let lastReason = "";
    let accepted: PersistedWeaknessQuestion | null = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const candidate = await generateQuestionForPlanItem({
        userId: params.userId,
        courseId: params.courseId,
        courseTitle: params.courseTitle,
        courseDescription: params.courseDescription,
        conceptTag: params.conceptTag,
        planItem,
        existingQuestions: rows,
        strictRetryReason: lastReason,
      });
      const reason = validateQuestionCandidate({
        candidate,
        existing: rows,
      });
      if (!reason) {
        accepted = candidate;
        break;
      }
      lastReason = reason;
    }

    if (!accepted) {
      accepted = normalizeGeneratedQuestion({
        generated: buildFallbackQuestionForPlanItem({
          conceptTag: params.conceptTag,
          courseTitle: params.courseTitle,
          planItem,
        }) as unknown as GenericRecord,
        planItem,
        conceptTag: params.conceptTag,
        courseTitle: params.courseTitle,
      });
    }

    rows.push(accepted);
  }

  const quality = evaluateWeaknessQuestionSet({
    rows,
    plan,
  });

  if (!quality.passed) {
    console.warn("[weakness] generation_quality_failed", {
      user_id: params.userId,
      course_id: params.courseId,
      concept_tag: params.conceptTag,
      reasons: quality.reasons,
    });
    const deterministic = plan.map((planItem) =>
      normalizeGeneratedQuestion({
        generated: buildFallbackQuestionForPlanItem({
          conceptTag: params.conceptTag,
          courseTitle: params.courseTitle,
          planItem,
        }) as unknown as GenericRecord,
        planItem,
        conceptTag: params.conceptTag,
        courseTitle: params.courseTitle,
      }),
    );
    return deterministic;
  }

  return rows;
}

function normalizePersistedQuestions(rows: GenericRecord[]) {
  return rows
    .map((row, index) => ({
      id: toStringValue(row.id),
      question_order: Math.max(1, Math.floor(toNumberValue(row.question_order) || index + 1)),
      question_type: normalizeQuestionType(row.question_type),
      question_text: norm(toStringValue(row.question_text)),
      options: Array.isArray(row.options_json)
        ? (row.options_json as unknown[]).map((item) => norm(toStringValue(item))).filter(Boolean)
        : [],
      correct_answer_text: norm(toStringValue(row.correct_answer_text)),
      acceptable_answers: Array.isArray(row.acceptable_answers_json)
        ? (row.acceptable_answers_json as unknown[]).map((item) => norm(toStringValue(item))).filter(Boolean)
        : [],
      explanation: norm(toStringValue(row.explanation)) || "Review this concept and retry.",
      score: Math.max(
        1,
        Math.floor(
          toNumberValue(row.score) ||
            (normalizeQuestionType(row.question_type) === "multiple_choice"
              ? WEAKNESS_MULTIPLE_CHOICE_SCORE
              : WEAKNESS_FILL_BLANK_SCORE),
        ),
      ),
    }))
    .filter((row) => Boolean(row.id && row.question_text))
    .sort((a, b) => a.question_order - b.question_order);
}

function hasValidWeaknessComposition(rows: PersistedWeaknessQuestion[]) {
  if (rows.length !== WEAKNESS_TOTAL_QUESTION_COUNT) {
    return false;
  }
  const multipleChoiceCount = rows.filter((row) => row.question_type === "multiple_choice").length;
  const fillBlankCount = rows.filter((row) => row.question_type === "fill_blank").length;
  if (multipleChoiceCount !== WEAKNESS_MULTIPLE_CHOICE_COUNT) {
    return false;
  }
  if (fillBlankCount !== WEAKNESS_FILL_BLANK_COUNT) {
    return false;
  }
  return true;
}

export async function getOrCreateWeaknessConceptTestSession(params: {
  userId: string;
  courseId: string;
  conceptTag: string;
}): Promise<WeaknessTestSessionPayload> {
  const conceptTag = conceptKey(params.conceptTag) || "foundational_skills";
  console.info("[concept] normalized_tag", {
    source: "weakness_concept_test",
    input: params.conceptTag,
    normalized_tag: conceptTag,
  });
  const { courseTitle, courseDescription } = await getCourseContext(params.courseId);
  const conceptLabel = conceptTitle(conceptTag);

  const { data: existingSession, error: existingSessionError } = await supabaseAdmin
    .from("weakness_test_sessions")
    .select("*")
    .eq("user_id", params.userId)
    .eq("course_id", params.courseId)
    .eq("concept_tag", conceptTag)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingSessionError && !isMissingRelationOrColumnError(existingSessionError)) {
    throw existingSessionError;
  }

  if (existingSession?.id) {
    const { data: existingQuestions, error: existingQuestionsError } = await supabaseAdmin
      .from("weakness_test_questions")
      .select("*")
      .eq("test_session_id", toStringValue((existingSession as GenericRecord).id))
      .order("question_order", { ascending: true });
    if (existingQuestionsError && !isMissingRelationOrColumnError(existingQuestionsError)) {
      throw existingQuestionsError;
    }
    const rows = normalizePersistedQuestions((existingQuestions ?? []) as GenericRecord[]);
    if (
      norm(toStringValue((existingSession as GenericRecord).status)).toLowerCase() === "open" &&
      rows.length > 0 &&
      hasValidWeaknessComposition(rows)
    ) {
      return {
        test_session_id: toStringValue((existingSession as GenericRecord).id),
        course_id: params.courseId,
        concept_tag: conceptTag,
        concept_title: conceptLabel,
        total_score: rows.reduce((sum, row) => sum + row.score, 0),
        cached: true,
        questions: rows.map((row) => ({
          id: row.id,
          question_order: row.question_order,
          question_type: row.question_type,
          question_text: row.question_text,
          options: row.options,
          score: row.score,
        })),
      };
    }
  }

  console.info("[weakness] concept_test:create", {
    user_id: params.userId,
    course_id: params.courseId,
    concept_tag: conceptTag,
  });

  const questions = await generateWeaknessTestQuestions({
    userId: params.userId,
    courseId: params.courseId,
    conceptTag,
    courseTitle,
    courseDescription,
  });
  const totalScore = questions.reduce((sum, item) => sum + item.score, 0);
  const nowIso = new Date().toISOString();
  let sessionId = toStringValue((existingSession as GenericRecord | null)?.id) || null;
  const { data: resourceSession } = await supabaseAdmin
    .from("weakness_resource_sessions")
    .select("id")
    .eq("user_id", params.userId)
    .eq("course_id", params.courseId)
    .eq("concept_tag", conceptTag)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const weaknessResourceSessionId = toStringValue((resourceSession as GenericRecord | null)?.id) || null;

  try {
    if (!sessionId) {
      const initialStatus: WeaknessTestSessionStatus = "open";
      const sessionInsertPayload = {
        user_id: params.userId,
        course_id: params.courseId,
        concept_tag: conceptTag,
        weakness_resource_session_id: weaknessResourceSessionId,
        status: initialStatus,
        score: 0,
        created_at: nowIso,
      };
      console.info("[weakness] test_session_insert:payload", sessionInsertPayload);
      console.info("[weakness][test_session_insert]", {
        payload: sessionInsertPayload,
      });
      console.info("[weakness] test_session_insert:start", {
        user_id: params.userId,
        course_id: params.courseId,
        concept_tag: conceptTag,
        weakness_resource_session_id: weaknessResourceSessionId,
        status: sessionInsertPayload.status,
        score: sessionInsertPayload.score,
        payload_keys: Object.keys(sessionInsertPayload),
      });
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from("weakness_test_sessions")
        .insert(sessionInsertPayload)
        .select("id")
        .limit(1)
        .maybeSingle();
      if (insertError) {
        const insertMessage = toStringValue(insertError.message).toLowerCase();
        const insertHint = toStringValue(insertError.hint).toLowerCase();
        const isStatusConstraintError =
          insertError.code === "23514" &&
          (insertMessage.includes("weakness_test_sessions_status_check") ||
            insertHint.includes("weakness_test_sessions_status_check"));
        if (isStatusConstraintError) {
          const strictOpenPayload = {
            user_id: params.userId,
            course_id: params.courseId,
            concept_tag: conceptTag,
            weakness_resource_session_id: weaknessResourceSessionId,
            status: "open" as const,
            score: 0,
            created_at: nowIso,
          };
          console.warn("[weakness] test_session_insert:status_retry", {
            user_id: params.userId,
            course_id: params.courseId,
            concept_tag: conceptTag,
            weakness_resource_session_id: weaknessResourceSessionId,
            first_attempt_status: sessionInsertPayload.status,
            retry_status: strictOpenPayload.status,
          });
          const { data: retryInserted, error: retryInsertError } = await supabaseAdmin
            .from("weakness_test_sessions")
            .insert(strictOpenPayload)
            .select("id")
            .limit(1)
            .maybeSingle();
          if (!retryInsertError) {
            sessionId = toStringValue((retryInserted as GenericRecord | null)?.id) || null;
            console.info("[weakness] test_session_insert:success", {
              user_id: params.userId,
              course_id: params.courseId,
              concept_tag: conceptTag,
              weakness_resource_session_id: weaknessResourceSessionId,
              status: strictOpenPayload.status,
              score: strictOpenPayload.score,
              test_session_id: sessionId,
              retried_after_status_check: true,
            });
          } else {
            console.error("[weakness] test_session_insert:failed", {
              user_id: params.userId,
              course_id: params.courseId,
              concept_tag: conceptTag,
              weakness_resource_session_id: weaknessResourceSessionId,
              status: strictOpenPayload.status,
              score: strictOpenPayload.score,
              db_error_message: retryInsertError.message,
              db_error_code: retryInsertError.code ?? null,
              db_error_details: retryInsertError.details ?? null,
              db_error_hint: retryInsertError.hint ?? null,
            });
            throw retryInsertError;
          }
        }
      }
      if (insertError && !sessionId) {
        console.error("[weakness] test_session_insert:failed", {
          user_id: params.userId,
          course_id: params.courseId,
          concept_tag: conceptTag,
          weakness_resource_session_id: weaknessResourceSessionId,
          status: sessionInsertPayload.status,
          score: sessionInsertPayload.score,
          db_error_message: insertError.message,
          db_error_code: insertError.code ?? null,
          db_error_details: insertError.details ?? null,
          db_error_hint: insertError.hint ?? null,
        });
        throw insertError;
      }
      if (!sessionId) {
        sessionId = toStringValue((inserted as GenericRecord | null)?.id) || null;
        console.info("[weakness] test_session_insert:success", {
          user_id: params.userId,
          course_id: params.courseId,
          concept_tag: conceptTag,
          weakness_resource_session_id: weaknessResourceSessionId,
          status: sessionInsertPayload.status,
          score: sessionInsertPayload.score,
          test_session_id: sessionId,
        });
      }
    } else {
      const sessionUpdatePayload: Partial<{
        status: WeaknessTestSessionStatus;
        score: number;
        completed_at: string | null;
      }> = {
        status: "open" satisfies WeaknessTestSessionStatus,
        score: 0,
        completed_at: null,
      };
      await updateWeaknessTestSessionRecord({
        sessionId,
        userId: params.userId,
        courseId: params.courseId,
        conceptTag,
        weaknessResourceSessionId,
        payload: sessionUpdatePayload,
      });
    }

    if (sessionId) {
      await supabaseAdmin.from("weakness_test_questions").delete().eq("test_session_id", sessionId);
      await supabaseAdmin.from("weakness_test_questions").insert(
        questions.map((item) => ({
          id: item.id,
          test_session_id: sessionId,
          question_order: item.question_order,
          question_type: item.question_type,
          question_text: item.question_text,
          options_json: item.options,
          correct_answer_text: item.correct_answer_text,
          acceptable_answers_json: item.acceptable_answers,
          explanation: item.explanation,
          score: item.score,
          created_at: nowIso,
          updated_at: nowIso,
        })),
      );
    }
  } catch (error) {
    if (sessionId) {
      try {
        await updateWeaknessTestSessionRecord({
          sessionId,
          userId: params.userId,
          courseId: params.courseId,
          conceptTag,
          weaknessResourceSessionId,
          payload: {
            status: "failed",
          },
        });
      } catch (statusUpdateError) {
        console.error("[weakness] test_session_update:failed", {
          user_id: params.userId,
          course_id: params.courseId,
          concept_tag: conceptTag,
          weakness_resource_session_id: weaknessResourceSessionId,
          status: "failed",
          db_error_message: err(statusUpdateError),
        });
      }
    }
    console.error("[weakness] concept_test:failed", {
      user_id: params.userId,
      course_id: params.courseId,
      concept_tag: conceptTag,
      reason: err(error),
    });
    throw new Error("Unable to create concept practice test right now.");
  }

  if (!sessionId) {
    throw new Error("Unable to create concept practice test session.");
  }

  return {
    test_session_id: sessionId,
    course_id: params.courseId,
    concept_tag: conceptTag,
    concept_title: conceptLabel,
    total_score: totalScore,
    cached: false,
    questions: questions.map((item) => ({
      id: item.id,
      question_order: item.question_order,
      question_type: item.question_type,
      question_text: item.question_text,
      options: item.options,
      score: item.score,
    })),
  };
}

function normalizedAnswer(value: string) {
  return norm(value).toLowerCase();
}

function scoreTextAnswer(params: {
  userAnswer: string;
  correctAnswer: string;
  acceptableAnswers: string[];
  maxScore: number;
}) {
  const answer = normalizedAnswer(params.userAnswer);
  const correct = normalizedAnswer(params.correctAnswer);
  const acceptable = params.acceptableAnswers.map((item) => normalizedAnswer(item)).filter(Boolean);
  if (answer && (answer === correct || acceptable.includes(answer))) {
    return { result_status: "correct" as const, earned_score: params.maxScore };
  }
  const keywords = Array.from(
    new Set(
      [correct, ...acceptable]
        .join(" ")
        .split(/[^a-z0-9_]+/)
        .map((item) => item.trim())
        .filter((item) => item.length >= 3),
    ),
  );
  if (!answer || keywords.length === 0) {
    return { result_status: "incorrect" as const, earned_score: 0 };
  }
  const matched = keywords.filter((keyword) => answer.includes(keyword)).length;
  const ratio = matched / keywords.length;
  if (ratio >= 0.6) {
    return { result_status: "correct" as const, earned_score: params.maxScore };
  }
  if (ratio >= 0.25) {
    return { result_status: "partial" as const, earned_score: Math.max(1, Math.floor(params.maxScore * 0.5)) };
  }
  return { result_status: "incorrect" as const, earned_score: 0 };
}

export async function submitWeaknessConceptTest(params: {
  userId: string;
  courseId: string;
  conceptTag: string;
  testSessionId: string;
  answers: Array<{
    question_id: string;
    selected_option_index?: number;
    answer_text?: string;
  }>;
}): Promise<WeaknessTestSubmitResult> {
  const conceptTag = conceptKey(params.conceptTag) || "foundational_skills";
  const { data: sessionRow, error: sessionError } = await supabaseAdmin
    .from("weakness_test_sessions")
    .select("*")
    .eq("id", params.testSessionId)
    .eq("user_id", params.userId)
    .eq("course_id", params.courseId)
    .eq("concept_tag", conceptTag)
    .limit(1)
    .maybeSingle();
  if (sessionError) {
    throw new Error("Failed to load concept test session.");
  }
  if (!sessionRow) {
    throw new Error("Concept test session not found.");
  }

  const { data: questionRows, error: questionError } = await supabaseAdmin
    .from("weakness_test_questions")
    .select("*")
    .eq("test_session_id", params.testSessionId)
    .order("question_order", { ascending: true });
  if (questionError) {
    throw new Error("Failed to load concept test questions.");
  }
  const questions = normalizePersistedQuestions((questionRows ?? []) as GenericRecord[]);
  if (questions.length === 0) {
    throw new Error("No concept test questions found.");
  }

  const answerMap = new Map<string, { selected_option_index?: number; answer_text?: string }>();
  params.answers.forEach((answer) => {
    const qid = norm(answer.question_id);
    if (!qid) {
      return;
    }
    answerMap.set(qid, {
      selected_option_index: typeof answer.selected_option_index === "number" ? answer.selected_option_index : undefined,
      answer_text: typeof answer.answer_text === "string" ? answer.answer_text : undefined,
    });
  });

  const results = questions.map((question) => {
    const answerInput = answerMap.get(question.id);
    let userAnswer = norm(answerInput?.answer_text ?? "");
    if (
      question.question_type === "multiple_choice" &&
      typeof answerInput?.selected_option_index === "number" &&
      answerInput.selected_option_index >= 0 &&
      answerInput.selected_option_index < question.options.length
    ) {
      userAnswer = question.options[answerInput.selected_option_index] ?? userAnswer;
    }
    const maxScore = Math.max(1, question.score);

    if (question.question_type === "multiple_choice") {
      const correct = normalizedAnswer(userAnswer) === normalizedAnswer(question.correct_answer_text);
      return {
        question_id: question.id,
        question_order: question.question_order,
        question_type: question.question_type,
        question_text: question.question_text,
        user_answer: userAnswer,
        correct_answer: question.correct_answer_text,
        earned_score: correct ? maxScore : 0,
        max_score: maxScore,
        result_status: (correct ? "correct" : "incorrect") as "correct" | "partial" | "incorrect",
        explanation: question.explanation,
      };
    }

    const scored = scoreTextAnswer({
      userAnswer,
      correctAnswer: question.correct_answer_text,
      acceptableAnswers: question.acceptable_answers,
      maxScore,
    });
    return {
      question_id: question.id,
      question_order: question.question_order,
      question_type: question.question_type,
      question_text: question.question_text,
      user_answer: userAnswer,
      correct_answer: question.correct_answer_text,
      earned_score: scored.earned_score,
      max_score: maxScore,
      result_status: scored.result_status,
      explanation: question.explanation,
    };
  });

  const totalScore = results.reduce((sum, item) => sum + item.max_score, 0);
  const earnedScore = results.reduce((sum, item) => sum + item.earned_score, 0);
  const percentage = totalScore > 0 ? Number(((earnedScore / totalScore) * 100).toFixed(1)) : 0;
  const passStatus: "passed" | "failed" =
    percentage >= WEAKNESS_PASS_THRESHOLD_PERCENT ? "passed" : "failed";
  const nowIso = new Date().toISOString();

  try {
    for (const row of results) {
      await supabaseAdmin
        .from("weakness_test_questions")
        .update({
          user_answer_text: row.user_answer,
          earned_score: row.earned_score,
          result_status: row.result_status,
          updated_at: nowIso,
        })
        .eq("id", row.question_id)
        .eq("test_session_id", params.testSessionId);
    }
  } catch (error) {
    try {
      await updateWeaknessTestSessionRecord({
        sessionId: params.testSessionId,
        userId: params.userId,
        courseId: params.courseId,
        conceptTag,
        weaknessResourceSessionId: toStringValue((sessionRow as GenericRecord).weakness_resource_session_id) || null,
        payload: {
          status: "failed",
        },
      });
    } catch {
      // no-op: failure path already logged by update helper
    }
    console.warn("[weakness] concept_test:answer_persist_failed", {
      user_id: params.userId,
      course_id: params.courseId,
      concept_tag: conceptTag,
      reason: err(error),
    });
    throw new Error("Failed to save concept test answers.");
  }

  try {
    await updateWeaknessTestSessionRecord({
      sessionId: params.testSessionId,
      userId: params.userId,
      courseId: params.courseId,
      conceptTag,
      weaknessResourceSessionId: toStringValue((sessionRow as GenericRecord).weakness_resource_session_id) || null,
      payload: {
        status: "completed",
        score: earnedScore,
        completed_at: nowIso,
      },
    });
  } catch {
    throw new Error("Failed to save concept test result.");
  }

  return {
    test_session_id: params.testSessionId,
    total_score: totalScore,
    earned_score: earnedScore,
    percentage,
    pass_status: passStatus,
    question_results: results,
  };
}

export async function skipWeaknessConceptTest(params: {
  userId: string;
  courseId: string;
  conceptTag: string;
  testSessionId: string;
}) {
  const conceptTag = conceptKey(params.conceptTag) || "foundational_skills";
  const { data: sessionRow, error: sessionError } = await supabaseAdmin
    .from("weakness_test_sessions")
    .select("id, weakness_resource_session_id")
    .eq("id", params.testSessionId)
    .eq("user_id", params.userId)
    .eq("course_id", params.courseId)
    .eq("concept_tag", conceptTag)
    .limit(1)
    .maybeSingle();
  if (sessionError) {
    throw new Error("Failed to load concept test session.");
  }
  if (!sessionRow) {
    throw new Error("Concept test session not found.");
  }
  await updateWeaknessTestSessionRecord({
    sessionId: params.testSessionId,
    userId: params.userId,
    courseId: params.courseId,
    conceptTag,
    weaknessResourceSessionId: toStringValue((sessionRow as GenericRecord).weakness_resource_session_id) || null,
    payload: {
      status: "skipped",
      completed_at: new Date().toISOString(),
    },
  });
  return {
    test_session_id: params.testSessionId,
    status: "skipped" as const,
  };
}
