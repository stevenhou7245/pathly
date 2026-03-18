import { z } from "zod";
import {
  isMissingRelationOrColumnError,
  normalizeResourceType,
  sha256Hash,
  toNumberValue,
  toStableJson,
  toStringValue,
  toSlug,
  type ResourceType,
} from "@/lib/ai/common";
import {
  hasStrongPreference,
  loadUserResourcePreferenceProfile,
  sortResourceTypesByPreference,
  updateUserResourcePreferenceSignal,
  type ResourcePreferenceProfile,
} from "@/lib/ai/preferences";
import { generateStructuredJson, type AiProvenance } from "@/lib/ai/provider";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type GenericRecord = Record<string, unknown>;

export type CourseResourceOption = {
  id: string;
  course_id: string;
  option_no: number;
  title: string;
  resource_type: ResourceType;
  provider_name: string;
  url: string;
  description: string | null;
};

const resourceOptionSchema = z.object({
  options: z
    .array(
      z.object({
        option_no: z.number().int().min(1).max(3),
        title: z.string().min(1),
        resource_type: z.enum(["video", "article", "tutorial", "document", "interactive"]),
        provider_name: z.string().min(1),
        url: z.string().url(),
        description: z.string().min(1),
      }),
    )
    .min(3),
});

function toLegacyResourceType(resourceType: ResourceType): "video" | "article" | "tutorial" {
  if (resourceType === "video") {
    return "video";
  }
  if (resourceType === "interactive" || resourceType === "tutorial") {
    return "tutorial";
  }
  return "article";
}

function defaultResourceTypesByDiversity(
  preferenceProfile: ResourcePreferenceProfile | null,
): ResourceType[] {
  const base: ResourceType[] = ["video", "article", "tutorial"];
  if (!preferenceProfile || preferenceProfile.signals.length === 0) {
    return base;
  }

  const preferred = sortResourceTypesByPreference(
    ["video", "article", "tutorial", "document", "interactive"],
    preferenceProfile,
  );
  const selected: ResourceType[] = [];

  preferred.forEach((item) => {
    if (selected.length >= 3) {
      return;
    }
    if (!selected.includes(item)) {
      selected.push(item);
    }
  });

  base.forEach((item) => {
    if (selected.length >= 3) {
      return;
    }
    if (!selected.includes(item)) {
      selected.push(item);
    }
  });

  return selected.slice(0, 3);
}

function fallbackOptions(params: {
  courseTitle: string;
  courseId: string;
  preferenceProfile: ResourcePreferenceProfile | null;
}) {
  const preferredTypes = defaultResourceTypesByDiversity(params.preferenceProfile);
  return preferredTypes.map((resourceType, index) => {
    const optionNo = index + 1;
    const resourceLabel =
      resourceType === "video"
        ? "Video Lesson"
        : resourceType === "article" || resourceType === "document"
        ? "Article Guide"
        : "Interactive Tutorial";

    return {
      option_no: optionNo,
      title: `${params.courseTitle} ${resourceLabel}`,
      resource_type: resourceType,
      provider_name:
        resourceType === "video"
          ? "Pathly Video"
          : resourceType === "interactive"
          ? "Pathly Lab"
          : "Pathly Docs",
      url: `https://example.com/pathly/${toSlug(params.courseTitle)}-${optionNo}`,
      description: `Option ${optionNo} (${resourceType}) for ${params.courseTitle}.`,
    };
  });
}

function normalizeOptionRows(rows: GenericRecord[]) {
  return rows
    .map((row, index) => ({
      id: toStringValue(row.id),
      course_id: toStringValue(row.course_id),
      option_no: Math.max(1, Math.floor(toNumberValue(row.option_no) || index + 1)),
      title: toStringValue(row.title) || `Resource Option ${index + 1}`,
      resource_type: normalizeResourceType(row.resource_type),
      provider_name: toStringValue(row.provider_name) || "Pathly",
      url: toStringValue(row.url),
      description: toStringValue(row.description) || null,
    }))
    .filter((row) => Boolean(row.id && row.course_id && row.url));
}

