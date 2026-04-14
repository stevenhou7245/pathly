import { z } from "zod";
import {
  isMissingRelationOrColumnError,
  sha256Hash,
  toNumberValue,
  toStableJson,
  toStringValue,
} from "@/lib/ai/common";
import { generateStructuredJson, type AiProvenance } from "@/lib/ai/provider";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  incrementWeaknessProfile,
  normalizeConceptTag,
} from "@/lib/weaknessProfiles";

type GenericRecord = Record<string, unknown>;

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

type WeaknessSignal = {
  concept_tag: string;
  skill_tag: string;
  incorrect_count: number;
  partial_count: number;
  total_observations: number;
  weakness_score: number;
};

export type TestQuestionForWeakness = {
  question_id: string;
  result_status: "correct" | "partial" | "incorrect";
  concept_tags?: string[] | null;
  skill_tags?: string[] | null;
};

const reviewQuestionSchema = z.object({
  question_type: z.enum(["single_choice", "fill_blank", "short_answer"]),
  question_text: z.string().min(1),
  options: z.array(z.string()).default([]),
  correct_answer: z.string().min(1),
  explanation: z.string().min(1),
});

export type ReviewSessionQuestion = {
  id: string;
  question_order: number;
  question_type: "single_choice" | "fill_blank" | "short_answer";
  question_text: string;
  options: string[];
  concept_tag: string;
  skill_tag: string | null;
  max_score: number;
};

export type PendingReviewPopup = {
  should_show: boolean;
  review_session_id: string | null;
  course_id: string | null;
  score_at_trigger: number | null;
  questions: ReviewSessionQuestion[];
};

function computeWeaknessSignals(
  questionResults: TestQuestionForWeakness[],
  score: number,
): WeaknessSignal[] {
  if (score >= 100) {
    return [];
  }

  const byConcept = new Map<string, WeaknessSignal>();
  questionResults.forEach((result) => {
    if (result.result_status === "correct") {
      return;
    }
    const conceptTags =
      Array.isArray(result.concept_tags) && result.concept_tags.length > 0
        ? result.concept_tags.map((tag) => toStringValue(tag).trim()).filter(Boolean)
        : ["general-foundation"];
    const skillTags =
      Array.isArray(result.skill_tags) && result.skill_tags.length > 0
        ? result.skill_tags.map((tag) => toStringValue(tag).trim()).filter(Boolean)
        : [""];

    conceptTags.forEach((conceptTag) => {
      const uniqueSkillTags = skillTags.length > 0 ? skillTags : [""];
      uniqueSkillTags.forEach((skillTag) => {
        const signalKey = `${conceptTag}::${skillTag}`;
        const current = byConcept.get(signalKey) ?? {
          concept_tag: conceptTag,
          skill_tag: skillTag,
          incorrect_count: 0,
          partial_count: 0,
          total_observations: 0,
          weakness_score: 0,
        };

        current.total_observations += 1;
        if (result.result_status === "incorrect") {
          current.incorrect_count += 1;
        } else if (result.result_status === "partial") {
          current.partial_count += 1;
        }
        current.weakness_score = Number(
          (
            (current.incorrect_count * 1 + current.partial_count * 0.5) /
            Math.max(1, current.total_observations)
          ).toFixed(4),
        );
        byConcept.set(signalKey, current);
      });
    });
  });

  return [...byConcept.values()].sort((a, b) => b.weakness_score - a.weakness_score);
}

async function upsertWeaknessProfiles(params: {
  userId: string;
  courseId: string;
  signals: WeaknessSignal[];
}) {
  for (const signal of params.signals) {
    const normalizedConceptTag = normalizeConceptTag(signal.concept_tag);
    if (!normalizedConceptTag) {
      continue;
    }

    const incrementBy = Math.max(1, signal.incorrect_count + signal.partial_count);
    await incrementWeaknessProfile({
      userId: params.userId,
      courseId: params.courseId,
      conceptTag: normalizedConceptTag,
      incrementBy,
      source: "ai_review_pipeline",
      questionIndex: null,
    });
  }
}

