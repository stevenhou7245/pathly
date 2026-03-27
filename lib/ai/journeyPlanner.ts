import { z } from "zod";
import {
  isMissingRelationOrColumnError,
  normalizeDifficultyBand,
  sha256Hash,
  toNumberValue,
  toStableJson,
  toStringValue,
  type DifficultyBand,
} from "@/lib/ai/common";
import { calculateTotalSteps, LESSONS_PER_LEVEL_GAP } from "@/lib/learningPath";
import type { ResourcePreferenceProfile } from "@/lib/ai/preferences";
import { generateStructuredJson, type AiProvenance } from "@/lib/ai/provider";
import { installAiPipelineDebugLogFilter } from "@/lib/aiPipelineDebugLogging";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type GenericRecord = Record<string, unknown>;
const JOURNEY_TEMPLATE_PROMPT_VERSION = "journey_template_v2";

export type JourneyPlanStep = {
  step_number: number;
  step_title: string;
  step_description: string;
  learning_objective: string;
  difficulty_level: DifficultyBand;
  skill_tags: string[];
  concept_tags: string[];
};

export type JourneyTemplateResult = {
  template_id: string | null;
  template_version: number;
  total_steps: number;
  source_hash: string;
  reused_existing: boolean;
  ai_provenance: AiProvenance;
  steps: JourneyPlanStep[];
};

const journeyTemplateOutputSchema = z.object({
  journey_plan: z
    .array(
      z.object({
        title: z.string().min(1),
        description: z.string().min(1),
        objective: z.string().min(1),
        difficulty: z.enum(["beginner", "basic", "intermediate", "advanced", "expert"]),
        skill_tags: z.array(z.string()),
        concept_tags: z.array(z.string()),
      }),
    )
    .min(1)
    .max(20),
});

const journeyTemplateLooseOutputSchema = z.object({
  journey_plan: z
    .array(
      z
        .object({
          title: z.string().optional().default(""),
          description: z.string().optional().default(""),
          objective: z.string().optional().default(""),
          difficulty: z.string().optional().default("beginner"),
          skill_tags: z.array(z.string()).optional().default([]),
          concept_tags: z.array(z.string()).optional().default([]),
        })
        .passthrough(),
    )
    .min(1)
    .max(20),
});

function normalizeJourneyDifficulty(value: string): DifficultyBand {
  const normalized = value.trim().toLowerCase();
  if (normalized === "beginner") {
    return "beginner";
  }
  if (normalized === "basic") {
    return "basic";
  }
  if (normalized === "intermediate") {
    return "intermediate";
  }
  if (normalized === "advanced") {
    return "advanced";
  }
  if (normalized === "expert") {
    return "expert";
  }
  if (normalized === "novice" || normalized === "starter" || normalized === "intro") {
    return "beginner";
  }
  if (normalized === "foundation" || normalized === "foundational") {
    return "basic";
  }
  return "beginner";
}

function normalizeJourneyPlanForValidation(
  value: z.infer<typeof journeyTemplateLooseOutputSchema>["journey_plan"],
) {
  return value.map((step, index) => {
    const originalDifficulty = toStringValue(step.difficulty);
    const normalizedDifficulty = normalizeJourneyDifficulty(originalDifficulty);
    console.info("[journey_template] difficulty_normalized", {
      step_index: index + 1,
      original: originalDifficulty || null,
      normalized: normalizedDifficulty,
    });
    return {
      title: toStringValue(step.title).trim() || `Step ${index + 1}`,
      description: toStringValue(step.description).trim() || `Complete step ${index + 1}.`,
      objective: toStringValue(step.objective).trim() || `Practice step ${index + 1}.`,
      difficulty: normalizedDifficulty,
      skill_tags: Array.isArray(step.skill_tags)
        ? step.skill_tags.map((item) => toStringValue(item).trim()).filter(Boolean)
        : [],
      concept_tags: Array.isArray(step.concept_tags)
        ? step.concept_tags.map((item) => toStringValue(item).trim()).filter(Boolean)
        : [],
    };
  });
}