async function syncLegacyCourseResources(options: CourseResourceOption[]) {
  if (options.length === 0) {
    return;
  }

  const courseId = options[0].course_id;
  const { data: existingRows, error: existingError } = await supabaseAdmin
    .from("course_resources")
    .select("*")
    .eq("course_id", courseId)
    .order("display_order", { ascending: true });

  if (existingError) {
    throw existingError;
  }

  const byOrder = new Map<number, GenericRecord>();
  ((existingRows ?? []) as GenericRecord[]).forEach((row) => {
    byOrder.set(Math.max(1, Math.floor(toNumberValue(row.display_order))), row);
  });

  for (const option of options) {
    const existing = byOrder.get(option.option_no);
    const payload = {
      course_id: option.course_id,
      title: option.title,
      resource_type: toLegacyResourceType(option.resource_type),
      provider_name: option.provider_name,
      url: option.url,
      description: option.description,
      display_order: option.option_no,
      is_active: true,
      created_at: new Date().toISOString(),
    };

    if (existing) {
      const { error: updateError } = await supabaseAdmin
        .from("course_resources")
        .update({
          title: payload.title,
          resource_type: payload.resource_type,
          provider_name: payload.provider_name,
          url: payload.url,
          description: payload.description,
          is_active: true,
        })
        .eq("id", toStringValue(existing.id));
      if (updateError) {
        throw updateError;
      }
    } else {
      const { error: insertError } = await supabaseAdmin.from("course_resources").insert(payload);
      if (insertError) {
        throw insertError;
      }
    }
  }
}

