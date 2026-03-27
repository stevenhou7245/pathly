import { z } from "zod";
import { generateLearningStepsPlan, type LearningStepResource } from "@/lib/ai/learningSteps";
import { calculateTotalSteps, normalizeLearningLevel } from "@/lib/learningPath";
import { installAiPipelineDebugLogFilter } from "@/lib/aiPipelineDebugLogging";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isMissingRelationOrColumnError, sha256Hash, toSlug } from "@/lib/ai/common";

installAiPipelineDebugLogFilter();

type GenericRecord = Record<string, unknown>;

export type LearningStepStatus = "locked" | "current" | "completed";
export type LearningStepGenerationSource = "ai" | "fallback" | "database";

export type LearningStepRow = {
  id: string;
  user_learning_field_id: string;
  step_number: number;
  title: string;
  summary: string | null;
  resources: LearningStepResource[];
  status: LearningStepStatus;
  generation_source: LearningStepGenerationSource;
  started_at: string | null;
  completed_at: string | null;
};

type LearningStepListResult = {
  steps: LearningStepRow[];
  storageUsable: boolean;
};

const stepCompleteBodySchema = z.object({
  step_number: z.number().int().min(1),
});

function toStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function toNumberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function normalizeStepStatus(value: unknown): LearningStepStatus {
  if (value === "completed" || value === "current" || value === "locked") {
    return value;
  }
  return "locked";
}

function normalizeGenerationSource(value: unknown): LearningStepGenerationSource {
  if (value === "ai" || value === "fallback" || value === "database") {
    return value;
  }
  return "database";
}

function toErrorLogDetails(error: unknown) {
  const record = (error ?? {}) as GenericRecord;
  return {
    message: error instanceof Error ? error.message : toStringValue(record.message) || String(error),
    code: toStringValue(record.code) || null,
    details: toStringValue(record.details) || null,
    hint: toStringValue(record.hint) || null,
    stack: error instanceof Error ? error.stack : null,
    raw_error: error,
  };
}

function isDirectResourceUrl(url: string) {
  const normalized = url.trim().toLowerCase();
  if (!/^https?:\/\//.test(normalized)) {
    return false;
  }
  if (
    /google\.[^/]+\/search|bing\.com\/search|duckduckgo\.com\/\?q=|example\.com/.test(normalized)
  ) {
    return false;
  }
  return true;
}

function isGenericFallbackTitle(title: string) {
  const normalized = title.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  return (
    /applied practice|advanced mastery|advanced projects|guided practice|performance practice|foundations\s+\d+|course\s+\d+/.test(
      normalized,
    ) ||
    /step\s+\d+/.test(normalized)
  );
}

function isGenericCourseTitle(params: { title: string; fieldTitle: string; stepNumber: number }) {
  const normalized = params.title.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  const normalizedField = params.fieldTitle.trim().toLowerCase();
  return (
    /milestone\s+\d+$/i.test(normalized) ||
    /course\s+\d+$/i.test(normalized) ||
    /applied practice|advanced mastery|guided practice|performance practice/.test(normalized) ||
    /foundations\s+\d+$/.test(normalized) ||
    normalized === `${normalizedField} course ${params.stepNumber}`.trim()
  );
}

