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

export type GeneratedAiQuestion = {
  question_order: number;
  question_type: "single_choice" | "fill_blank" | "essay";
  question_text: string;
  options: string[];
  correct_answer_text: string;
  acceptable_answers: string[];
  score: number;
  explanation: string;
  skill_tag: string;
  concept_tag: string;
};

const generatedQuestionSchema = z.object({
  questions: z
    .array(
      z.object({
        question_order: z.number().int().min(1),
        question_type: z.enum(["single_choice", "fill_blank", "essay"]),
        question_text: z.string().min(1),
        options: z.array(z.string()).default([]),
        correct_answer_text: z.string().min(1),
        acceptable_answers: z.array(z.string()).default([]),
        score: z.number().int().min(1).max(40),
        explanation: z.string().min(1),
        skill_tag: z.string().min(1),
        concept_tag: z.string().min(1),
      }),
    )
    .min(8)
    .max(20),
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

function getFallbackQuestions(params: {
  courseTitle: string;
  attemptNumber: number;
  difficultyBand: DifficultyBand;
}): z.infer<typeof generatedQuestionSchema> {
  const totalQuestions = 10;
  const questions: z.infer<typeof generatedQuestionSchema>["questions"] = [];

  for (let i = 0; i < totalQuestions; i += 1) {
    const questionNo = i + 1;
    const isFillBlank = questionNo % 3 === 0;
    const isEssay = questionNo % 5 === 0;
    const questionType = isEssay ? "essay" : isFillBlank ? "fill_blank" : "single_choice";
    const score = questionType === "essay" ? 20 : 8;

    questions.push({
      question_order: questionNo,
      question_type: questionType,
      question_text: isEssay
        ? `Explain how to apply ${params.courseTitle} concept ${questionNo} at ${params.difficultyBand} difficulty.`
        : isFillBlank
        ? `Fill in the missing term for ${params.courseTitle} concept ${questionNo}.`
        : `Which option best matches ${params.courseTitle} concept ${questionNo}?`,
      options:
        questionType === "single_choice"
          ? ["Option A", "Option B", "Option C", "Option D"]
          : [],
      correct_answer_text:
        questionType === "single_choice"
          ? "Option A"
          : questionType === "fill_blank"
          ? `${params.courseTitle} concept ${questionNo}`
          : `A strong explanation covering concept ${questionNo}.`,
      acceptable_answers:
        questionType === "fill_blank" ? [`${params.courseTitle} concept ${questionNo}`] : [],
      score,
      explanation: `Review ${params.courseTitle} concept ${questionNo} and its practical usage.`,
      skill_tag: `${params.courseTitle.toLowerCase().replace(/\s+/g, "-")}-skill-${questionNo}`,
      concept_tag: `${params.courseTitle.toLowerCase().replace(/\s+/g, "-")}-concept-${questionNo}`,
    });
  }

  return {
    questions,
  };
}

function normalizeGeneratedQuestions(input: z.infer<typeof generatedQuestionSchema>) {
  const sorted = [...input.questions].sort((a, b) => a.question_order - b.question_order);
  return sorted.map((question, index) => ({
    question_order: index + 1,
    question_type: question.question_type,
    question_text: question.question_text.trim(),
    options:
      question.question_type === "single_choice"
        ? question.options.map((item) => item.trim()).filter(Boolean).slice(0, 6)
        : [],
    correct_answer_text: question.correct_answer_text.trim(),
    acceptable_answers: Array.from(
      new Set(question.acceptable_answers.map((item) => item.trim()).filter(Boolean)),
    ),
    score: Math.max(1, Math.floor(question.score)),
    explanation: question.explanation.trim(),
    skill_tag: question.skill_tag.trim(),
    concept_tag: question.concept_tag.trim(),
  })) as GeneratedAiQuestion[];
}

async function findReusableTemplate(params: {
  courseId: string;
  difficultyBand: DifficultyBand;
  variantNo: number;
  basedOnResourceOptionId?: string | null;
}) {
  const { data, error } = await supabaseAdmin
    .from("ai_test_templates")
    .select("*")
    .eq("course_id", params.courseId)
    .eq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(30);

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as GenericRecord[];
  const matched = rows.find((row) => {
    const rowDifficulty = normalizeDifficultyBand(row.difficulty_band || "basic");
    const rowVariant = Math.max(1, Math.floor(toNumberValue(row.variant_no) || 1));
    const rowResourceOptionId = toStringValue(row.based_on_resource_option_id) || null;
    const matchesResource =
      !params.basedOnResourceOptionId || rowResourceOptionId === params.basedOnResourceOptionId;
    return (
      rowDifficulty === params.difficultyBand &&
      rowVariant === params.variantNo &&
      matchesResource
    );
  });

  if (!matched) {
    return null;
  }

  return {
    id: toStringValue(matched.id),
  };
}

async function insertTemplateRow(params: {
  courseId: string;
  difficultyBand: DifficultyBand;
  variantNo: number;
  basedOnResourceOptionId?: string | null;
  sourceHash: string;
}) {
  const nowIso = new Date().toISOString();
  const firstPayload: Record<string, unknown> = {
    course_id: params.courseId,
    status: "ready",
    difficulty_band: params.difficultyBand,
    variant_no: params.variantNo,
    based_on_resource_option_id: params.basedOnResourceOptionId ?? null,
    reuse_scope: "course",
    source_hash: params.sourceHash,
    created_at: nowIso,
  };

  let insertResult = await supabaseAdmin
    .from("ai_test_templates")
    .insert(firstPayload)
    .select("id")
    .limit(1)
    .maybeSingle();

  if (insertResult.error) {
    const fallbackPayload: Record<string, unknown> = {
      course_id: params.courseId,
      status: "ready",
      created_at: nowIso,
    };
    insertResult = await supabaseAdmin
      .from("ai_test_templates")
      .insert(fallbackPayload)
      .select("id")
      .limit(1)
      .maybeSingle();
  }

  if (insertResult.error || !insertResult.data) {
    throw insertResult.error ?? new Error("Unable to insert AI test template.");
  }

  return toStringValue((insertResult.data as GenericRecord).id);
}

async function insertTemplateQuestions(params: {
  templateId: string;
  questions: GeneratedAiQuestion[];
}) {
  const baseRows = params.questions.map((question) => ({
    template_id: params.templateId,
    question_order: question.question_order,
    question_type: question.question_type,
    question_text: question.question_text,
    options_json: question.question_type === "single_choice" ? question.options : [],
    correct_answer_text: question.correct_answer_text,
    acceptable_answers_json: question.acceptable_answers,
    score: question.score,
    explanation: question.explanation,
    skill_tag: question.skill_tag,
    concept_tag: question.concept_tag,
  }));

  let insertResult = await supabaseAdmin
    .from("ai_test_template_questions")
    .insert(baseRows);

  if (insertResult.error) {
    const fallbackRows = baseRows.map((row) => ({
      template_id: row.template_id,
      question_order: row.question_order,
      question_type: row.question_type,
      question_text: row.question_text,
      options_json: row.options_json,
      correct_answer_text: row.correct_answer_text,
      acceptable_answers_json: row.acceptable_answers_json,
      score: row.score,
      explanation: row.explanation,
    }));
    insertResult = await supabaseAdmin
      .from("ai_test_template_questions")
      .insert(fallbackRows);
  }

  if (insertResult.error) {
    throw insertResult.error;
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
  attemptNumber: number;
}): Promise<{
  templateId: string;
  reusedExisting: boolean;
  difficultyBand: DifficultyBand;
  variantNo: number;
  aiProvenance: AiProvenance | null;
}> {
  const difficultyBand = determineDifficultyBand(params.attemptNumber);
  const variantNo = Math.max(1, Math.floor(params.attemptNumber));

  try {
    const existingTemplate = await findReusableTemplate({
      courseId: params.courseId,
      difficultyBand,
      variantNo,
      basedOnResourceOptionId: params.selectedResourceOptionId ?? null,
    });

    if (existingTemplate?.id) {
      console.info("[ai_test] template_reuse_decision", {
        decision: "reuse",
        course_id: params.courseId,
        template_id: existingTemplate.id,
        difficulty_band: difficultyBand,
        variant_no: variantNo,
      });
      return {
        templateId: existingTemplate.id,
        reusedExisting: true,
        difficultyBand,
        variantNo,
        aiProvenance: null,
      };
    }
  } catch (error) {
    console.warn("[ai_test] template_lookup_failed", {
      course_id: params.courseId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  const { output, provenance } = await generateStructuredJson({
    feature: "ai_test_template",
    promptVersion: "ai_test_template_v2",
    systemInstruction: [
      "Generate a reusable course test template.",
      "Questions must be relevant to the provided course and selected resource context.",
      "Increase conceptual depth for higher difficulty bands.",
      "Return structured JSON only.",
    ].join(" "),
    input: {
      user_id: params.userId,
      course_id: params.courseId,
      course_title: params.courseTitle,
      course_description: params.courseDescription ?? null,
      selected_resource_option_id: params.selectedResourceOptionId ?? null,
      selected_resource_title: params.selectedResourceTitle ?? null,
      selected_resource_type: params.selectedResourceType ?? null,
      attempt_number: params.attemptNumber,
      difficulty_band: difficultyBand,
      variant_no: variantNo,
      requirements: {
        include_concept_and_skill_tags: true,
        vary_from_previous_attempts: true,
      },
    },
    outputSchema: generatedQuestionSchema,
    fallback: () =>
      getFallbackQuestions({
        courseTitle: params.courseTitle,
        attemptNumber: params.attemptNumber,
        difficultyBand,
      }),
  });

  const normalizedQuestions = normalizeGeneratedQuestions(output);
  const sourceHash = sha256Hash({
    course_id: params.courseId,
    difficulty_band: difficultyBand,
    variant_no: variantNo,
    based_on_resource_option_id: params.selectedResourceOptionId ?? null,
    questions: normalizedQuestions,
  });

  try {
    const templateId = await insertTemplateRow({
      courseId: params.courseId,
      difficultyBand,
      variantNo,
      basedOnResourceOptionId: params.selectedResourceOptionId ?? null,
      sourceHash,
    });
    await insertTemplateQuestions({
      templateId,
      questions: normalizedQuestions,
    });

    console.info("[ai_test] template_reuse_decision", {
      decision: "regenerate",
      course_id: params.courseId,
      template_id: templateId,
      difficulty_band: difficultyBand,
      variant_no: variantNo,
      based_on_resource_option_id: params.selectedResourceOptionId ?? null,
      question_count: normalizedQuestions.length,
      ai_provider: provenance.provider,
      ai_model: provenance.model,
      fallback_used: provenance.fallback_used,
    });

    return {
      templateId,
      reusedExisting: false,
      difficultyBand,
      variantNo,
      aiProvenance: provenance,
    };
  } catch (error) {
    console.error("[ai_test] template_creation_failed", {
      course_id: params.courseId,
      difficulty_band: difficultyBand,
      variant_no: variantNo,
      reason: error instanceof Error ? error.message : String(error),
    });

    const fallback = await supabaseAdmin
      .from("ai_test_templates")
      .select("id")
      .eq("course_id", params.courseId)
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fallback.error || !fallback.data) {
      throw new Error("No ready AI test template found for this course.");
    }

    return {
      templateId: toStringValue((fallback.data as GenericRecord).id),
      reusedExisting: true,
      difficultyBand,
      variantNo,
      aiProvenance: provenance,
    };
  }
}