export async function ensureCourseResourceOptions(params: {
  userId?: string | null;
  courseId: string;
  courseTitle: string;
  courseDescription?: string | null;
  learningFieldTitle?: string | null;
  preferenceProfile?: ResourcePreferenceProfile | null;
}): Promise<{
  options: CourseResourceOption[];
  reused_existing: boolean;
  ai_provenance: AiProvenance | null;
}> {
  let preferenceProfile = params.preferenceProfile ?? null;
  if (!preferenceProfile && params.userId) {
    preferenceProfile = await loadUserResourcePreferenceProfile(params.userId);
  }

  try {
    const { data: existingRows, error: existingError } = await supabaseAdmin
      .from("course_resource_options")
      .select("*")
      .eq("course_id", params.courseId)
      .eq("is_active", true)
      .order("option_no", { ascending: true });

    if (existingError && !isMissingRelationOrColumnError(existingError)) {
      throw existingError;
    }

    const normalizedExisting = normalizeOptionRows((existingRows ?? []) as GenericRecord[]);
    if (normalizedExisting.length >= 3) {
      await syncLegacyCourseResources(normalizedExisting.slice(0, 3));
      console.info("[resource_options] reuse_template_options", {
        course_id: params.courseId,
        reused_count: normalizedExisting.length,
      });
      return {
        options: normalizedExisting.slice(0, 3),
        reused_existing: true,
        ai_provenance: null,
      };
    }
  } catch (error) {
    if (!isMissingRelationOrColumnError(error)) {
      console.warn("[resource_options] lookup_failed", {
        course_id: params.courseId,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const { output, provenance } = await generateStructuredJson({
    feature: "resource_options",
    promptVersion: "resource_options_v1",
    systemInstruction: [
      "You generate 3 learning resource options per course.",
      "Keep options diverse by content type.",
      "Prefer one video, one document/article, and one tutorial/interactive when possible.",
      "Return JSON only.",
    ].join(" "),
    input: {
      course_id: params.courseId,
      course_title: params.courseTitle,
      course_description: params.courseDescription ?? null,
      learning_field_title: params.learningFieldTitle ?? null,
      preference_profile: preferenceProfile,
    },
    outputSchema: resourceOptionSchema,
    fallback: () => ({
      options: fallbackOptions({
        courseTitle: params.courseTitle,
        courseId: params.courseId,
        preferenceProfile,
      }),
    }),
  });

  const deduped = output.options
    .slice(0, 3)
    .map((option, index) => ({
      option_no: index + 1,
      title: option.title.trim(),
      resource_type: normalizeResourceType(option.resource_type),
      provider_name: option.provider_name.trim(),
      url: option.url.trim(),
      description: option.description.trim(),
    }));

  const insertRows = deduped.map((option) => ({
    course_id: params.courseId,
    option_no: option.option_no,
    title: option.title,
    resource_type: option.resource_type,
    provider_name: option.provider_name,
    url: option.url,
    description: option.description,
    source_hash: sha256Hash({
      course_id: params.courseId,
      option_no: option.option_no,
      title: option.title,
      resource_type: option.resource_type,
      url: option.url,
      provider_name: option.provider_name,
    }),
    quality_score: 0,
    diversity_group:
      option.resource_type === "video"
        ? "video"
        : option.resource_type === "interactive" || option.resource_type === "tutorial"
        ? "interactive"
        : "document",
    reuse_scope: "course",
    artifact_version: 1,
    generation_input_json: JSON.parse(
      toStableJson({
        course_id: params.courseId,
        course_title: params.courseTitle,
        course_description: params.courseDescription ?? null,
        learning_field_title: params.learningFieldTitle ?? null,
      }),
    ),
    generation_output_json: JSON.parse(
      toStableJson({
        option_no: option.option_no,
        title: option.title,
        resource_type: option.resource_type,
        provider_name: option.provider_name,
        url: option.url,
      }),
    ),
    ai_provider: provenance.provider,
    ai_model: provenance.model,
    ai_prompt_version: provenance.prompt_version,
    ai_generated_at: provenance.generated_at,
    is_active: true,
  }));

  let createdOptions: CourseResourceOption[] = [];
  try {
    if (insertRows.length > 0) {
      const { error: upsertError } = await supabaseAdmin
        .from("course_resource_options")
        .upsert(insertRows, {
          onConflict: "course_id,option_no",
        });
      if (upsertError) {
        throw upsertError;
      }
    }

    const { data: refreshedRows, error: refreshError } = await supabaseAdmin
      .from("course_resource_options")
      .select("*")
      .eq("course_id", params.courseId)
      .eq("is_active", true)
      .order("option_no", { ascending: true })
      .limit(3);

    if (refreshError) {
      throw refreshError;
    }

    createdOptions = normalizeOptionRows((refreshedRows ?? []) as GenericRecord[]).slice(0, 3);
  } catch (error) {
    console.error("[resource_options] template_creation_failed", {
      course_id: params.courseId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  if (createdOptions.length === 0) {
    createdOptions = deduped.map((option) => ({
      id: "",
      course_id: params.courseId,
      option_no: option.option_no,
      title: option.title,
      resource_type: option.resource_type,
      provider_name: option.provider_name,
      url: option.url,
      description: option.description,
    }));
  }

  try {
    await syncLegacyCourseResources(createdOptions);
  } catch (error) {
    console.warn("[resource_options] legacy_sync_failed", {
      course_id: params.courseId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  console.info("[resource_options] template_created", {
    course_id: params.courseId,
    option_count: createdOptions.length,
    ai_provider: provenance.provider,
    ai_model: provenance.model,
    fallback_used: provenance.fallback_used,
  });

  return {
    options: createdOptions,
    reused_existing: false,
    ai_provenance: provenance,
  };
}

export async function resolveResourceOptionIdFromLegacyResource(params: {
  courseId: string;
  legacyResourceId?: string | null;
}) {
  const legacyResourceId = params.legacyResourceId?.trim();
  if (!legacyResourceId) {
    return null;
  }

  try {
    const { data: legacyResourceRow, error: legacyResourceError } = await supabaseAdmin
      .from("course_resources")
      .select("id, display_order, resource_type")
      .eq("id", legacyResourceId)
      .eq("course_id", params.courseId)
      .limit(1)
      .maybeSingle();

    if (legacyResourceError || !legacyResourceRow) {
      return null;
    }

    const displayOrder = Math.max(
      1,
      Math.floor(toNumberValue((legacyResourceRow as GenericRecord).display_order) || 1),
    );

    const { data: optionByOrder, error: optionByOrderError } = await supabaseAdmin
      .from("course_resource_options")
      .select("id")
      .eq("course_id", params.courseId)
      .eq("option_no", displayOrder)
      .limit(1)
      .maybeSingle();

    if (!optionByOrderError && optionByOrder) {
      return toStringValue((optionByOrder as GenericRecord).id) || null;
    }

    const resourceType = normalizeResourceType((legacyResourceRow as GenericRecord).resource_type);
    const { data: optionByType, error: optionByTypeError } = await supabaseAdmin
      .from("course_resource_options")
      .select("id")
      .eq("course_id", params.courseId)
      .eq("resource_type", resourceType)
      .order("option_no", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (optionByTypeError || !optionByType) {
      return null;
    }
    return toStringValue((optionByType as GenericRecord).id) || null;
  } catch {
    return null;
  }
}

export async function recordUserResourceSelection(params: {
  userId: string;
  journeyPathId: string;
  courseId: string;
  legacyResourceId?: string | null;
  selectedAt?: string;
}) {
  const selectedAt = params.selectedAt ?? new Date().toISOString();

  try {
    let resourceType: ResourceType = "tutorial";
    const legacyResourceId = params.legacyResourceId?.trim() ?? "";

    if (legacyResourceId) {
      const { data: legacyResource } = await supabaseAdmin
        .from("course_resources")
        .select("resource_type")
        .eq("id", legacyResourceId)
        .eq("course_id", params.courseId)
        .limit(1)
        .maybeSingle();

      resourceType = normalizeResourceType((legacyResource as GenericRecord | null)?.resource_type);
    }

    const optionId = await resolveResourceOptionIdFromLegacyResource({
      courseId: params.courseId,
      legacyResourceId,
    });

    if (optionId) {
      const sourceHash = sha256Hash({
        user_id: params.userId,
        journey_path_id: params.journeyPathId,
        course_id: params.courseId,
        resource_option_id: optionId,
        selected_at: selectedAt,
      });

      const { error } = await supabaseAdmin.from("user_resource_selections").insert({
        user_id: params.userId,
        journey_path_id: params.journeyPathId,
        course_id: params.courseId,
        resource_option_id: optionId,
        selected_at: selectedAt,
        selection_context_json: {
          source: "start_course",
          legacy_resource_id: legacyResourceId || null,
        },
        source_hash: sourceHash,
      });

      if (error && !isMissingRelationOrColumnError(error)) {
        throw error;
      }
    }

    await updateUserResourcePreferenceSignal({
      userId: params.userId,
      resourceType,
      eventType: "selected",
      eventMeta: {
        course_id: params.courseId,
        journey_path_id: params.journeyPathId,
      },
    });
  } catch (error) {
    console.warn("[resource_options] selection_record_failed", {
      user_id: params.userId,
      course_id: params.courseId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function markUserResourceCompletionAndSuccess(params: {
  userId: string;
  courseId: string;
  journeyPathId: string;
  selectedLegacyResourceId?: string | null;
  userTestId?: string | null;
  passed: boolean;
}) {
  try {
    const optionId = await resolveResourceOptionIdFromLegacyResource({
      courseId: params.courseId,
      legacyResourceId: params.selectedLegacyResourceId ?? null,
    });

    const nowIso = new Date().toISOString();
    if (optionId) {
      const { data: latestSelection, error: latestSelectionError } = await supabaseAdmin
        .from("user_resource_selections")
        .select("id")
        .eq("user_id", params.userId)
        .eq("course_id", params.courseId)
        .eq("journey_path_id", params.journeyPathId)
        .eq("resource_option_id", optionId)
        .order("selected_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!latestSelectionError && latestSelection) {
        await supabaseAdmin
          .from("user_resource_selections")
          .update({
            completed_at: nowIso,
            test_attempt_id: params.userTestId ?? null,
          })
          .eq("id", toStringValue((latestSelection as GenericRecord).id));
      }
    }

    let resourceType: ResourceType = "tutorial";
    if (params.selectedLegacyResourceId?.trim()) {
      const { data: selectedResource } = await supabaseAdmin
        .from("course_resources")
        .select("resource_type")
        .eq("id", params.selectedLegacyResourceId)
        .eq("course_id", params.courseId)
        .limit(1)
        .maybeSingle();

      resourceType = normalizeResourceType((selectedResource as GenericRecord | null)?.resource_type);
    }

    await updateUserResourcePreferenceSignal({
      userId: params.userId,
      resourceType,
      eventType: "completed",
      eventMeta: {
        course_id: params.courseId,
        journey_path_id: params.journeyPathId,
        user_test_id: params.userTestId ?? null,
      },
    });

    if (params.passed) {
      await updateUserResourcePreferenceSignal({
        userId: params.userId,
        resourceType,
        eventType: "test_success",
        eventMeta: {
          course_id: params.courseId,
          journey_path_id: params.journeyPathId,
          user_test_id: params.userTestId ?? null,
        },
      });
    }
  } catch (error) {
    console.warn("[resource_options] completion_signal_failed", {
      user_id: params.userId,
      course_id: params.courseId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

export function sortResourceOptionsByPreference(
  options: CourseResourceOption[],
  preferenceProfile: ResourcePreferenceProfile | null,
) {
  if (!preferenceProfile || options.length === 0) {
    return options;
  }

  return [...options].sort((a, b) => {
    const aStrong = hasStrongPreference(preferenceProfile, a.resource_type);
    const bStrong = hasStrongPreference(preferenceProfile, b.resource_type);
    if (aStrong !== bStrong) {
      return bStrong ? 1 : -1;
    }
    return a.option_no - b.option_no;
  });
}