function buildFallbackReviewQuestion(input: {
  courseTitle: string;
  conceptTag: string;
  skillTag: string | null;
}) {
  const concept = input.conceptTag.replace(/[-_]/g, " ");
  const skill = input.skillTag ? input.skillTag.replace(/[-_]/g, " ") : "core skill";
  return {
    question_type: "single_choice" as const,
    question_text: `Which statement best reviews ${concept} for ${input.courseTitle}?`,
    options: [
      `A concise definition of ${concept} and one practical example.`,
      `An unrelated description of another topic.`,
      `A list of random keywords without explanation.`,
      `A summary that avoids mentioning ${concept}.`,
    ],
    correct_answer: `A concise definition of ${concept} and one practical example.`,
    explanation: `Focus on ${concept} using ${skill} context before the next lesson.`,
  };
}

async function resolveOrCreateReviewQuestionTemplate(params: {
  userId: string;
  courseId: string;
  courseTitle: string;
  conceptTag: string;
  skillTag: string | null;
  weaknessScore: number;
}): Promise<{
  templateId: string | null;
  questionType: "single_choice" | "fill_blank" | "short_answer";
  questionText: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  aiProvenance: AiProvenance | null;
}> {
  try {
    const { data: existingTemplate, error: existingError } = await supabaseAdmin
      .from("review_question_templates")
      .select("*")
      .eq("course_id", params.courseId)
      .eq("concept_tag", params.conceptTag)
      .order("template_version", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingError) {
      throw existingError;
    }

    if (existingTemplate) {
      return {
        templateId: toStringValue((existingTemplate as GenericRecord).id) || null,
        questionType: (toStringValue((existingTemplate as GenericRecord).question_type) ||
          "single_choice") as "single_choice" | "fill_blank" | "short_answer",
        questionText: toStringValue((existingTemplate as GenericRecord).question_text),
        options: Array.isArray((existingTemplate as GenericRecord).options_json)
          ? ((existingTemplate as GenericRecord).options_json as unknown[])
              .map((item) => toStringValue(item))
              .filter(Boolean)
          : [],
        correctAnswer: JSON.stringify((existingTemplate as GenericRecord).correct_answer_json ?? {}),
        explanation: toStringValue((existingTemplate as GenericRecord).explanation),
        aiProvenance: null,
      };
    }
  } catch (error) {
    if (!isMissingRelationOrColumnError(error)) {
      console.warn("[review] template_lookup_failed", {
        course_id: params.courseId,
        concept_tag: params.conceptTag,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const { output, provenance } = await generateStructuredJson({
    feature: "review_question_template",
    promptVersion: "review_question_template_v1",
    systemInstruction: [
      "Generate one targeted review question from a weakness signal.",
      "Question must be concise and fix the identified concept gap.",
      "Return JSON only.",
    ].join(" "),
    input: {
      course_id: params.courseId,
      course_title: params.courseTitle,
      concept_tag: params.conceptTag,
      skill_tag: params.skillTag,
      weakness_score: params.weaknessScore,
    },
    outputSchema: reviewQuestionSchema,
    fallback: () =>
      buildFallbackReviewQuestion({
        courseTitle: params.courseTitle,
        conceptTag: params.conceptTag,
        skillTag: params.skillTag,
      }),
  });

  const sourceHash = sha256Hash({
    course_id: params.courseId,
    concept_tag: params.conceptTag,
    skill_tag: params.skillTag,
    output,
  });

  let templateId: string | null = null;
  try {
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("review_question_templates")
      .insert({
        course_id: params.courseId,
        concept_tag: params.conceptTag,
        skill_tag: params.skillTag ?? null,
        question_type: output.question_type,
        question_text: output.question_text,
        options_json: output.options,
        correct_answer_json: {
          correct_answer: output.correct_answer,
        },
        explanation: output.explanation,
        difficulty_band: "remedial",
        template_version: 1,
        source_hash: sourceHash,
        reuse_scope: "course",
        generation_input_json: JSON.parse(
          toStableJson({
            course_id: params.courseId,
            concept_tag: params.conceptTag,
            skill_tag: params.skillTag ?? null,
            weakness_score: params.weaknessScore,
          }),
        ),
        generation_output_json: JSON.parse(
          toStableJson({
            question_type: output.question_type,
            question_text: output.question_text,
            options: output.options,
          }),
        ),
        ai_provider: provenance.provider,
        ai_model: provenance.model,
        ai_prompt_version: provenance.prompt_version,
        ai_generated_at: provenance.generated_at,
      })
      .select("id")
      .limit(1)
      .maybeSingle();

    if (insertError) {
      throw insertError;
    }
    templateId = toStringValue((inserted as GenericRecord | null)?.id) || null;
    console.info("[review] template_created", {
      course_id: params.courseId,
      concept_tag: params.conceptTag,
      template_id: templateId,
    });
  } catch (error) {
    if (!isMissingRelationOrColumnError(error)) {
      console.warn("[review] template_creation_failed", {
        course_id: params.courseId,
        concept_tag: params.conceptTag,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    templateId,
    questionType: output.question_type,
    questionText: output.question_text,
    options: output.options,
    correctAnswer: output.correct_answer,
    explanation: output.explanation,
    aiProvenance: provenance,
  };
}

async function createOrReplaceReviewSessionQuestions(params: {
  reviewSessionId: string;
  generatedQuestions: Array<{
    templateId: string | null;
    questionOrder: number;
    questionType: "single_choice" | "fill_blank" | "short_answer";
    questionText: string;
    options: string[];
    correctAnswer: string;
    explanation: string;
    conceptTag: string;
    skillTag: string | null;
  }>;
}) {
  await supabaseAdmin
    .from("user_review_session_questions")
    .delete()
    .eq("review_session_id", params.reviewSessionId);

  const insertRows = params.generatedQuestions.map((item) => ({
    review_session_id: params.reviewSessionId,
    review_question_template_id: item.templateId,
    question_order: item.questionOrder,
    question_type: item.questionType,
    question_text: item.questionText,
    options_json: item.options,
    correct_answer_json: {
      correct_answer: item.correctAnswer,
    },
    concept_tag: item.conceptTag,
    skill_tag: item.skillTag,
    max_score: 5,
    earned_score: 0,
    explanation: item.explanation,
  }));

  if (insertRows.length === 0) {
    return;
  }

  const { error } = await supabaseAdmin
    .from("user_review_session_questions")
    .insert(insertRows);
  if (error) {
    throw error;
  }
}

export async function analyzeWeaknessAndPrepareReview(params: {
  userId: string;
  courseId: string;
  courseTitle: string;
  journeyPathId: string;
  userTestId: string;
  score: number;
  questionResults: TestQuestionForWeakness[];
}): Promise<{
  review_required: boolean;
  review_session_id: string | null;
  weaknesses: WeaknessSignal[];
}> {
  try {
    const weaknesses = computeWeaknessSignals(params.questionResults, params.score);
    if (weaknesses.length === 0) {
      return {
        review_required: false,
        review_session_id: null,
        weaknesses: [],
      };
    }

    await upsertWeaknessProfiles({
      userId: params.userId,
      courseId: params.courseId,
      signals: weaknesses,
    });

    if (params.score >= 100) {
      return {
        review_required: false,
        review_session_id: null,
        weaknesses,
      };
    }

    const { data: sessionRow, error: sessionError } = await supabaseAdmin
      .from("user_review_sessions")
      .insert({
        user_id: params.userId,
        course_id: params.courseId,
        journey_path_id: params.journeyPathId,
        trigger_user_test_id: params.userTestId,
        trigger_type: "before_next_lesson",
        score_at_trigger: params.score,
        review_required: true,
        status: "open",
        weakness_snapshot_json: JSON.parse(toStableJson(weaknesses)),
      })
      .select("id")
      .limit(1)
      .maybeSingle();

    if (sessionError || !sessionRow) {
      throw sessionError ?? new Error("Unable to create review session.");
    }

    const reviewSessionId = toStringValue((sessionRow as GenericRecord).id);

    const targetWeaknesses = weaknesses.slice(0, 3);
    const generatedQuestions: Array<{
      templateId: string | null;
      questionOrder: number;
      questionType: "single_choice" | "fill_blank" | "short_answer";
      questionText: string;
      options: string[];
      correctAnswer: string;
      explanation: string;
      conceptTag: string;
      skillTag: string | null;
    }> = [];

    for (let i = 0; i < targetWeaknesses.length; i += 1) {
      const weakness = targetWeaknesses[i];
      const resolved = await resolveOrCreateReviewQuestionTemplate({
        userId: params.userId,
        courseId: params.courseId,
        courseTitle: params.courseTitle,
        conceptTag: weakness.concept_tag,
        skillTag: weakness.skill_tag || null,
        weaknessScore: weakness.weakness_score,
      });

      generatedQuestions.push({
        templateId: resolved.templateId,
        questionOrder: i + 1,
        questionType: resolved.questionType,
        questionText: resolved.questionText,
        options: resolved.options,
        correctAnswer: resolved.correctAnswer,
        explanation: resolved.explanation,
        conceptTag: weakness.concept_tag,
        skillTag: weakness.skill_tag || null,
      });
    }

    await createOrReplaceReviewSessionQuestions({
      reviewSessionId,
      generatedQuestions,
    });

    console.info("[review] weakness_detection", {
      user_id: params.userId,
      course_id: params.courseId,
      user_test_id: params.userTestId,
      score: params.score,
      weakness_count: weaknesses.length,
      review_session_id: reviewSessionId,
    });

    return {
      review_required: true,
      review_session_id: reviewSessionId,
      weaknesses,
    };
  } catch (error) {
    if (!isMissingRelationOrColumnError(error)) {
      console.warn("[review] weakness_pipeline_failed", {
        user_id: params.userId,
        course_id: params.courseId,
        user_test_id: params.userTestId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    return {
      review_required: false,
      review_session_id: null,
      weaknesses: [],
    };
  }
}

export async function getPendingReviewPopup(params: {
  userId: string;
  journeyPathId?: string | null;
  nextCourseId?: string | null;
}): Promise<PendingReviewPopup> {
  try {
    let query = supabaseAdmin
      .from("user_review_sessions")
      .select("*")
      .eq("user_id", params.userId)
      .eq("status", "open")
      .eq("review_required", true)
      .order("created_at", { ascending: false })
      .limit(1);

    if (params.journeyPathId?.trim()) {
      query = query.eq("journey_path_id", params.journeyPathId.trim());
    }

    const { data: sessionRow, error: sessionError } = await query.maybeSingle();
    if (sessionError) {
      throw sessionError;
    }
    if (!sessionRow) {
      return {
        should_show: false,
        review_session_id: null,
        course_id: null,
        score_at_trigger: null,
        questions: [],
      };
    }

    const reviewSessionId = toStringValue((sessionRow as GenericRecord).id);
    const { data: questionRows, error: questionError } = await supabaseAdmin
      .from("user_review_session_questions")
      .select("*")
      .eq("review_session_id", reviewSessionId)
      .order("question_order", { ascending: true });

    if (questionError) {
      throw questionError;
    }

    const questions = ((questionRows ?? []) as GenericRecord[]).map((row) => ({
      id: toStringValue(row.id),
      question_order: Math.max(1, Math.floor(toNumberValue(row.question_order))),
      question_type: (toStringValue(row.question_type) ||
        "single_choice") as "single_choice" | "fill_blank" | "short_answer",
      question_text: toStringValue(row.question_text),
      options: Array.isArray(row.options_json)
        ? row.options_json.map((item) => toStringValue(item)).filter(Boolean)
        : [],
      concept_tag: toStringValue(row.concept_tag),
      skill_tag: toStringValue(row.skill_tag) || null,
      max_score: Math.max(1, Math.floor(toNumberValue(row.max_score) || 5)),
    }));

    return {
      should_show: questions.length > 0,
      review_session_id: reviewSessionId,
      course_id: toStringValue((sessionRow as GenericRecord).course_id) || null,
      score_at_trigger: Math.floor(toNumberValue((sessionRow as GenericRecord).score_at_trigger) || 0),
      questions,
    };
  } catch (error) {
    if (!isMissingRelationOrColumnError(error)) {
      console.warn("[review] pending_popup_lookup_failed", {
        user_id: params.userId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    return {
      should_show: false,
      review_session_id: null,
      course_id: null,
      score_at_trigger: null,
      questions: [],
    };
  }
}

export async function submitReviewSessionAnswers(params: {
  userId: string;
  reviewSessionId: string;
  answers: Array<{
    question_id?: string;
    question_order?: number;
    answer_text?: string | null;
  }>;
  markSkipped?: boolean;
}) {
  console.info("[review] submit_answers:start", {
    user_id: params.userId,
    review_session_id: params.reviewSessionId,
    mark_skipped: Boolean(params.markSkipped),
    answer_count: params.answers.length,
  });

  const { data: session, error: sessionError } = await supabaseAdmin
    .from("user_review_sessions")
    .select("*")
    .eq("id", params.reviewSessionId)
    .eq("user_id", params.userId)
    .limit(1)
    .maybeSingle();

  if (sessionError || !session) {
    console.error("[review] submit_answers:failed", {
      user_id: params.userId,
      review_session_id: params.reviewSessionId,
      reason: sessionError ? getUnknownErrorMessage(sessionError) : "Review session not found.",
    });
    throw new Error("Review session not found.");
  }

  if (params.markSkipped) {
    const skippedPayload = {
      status: "skipped",
      completed_at: new Date().toISOString(),
    };
    const skippedUpdate = await supabaseAdmin
      .from("user_review_sessions")
      .update(skippedPayload)
      .eq("id", params.reviewSessionId)
      .eq("user_id", params.userId);
    if (skippedUpdate.error) {
      console.error("[review] submit_answers:failed", {
        user_id: params.userId,
        review_session_id: params.reviewSessionId,
        reason: getUnknownErrorMessage(skippedUpdate.error),
      });
      throw new Error("Unable to update review session.");
    }
    console.info("[review] submit_answers:update_session:success", {
      user_id: params.userId,
      review_session_id: params.reviewSessionId,
      status: "skipped",
      total_score: 0,
      earned_score: 0,
    });
    return {
      review_session_id: params.reviewSessionId,
      status: "skipped" as const,
      total_score: 0,
      earned_score: 0,
    };
  }

  const { data: questionRows, error: questionError } = await supabaseAdmin
    .from("user_review_session_questions")
    .select("*")
    .eq("review_session_id", params.reviewSessionId)
    .order("question_order", { ascending: true });

  if (questionError) {
    console.error("[review] submit_answers:failed", {
      user_id: params.userId,
      review_session_id: params.reviewSessionId,
      reason: getUnknownErrorMessage(questionError),
    });
    throw new Error("Unable to load review questions.");
  }

  const answersByQuestionId = new Map<string, string>();
  const answersByQuestionOrder = new Map<number, string>();
  params.answers.forEach((row) => {
    const answerText = toStringValue(row.answer_text ?? "").trim();
    const questionId = toStringValue(row.question_id).trim();
    const questionOrder = Math.max(0, Math.floor(toNumberValue(row.question_order) || 0));
    if (questionId) {
      answersByQuestionId.set(questionId, answerText);
    }
    if (questionOrder > 0) {
      answersByQuestionOrder.set(questionOrder, answerText);
    }
  });

  let totalScore = 0;
  let earnedScore = 0;
  const nowIso = new Date().toISOString();

  for (const question of (questionRows ?? []) as GenericRecord[]) {
    const questionId = toStringValue(question.id);
    const questionOrder = Math.max(1, Math.floor(toNumberValue(question.question_order) || 1));
    const maxScore = Math.max(1, Math.floor(toNumberValue(question.max_score) || 5));
    const userAnswer = answersByQuestionId.get(questionId) ?? answersByQuestionOrder.get(questionOrder) ?? "";
    const answerPayload = (question.correct_answer_json ?? {}) as Record<string, unknown>;
    const directCorrect = toStringValue(answerPayload.correct_answer).trim();
    const valueCorrect = toStringValue(answerPayload.value).trim();
    const correctAnswer = (directCorrect || valueCorrect).toLowerCase();
    const acceptableAnswers = Array.isArray(answerPayload.acceptable_answers)
      ? answerPayload.acceptable_answers
          .map((item) => toStringValue(item).trim().toLowerCase())
          .filter(Boolean)
      : [];
    const acceptedSet = new Set([correctAnswer, ...acceptableAnswers].filter(Boolean));
    const normalizedAnswer = userAnswer.trim().toLowerCase();

    let resultStatus: "correct" | "partial" | "incorrect" = "incorrect";
    let perQuestionEarned = 0;
    if (normalizedAnswer && acceptedSet.has(normalizedAnswer)) {
      resultStatus = "correct";
      perQuestionEarned = maxScore;
    } else if (
      normalizedAnswer &&
      correctAnswer &&
      correctAnswer.length >= 4 &&
      (normalizedAnswer.includes(correctAnswer.slice(0, 8)) ||
        correctAnswer.includes(normalizedAnswer.slice(0, 8)))
    ) {
      resultStatus = "partial";
      perQuestionEarned = Math.max(1, Math.floor(maxScore / 2));
    }
    const isCorrect = resultStatus === "correct";

    totalScore += maxScore;
    earnedScore += perQuestionEarned;

    console.info("[review] submit_answers:update_question:start", {
      user_id: params.userId,
      review_session_id: params.reviewSessionId,
      question_id: questionId,
      question_order: questionOrder,
      user_answer_text: userAnswer,
    });

    const updatePayloadCandidates: Array<Record<string, unknown>> = [
      {
        user_answer_text: userAnswer,
        user_answer_json: { answer_text: userAnswer },
        earned_score: perQuestionEarned,
        result_status: resultStatus,
        is_correct: isCorrect,
        updated_at: nowIso,
      },
      {
        user_answer_text: userAnswer,
        user_answer_json: { answer_text: userAnswer },
        earned_score: perQuestionEarned,
        result_status: resultStatus,
        updated_at: nowIso,
      },
      {
        user_answer_text: userAnswer,
        user_answer_json: { answer_text: userAnswer },
        earned_score: perQuestionEarned,
        result_status: resultStatus,
      },
      {
        user_answer_text: userAnswer,
        earned_score: perQuestionEarned,
        result_status: resultStatus,
      },
      {
        user_answer_json: { answer_text: userAnswer },
        earned_score: perQuestionEarned,
        result_status: resultStatus,
      },
      {
        user_answer_json: { answer_text: userAnswer },
      },
    ];

    let updated = false;
    let lastUpdateError: unknown = null;
    for (const payload of updatePayloadCandidates) {
      const updateResult = await supabaseAdmin
        .from("user_review_session_questions")
        .update(payload)
        .eq("id", questionId)
        .eq("review_session_id", params.reviewSessionId);
      if (!updateResult.error) {
        updated = true;
        break;
      }
      lastUpdateError = updateResult.error;
      if (!isMissingRelationOrColumnError(updateResult.error)) {
        break;
      }
    }

    if (!updated) {
      console.error("[review] submit_answers:update_question:failed", {
        user_id: params.userId,
        review_session_id: params.reviewSessionId,
        question_id: questionId,
        question_order: questionOrder,
        user_answer_text: userAnswer,
        db_error: getUnknownErrorMessage(lastUpdateError),
      });
      throw new Error("Unable to save review answer.");
    }

    console.info("[review] submit_answers:update_question:success", {
      user_id: params.userId,
      review_session_id: params.reviewSessionId,
      question_id: questionId,
      question_order: questionOrder,
      user_answer_text: userAnswer,
      earned_score: perQuestionEarned,
      result_status: resultStatus,
    });
  }

  const sessionUpdate = await supabaseAdmin
    .from("user_review_sessions")
    .update({
      status: "completed",
      completed_at: nowIso,
    })
    .eq("id", params.reviewSessionId)
    .eq("user_id", params.userId);
  if (sessionUpdate.error) {
    console.error("[review] submit_answers:failed", {
      user_id: params.userId,
      review_session_id: params.reviewSessionId,
      reason: getUnknownErrorMessage(sessionUpdate.error),
    });
    throw new Error("Unable to update review session.");
  }

  console.info("[review] submit_answers:update_session:success", {
    user_id: params.userId,
    review_session_id: params.reviewSessionId,
    status: "completed",
    total_score: totalScore,
    earned_score: earnedScore,
  });

  return {
    review_session_id: params.reviewSessionId,
    status: "completed" as const,
    total_score: totalScore,
    earned_score: earnedScore,
  };
}