function normalizeResources(resourcesValue: unknown): LearningStepResource[] {
  if (!Array.isArray(resourcesValue)) {
    return [];
  }

  return resourcesValue
    .map((resource) => {
      const row = (resource ?? {}) as GenericRecord;
      const typeRaw = toStringValue(row.type).toLowerCase();
      const type: LearningStepResource["type"] =
        typeRaw === "video" ||
        typeRaw === "article" ||
        typeRaw === "document" ||
        typeRaw === "interactive" ||
        typeRaw === "tutorial"
          ? typeRaw
          : "tutorial";
      const title = (toStringValue(row.title) || toStringValue(row.name)).trim();
      const url = toStringValue(row.url).trim();
      if (!url) {
        return null;
      }
      return {
        type,
        title: title || "Resource",
        url,
        provider: toStringValue(row.provider).trim() || null,
        difficulty: toStringValue(row.difficulty).trim() || null,
        estimated_minutes: (() => {
          const minutes = Math.max(0, Math.floor(toNumberValue(row.estimated_minutes) || 0));
          return minutes > 0 ? minutes : null;
        })(),
        ai_selected: row.ai_selected === false ? false : true,
        ai_generated_at: toStringValue(row.ai_generated_at).trim() || null,
        reason: toStringValue(row.reason).trim() || null,
        status:
          toStringValue(row.status) === "invalid"
            ? "invalid"
            : toStringValue(row.status) === "unavailable"
              ? "unavailable"
              : "valid",
      } satisfies LearningStepResource;
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .slice(0, 3);
}

function mapStepRow(row: GenericRecord): LearningStepRow {
  return {
    id: toStringValue(row.id),
    user_learning_field_id: toStringValue(row.user_learning_field_id),
    step_number: Math.max(1, Math.floor(toNumberValue(row.step_number) || 1)),
    title: toStringValue(row.title) || "Untitled Step",
    summary: toNullableString(row.summary),
    resources: normalizeResources(row.resources_json),
    status: normalizeStepStatus(row.status),
    generation_source: normalizeGenerationSource(row.generation_source),
    started_at: toNullableString(row.started_at),
    completed_at: toNullableString(row.completed_at),
  };
}

function getStepStatus(params: {
  stepNumber: number;
  currentStepIndex: number;
  totalSteps: number;
}): LearningStepStatus {
  if (params.currentStepIndex > params.totalSteps) {
    return "completed";
  }
  if (params.stepNumber < params.currentStepIndex) {
    return "completed";
  }
  if (params.stepNumber === params.currentStepIndex) {
    return "current";
  }
  return "locked";
}

async function getUserLearningField(params: {
  userId: string;
  userFieldId: string;
}): Promise<GenericRecord | null> {
  const { data, error } = await supabaseAdmin
    .from("user_learning_fields")
    .select("*")
    .eq("id", params.userFieldId)
    .eq("user_id", params.userId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load user learning field.");
  }

  return (data as GenericRecord | null) ?? null;
}

async function getLearningFieldTitle(fieldId: string) {
  const { data, error } = await supabaseAdmin
    .from("learning_fields")
    .select("id, title")
    .eq("id", fieldId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load learning field metadata.");
  }

  const title = toStringValue((data as GenericRecord | null)?.title).trim();
  return title || "Learning";
}

async function listLearningStepsForField(userFieldId: string): Promise<LearningStepListResult> {
  const { data, error } = await supabaseAdmin
    .from("learning_steps")
    .select("*")
    .eq("user_learning_field_id", userFieldId)
    .order("step_number", { ascending: true });

  if (error) {
    console.error("[learning_steps] list_failed", {
      user_field_id: userFieldId,
      ...toErrorLogDetails(error),
    });

    if (isMissingRelationOrColumnError(error)) {
      return {
        steps: [],
        storageUsable: false,
      };
    }
    throw new Error("Failed to load learning steps.");
  }

  const steps = ((data ?? []) as GenericRecord[]).map(mapStepRow);
  console.info("[learning_steps] list_result", {
    user_field_id: userFieldId,
    row_count: steps.length,
  });
  return {
    steps,
    storageUsable: true,
  };
}

async function storeGenerationDebugOnUserField(params: {
  userFieldId: string;
  userId: string;
  generationSource: LearningStepGenerationSource;
  generatedCourseJson: unknown;
}) {
  const payload = {
    generated_course_json: params.generatedCourseJson,
    generated_course_source: params.generationSource,
    generated_course_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin
    .from("user_learning_fields")
    .update(payload)
    .eq("id", params.userFieldId)
    .eq("user_id", params.userId);

  if (error) {
    console.warn("[learning_steps] store_generation_debug_failed", {
      user_id: params.userId,
      user_field_id: params.userFieldId,
      reason: error.message,
    });
  }
}

function normalizeResourceTypeFromCourse(value: unknown): LearningStepResource["type"] {
  const normalized = toStringValue(value).trim().toLowerCase();
  if (
    normalized === "video" ||
    normalized === "article" ||
    normalized === "document" ||
    normalized === "interactive" ||
    normalized === "tutorial"
  ) {
    return normalized;
  }
  return "tutorial";
}

function normalizeReusableResourceUrl(rawUrl: string, fallbackQuery: string) {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^www\./i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed || fallbackQuery)}`;
}

function buildReusableFallbackResources(params: { fieldTitle: string; stepTitle: string }) {
  const keyword = `${params.fieldTitle} ${params.stepTitle}`.trim();
  const encodedKeyword = encodeURIComponent(keyword);
  const encodedTutorial = encodeURIComponent(`${keyword} hands on tutorial`);
  const encodedArticle = encodeURIComponent(`${keyword} guide`);
  return [
    {
      type: "video" as const,
      title: `${params.stepTitle} Video`,
      url: `https://www.youtube.com/results?search_query=${encodedKeyword}`,
    },
    {
      type: "article" as const,
      title: `${params.stepTitle} Reading`,
      url: `https://duckduckgo.com/?q=${encodedArticle}`,
    },
    {
      type: "tutorial" as const,
      title: `${params.stepTitle} Practice`,
      url: `https://www.coursera.org/search?query=${encodedTutorial}`,
    },
  ];
}

