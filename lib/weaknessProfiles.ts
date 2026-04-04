import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  extractConceptTags,
  formatConceptLabel,
  normalizeConceptTag as normalizeStoredConceptTag,
} from "@/lib/conceptTags";

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

export function normalizeConceptTag(value: unknown) {
  return normalizeStoredConceptTag(value);
}

function fallbackConceptTag(params: {
  questionText?: string | null;
  explanation?: string | null;
  questionIndex?: number | null;
}) {
  const extracted = extractConceptTags({
    texts: [params.questionText ?? "", params.explanation ?? ""],
    maxTags: 1,
  });
  if (extracted.length > 0) {
    return extracted[0];
  }
  return "foundational_skills";
}

function deriveConceptTags(params: {
  conceptTags?: string[] | null;
  questionText?: string | null;
  explanation?: string | null;
  questionIndex?: number | null;
}) {
  const explicit = Array.isArray(params.conceptTags)
    ? params.conceptTags
        .map((tag) => normalizeConceptTag(tag))
        .filter(Boolean)
    : [];
  const extractedFromText = extractConceptTags({
    texts: [params.questionText ?? "", params.explanation ?? ""],
    maxTags: 3,
  });

  const combined = Array.from(new Set([...explicit, ...extractedFromText]));
  if (combined.length > 0) {
    return combined;
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
  const displayLabel = formatConceptLabel(normalizedConceptTag);
  console.info("[concept] normalized_tag", {
    source: params.source,
    input: params.conceptTag,
    normalized_tag: normalizedConceptTag,
  });
  console.info("[concept] display_label", {
    source: params.source,
    concept_tag: normalizedConceptTag,
    display_label: displayLabel,
  });

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
    console.info("[concept] extracted_tags", {
      source: params.source,
      user_id: params.userId,
      course_id: params.courseId,
      question_index: evaluation.questionIndex ?? null,
      extracted_tags: conceptTags,
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