function normalizeSteps(
  steps: z.infer<typeof journeyTemplateOutputSchema>["journey_plan"],
  totalSteps: number,
) {
  const trimmed = [...steps].slice(0, Math.max(1, totalSteps));
  return trimmed.map((step, index) => ({
    step_number: index + 1,
    step_title: step.title.trim() || `Step ${index + 1}`,
    step_description: step.description.trim() || `Complete step ${index + 1}.`,
    learning_objective: step.objective.trim() || `Practice step ${index + 1}.`,
    difficulty_level: normalizeDifficultyBand(step.difficulty),
    skill_tags: Array.from(new Set(step.skill_tags.map((tag) => tag.trim()).filter(Boolean))),
    concept_tags: Array.from(new Set(step.concept_tags.map((tag) => tag.trim()).filter(Boolean))),
  }));
}

function hasGenericStepTitles(steps: JourneyPlanStep[]) {
  return steps.every((step) => {
    const normalized = step.step_title.trim().toLowerCase();
    if (!normalized) {
      return true;
    }
    return (
      /^(milestone|step)\s*\d+$/.test(normalized) ||
      /applied practice|advanced mastery|guided practice/.test(normalized) ||
      /foundations\s+\d+$/.test(normalized) ||
      /course\s+\d+$/.test(normalized)
    );
  });
}

function estimateSteps(startLevel: string, targetLevel: string) {
  const fixedTotalSteps = calculateTotalSteps(startLevel, targetLevel);
  return Math.max(1, Math.min(20, fixedTotalSteps));
}

function buildDeterministicJourneyPlan(input: {
  fieldTitle: string;
  startLevel: string;
  targetLevel: string;
}): z.infer<typeof journeyTemplateOutputSchema> {
  const totalSteps = estimateSteps(input.startLevel, input.targetLevel);
  const steps: z.infer<typeof journeyTemplateOutputSchema>["journey_plan"] = [];

  const difficultyByIndex: DifficultyBand[] = [
    "beginner",
    "basic",
    "intermediate",
    "advanced",
    "expert",
  ];
  const normalizedField = input.fieldTitle.trim().toLowerCase();
  const fallbackTitleCatalog = (() => {
    if (normalizedField.includes("ielts")) {
      return [
        "IELTS Reading Foundations",
        "IELTS Listening Strategies",
        "IELTS Speaking Part 1 Basics",
        "IELTS Task 2 Writing Structure",
        "IELTS Reading Skimming and Scanning",
        "IELTS Listening Distractor Detection",
        "IELTS Speaking Part 2 Story Flow",
        "IELTS Writing Task 1 Data Overview",
        "IELTS Full Mock Test Practice",
      ];
    }
    if (normalizedField.includes("toefl")) {
      return [
        "TOEFL Reading Foundations",
        "TOEFL Listening Note-Taking",
        "TOEFL Speaking Task 1 Strategies",
        "TOEFL Independent Writing Basics",
        "TOEFL Reading Accuracy Drills",
        "TOEFL Listening Detail Recognition",
        "TOEFL Speaking Task 2-4 Fluency",
        "TOEFL Integrated Writing Structure",
        "TOEFL Timed Mock Test Practice",
      ];
    }
    if (normalizedField === "html" || normalizedField.includes("html")) {
      return [
        "HTML Basics",
        "Semantic HTML",
        "Forms and Inputs",
        "HTML Structure Practice",
        "Tables and Media Embeds",
        "Accessible Markup Patterns",
        "HTML Page Layout Workshop",
      ];
    }
    return [];
  })();

  for (let i = 0; i < totalSteps; i += 1) {
    const progress = totalSteps <= 1 ? 0 : i / (totalSteps - 1);
    const difficultyIndex = Math.min(4, Math.max(0, Math.floor(progress * 5)));
    const difficulty = difficultyByIndex[difficultyIndex];
    const stepNo = i + 1;
    const focusLabel =
      stepNo <= 2
        ? "Foundations"
        : stepNo <= Math.max(3, Math.floor(totalSteps * 0.65))
        ? "Guided Practice"
        : "Performance Practice";
    const catalogTitle = fallbackTitleCatalog[i] ?? "";
    const stepTitle = catalogTitle || `${input.fieldTitle} ${focusLabel} ${stepNo}`;
    steps.push({
      title: stepTitle,
      description: `Practice ${input.fieldTitle} through ${focusLabel.toLowerCase()} step ${stepNo}.`,
      objective: `Move from ${input.startLevel} toward ${input.targetLevel} with ${focusLabel.toLowerCase()} outcomes.`,
      difficulty,
      skill_tags: [`${input.fieldTitle.toLowerCase()}-core`, `${focusLabel.toLowerCase().replace(/\s+/g, "-")}-${stepNo}`],
      concept_tags: [`${input.fieldTitle.toLowerCase()}-concept-${stepNo}`, `level-${difficulty}`],
    });
  }

  return {
    journey_plan: steps.slice(0, totalSteps),
  };
}

