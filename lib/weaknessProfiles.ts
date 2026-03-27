import { supabaseAdmin } from "@/lib/supabaseAdmin";

type WeaknessEvaluationInput = {
  isCorrect: boolean;
  questionIndex?: number | null;
  conceptTags?: string[] | null;
  questionText?: string | null;
  explanation?: string | null;
};

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
    const { error: insertError } = await supabaseAdmin
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
    if (insertError) {
      throw insertError;
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

  const { error: updateError } = await supabaseAdmin
    .from("weakness_profiles")
    .update({
      mistake_count: nextMistakeCount,
      weakness_score: nextWeaknessScore,
      last_mistake_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", toStringValue(existingRow.id));
  if (updateError) {
    throw updateError;
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
