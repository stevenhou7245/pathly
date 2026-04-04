import { randomUUID } from "crypto";
import { z } from "zod";
import { isMissingRelationOrColumnError, toNumberValue, toStringValue } from "@/lib/ai/common";
import { generateStructuredJson } from "@/lib/ai/provider";
import { formatConceptLabel, normalizeConceptTag } from "@/lib/conceptTags";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getTavilyClient } from "@/lib/tavilyClient";

type GenericRecord = Record<string, unknown>;

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
  question_type: "multiple_choice" | "fill_blank" | "short_answer";
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

const summarySchema = z
  .object({
    concept_title: z.string().min(1),
    concept_explanation: z.string().min(1),
  })
  .strict();

const generatedQuestionSchema = z
  .object({
    question_id: z.string().optional(),
    question_type: z.enum(["multiple_choice", "fill_blank", "short_answer"]).optional(),
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
    questions: z.array(generatedQuestionSchema).min(3).max(5),
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

function conceptTitle(input: string) {
  return formatConceptLabel(input);
}

function normalizeQuestionType(value: unknown) {
  const type = norm(toStringValue(value)).toLowerCase();
  if (type === "fill_blank" || type === "fill-blank") {
    return "fill_blank" as const;
  }
  if (type === "short_answer" || type === "short-answer") {
    return "short_answer" as const;
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

function fallbackTestQuestions(params: { conceptTag: string; courseTitle: string }) {
  const concept = conceptTitle(params.conceptTag);
  return [
    {
      question_type: "multiple_choice" as const,
      question_text: `Which choice best applies ${concept} in ${params.courseTitle}?`,
      options: [
        "Use the concept to solve the concrete task with clear steps.",
        "Memorize a definition and ignore implementation details.",
        "Skip validation and debugging entirely.",
        "Use unrelated syntax from another topic.",
      ],
      correct_answer: "Use the concept to solve the concrete task with clear steps.",
      acceptable_answers: [] as string[],
      explanation: "Practical application with clear logic is the correct approach.",
    },
    {
      question_type: "fill_blank" as const,
      question_text: `Fill in one key token used when implementing ${concept} safely in practice.`,
      options: [] as string[],
      correct_answer: "condition",
      acceptable_answers: ["condition", "check"],
      explanation: "A clear condition/check is often essential for correctness.",
    },
    {
      question_type: "multiple_choice" as const,
      question_text: `A bug appears in ${concept}. What should you do first?`,
      options: [
        "Reproduce the bug with a minimal case and inspect state changes.",
        "Ignore the bug and add random prints only.",
        "Delete tests and continue development.",
        "Change unrelated modules.",
      ],
      correct_answer: "Reproduce the bug with a minimal case and inspect state changes.",
      acceptable_answers: [] as string[],
      explanation: "Reproduce + inspect is the best first step for debugging.",
    },
    {
      question_type: "fill_blank" as const,
      question_text: `Fill in: To verify ${concept}, prepare a failing case and an expected ____.`,
      options: [] as string[],
      correct_answer: "output",
      acceptable_answers: ["output", "result"],
      explanation: "Expected output/result is needed for reliable verification.",
    },
    {
      question_type: "short_answer" as const,
      question_text: `Short answer: Explain concrete steps to fix a realistic ${concept} issue in ${params.courseTitle}.`,
      options: [] as string[],
      correct_answer: "Identify failing case, inspect logic, implement fix, and verify with tests.",
      acceptable_answers: ["failing", "logic", "fix", "test"],
      explanation: "Strong answers include diagnosis, fix strategy, and verification.",
    },
  ];
}

function normalizeGeneratedQuestions(params: {
  generated: z.infer<typeof generatedQuestionSchema>[];
  conceptTag: string;
  courseTitle: string;
}) {
  const fallback = fallbackTestQuestions({
    conceptTag: params.conceptTag,
    courseTitle: params.courseTitle,
  });
  const source = params.generated.length > 0 ? params.generated : fallback;
  const objective: PersistedWeaknessQuestion[] = [];
  const shortAnswers: PersistedWeaknessQuestion[] = [];

  source.forEach((item, index) => {
    const record = item as GenericRecord;
    const type = normalizeQuestionType(record.question_type);
    const options = type === "multiple_choice"
      ? (Array.isArray(record.options) ? record.options : [])
          .map((option) => norm(toStringValue(option)))
          .filter(Boolean)
          .slice(0, 4)
      : [];
    while (type === "multiple_choice" && options.length < 4) {
      options.push(`Option ${options.length + 1}`);
    }
    const row: PersistedWeaknessQuestion = {
      id: norm(toStringValue(record.question_id)) || randomUUID(),
      question_order: index + 1,
      question_type: type,
      question_text: norm(toStringValue(record.question_text)) || `Question ${index + 1}`,
      options,
      correct_answer_text: norm(toStringValue(record.correct_answer)) || "See explanation.",
      acceptable_answers: (Array.isArray(record.acceptable_answers) ? record.acceptable_answers : [])
        .map((answer) => norm(toStringValue(answer)))
        .filter(Boolean),
      explanation: norm(toStringValue(record.explanation)) || "Review the concept and retry.",
      score: 20,
    };
    if (type === "short_answer") {
      shortAnswers.push(row);
    } else {
      objective.push(row);
    }
  });

  const picked = [...objective.slice(0, 4), ...(shortAnswers.length > 0 ? shortAnswers.slice(0, 1) : [])];
  while (picked.length < 5) {
    const fb = fallback[picked.length] ?? fallback[fallback.length - 1];
    picked.push({
      id: randomUUID(),
      question_order: picked.length + 1,
      question_type: fb.question_type,
      question_text: fb.question_text,
      options: fb.options,
      correct_answer_text: fb.correct_answer,
      acceptable_answers: fb.acceptable_answers,
      explanation: fb.explanation,
      score: 20,
    });
  }

  return picked.slice(0, 5).map((row, index) => ({
    ...row,
    question_order: index + 1,
    score: 20,
    acceptable_answers:
      row.question_type === "multiple_choice"
        ? []
        : row.acceptable_answers.length > 0
          ? row.acceptable_answers
          : [row.correct_answer_text],
  }));
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
      score: Math.max(1, Math.floor(toNumberValue(row.score) || 20)),
    }))
    .filter((row) => Boolean(row.id && row.question_text))
    .sort((a, b) => a.question_order - b.question_order);
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
    .order("updated_at", { ascending: false })
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
    if (norm(toStringValue((existingSession as GenericRecord).status)).toLowerCase() === "ready" && rows.length > 0) {
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

  const { output } = await generateStructuredJson({
    feature: "weakness_concept_test",
    promptVersion: "weakness_concept_test_v1",
    systemInstruction: [
      "Generate a focused concept drill test.",
      "Return JSON only with key questions.",
      "Generate exactly 5 questions: 4 objective (multiple_choice or fill_blank) and 1 short_answer.",
      "Each question must include: question_id, question_type, question_text, options, correct_answer, acceptable_answers, explanation, score.",
      "Questions must be practical and concept-specific.",
    ].join(" "),
    input: {
      user_id: params.userId,
      course_id: params.courseId,
      course_title: courseTitle,
      course_description: courseDescription,
      concept_tag: conceptTag,
    },
    outputSchema: generatedTestSchema,
    fallback: () => ({
      questions: fallbackTestQuestions({ conceptTag, courseTitle }).map((item, index) => ({
        question_id: `${conceptTag}-${index + 1}`,
        question_type: item.question_type,
        question_text: item.question_text,
        options: item.options,
        correct_answer: item.correct_answer,
        acceptable_answers: item.acceptable_answers,
        explanation: item.explanation,
        score: 20,
      })),
    }),
    temperature: 0.2,
    maxOutputTokens: 1400,
  });

  const questions = normalizeGeneratedQuestions({
    generated: output.questions,
    conceptTag,
    courseTitle,
  });
  const totalScore = questions.reduce((sum, item) => sum + item.score, 0);
  const nowIso = new Date().toISOString();
  let sessionId = toStringValue((existingSession as GenericRecord | null)?.id) || null;

  try {
    if (!sessionId) {
      const { data: inserted, error: insertError } = await supabaseAdmin
        .from("weakness_test_sessions")
        .insert({
          user_id: params.userId,
          course_id: params.courseId,
          concept_tag: conceptTag,
          status: "ready",
          question_count: questions.length,
          total_score: totalScore,
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
        .from("weakness_test_sessions")
        .update({
          status: "ready",
          question_count: questions.length,
          total_score: totalScore,
          updated_at: nowIso,
        })
        .eq("id", sessionId);
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
  const passStatus: "passed" | "failed" = percentage >= 60 ? "passed" : "failed";
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
    console.warn("[weakness] concept_test:answer_persist_failed", {
      user_id: params.userId,
      course_id: params.courseId,
      concept_tag: conceptTag,
      reason: err(error),
    });
  }

  const { error: updateSessionError } = await supabaseAdmin
    .from("weakness_test_sessions")
    .update({
      status: "graded",
      earned_score: earnedScore,
      total_score: totalScore,
      submitted_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", params.testSessionId);
  if (updateSessionError && !isMissingRelationOrColumnError(updateSessionError)) {
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