async function getReusableStepsFromCourses(params: {
  learningFieldId: string;
  fieldTitle: string;
  totalSteps: number;
}) {
  const { data: courses, error: coursesError } = await supabaseAdmin
    .from("courses")
    .select("id, title, description, created_at")
    .eq("learning_field_id", params.learningFieldId)
    .order("created_at", { ascending: true })
    .limit(params.totalSteps);

  if (coursesError) {
    console.warn("[learning_steps] reusable_courses_lookup_failed", {
      learning_field_id: params.learningFieldId,
      ...toErrorLogDetails(coursesError),
    });
    return [];
  }

  const courseRows = (courses ?? []) as GenericRecord[];
  if (courseRows.length === 0) {
    console.info("[learning_steps] reusable_courses_lookup_empty", {
      learning_field_id: params.learningFieldId,
      total_steps: params.totalSteps,
    });
    return [];
  }

  const courseIds = courseRows.map((row) => toStringValue(row.id)).filter(Boolean);
  const resourcesByCourseId = new Map<string, LearningStepResource[]>();
  const { data: optionRows, error: optionRowsError } = await supabaseAdmin
    .from("course_resource_options")
    .select(
      "course_id, option_no, title, resource_type, provider, url, summary, difficulty, estimated_minutes, ai_selected, ai_generated_at",
    )
    .in("course_id", courseIds)
    .order("option_no", { ascending: true });
  if (optionRowsError) {
    console.warn("[learning_steps] reusable_course_options_lookup_failed", {
      learning_field_id: params.learningFieldId,
      ...toErrorLogDetails(optionRowsError),
    });
  } else {
    ((optionRows ?? []) as GenericRecord[]).forEach((optionRow) => {
      const courseId = toStringValue(optionRow.course_id);
      if (!courseId) {
        return;
      }
      const title = toStringValue(optionRow.title).trim() || "Resource";
      const normalizedUrl = normalizeReusableResourceUrl(
        toStringValue(optionRow.url),
        `${params.fieldTitle} ${title}`,
      );
      if (!normalizedUrl || !isDirectResourceUrl(normalizedUrl)) {
        return;
      }
      const mapped: LearningStepResource = {
        type: normalizeResourceTypeFromCourse(optionRow.resource_type),
        title,
        url: normalizedUrl,
        provider: toStringValue(optionRow.provider).trim() || null,
        difficulty: toStringValue(optionRow.difficulty).trim() || null,
        estimated_minutes: Math.max(0, Math.floor(toNumberValue(optionRow.estimated_minutes) || 0)) || null,
        ai_selected: optionRow.ai_selected === false ? false : true,
        ai_generated_at: toStringValue(optionRow.ai_generated_at).trim() || null,
        reason: toStringValue(optionRow.summary).trim() || null,
        status: "valid",
      };
      const existing = resourcesByCourseId.get(courseId) ?? [];
      existing.push(mapped);
      resourcesByCourseId.set(courseId, existing);
    });
  }

  console.info("[resource_read] source_table_used", {
    table: "course_resource_options",
    learning_field_id: params.learningFieldId,
  });

  const steps = courseRows
    .slice(0, params.totalSteps)
    .map((courseRow, index) => {
      const courseId = toStringValue(courseRow.id);
      const stepNumber = index + 1;
      const title = toStringValue(courseRow.title).trim() || `${params.fieldTitle} Step ${stepNumber}`;
      const summary =
        toStringValue(courseRow.description).trim() || `Complete ${title} to progress.`;
      const mappedResources = (resourcesByCourseId.get(courseId) ?? []).slice(0, 3);
      if (mappedResources.length < 3) {
        const fallback = buildReusableFallbackResources({
          fieldTitle: params.fieldTitle,
          stepTitle: title,
        });
        for (const fallbackItem of fallback) {
          if (mappedResources.length >= 3) {
            break;
          }
          const exists = mappedResources.some(
            (resource) =>
              resource.url === fallbackItem.url || resource.title === fallbackItem.title,
          );
          if (exists) {
            continue;
          }
          mappedResources.push(fallbackItem);
        }
      }
      return {
        step_number: stepNumber,
        title,
        summary,
        resources: mappedResources,
      };
    });

  console.info("[learning_steps] reusable_courses_resolved", {
    learning_field_id: params.learningFieldId,
    field_title: params.fieldTitle,
    total_steps_requested: params.totalSteps,
    reusable_steps_count: steps.length,
  });

  if (steps.length < params.totalSteps) {
    console.info("[learning_steps] reusable_courses_not_enough_steps", {
      learning_field_id: params.learningFieldId,
      reusable_steps_count: steps.length,
      total_steps_requested: params.totalSteps,
    });
    return [];
  }

  return steps;
}

