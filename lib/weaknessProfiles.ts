import { supabaseAdmin } from "@/lib/supabaseAdmin";

type WeaknessEvaluationInput = {
  isCorrect: boolean;
  questionIndex?: number | null;
  conceptTags?: string[] | null;
  questionText?: string | null;
  explanation?: string | null;
};

type GenericRecord = Record<string, unknown>;

function getErrorCode(value: unknown) {
  return toStringValue((value as GenericRecord)?.code).trim();
}

function isMissingResolvedColumnError(error: unknown) {
  return getErrorCode(error) === "42703";
}

function toStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeConceptTag(value: unknown) {
  const raw = toStringValue(value).toLowerCase();
  const cleaned = normalizeWhitespace(
    raw
      .replace(/[`~!@#$%^&*()+=\[\]{}\\|;:'",.<>/?]/g, " ")
      .replace(/\s+/g, " "),
  );
  if (!cleaned) {
    return "";
  }
  const limited = cleaned.slice(0, 120);
  const words = limited.split(" ").filter(Boolean).slice(0, 8);
  return words.join(" ").slice(0, 80);
}

export function formatConceptLabel(value: string | null | undefined) {
  const raw = toStringValue(value).trim();
  if (!raw) {
    return "None";
  }
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function parseWeaknessConceptRows(rows: GenericRecord[]) {
  return rows
    .map((row) => toStringValue(row.concept_tag).trim())
    .filter(Boolean);
}

export async function getTopWeaknessConceptTagsForCourse(params: {
  userId: string;
  courseId: string;
  limit?: number;
}) {
  const limit = Math.max(1, Math.min(10, Math.floor(Number(params.limit ?? 3) || 3)));

  console.info("[course] weakness_lookup:start", {
    user_id: params.userId,
    course_id: params.courseId,
  });

  try {
    const queryByMistakeCount = (onlyUnresolved: boolean) =>
      supabaseAdmin
        .from("weakness_profiles")
        .select("concept_tag, mistake_count, updated_at")
        .eq("user_id", params.userId)
        .eq("course_id", params.courseId)
        .order("mistake_count", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(limit)
        .match(onlyUnresolved ? { resolved: false } : {});

    let byMistakeCount = await queryByMistakeCount(true);
    if (byMistakeCount.error && isMissingResolvedColumnError(byMistakeCount.error)) {
      byMistakeCount = await queryByMistakeCount(false);
    }

    if (!byMistakeCount.error) {
      const concepts = parseWeaknessConceptRows((byMistakeCount.data ?? []) as GenericRecord[]);
      console.info("[course] weakness_lookup:result", {
        user_id: params.userId,
        course_id: params.courseId,
        weakness_row_count: concepts.length,
      });
      return concepts;
    }

    const queryByWeaknessScore = (onlyUnresolved: boolean) =>
      supabaseAdmin
        .from("weakness_profiles")
        .select("concept_tag, weakness_score, updated_at")
        .eq("user_id", params.userId)
        .eq("course_id", params.courseId)
        .order("weakness_score", { ascending: false })
        .order("updated_at", { ascending: false })
        .limit(limit)
        .match(onlyUnresolved ? { resolved: false } : {});

    let byWeaknessScore = await queryByWeaknessScore(true);
    if (byWeaknessScore.error && isMissingResolvedColumnError(byWeaknessScore.error)) {
      byWeaknessScore = await queryByWeaknessScore(false);
    }

    if (byWeaknessScore.error) {
      throw byWeaknessScore.error;
    }

    const concepts = parseWeaknessConceptRows((byWeaknessScore.data ?? []) as GenericRecord[]);
    console.info("[course] weakness_lookup:result", {
      user_id: params.userId,
      course_id: params.courseId,
      weakness_row_count: concepts.length,
    });
    return concepts;
  } catch (error) {
    console.error("[course] weakness_lookup:failed", {
      user_id: params.userId,
      course_id: params.courseId,
      weakness_row_count: 0,
      reason: error instanceof Error ? error.message : String(error),
    });
    return [] as string[];
  }
}

export async function resolveWeaknessConcept(params: {
  userId: string;
  courseId: string;
  conceptTag: string;
}) {
  const normalizedConceptTag = normalizeConceptTag(params.conceptTag);
  if (!normalizedConceptTag) {
    return {
      success: false,
      updatedCount: 0,
      message: "Invalid concept_tag.",
    };
  }

  const nowIso = new Date().toISOString();
  const updateWithResolved = await supabaseAdmin
    .from("weakness_profiles")
    .update({
      resolved: true,
      updated_at: nowIso,
    })
    .eq("user_id", params.userId)
    .eq("course_id", params.courseId)
    .eq("concept_tag", normalizedConceptTag)
    .select("id");

  if (updateWithResolved.error && isMissingResolvedColumnError(updateWithResolved.error)) {
    return {
      success: false,
      updatedCount: 0,
      message: "weakness_profiles.resolved column is missing.",
    };
  }

  if (updateWithResolved.error) {
    throw updateWithResolved.error;
  }

  return {
    success: true,
    updatedCount: (updateWithResolved.data ?? []).length,
    message: "Weakness resolved.",
  };
}

function fallbackConceptTag(params: {
  questionText?: string | null;
  explanation?: string | null;
  questionIndex?: number | null;
}) {
  const questionSource = normalizeConceptTag(params.questionText ?? "");
  if (questionSource) {
    return questionSource;
  }
  const explanationSource = normalizeConceptTag(params.explanation ?? "");
  if (explanationSource) {
    return explanationSource;
  }
  const fallbackIndex = Math.max(1, Math.floor(Number(params.questionIndex ?? 0) || 1));
  return `question ${fallbackIndex}`;
}

function deriveConceptTags(params: {
  conceptTags?: string[] | null;
  questionText?: string | null;
  explanation?: string | null;
  questionIndex?: number | null;
}) {
  const explicit = Array.isArray(params.conceptTags)
    ? params.conceptTags.map((tag) => normalizeConceptTag(tag)).filter(Boolean)
    : [];
  if (explicit.length > 0) {
    return [...new Set(explicit)];
  }
  return [fallbackConceptTag(params)];
}

export async function incrementWeaknessProfile(params: {
  userId: string;
  courseId: string;
  conceptTag: string;
  incrementBy?: number;
  questionIndex?: number | null;
  source: string;
}) {
  const normalizedConceptTag = normalizeConceptTag(params.conceptTag);
  if (!normalizedConceptTag) {
    return;
  }

  const incrementBy = Math.max(1, Math.floor(Number(params.incrementBy ?? 1) || 1));
  const nowIso = new Date().toISOString();

  const { data: existingRow, error: existingError } = await supabaseAdmin
    .from("weakness_profiles")
    .select("id, mistake_count, weakness_score")
    .eq("user_id", params.userId)
    .eq("course_id", params.courseId)
    .eq("concept_tag", normalizedConceptTag)
    .limit(1)
    .maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (!existingRow) {
    let insertResult = await supabaseAdmin
      .from("weakness_profiles")
      .insert({
        user_id: params.userId,
        course_id: params.courseId,
        concept_tag: normalizedConceptTag,
        mistake_count: incrementBy,
        weakness_score: incrementBy,
        resolved: false,
        last_mistake_at: nowIso,
        updated_at: nowIso,
      });
    if (insertResult.error && isMissingResolvedColumnError(insertResult.error)) {
      insertResult = await supabaseAdmin
        .from("weakness_profiles")
        .insert({
          user_id: params.userId,
          course_id: params.courseId,
          concept_tag: normalizedConceptTag,
          mistake_count: incrementBy,
          weakness_score: incrementBy,
          last_mistake_at: nowIso,
          updated_at: nowIso,
        });
    }
    if (insertResult.error) {
      throw insertResult.error;
    }
    console.info("[weakness_profiles] insert_new", {
      source: params.source,
      user_id: params.userId,
      course_id: params.courseId,
      concept_tag: normalizedConceptTag,
      question_index: params.questionIndex ?? null,
      increment_by: incrementBy,
    });
    return;
  }

  const currentMistakeCount = Math.max(0, Math.floor(Number(existingRow.mistake_count) || 0));
  const currentWeaknessScore = Math.max(0, Math.floor(Number(existingRow.weakness_score) || 0));
  const nextMistakeCount = currentMistakeCount + incrementBy;
  const nextWeaknessScore = currentWeaknessScore + incrementBy;

  let updateResult = await supabaseAdmin
    .from("weakness_profiles")
    .update({
      mistake_count: nextMistakeCount,
      weakness_score: nextWeaknessScore,
      resolved: false,
      last_mistake_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", toStringValue(existingRow.id));
  if (updateResult.error && isMissingResolvedColumnError(updateResult.error)) {
    updateResult = await supabaseAdmin
      .from("weakness_profiles")
      .update({
        mistake_count: nextMistakeCount,
        weakness_score: nextWeaknessScore,
        last_mistake_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", toStringValue(existingRow.id));
  }
  if (updateResult.error) {
    throw updateResult.error;
  }

  console.info("[weakness_profiles] update_existing", {
    source: params.source,
    user_id: params.userId,
    course_id: params.courseId,
    concept_tag: normalizedConceptTag,
    question_index: params.questionIndex ?? null,
    increment_by: incrementBy,
    next_mistake_count: nextMistakeCount,
    next_weakness_score: nextWeaknessScore,
  });
}

export async function trackWeaknessProfilesForIncorrectAnswers(params: {
  userId: string;
  courseId: string;
  source: string;
  evaluations: WeaknessEvaluationInput[];
}) {
  for (const evaluation of params.evaluations) {
    if (evaluation.isCorrect) {
      continue;
    }

    const conceptTags = deriveConceptTags({
      conceptTags: evaluation.conceptTags ?? [],
      questionText: evaluation.questionText ?? "",
      explanation: evaluation.explanation ?? "",
      questionIndex: evaluation.questionIndex ?? null,
    });

    for (const conceptTag of conceptTags) {
      console.info("[weakness_profiles] derive_concept_tag", {
        source: params.source,
        user_id: params.userId,
        course_id: params.courseId,
        question_index: evaluation.questionIndex ?? null,
        concept_tag: conceptTag,
      });

      try {
        await incrementWeaknessProfile({
          userId: params.userId,
          courseId: params.courseId,
          conceptTag,
          questionIndex: evaluation.questionIndex ?? null,
          source: params.source,
          incrementBy: 1,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[weakness_profiles] failed", {
          source: params.source,
          user_id: params.userId,
          course_id: params.courseId,
          question_index: evaluation.questionIndex ?? null,
          concept_tag: conceptTag,
          reason: message,
        });
      }
    }
  }
}