async function loadTemplateSteps(templateId: string) {
  const { data, error } = await supabaseAdmin
    .from("learning_field_template_steps")
    .select("*")
    .eq("template_id", templateId)
    .order("step_number", { ascending: true });

  if (error) {
    throw error;
  }

  return ((data ?? []) as GenericRecord[]).map((row, index) => ({
    step_number: Math.max(1, Math.floor(toNumberValue(row.step_number) || index + 1)),
    step_title: toStringValue(row.step_title) || `Step ${index + 1}`,
    step_description: toStringValue(row.step_description) || `Step ${index + 1}`,
    learning_objective: toStringValue(row.learning_objective) || `Objective ${index + 1}`,
    difficulty_level: normalizeDifficultyBand(row.difficulty_level),
    skill_tags: Array.isArray(row.skill_tags_json)
      ? row.skill_tags_json.map((item) => toStringValue(item)).filter(Boolean)
      : [],
    concept_tags: Array.isArray(row.concept_tags_json)
      ? row.concept_tags_json.map((item) => toStringValue(item)).filter(Boolean)
      : [],
  }));
}

export async function resolveOrCreateJourneyTemplate(params: {
  userId: string;
  learningFieldId: string;
  fieldTitle: string;
  startLevel: string;
  targetLevel: string;
  desiredTotalSteps?: number | null;
  userPreferenceProfile?: ResourcePreferenceProfile | null;
}): Promise<JourneyTemplateResult> {
  installAiPipelineDebugLogFilter();
  const rawComputedTotalSteps = calculateTotalSteps(params.startLevel, params.targetLevel);
  const fixedTotalSteps = Math.max(1, rawComputedTotalSteps);
  const levelDistance = Math.max(
    0,
    Math.floor(rawComputedTotalSteps / LESSONS_PER_LEVEL_GAP),
  );

  const templateSourceHash = sha256Hash({
    learning_field_id: params.learningFieldId,
    start_level: params.startLevel,
    target_level: params.targetLevel,
    level_distance: levelDistance,
    total_steps: fixedTotalSteps,
    lessons_per_level_gap: LESSONS_PER_LEVEL_GAP,
    prompt_version: JOURNEY_TEMPLATE_PROMPT_VERSION,
  });

  try {
    const { data: existingTemplate, error: existingTemplateError } = await supabaseAdmin
      .from("learning_field_templates")
      .select("*")
      .eq("learning_field_id", params.learningFieldId)
      .eq("start_level", params.startLevel)
      .eq("target_level", params.targetLevel)
      .eq("status", "ready")
      .order("template_version", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingTemplateError && !isMissingRelationOrColumnError(existingTemplateError)) {
      throw existingTemplateError;
    }

    if (existingTemplate) {
      const templateId = toStringValue((existingTemplate as GenericRecord).id);
      if (templateId) {
        const loadedSteps = await loadTemplateSteps(templateId);
        if (loadedSteps.length > 0) {
          if (hasGenericStepTitles(loadedSteps)) {
            console.info("[journey_ai] template_reuse_skipped_placeholder_titles", {
              learning_field_id: params.learningFieldId,
              template_id: templateId,
            });
          } else if (loadedSteps.length !== fixedTotalSteps) {
            console.info("[journey_ai] template_reuse_skipped_step_count_mismatch", {
              learning_field_id: params.learningFieldId,
              template_id: templateId,
              expected_total_steps: fixedTotalSteps,
              existing_total_steps: loadedSteps.length,
            });
          } else {
            console.info("[journey_ai] template_reuse", {
              learning_field_id: params.learningFieldId,
              template_id: templateId,
              start_level: params.startLevel,
              target_level: params.targetLevel,
              total_steps: fixedTotalSteps,
            });
            return {
              template_id: templateId,
              template_version: Math.max(
                1,
                Math.floor(toNumberValue((existingTemplate as GenericRecord).template_version)),
              ),
              total_steps: loadedSteps.length,
              source_hash:
                toStringValue((existingTemplate as GenericRecord).source_hash) || templateSourceHash,
              reused_existing: true,
              ai_provenance: {
                provider: "deterministic",
                model: toStringValue((existingTemplate as GenericRecord).ai_model) || "reused-template",
                prompt_version:
                  toStringValue((existingTemplate as GenericRecord).ai_prompt_version) ||
                  JOURNEY_TEMPLATE_PROMPT_VERSION,
                generated_at:
                  toStringValue((existingTemplate as GenericRecord).ai_generated_at) ||
                  new Date().toISOString(),
                fallback_used: false,
                failure_reason: null,
              },
              steps: loadedSteps,
            };
          }
        }
      }
    }
  } catch (error) {
    if (!isMissingRelationOrColumnError(error)) {
      console.warn("[journey_ai] template_lookup_failed", {
        learning_field_id: params.learningFieldId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const promptFieldTitle = toStringValue(params.fieldTitle).trim();
  const promptStartLevel = toStringValue(params.startLevel).trim();
  const promptTargetLevel = toStringValue(params.targetLevel).trim();
  const systemInstruction = [
    "You are a learning journey planner.",
    "Return JSON only with this exact top-level field: journey_plan (array).",
    "Each journey_plan item must include: title, description, objective, difficulty, skill_tags, concept_tags.",
    `Level order is fixed: beginner -> basic -> intermediate -> advanced -> expert.`,
    `Each adjacent level gap must always equal exactly ${LESSONS_PER_LEVEL_GAP} lessons.`,
    "Use total_steps from input exactly. Do not return more or fewer lessons than total_steps.",
    "Create progressively harder steps from start to target level.",
    "difficulty must be exactly one of: beginner, basic, intermediate, advanced, expert.",
    "Use lowercase difficulty values only.",
    "Do not use capitalized values like Beginner, Intermediate, Advanced, Expert.",
    "Do not return any difficulty value outside the allowed lowercase enum.",
    "Every title must be topic-specific and concrete. Avoid generic names like Applied Practice 7.",
    "Examples for IELTS: IELTS Reading Foundations, IELTS Listening Strategies, IELTS Speaking Part 1 Basics, IELTS Task 2 Writing Structure.",
    "Examples for TOEFL: TOEFL Reading Foundations, TOEFL Listening Note-Taking, TOEFL Speaking Task 1 Strategies, TOEFL Independent Writing Basics.",
    "Examples for HTML: HTML Basics, Semantic HTML, Forms and Inputs, HTML Structure Practice.",
  ].join(" ").trim();
  const missingPromptFields = [
    promptFieldTitle ? null : "field_title",
    promptStartLevel ? null : "start_level",
    promptTargetLevel ? null : "target_level",
    systemInstruction ? null : "system_instruction",
  ].filter((value): value is string => Boolean(value));

  console.info("[journey_template] prompt_ready", {
    learning_field_id: params.learningFieldId,
    has_field_title: Boolean(promptFieldTitle),
    has_start_level: Boolean(promptStartLevel),
    has_target_level: Boolean(promptTargetLevel),
    level_distance: levelDistance,
    total_steps: fixedTotalSteps,
    missing_fields: missingPromptFields,
  });

  let output: z.infer<typeof journeyTemplateOutputSchema>;
  let provenance: AiProvenance;
  let debug: { ai_called: boolean; raw_response_text: string | null; parsed_output_json: unknown | null };

  if (missingPromptFields.length > 0) {
    console.error("[journey_template] api_request_started", {
      learning_field_id: params.learningFieldId,
      skipped: true,
      reason: "missing_required_prompt_input",
    });
    console.error("[journey_template] api_request_succeeded", {
      learning_field_id: params.learningFieldId,
      provider: "deterministic",
      model: "deterministic-fallback",
      fallback_used: true,
    });
    console.error("[journey_template] raw_response_received", {
      learning_field_id: params.learningFieldId,
      raw_response_text: null,
      parsed_output_json: null,
    });
    output = buildDeterministicJourneyPlan({
      fieldTitle: promptFieldTitle || "Learning",
      startLevel: promptStartLevel || "Beginner",
      targetLevel: promptTargetLevel || promptStartLevel || "Intermediate",
    });
    provenance = {
      provider: "deterministic",
      model: "deterministic-fallback",
      prompt_version: JOURNEY_TEMPLATE_PROMPT_VERSION,
      generated_at: new Date().toISOString(),
      fallback_used: true,
      failure_reason: `Missing prompt fields: ${missingPromptFields.join(", ")}`,
    };
    debug = {
      ai_called: false,
      raw_response_text: null,
      parsed_output_json: output,
    };
  } else {
    console.info("[journey_template] api_request_started", {
      learning_field_id: params.learningFieldId,
      field_title: promptFieldTitle,
      start_level: promptStartLevel,
      target_level: promptTargetLevel,
      level_distance: levelDistance,
      total_steps: fixedTotalSteps,
      requested_desired_total_steps: params.desiredTotalSteps ?? null,
    });
    const generation = await generateStructuredJson({
      feature: "journey_template",
      promptVersion: JOURNEY_TEMPLATE_PROMPT_VERSION,
      systemInstruction,
      input: {
        learning_field_id: params.learningFieldId,
        field_title: promptFieldTitle,
        start_level: promptStartLevel,
        target_level: promptTargetLevel,
        level_order: ["beginner", "basic", "intermediate", "advanced", "expert"],
        lessons_per_adjacent_level_gap: LESSONS_PER_LEVEL_GAP,
        level_distance: levelDistance,
        total_steps: fixedTotalSteps,
        requested_desired_total_steps: params.desiredTotalSteps ?? null,
      },
      outputSchema: journeyTemplateLooseOutputSchema,
      fallback: () =>
        buildDeterministicJourneyPlan({
          fieldTitle: promptFieldTitle || "Learning",
          startLevel: promptStartLevel || "Beginner",
          targetLevel: promptTargetLevel || promptStartLevel || "Intermediate",
        }),
    });
    const looseOutput = generation.output;
    provenance = generation.provenance;
    debug = generation.debug;

    console.info("[journey_template] api_request_succeeded", {
      learning_field_id: params.learningFieldId,
      provider: provenance.provider,
      model: provenance.model,
      fallback_used: provenance.fallback_used,
      failure_reason: provenance.failure_reason,
    });
    console.info("[journey_template] raw_response_received", {
      learning_field_id: params.learningFieldId,
      raw_response_text: debug.raw_response_text,
      parsed_output_json: debug.parsed_output_json,
    });

    console.info("[journey_template] normalization_started", {
      learning_field_id: params.learningFieldId,
      step_count: looseOutput.journey_plan.length,
    });
    const normalizedOutput = {
      journey_plan: normalizeJourneyPlanForValidation(looseOutput.journey_plan),
    };
    console.info("[journey_template] normalization_completed", {
      learning_field_id: params.learningFieldId,
      step_count: normalizedOutput.journey_plan.length,
    });

    const strictParsed = journeyTemplateOutputSchema.safeParse(normalizedOutput);
    if (!strictParsed.success) {
      console.error("[journey_template] schema_validation_failed", {
        learning_field_id: params.learningFieldId,
        issue: strictParsed.error.issues[0]?.message ?? "Unknown schema issue",
        issues: strictParsed.error.issues,
      });
      output = buildDeterministicJourneyPlan({
        fieldTitle: promptFieldTitle || "Learning",
        startLevel: promptStartLevel || "Beginner",
        targetLevel: promptTargetLevel || promptStartLevel || "Intermediate",
      });
      provenance = {
        provider: "deterministic",
        model: "deterministic-fallback",
        prompt_version: JOURNEY_TEMPLATE_PROMPT_VERSION,
        generated_at: new Date().toISOString(),
        fallback_used: true,
        failure_reason: "schema_validation_failed_after_normalization",
      };
      debug = {
        ai_called: true,
        raw_response_text: debug.raw_response_text,
        parsed_output_json: normalizedOutput,
      };
    } else {
      console.info("[journey_template] schema_validation_succeeded", {
        learning_field_id: params.learningFieldId,
        step_count: strictParsed.data.journey_plan.length,
      });
      output = strictParsed.data;
    }
  }

  if (missingPromptFields.length > 0) {
    console.info("[journey_template] normalization_started", {
      learning_field_id: params.learningFieldId,
      step_count: output.journey_plan.length,
    });
    const normalizedOutput = {
      journey_plan: normalizeJourneyPlanForValidation(output.journey_plan),
    };
    console.info("[journey_template] normalization_completed", {
      learning_field_id: params.learningFieldId,
      step_count: normalizedOutput.journey_plan.length,
    });
    const strictParsed = journeyTemplateOutputSchema.safeParse(normalizedOutput);
    if (!strictParsed.success) {
      console.error("[journey_template] schema_validation_failed", {
        learning_field_id: params.learningFieldId,
        issue: strictParsed.error.issues[0]?.message ?? "Unknown schema issue",
        issues: strictParsed.error.issues,
      });
      output = buildDeterministicJourneyPlan({
        fieldTitle: promptFieldTitle || "Learning",
        startLevel: promptStartLevel || "Beginner",
        targetLevel: promptTargetLevel || promptStartLevel || "Intermediate",
      });
    } else {
      console.info("[journey_template] schema_validation_succeeded", {
        learning_field_id: params.learningFieldId,
        step_count: strictParsed.data.journey_plan.length,
      });
      output = strictParsed.data;
    }
  }

  console.info("[journey_template] parsed_journey_plan_count", {
    learning_field_id: params.learningFieldId,
    count: Array.isArray(output.journey_plan) ? output.journey_plan.length : 0,
  });

  let normalizedSteps = normalizeSteps(
    output.journey_plan,
    Math.max(1, fixedTotalSteps),
  );
  if (normalizedSteps.length !== fixedTotalSteps) {
    const deterministicFallback = normalizeSteps(
      buildDeterministicJourneyPlan({
        fieldTitle: promptFieldTitle || "Learning",
        startLevel: promptStartLevel || "Beginner",
        targetLevel: promptTargetLevel || promptStartLevel || "Intermediate",
      }).journey_plan,
      fixedTotalSteps,
    );
    normalizedSteps = deterministicFallback;
    console.warn("[journey_template] normalized_step_count_adjusted_to_fixed_rule", {
      learning_field_id: params.learningFieldId,
      expected_total_steps: fixedTotalSteps,
      normalized_step_count: normalizedSteps.length,
      reason: "enforced_fixed_level_gap_rule",
    });
  }
  console.info("[journey_template] generation_result", {
    learning_field_id: params.learningFieldId,
    field_title: params.fieldTitle,
    ai_called: debug.ai_called,
    provider: provenance.provider,
    model: provenance.model,
    fallback_used: provenance.fallback_used,
    raw_ai_response_text: debug.raw_response_text,
    parsed_ai_json: debug.parsed_output_json,
    normalized_step_count: normalizedSteps.length,
    expected_total_steps: fixedTotalSteps,
  });
  const normalizedTotalSteps = normalizedSteps.length;
  const sourceHash = sha256Hash({
    base_hash: templateSourceHash,
    output: {
      journey_plan: normalizedSteps,
      total_steps: normalizedTotalSteps,
    },
  });

  let templateId: string | null = null;
  let templateVersion = 1;

  try {
    const { data: insertedTemplate, error: insertTemplateError } = await supabaseAdmin
      .from("learning_field_templates")
      .insert({
        learning_field_id: params.learningFieldId,
        template_name: `${promptFieldTitle || "Learning"} ${promptStartLevel || "Start"} to ${promptTargetLevel || "Target"}`,
        start_level: params.startLevel,
        target_level: params.targetLevel,
        desired_total_steps: fixedTotalSteps,
        total_steps: normalizedTotalSteps,
        status: "ready",
        template_version: templateVersion,
        source_hash: sourceHash,
        reuse_scope: "global",
        generation_input_json: JSON.parse(
          toStableJson({
            learning_field_id: params.learningFieldId,
            field_title: params.fieldTitle,
            start_level: params.startLevel,
            target_level: params.targetLevel,
            level_order: ["beginner", "basic", "intermediate", "advanced", "expert"],
            lessons_per_adjacent_level_gap: LESSONS_PER_LEVEL_GAP,
            level_distance: levelDistance,
            total_steps: fixedTotalSteps,
            requested_desired_total_steps: params.desiredTotalSteps ?? null,
          }),
        ),
        template_json: JSON.parse(
          toStableJson({
            journey_plan: normalizedSteps.map((step) => ({
              title: step.step_title,
              description: step.step_description,
              objective: step.learning_objective,
              difficulty: step.difficulty_level,
              skill_tags: step.skill_tags,
              concept_tags: step.concept_tags,
            })),
            total_steps: normalizedTotalSteps,
          }),
        ),
        ai_provider: provenance.provider,
        ai_model: provenance.model,
        ai_prompt_version: provenance.prompt_version,
        ai_generated_at: provenance.generated_at,
        created_by_user_id: params.userId,
      })
      .select("id, template_version")
      .limit(1)
      .maybeSingle();

    if (insertTemplateError) {
      throw insertTemplateError;
    }

    templateId = toStringValue((insertedTemplate as GenericRecord | null)?.id) || null;
    templateVersion = Math.max(
      1,
      Math.floor(toNumberValue((insertedTemplate as GenericRecord | null)?.template_version) || 1),
    );

    if (templateId) {
      const stepRows = normalizedSteps.map((step) => ({
        template_id: templateId,
        step_number: step.step_number,
        step_title: step.step_title,
        step_description: step.step_description,
        learning_objective: step.learning_objective,
        difficulty_level: step.difficulty_level,
        skill_tags_json: step.skill_tags,
        concept_tags_json: step.concept_tags,
        metadata_json: {
          created_by: JOURNEY_TEMPLATE_PROMPT_VERSION,
        },
        source_hash: sha256Hash({
          template_id: templateId,
          step_number: step.step_number,
          step_title: step.step_title,
          difficulty_level: step.difficulty_level,
          skill_tags: step.skill_tags,
          concept_tags: step.concept_tags,
        }),
      }));

      if (stepRows.length > 0) {
        const { error: insertStepsError } = await supabaseAdmin
          .from("learning_field_template_steps")
          .insert(stepRows);
        if (insertStepsError) {
          throw insertStepsError;
        }
      }

      console.info("[journey_ai] template_created", {
        learning_field_id: params.learningFieldId,
        template_id: templateId,
        template_version: templateVersion,
        total_steps: normalizedTotalSteps,
        source_hash: sourceHash,
      });
    }
  } catch (error) {
    if (!isMissingRelationOrColumnError(error)) {
      console.error("[journey_ai] template_creation_failed", {
        learning_field_id: params.learningFieldId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    template_id: templateId,
    template_version: templateVersion,
    total_steps: normalizedTotalSteps,
    source_hash: sourceHash,
    reused_existing: false,
    ai_provenance: provenance,
    steps: normalizedSteps,
  };
}

export async function instantiateUserLearningJourney(params: {
  userId: string;
  journeyPathId: string;
  learningFieldId: string;
  startLevel: string;
  targetLevel: string;
  totalSteps: number;
  currentStep: number;
  template: JourneyTemplateResult;
}) {
  try {
    console.info("[migration_cleanup] replaced_with_source_of_truth", {
      old_table: "user_learning_journeys",
      new_table: "journey_paths",
      journey_path_id: params.journeyPathId,
      user_id: params.userId,
    });

    const { error } = await supabaseAdmin
      .from("journey_paths")
      .update({
        user_id: params.userId,
        learning_field_id: params.learningFieldId,
        starting_point: params.startLevel,
        destination: params.targetLevel,
        total_steps: Math.max(1, params.totalSteps),
      })
      .eq("id", params.journeyPathId)
      .eq("user_id", params.userId)
      .eq("learning_field_id", params.learningFieldId);

    if (error) {
      throw error;
    }

    console.info("[journey_ai] user_instance_created", {
      user_id: params.userId,
      journey_path_id: params.journeyPathId,
      learning_field_id: params.learningFieldId,
      template_id: params.template.template_id,
      reused_existing: params.template.reused_existing,
    });
  } catch (error) {
    if (!isMissingRelationOrColumnError(error)) {
      console.warn("[journey_ai] user_instance_creation_failed", {
        user_id: params.userId,
        journey_path_id: params.journeyPathId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