async function syncCoursesFromSteps(params: {
  learningFieldId: string;
  fieldTitle: string;
  steps: Array<{ step_number: number; title: string; summary: string; resources: LearningStepResource[] }>;
}) {
  console.info("[learning_steps] sync_courses_from_steps_start", {
    learning_field_id: params.learningFieldId,
    field_title: params.fieldTitle,
    step_count: params.steps.length,
  });
  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from("courses")
    .select("id, title, created_at")
    .eq("learning_field_id", params.learningFieldId)
    .order("created_at", { ascending: true });

  if (existingError) {
    console.warn("[learning_steps] sync_courses_lookup_failed", {
      learning_field_id: params.learningFieldId,
      reason: existingError.message,
    });
    return;
  }

  const existing = (existingRows ?? []) as GenericRecord[];
  const nowIso = new Date().toISOString();
  const fieldSlug = toSlug(params.fieldTitle) || "learning";

  for (let index = 0; index < params.steps.length; index += 1) {
    const step = params.steps[index];
    const course = existing[index] ?? null;
    const difficulty =
      index <= 1
        ? "basic"
        : index < Math.max(2, Math.floor(params.steps.length * 0.7))
        ? "intermediate"
        : "advanced";

    let courseId = "";
    if (course) {
      const existingTitle = toStringValue(course.title).trim();
      const shouldReplaceTitle = isGenericCourseTitle({
        title: existingTitle,
        fieldTitle: params.fieldTitle,
        stepNumber: step.step_number,
      });

      const { error: updateError } = await supabaseAdmin
        .from("courses")
        .update({
          title: shouldReplaceTitle ? step.title : existingTitle,
          description: step.summary,
          difficulty_level: difficulty,
        })
        .eq("id", toStringValue(course.id));
      if (updateError) {
        console.warn("[learning_steps] sync_course_update_failed", {
          course_id: toStringValue(course.id),
          reason: updateError.message,
        });
        continue;
      }
      courseId = toStringValue(course.id);
    } else {
      const skeletonInsertPayload = {
        learning_field_id: params.learningFieldId,
        title: step.title,
        slug: `${fieldSlug}-course-${step.step_number}-${Date.now()}`,
        description: step.summary,
        estimated_minutes: 35,
        difficulty_level: difficulty,
        resource_generation_status: "pending",
        is_resource_generated: false,
        resources_generated_at: null,
        created_at: nowIso,
      };

      let { data: inserted, error: insertError } = await supabaseAdmin
        .from("courses")
        .insert(skeletonInsertPayload)
        .select("id")
        .limit(1)
        .maybeSingle();

      if (insertError && isMissingRelationOrColumnError(insertError)) {
        ({ data: inserted, error: insertError } = await supabaseAdmin
          .from("courses")
          .insert({
            learning_field_id: params.learningFieldId,
            title: step.title,
            slug: `${fieldSlug}-course-${step.step_number}-${Date.now()}`,
            description: step.summary,
            estimated_minutes: 35,
            difficulty_level: difficulty,
            created_at: nowIso,
          })
          .select("id")
          .limit(1)
          .maybeSingle());
      }

      if (insertError || !inserted) {
        console.warn("[learning_steps] sync_course_insert_failed", {
          learning_field_id: params.learningFieldId,
          step_number: step.step_number,
          reason: insertError?.message ?? "Unknown insert error.",
        });
        continue;
      }
      courseId = toStringValue((inserted as GenericRecord).id);
    }
  }
  console.info("[learning_steps] sync_courses_from_steps_success", {
    learning_field_id: params.learningFieldId,
    field_title: params.fieldTitle,
    step_count: params.steps.length,
  });
}

