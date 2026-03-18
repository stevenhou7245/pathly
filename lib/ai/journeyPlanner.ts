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
import { loadUserResourcePreferenceProfile, type ResourcePreferenceProfile } from "@/lib/ai/preferences";
import { generateStructuredJson, type AiProvenance } from "@/lib/ai/provider";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type GenericRecord = Record<string, unknown>;

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
  template_name: z.string().min(1),
  total_steps: z.number().int().min(1).max(20),
  steps: z
    .array(
      z.object({
        step_number: z.number().int().min(1),
        step_title: z.string().min(1),
        step_description: z.string().min(1),
        learning_objective: z.string().min(1),
        difficulty_level: z
          .enum(["beginner", "basic", "intermediate", "advanced", "expert"])
          .default("beginner"),
        skill_tags: z.array(z.string()).default([]),
        concept_tags: z.array(z.string()).default([]),
      }),
    )
    .min(1),
});

function normalizeSteps(steps: JourneyPlanStep[], totalSteps: number) {
  const sorted = [...steps].sort((a, b) => a.step_number - b.step_number);
  const trimmed = sorted.slice(0, Math.max(1, totalSteps));

  return trimmed.map((step, index) => ({
    step_number: index + 1,
    step_title: step.step_title.trim() || `Step ${index + 1}`,
    step_description: step.step_description.trim() || `Complete step ${index + 1}.`,
    learning_objective: step.learning_objective.trim() || `Practice step ${index + 1}.`,
    difficulty_level: normalizeDifficultyBand(step.difficulty_level),
    skill_tags: Array.from(new Set(step.skill_tags.map((tag) => tag.trim()).filter(Boolean))),
    concept_tags: Array.from(new Set(step.concept_tags.map((tag) => tag.trim()).filter(Boolean))),
  }));
}

function levelRank(level: string) {
  const normalized = level.toLowerCase().trim();
  if (normalized === "beginner") return 1;
  if (normalized === "basic") return 2;
  if (normalized === "intermediate") return 3;
  if (normalized === "advanced") return 4;
  if (normalized === "expert") return 5;
  return 3;
}

function estimateSteps(startLevel: string, targetLevel: string, desiredTotalSteps?: number | null) {
  if (desiredTotalSteps && Number.isFinite(desiredTotalSteps) && desiredTotalSteps > 0) {
    return Math.max(1, Math.min(20, Math.floor(desiredTotalSteps)));
  }
  const distance = Math.max(1, Math.abs(levelRank(targetLevel) - levelRank(startLevel)) + 1);
  return Math.max(3, Math.min(10, distance * 2));
}