function buildEphemeralStepRows(params: {
  userFieldId: string;
  totalSteps: number;
  currentStepIndex: number;
  generationSource: LearningStepGenerationSource;
  steps: Array<{ step_number: number; title: string; summary: string; resources: LearningStepResource[] }>;
}): LearningStepRow[] {
  const nowIso = new Date().toISOString();
  return params.steps
    .slice(0, params.totalSteps)
    .map((step) => {
      const status = getStepStatus({
        stepNumber: step.step_number,
        currentStepIndex: params.currentStepIndex,
        totalSteps: params.totalSteps,
      });
      return {
        id: `ephemeral-${params.userFieldId}-${step.step_number}`,
        user_learning_field_id: params.userFieldId,
        step_number: step.step_number,
        title: step.title,
        summary: step.summary,
        resources: step.resources,
        status,
        generation_source: params.generationSource,
        started_at: status === "current" || status === "completed" ? nowIso : null,
        completed_at: status === "completed" ? nowIso : null,
      } satisfies LearningStepRow;
    });
}

export async function ensureLearningStepsForUserField(params: {
  userId: string;
  userFieldId: string;
  forceRegenerate?: boolean;
}) {
  const userField = await getUserLearningField({
    userId: params.userId,
    userFieldId: params.userFieldId,
  });
  if (!userField) {
    return null;
  }

  const fieldId = toStringValue(userField.field_id);
  const currentLevel = normalizeLearningLevel(userField.current_level) ?? "Beginner";
  const targetLevel = normalizeLearningLevel(userField.target_level) ?? currentLevel;
  console.info("[learning_steps] ensure_requested", {
    user_id: params.userId,
    user_field_id: params.userFieldId,
    learning_field_id: fieldId,
    current_level: currentLevel,
    target_level: targetLevel,
    force_regenerate: Boolean(params.forceRegenerate),
  });

  const derivedTotalSteps = calculateTotalSteps(currentLevel, targetLevel);
  const currentStepRaw = Math.max(
    1,
    Math.floor(toNumberValue(userField.current_step_index) || 1),
  );
  const currentStepIndex = Math.min(derivedTotalSteps + 1, currentStepRaw);
  const storedTotalSteps = Math.max(
    0,
    Math.floor(toNumberValue(userField.total_steps)),
  );

  if (storedTotalSteps !== derivedTotalSteps || currentStepRaw !== currentStepIndex) {
    await supabaseAdmin
      .from("user_learning_fields")
      .update({
        total_steps: derivedTotalSteps,
        current_step_index: currentStepIndex,
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.userFieldId)
      .eq("user_id", params.userId);
  }

  const existingStepList = await listLearningStepsForField(params.userFieldId);
  const existingSteps = existingStepList.steps;
  const hasGenericTitles = existingSteps.some((step) => isGenericFallbackTitle(step.title));
  const shouldRegenerate =
    params.forceRegenerate === true ||
    !existingStepList.storageUsable ||
    existingSteps.length === 0 ||
    existingSteps.length < derivedTotalSteps ||
    hasGenericTitles;
  console.info("[learning_steps] existing_steps_check", {
    user_id: params.userId,
    user_field_id: params.userFieldId,
    existing_steps_count: existingSteps.length,
    derived_total_steps: derivedTotalSteps,
    should_regenerate: shouldRegenerate,
    storage_usable: existingStepList.storageUsable,
    has_generic_titles: hasGenericTitles,
  });
  if (shouldRegenerate) {
    console.info("[learning_steps] cache_miss", {
      user_id: params.userId,
      user_field_id: params.userFieldId,
      learning_field_id: fieldId,
      reason: "missing_or_incomplete_learning_steps",
    });
  } else {
    console.info("[learning_steps] cache_hit", {
      user_id: params.userId,
      user_field_id: params.userFieldId,
      learning_field_id: fieldId,
      step_count: existingSteps.length,
    });
  }
  const fieldTitle = fieldId ? await getLearningFieldTitle(fieldId) : "Learning";

  if (!shouldRegenerate) {
    await syncCoursesFromSteps({
      learningFieldId: fieldId,
      fieldTitle,
      steps: existingSteps.map((step) => ({
        step_number: step.step_number,
        title: step.title,
        summary: step.summary ?? "",
        resources: step.resources,
      })),
    });

    const normalized = await syncLearningStepStatuses({
      userFieldId: params.userFieldId,
      totalSteps: derivedTotalSteps,
      currentStepIndex,
    });
    await storeGenerationDebugOnUserField({
      userFieldId: params.userFieldId,
      userId: params.userId,
      generationSource: "database",
      generatedCourseJson: {
        source: "database",
        reused_existing_steps: true,
        current_level: currentLevel,
        target_level: targetLevel,
        total_steps: derivedTotalSteps,
      },
    });
    return {
      userFieldId: params.userFieldId,
      totalSteps: derivedTotalSteps,
      currentStepIndex,
      steps: normalized,
      generated: false,
      generationSource: "database" as const,
    };
  }

  const reusableCourseSteps = fieldId
    ? await getReusableStepsFromCourses({
        learningFieldId: fieldId,
        fieldTitle,
        totalSteps: derivedTotalSteps,
      })
    : [];
  if (reusableCourseSteps.length >= derivedTotalSteps) {
    console.info("[learning_steps] reuse_existing_courses", {
      user_id: params.userId,
      user_field_id: params.userFieldId,
      learning_field_id: fieldId,
      reusable_steps_count: reusableCourseSteps.length,
      total_steps: derivedTotalSteps,
    });

    const nowIso = new Date().toISOString();
    const upsertRows = reusableCourseSteps.map((step) => {
      const stepStatus = getStepStatus({
        stepNumber: step.step_number,
        currentStepIndex,
        totalSteps: derivedTotalSteps,
      });
      return {
        user_learning_field_id: params.userFieldId,
        step_number: step.step_number,
        title: step.title,
        summary: step.summary,
        resources_json: step.resources,
        status: stepStatus,
        generation_source: "database" as const,
        started_at: stepStatus === "current" ? nowIso : null,
        completed_at: stepStatus === "completed" ? nowIso : null,
        source_hash: sha256Hash({
          user_field_id: params.userFieldId,
          step_number: step.step_number,
          title: step.title,
          summary: step.summary,
          resources: step.resources,
        }),
        artifact_version: 1,
        ai_provider: null,
        ai_model: null,
        ai_prompt_version: null,
        ai_generated_at: null,
        updated_at: nowIso,
      };
    });

    let canPersistToLearningSteps = existingStepList.storageUsable;
    if (canPersistToLearningSteps && upsertRows.length > 0) {
      const { error: upsertError } = await supabaseAdmin
        .from("learning_steps")
        .upsert(upsertRows, {
          onConflict: "user_learning_field_id,step_number",
        });
      if (upsertError) {
        console.error("[learning_steps] reuse_courses_upsert_failed", {
          user_id: params.userId,
          user_field_id: params.userFieldId,
          ...toErrorLogDetails(upsertError),
        });
        if (isMissingRelationOrColumnError(upsertError)) {
          canPersistToLearningSteps = false;
        } else {
          throw new Error("Failed to upsert reusable course steps.");
        }
      }
    }
    if (canPersistToLearningSteps) {
      const { error: deleteExtraError } = await supabaseAdmin
        .from("learning_steps")
        .delete()
        .eq("user_learning_field_id", params.userFieldId)
        .gt("step_number", derivedTotalSteps);
      if (deleteExtraError) {
        console.warn("[learning_steps] reuse_courses_delete_extra_failed", {
          user_field_id: params.userFieldId,
          ...toErrorLogDetails(deleteExtraError),
        });
      }
    }

    await storeGenerationDebugOnUserField({
      userFieldId: params.userFieldId,
      userId: params.userId,
      generationSource: "database",
      generatedCourseJson: {
        source: "database",
        reused_existing_courses: true,
        reusable_steps_count: reusableCourseSteps.length,
        total_steps: derivedTotalSteps,
        current_level: currentLevel,
        target_level: targetLevel,
        normalized_steps: reusableCourseSteps,
      },
    });

    const normalized = canPersistToLearningSteps
      ? await syncLearningStepStatuses({
          userFieldId: params.userFieldId,
          totalSteps: derivedTotalSteps,
          currentStepIndex,
        })
      : buildEphemeralStepRows({
          userFieldId: params.userFieldId,
          totalSteps: derivedTotalSteps,
          currentStepIndex,
          generationSource: "database",
          steps: reusableCourseSteps,
        });

    return {
      userFieldId: params.userFieldId,
      totalSteps: derivedTotalSteps,
      currentStepIndex,
      steps: normalized,
      generated: false,
      generationSource: "database" as const,
    };
  }

  const plan = await generateLearningStepsPlan({
    fieldTitle,
    startLevel: currentLevel,
    targetLevel: targetLevel,
    totalSteps: derivedTotalSteps,
  });
  console.info("[learning_steps] ai_generation_status", {
    user_id: params.userId,
    user_field_id: params.userFieldId,
    field_title: fieldTitle,
    ai_called: plan.debug.ai_called,
    generation_source: plan.generation_source,
    fallback_used: plan.ai_provenance.fallback_used,
    ai_provider: plan.ai_provenance.provider,
    ai_model: plan.ai_provenance.model,
    raw_ai_response_text: plan.debug.raw_ai_response_text,
    parsed_ai_json: plan.debug.parsed_ai_json,
  });
  const finalizedPlanSteps = plan.steps;
  console.info("[learning_steps] skeleton_generation_completed", {
    user_id: params.userId,
    user_field_id: params.userFieldId,
    learning_field_id: fieldId,
    step_count: finalizedPlanSteps.length,
    deferred_resource_generation: true,
  });
  const nowIso = new Date().toISOString();

  const upsertRows = finalizedPlanSteps.map((step) => {
    const stepStatus = getStepStatus({
      stepNumber: step.step_number,
      currentStepIndex,
      totalSteps: derivedTotalSteps,
    });
    return {
      user_learning_field_id: params.userFieldId,
      step_number: step.step_number,
      title: step.title,
      summary: step.summary,
      resources_json: step.resources,
      status: stepStatus,
      generation_source: plan.generation_source,
      started_at: stepStatus === "current" ? nowIso : null,
      completed_at: stepStatus === "completed" ? nowIso : null,
      source_hash: sha256Hash({
        user_field_id: params.userFieldId,
        step_number: step.step_number,
        title: step.title,
        summary: step.summary,
        resources: step.resources,
      }),
      artifact_version: 1,
      ai_provider: plan.ai_provenance.provider,
      ai_model: plan.ai_provenance.model,
      ai_prompt_version: plan.ai_provenance.prompt_version,
      ai_generated_at: plan.ai_provenance.generated_at,
      updated_at: nowIso,
    };
  });

  let canPersistToLearningSteps = existingStepList.storageUsable;
  if (canPersistToLearningSteps && upsertRows.length > 0) {
    console.info("[learning_steps] upsert_steps_start", {
      user_id: params.userId,
      user_field_id: params.userFieldId,
      row_count: upsertRows.length,
      generation_source: plan.generation_source,
    });
    const { error: upsertError } = await supabaseAdmin
      .from("learning_steps")
      .upsert(upsertRows, {
        onConflict: "user_learning_field_id,step_number",
      });
    if (upsertError) {
      console.error("[learning_steps] upsert_steps_failed", {
        user_id: params.userId,
        user_field_id: params.userFieldId,
        ...toErrorLogDetails(upsertError),
      });
      if (isMissingRelationOrColumnError(upsertError)) {
        canPersistToLearningSteps = false;
      } else {
        throw new Error("Failed to upsert learning steps.");
      }
    } else {
      console.info("[learning_steps] upsert_steps_success", {
        user_id: params.userId,
        user_field_id: params.userFieldId,
        row_count: upsertRows.length,
      });
    }
  }

  if (canPersistToLearningSteps) {
    const { error: deleteExtraError } = await supabaseAdmin
      .from("learning_steps")
      .delete()
      .eq("user_learning_field_id", params.userFieldId)
      .gt("step_number", derivedTotalSteps);
    if (deleteExtraError) {
      console.warn("[learning_steps] delete_extra_steps_failed", {
        user_field_id: params.userFieldId,
        ...toErrorLogDetails(deleteExtraError),
      });
    }
  }

  await syncCoursesFromSteps({
    learningFieldId: fieldId,
    fieldTitle,
    steps: finalizedPlanSteps,
  });
  await storeGenerationDebugOnUserField({
    userFieldId: params.userFieldId,
    userId: params.userId,
    generationSource: plan.generation_source,
    generatedCourseJson: {
      source: plan.generation_source,
      ai_called: plan.debug.ai_called,
      fallback_used: plan.ai_provenance.fallback_used,
      ai_provider: plan.ai_provenance.provider,
      ai_model: plan.ai_provenance.model,
      ai_prompt_version: plan.ai_provenance.prompt_version,
      ai_generated_at: plan.ai_provenance.generated_at,
      raw_ai_response_text: plan.debug.raw_ai_response_text,
      parsed_ai_json: plan.debug.parsed_ai_json,
      normalized_steps: finalizedPlanSteps,
      total_steps: derivedTotalSteps,
      current_level: currentLevel,
      target_level: targetLevel,
    },
  });

  const normalized = canPersistToLearningSteps
    ? await syncLearningStepStatuses({
        userFieldId: params.userFieldId,
        totalSteps: derivedTotalSteps,
        currentStepIndex,
      })
    : buildEphemeralStepRows({
        userFieldId: params.userFieldId,
        totalSteps: derivedTotalSteps,
        currentStepIndex,
        generationSource: plan.generation_source,
        steps: finalizedPlanSteps,
      });

  if (!canPersistToLearningSteps) {
    console.warn("[learning_steps] storage_unavailable_returning_ephemeral", {
      user_id: params.userId,
      user_field_id: params.userFieldId,
      learning_field_id: fieldId,
      step_count: normalized.length,
      reason: "learning_steps table/columns unavailable for persistence",
    });
  }

  console.info("[learning_steps] generated", {
    user_id: params.userId,
    user_field_id: params.userFieldId,
    learning_field_id: fieldId,
    total_steps: derivedTotalSteps,
    ai_provider: plan.ai_provenance.provider,
    ai_model: plan.ai_provenance.model,
    fallback_used: plan.ai_provenance.fallback_used,
  });

  return {
    userFieldId: params.userFieldId,
    totalSteps: derivedTotalSteps,
    currentStepIndex,
    steps: normalized,
    generated: true,
    generationSource: plan.generation_source,
  };
}

export async function syncLearningStepStatuses(params: {
  userFieldId: string;
  totalSteps: number;
  currentStepIndex: number;
}) {
  const listResult = await listLearningStepsForField(params.userFieldId);
  if (!listResult.storageUsable) {
    return [];
  }
  const rows = listResult.steps;
  const nowIso = new Date().toISOString();

  for (const row of rows) {
    const nextStatus = getStepStatus({
      stepNumber: row.step_number,
      currentStepIndex: params.currentStepIndex,
      totalSteps: params.totalSteps,
    });
    const nextStartedAt =
      row.started_at ?? (nextStatus === "current" || nextStatus === "completed" ? nowIso : null);
    const nextCompletedAt = nextStatus === "completed" ? row.completed_at ?? nowIso : null;

    if (
      row.status === nextStatus &&
      row.started_at === nextStartedAt &&
      row.completed_at === nextCompletedAt
    ) {
      continue;
    }

    const { error: updateError } = await supabaseAdmin
      .from("learning_steps")
      .update({
        status: nextStatus,
        started_at: nextStartedAt,
        completed_at: nextCompletedAt,
        updated_at: nowIso,
      })
      .eq("id", row.id);
    if (updateError) {
      throw new Error("Failed to update learning step status.");
    }
  }

  const refreshed = await listLearningStepsForField(params.userFieldId);
  return refreshed.steps;
}

export async function completeLearningStepForUserField(params: {
  userId: string;
  userFieldId: string;
  stepNumber: number;
}) {
  const userField = await getUserLearningField({
    userId: params.userId,
    userFieldId: params.userFieldId,
  });
  if (!userField) {
    return {
      success: false as const,
      status: 404,
      message: "Learning field entry not found.",
    };
  }

  const totalSteps = Math.max(
    1,
    calculateTotalSteps(userField.current_level, userField.target_level),
  );
  const currentStepRaw = Math.max(
    1,
    Math.floor(toNumberValue(userField.current_step_index) || 1),
  );
  const currentStepIndex = Math.min(totalSteps + 1, currentStepRaw);

  if (params.stepNumber > totalSteps) {
    return {
      success: false as const,
      status: 400,
      message: "step_number is out of range.",
    };
  }

  if (params.stepNumber > currentStepIndex) {
    return {
      success: false as const,
      status: 409,
      message: "Please complete the current step first.",
    };
  }

  let nextCurrentStepIndex = currentStepIndex;
  if (params.stepNumber === currentStepIndex) {
    nextCurrentStepIndex = Math.min(totalSteps + 1, currentStepIndex + 1);
    const { error: updateUserFieldError } = await supabaseAdmin
      .from("user_learning_fields")
      .update({
        current_step_index: nextCurrentStepIndex,
        total_steps: totalSteps,
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.userFieldId)
      .eq("user_id", params.userId);
    if (updateUserFieldError) {
      throw new Error("Failed to update learning field progress.");
    }
  }

  const steps = await syncLearningStepStatuses({
    userFieldId: params.userFieldId,
    totalSteps,
    currentStepIndex: nextCurrentStepIndex,
  });

  return {
    success: true as const,
    status: 200,
    message:
      params.stepNumber < currentStepIndex
        ? "Step already completed."
        : "Step completed.",
    totalSteps,
    currentStepIndex: nextCurrentStepIndex,
    steps,
  };
}

export function parseCompleteStepBody(body: unknown) {
  return stepCompleteBodySchema.safeParse(body);
}