function buildDeterministicJourneyPlan(input: {
  fieldTitle: string;
  startLevel: string;
  targetLevel: string;
  desiredTotalSteps?: number | null;
}): z.infer<typeof journeyTemplateOutputSchema> {
  const totalSteps = estimateSteps(input.startLevel, input.targetLevel, input.desiredTotalSteps);
  const steps: z.infer<typeof journeyTemplateOutputSchema>["steps"] = [];

  const difficultyByIndex: DifficultyBand[] = [
    "beginner",
    "basic",
    "intermediate",
    "advanced",
    "expert",
  ];

  for (let i = 0; i < totalSteps; i += 1) {
    const progress = totalSteps <= 1 ? 0 : i / (totalSteps - 1);
    const difficultyIndex = Math.min(4, Math.max(0, Math.floor(progress * 5)));
    const difficulty = difficultyByIndex[difficultyIndex];
    const stepNo = i + 1;
    steps.push({
      step_number: stepNo,
      step_title: `${input.fieldTitle} Milestone ${stepNo}`,
      step_description: `Build a stronger ${input.fieldTitle} foundation with milestone ${stepNo}.`,
      learning_objective: `Reach milestone ${stepNo} from ${input.startLevel} toward ${input.targetLevel}.`,
      difficulty_level: difficulty,
      skill_tags: [`${input.fieldTitle.toLowerCase()}-core`, `milestone-${stepNo}`],
      concept_tags: [`concept-${stepNo}`, `level-${difficulty}`],
    });
  }

  return {
    template_name: `${input.fieldTitle} ${input.startLevel} to ${input.targetLevel}`,
    total_steps: totalSteps,
    steps,
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
  const templateSourceHash = sha256Hash({
    learning_field_id: params.learningFieldId,
    start_level: params.startLevel,
    target_level: params.targetLevel,
    desired_total_steps: params.desiredTotalSteps ?? null,
    prompt_version: "journey_template_v1",
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
          console.info("[journey_ai] template_reuse", {
            learning_field_id: params.learningFieldId,
            template_id: templateId,
            start_level: params.startLevel,
            target_level: params.targetLevel,
          });
          return {
            template_id: templateId,
            template_version: Math.max(1, Math.floor(toNumberValue((existingTemplate as GenericRecord).template_version))),
            total_steps: loadedSteps.length,
            source_hash: toStringValue((existingTemplate as GenericRecord).source_hash) || templateSourceHash,
            reused_existing: true,
            ai_provenance: {
              provider: "deterministic",
              model: toStringValue((existingTemplate as GenericRecord).ai_model) || "reused-template",
              prompt_version:
                toStringValue((existingTemplate as GenericRecord).ai_prompt_version) || "journey_template_v1",
              generated_at:
                toStringValue((existingTemplate as GenericRecord).ai_generated_at) || new Date().toISOString(),
              fallback_used: false,
              failure_reason: null,
            },
            steps: loadedSteps,
          };
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

  const preferenceProfile =
    params.userPreferenceProfile ?? (await loadUserResourcePreferenceProfile(params.userId));
  const { output, provenance } = await generateStructuredJson({
    feature: "journey_template",
    promptVersion: "journey_template_v1",
    systemInstruction: [
      "You are a learning journey planner.",
      "Return a concise JSON journey plan only.",
      "Each step must include title, description, objective, difficulty, skill_tags and concept_tags.",
      "Create progressively harder steps from start to target level.",
    ].join(" "),
    input: {
      learning_field_id: params.learningFieldId,
      field_title: params.fieldTitle,
      start_level: params.startLevel,
      target_level: params.targetLevel,
      desired_total_steps: params.desiredTotalSteps ?? null,
      user_preference_profile: preferenceProfile,
    },
    outputSchema: journeyTemplateOutputSchema,
    fallback: () =>
      buildDeterministicJourneyPlan({
        fieldTitle: params.fieldTitle,
        startLevel: params.startLevel,
        targetLevel: params.targetLevel,
        desiredTotalSteps: params.desiredTotalSteps ?? null,
      }),
  });

  const normalizedSteps = normalizeSteps(
    output.steps as JourneyPlanStep[],
    Math.max(1, Math.floor(output.total_steps)),
  );
  const normalizedTotalSteps = normalizedSteps.length;
  const sourceHash = sha256Hash({
    base_hash: templateSourceHash,
    output: {
      template_name: output.template_name,
      total_steps: normalizedTotalSteps,
      steps: normalizedSteps,
    },
  });

  let templateId: string | null = null;
  let templateVersion = 1;

  try {
    const { data: insertedTemplate, error: insertTemplateError } = await supabaseAdmin
      .from("learning_field_templates")
      .insert({
        learning_field_id: params.learningFieldId,
        template_name: output.template_name,
        start_level: params.startLevel,
        target_level: params.targetLevel,
        desired_total_steps: params.desiredTotalSteps ?? null,
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
            desired_total_steps: params.desiredTotalSteps ?? null,
            user_preference_profile: preferenceProfile,
          }),
        ),
        template_json: JSON.parse(
          toStableJson({
            template_name: output.template_name,
            total_steps: normalizedTotalSteps,
            steps: normalizedSteps,
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
          created_by: "journey_template_v1",
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
    const payload = {
      user_id: params.userId,
      journey_path_id: params.journeyPathId,
      learning_field_id: params.learningFieldId,
      learning_field_template_id: params.template.template_id,
      start_level: params.startLevel,
      target_level: params.targetLevel,
      total_steps: params.totalSteps,
      current_step: Math.max(1, params.currentStep),
      status: params.currentStep >= params.totalSteps ? "completed" : "active",
      template_version: params.template.template_version,
      source_hash: params.template.source_hash,
      generation_input_json: {
        start_level: params.startLevel,
        target_level: params.targetLevel,
      },
      adaptation_json: {
        reused_existing: params.template.reused_existing,
      },
      ai_provider: params.template.ai_provenance.provider,
      ai_model: params.template.ai_provenance.model,
      ai_prompt_version: params.template.ai_provenance.prompt_version,
      ai_generated_at: params.template.ai_provenance.generated_at,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabaseAdmin
      .from("user_learning_journeys")
      .upsert(payload, {
        onConflict: "user_id,journey_path_id",
      });

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
