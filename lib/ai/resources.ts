import { z } from "zod";
import {
  isMissingRelationOrColumnError,
  normalizeResourceType,
  sha256Hash,
  toNumberValue,
  toStringValue,
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
import { installAiPipelineDebugLogFilter } from "@/lib/aiPipelineDebugLogging";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { searchAndExtractCandidatesForStep } from "@/lib/tavilySearch";

type GenericRecord = Record<string, unknown>;

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String((error as { message?: unknown })?.message ?? error);
}

export type CourseResourceOption = {
  id: string;
  course_id: string;
  option_no: number;
  title: string;
  resource_type: ResourceType;
  provider: string;
  url: string;
  summary: string | null;
  difficulty?: "beginner" | "intermediate" | "advanced";
  estimated_minutes?: number | null;
  ai_selected?: boolean;
};

const resourceOptionSchema = z
  .object({
    course_id: z.string().min(1),
    resource_options: z
      .array(
        z
          .object({
            option_no: z.number().int().min(1).max(3),
            resource_type: z.enum(["video", "article", "tutorial", "interactive", "document"]),
            title: z.string().min(1),
            provider: z.string().min(1),
            url: z.string().min(1),
            summary: z.string().min(0),
            difficulty: z.enum(["beginner", "intermediate", "advanced"]),
            estimated_minutes: z.number().int().min(1).max(360),
            ai_selected: z.boolean(),
            ai_generated_at: z.string().min(1),
          })
          .strict(),
      )
      .min(1)
      .max(3),
  })
  .strict();

type ResourceOptionCandidate = {
  title: string;
  url: string;
  snippet: string;
  source: string;
};

function isResourceUnavailableUrl(url: string) {
  return url.trim().toLowerCase() === "resource_unavailable";
}

function isDirectLearningUrl(url: string) {
  const normalized = url.trim().toLowerCase();
  if (!/^https?:\/\//.test(normalized)) {
    return false;
  }
  if (/example\.com/.test(normalized)) {
    return false;
  }
  if (/google\.[^/]+\/search|bing\.com\/search|duckduckgo\.com\/\?q=/.test(normalized)) {
    return false;
  }
  try {
    const parsed = new URL(normalized);
    if ((parsed.pathname || "/") === "/" && !parsed.search) {
      return false;
    }
  } catch {
    return false;
  }
  return true;
}

function normalizeDifficultyLevel(value: string): "beginner" | "intermediate" | "advanced" {
  const normalized = value.trim().toLowerCase();
  if (normalized === "advanced") {
    return "advanced";
  }
  if (normalized === "intermediate") {
    return "intermediate";
  }
  return "beginner";
}

function inferResourceTypeFromCandidate(candidate: ResourceOptionCandidate): ResourceType {
  const normalized = `${candidate.title} ${candidate.url}`.toLowerCase();
  if (/youtube|vimeo|video|watch/.test(normalized)) {
    return "video";
  }
  if (/doc|docs|documentation|pdf/.test(normalized)) {
    return "document";
  }
  if (/interactive|sandbox|lab|repl|exercise|quiz|practice/.test(normalized)) {
    return "interactive";
  }
  if (/article|blog|guide|read/.test(normalized)) {
    return "article";
  }
  return "tutorial";
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

function deterministicOptionsFromCandidates(params: {
  candidates: ResourceOptionCandidate[];
  preferredTypes: ResourceType[];
}) {
  const nowIso = new Date().toISOString();
  const selected = params.candidates.slice(0, 3);
  if (selected.length === 0) {
    return [
      {
        option_no: 1,
        resource_type: "tutorial" as const,
        title: "Resource currently unavailable",
        provider: "Unavailable",
        url: "resource_unavailable",
        summary: "No trustworthy direct learning link was found for this step yet.",
        difficulty: "intermediate" as const,
        estimated_minutes: 20,
        ai_selected: false,
        ai_generated_at: nowIso,
      },
    ];
  }

  return selected.map((candidate, index) => {
    const preferredType = params.preferredTypes[index] ?? inferResourceTypeFromCandidate(candidate);
    return {
      option_no: index + 1,
      resource_type: preferredType,
      title: candidate.title,
      provider: candidate.source || "Tavily",
      url: candidate.url,
      summary: candidate.snippet || `Recommended resource for ${candidate.title}.`,
      difficulty: "intermediate" as const,
      estimated_minutes: 20,
      ai_selected: false,
      ai_generated_at: nowIso,
    };
  });
}

function normalizeCandidateResources(
  candidates: Awaited<ReturnType<typeof searchAndExtractCandidatesForStep>>,
): ResourceOptionCandidate[] {
  return candidates.slice(0, 5).map((candidate) => {
    let source = "tavily";
    try {
      source = new URL(candidate.url).hostname || "tavily";
    } catch {
      source = "tavily";
    }
    return {
      title: candidate.title.trim(),
      url: candidate.url.trim(),
      snippet: (candidate.content || candidate.raw_content || "").trim().slice(0, 280),
      source,
    };
  });
}

function extractParsedOutputKeys(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [] as string[];
  }
  return Object.keys(value as Record<string, unknown>);
}

function extractParsedResourceOptionsLength(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return 0;
  }
  const record = value as Record<string, unknown>;
  if (!Array.isArray(record.resource_options)) {
    return 0;
  }
  return record.resource_options.length;
}

function normalizeOptionRows(rows: GenericRecord[]) {
  return rows
    .map((row, index) => ({
      id: toStringValue(row.id),
      course_id: toStringValue(row.course_id),
      option_no: Math.max(1, Math.floor(toNumberValue(row.option_no) || index + 1)),
      title: toStringValue(row.title) || `Resource Option ${index + 1}`,
      resource_type: normalizeResourceType(row.resource_type),
      provider: toStringValue(row.provider) || "Pathly",
      url: toStringValue(row.url),
      summary: toStringValue(row.summary) || null,
      difficulty: normalizeDifficultyLevel(toStringValue(row.difficulty)),
      estimated_minutes: (() => {
        const minutes = Math.max(0, Math.floor(toNumberValue(row.estimated_minutes) || 0));
        return minutes > 0 ? minutes : null;
      })(),
      ai_selected: row.ai_selected === false ? false : true,
    }))
    .filter((row) => Boolean(row.id && row.course_id && row.url));
}

function isUuidLike(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim(),
  );
}

function isLikelyInvalidResourceUrl(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (!/^https?:\/\//.test(normalized)) {
    return true;
  }
  if (/example\.com/.test(normalized)) {
    return true;
  }
  if (/watch\?v=example|placeholder|your-link-here|lorem-ipsum/.test(normalized)) {
    return true;
  }
  return false;
}

type InsertableCourseResourceOption = {
  course_id: string;
  option_no: number;
  resource_type: ResourceType;
  title: string;
  provider: string;
  url: string;
  summary: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  estimated_minutes: number;
  ai_selected: boolean;
  created_at: string;
  ai_generated_at: string;
};

const STRICT_INSERT_KEYS = [
  "course_id",
  "option_no",
  "resource_type",
  "title",
  "provider",
  "url",
  "summary",
  "difficulty",
  "estimated_minutes",
  "ai_selected",
  "created_at",
  "ai_generated_at",
] as const;

function ensureStrictInsertRowKeys(row: InsertableCourseResourceOption) {
  const actual = Object.keys(row).sort();
  const expected = [...STRICT_INSERT_KEYS].sort();
  if (actual.length !== expected.length) {
    throw new Error("Insert row has missing or extra keys.");
  }
  for (let i = 0; i < expected.length; i += 1) {
    if (actual[i] !== expected[i]) {
      throw new Error("Insert row keys do not strictly match course_resource_options schema.");
    }
  }
}

function normalizeResourceOptionForInsert(
  resource: GenericRecord,
  params: {
    courseId: string;
    optionNo: number;
    nowIso: string;
  },
): { row: InsertableCourseResourceOption | null; reason: string | null } {
  const courseId = params.courseId.trim();
  if (!courseId || !isUuidLike(courseId)) {
    return { row: null, reason: "Invalid or missing course_id." };
  }

  const title = toStringValue(resource.title).trim();
  if (!title) {
    return { row: null, reason: "Missing title." };
  }

  const url = toStringValue(resource.url).trim();
  if (isLikelyInvalidResourceUrl(url)) {
    return { row: null, reason: "Invalid or unsupported URL." };
  }

  const rawResourceType =
    toStringValue(resource.resource_type) ||
    toStringValue(resource.content_type);
  const resourceType = normalizeResourceType(rawResourceType);
  if (
    resourceType !== "video" &&
    resourceType !== "article" &&
    resourceType !== "tutorial" &&
    resourceType !== "interactive" &&
    resourceType !== "document"
  ) {
    return { row: null, reason: "Invalid resource_type." };
  }

  const difficulty = normalizeDifficultyLevel(toStringValue(resource.difficulty));
  const estimatedMinutes = Math.max(1, Math.floor(toNumberValue(resource.estimated_minutes) || 30));
  const provider = toStringValue(resource.provider).trim() || "Unknown";
  const summary = toStringValue(resource.summary).trim() || "";
  const aiGeneratedAt = toStringValue(resource.ai_generated_at).trim() || params.nowIso;
  const createdAt = params.nowIso;
  const row: InsertableCourseResourceOption = {
    course_id: courseId,
    option_no: Math.max(1, Math.floor(toNumberValue(resource.option_no) || params.optionNo || 1)),
    resource_type: resourceType,
    title,
    provider,
    url,
    summary,
    difficulty,
    estimated_minutes: estimatedMinutes,
    ai_selected: resource.ai_selected === false ? false : true,
    created_at: createdAt,
    ai_generated_at: aiGeneratedAt,
  };
  ensureStrictInsertRowKeys(row);

  return {
    row,
    reason: null,
  };
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
  installAiPipelineDebugLogFilter();

  let preferenceProfile = params.preferenceProfile ?? null;
  if (!preferenceProfile && params.userId) {
    preferenceProfile = await loadUserResourcePreferenceProfile(params.userId);
  }

  try {
    let existingRows: GenericRecord[] = [];
    const { data: activeRows, error: activeRowsError } = await supabaseAdmin
      .from("course_resource_options")
      .select("*")
      .eq("course_id", params.courseId)
      .eq("is_active", true)
      .order("option_no", { ascending: true })
      .limit(3);

    if (activeRowsError) {
      if (
        !isMissingRelationOrColumnError(activeRowsError) &&
        !/column .*is_active/i.test(toErrorMessage(activeRowsError))
      ) {
        throw activeRowsError;
      }

      const { data: fallbackRows, error: fallbackRowsError } = await supabaseAdmin
        .from("course_resource_options")
        .select("*")
        .eq("course_id", params.courseId)
        .order("option_no", { ascending: true })
        .limit(3);
      if (fallbackRowsError && !isMissingRelationOrColumnError(fallbackRowsError)) {
        throw fallbackRowsError;
      }
      existingRows = (fallbackRows ?? []) as GenericRecord[];
    } else {
      existingRows = (activeRows ?? []) as GenericRecord[];
    }

    const normalizedExisting = normalizeOptionRows(existingRows);
    if (normalizedExisting.length > 0) {
      return {
        options: normalizedExisting.slice(0, 3),
        reused_existing: true,
        ai_provenance: null,
      };
    }
  } catch (error) {
    if (!isMissingRelationOrColumnError(error)) {
      throw error;
    }
  }

  const preferredTypes = defaultResourceTypesByDiversity(preferenceProfile);

  let candidateResources: ResourceOptionCandidate[] = [];
  try {
    const tavilyCandidates = await searchAndExtractCandidatesForStep({
      userFieldId: params.courseId,
      fieldTitle: params.learningFieldTitle?.trim() || params.courseTitle,
      stepTitle: params.courseTitle,
      userLevel: "intermediate",
      maxResults: 5,
    });
    candidateResources = normalizeCandidateResources(tavilyCandidates);
  } catch (error) {
    throw error;
  }

  const { output, provenance, debug } = await generateStructuredJson({
    feature: "resource_options",
    promptVersion: "resource_options_v3",
    systemInstruction: [
      "You are selecting learning resources from provided candidate search results.",
      "You must only choose URLs from candidate_resources.",
      "Do not invent URLs.",
      "Do not output example.com links or fake URLs.",
      "Prefer direct learning pages, not search pages or generic homepages.",
      "If no trustworthy candidate exists, use url='resource_unavailable'.",
      "Return ONLY JSON matching this strict schema and field names exactly:",
      "{",
      '  "course_id": "string",',
      '  "resource_options": [',
      "    {",
      '      "option_no": 1,',
      '      "resource_type": "video|article|tutorial|interactive|document",',
      '      "title": "string",',
      '      "provider": "string",',
      '      "url": "string",',
      '      "summary": "string",',
      '      "difficulty": "beginner|intermediate|advanced",',
      '      "estimated_minutes": 30,',
      '      "ai_selected": true,',
      '      "ai_generated_at": "ISO timestamp"',
      "    }",
      "  ]",
      "}",
      "Do not return deprecated or unsupported fields outside the schema.",
      "The resource_options array must have 1 to 3 items.",
    ].join(" "),
    input: {
      course_id: params.courseId,
      course_title: params.courseTitle,
      course_description: params.courseDescription ?? null,
      learning_field_title: params.learningFieldTitle ?? null,
      preference_profile: preferenceProfile,
      candidate_resources: candidateResources.map((candidate) => ({
        title: candidate.title,
        url: candidate.url,
        snippet: candidate.snippet,
        source: candidate.source,
      })),
    },
    outputSchema: resourceOptionSchema,
    fallback: () => ({
      course_id: params.courseId,
      resource_options: deterministicOptionsFromCandidates({
        candidates: candidateResources,
        preferredTypes,
      }),
    }),
  });

  const parsedKeys = extractParsedOutputKeys(debug.parsed_output_json);
  const parsedCount = extractParsedResourceOptionsLength(debug.parsed_output_json);

  const trustedGeneratedOptions = output.resource_options
    .slice(0, 3)
    .filter((option) => {
      const optionRecord = option as GenericRecord;
      const normalizedUrl = toStringValue(optionRecord.url).trim();
      if (isResourceUnavailableUrl(normalizedUrl)) {
        return false;
      }
      const allowedUrl = candidateResources.some((candidate) => candidate.url === normalizedUrl);
      return allowedUrl && isDirectLearningUrl(normalizedUrl);
    });

  const fallbackOptions = deterministicOptionsFromCandidates({
    candidates: candidateResources,
    preferredTypes,
  }).filter((option) => !isResourceUnavailableUrl(option.url) && isDirectLearningUrl(option.url));

  const optionsForNormalization = (
    trustedGeneratedOptions.length > 0 ? trustedGeneratedOptions : fallbackOptions
  ).slice(0, 3);

  const nowIso = new Date().toISOString();
  const normalizedRows: InsertableCourseResourceOption[] = [];
  optionsForNormalization.forEach((optionRaw, index) => {
    const option = optionRaw as GenericRecord;
    const normalized = normalizeResourceOptionForInsert(option, {
      courseId: params.courseId,
      optionNo: index + 1,
      nowIso: provenance.generated_at || nowIso,
    });
    if (!normalized.row) {
      throw new Error(
        `Resource option normalization failed at index ${index}: ${normalized.reason ?? "unknown"}`,
      );
    }
    normalizedRows.push(normalized.row);
  });

  const normalizedPayloadKeys = normalizedRows.length > 0 ? Object.keys(normalizedRows[0]) : [];
  console.info("[resource_options] normalized_payload_keys", {
    course_id: params.courseId,
    keys: normalizedPayloadKeys,
    parsed_output_keys: parsedKeys,
    parsed_resource_count: parsedCount,
  });
  console.info("[resource_options] row_sample_after_normalization", {
    course_id: params.courseId,
    sample: normalizedRows.length > 0 ? normalizedRows[0] : null,
  });

  if (normalizedRows.length === 0) {
    console.error("[resource_options] db_insert_failed", {
      course_id: params.courseId,
      reason: "No valid rows after normalization.",
      row_count: 0,
    });
    throw new Error("No valid resource options remained after normalization.");
  }

  const insertRows = normalizedRows.map((row) => ({ ...row }));

  console.info("[resource_options] db_insert_payload_keys", {
    course_id: params.courseId,
    keys: insertRows.length > 0 ? Object.keys(insertRows[0]) : [],
  });
  console.info("[resource_options] db_insert_row_count", {
    course_id: params.courseId,
    row_count: insertRows.length,
  });
  let createdOptions: CourseResourceOption[] = [];
  try {
    if (insertRows.length > 0) {
      let { error: upsertError } = await supabaseAdmin
        .from("course_resource_options")
        .upsert(insertRows, {
          onConflict: "course_id,option_no",
        });
      if (
        upsertError &&
        /no unique|conflict|on conflict/i.test(toErrorMessage(upsertError).toLowerCase())
      ) {
        const deleteExisting = await supabaseAdmin
          .from("course_resource_options")
          .delete()
          .eq("course_id", params.courseId);
        if (deleteExisting.error && !isMissingRelationOrColumnError(deleteExisting.error)) {
          throw deleteExisting.error;
        }
        const retryInsert = await supabaseAdmin
          .from("course_resource_options")
          .insert(insertRows);
        upsertError = retryInsert.error;
      }
      if (upsertError) {
        throw upsertError;
      }
    }

    let { data: refreshedRows, error: refreshError } = await supabaseAdmin
      .from("course_resource_options")
      .select("*")
      .eq("course_id", params.courseId)
      .eq("is_active", true)
      .order("option_no", { ascending: true })
      .limit(3);
    if (refreshError && isMissingRelationOrColumnError(refreshError)) {
      const fallbackRefresh = await supabaseAdmin
        .from("course_resource_options")
        .select("*")
        .eq("course_id", params.courseId)
        .order("option_no", { ascending: true })
        .limit(3);
      refreshedRows = fallbackRefresh.data;
      refreshError = fallbackRefresh.error;
    }
    if (!refreshError && ((refreshedRows ?? []) as GenericRecord[]).length === 0) {
      const fallbackNoActive = await supabaseAdmin
        .from("course_resource_options")
        .select("*")
        .eq("course_id", params.courseId)
        .order("option_no", { ascending: true })
        .limit(3);
      refreshedRows = fallbackNoActive.data;
      refreshError = fallbackNoActive.error;
    }

    if (refreshError) {
      throw refreshError;
    }

    createdOptions = normalizeOptionRows((refreshedRows ?? []) as GenericRecord[]).slice(0, 3);
    console.info("[resource_options] db_insert_succeeded", {
      course_id: params.courseId,
      inserted_count: createdOptions.length,
    });
  } catch (error) {
    console.error("[resource_options] db_insert_failed", {
      course_id: params.courseId,
      message: toErrorMessage(error),
      payload_keys: insertRows.length > 0 ? Object.keys(insertRows[0]) : [],
      row_sample: insertRows.length > 0 ? insertRows[0] : null,
    });
    throw error;
  }

  if (createdOptions.length === 0) {
    throw new Error("course_resource_options insert completed but no rows were returned.");
  }

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
  const selectedId = params.legacyResourceId?.trim();
  if (!selectedId) {
    return null;
  }

  try {
    const { data: directOption, error: directOptionError } = await supabaseAdmin
      .from("course_resource_options")
      .select("id")
      .eq("id", selectedId)
      .eq("course_id", params.courseId)
      .limit(1)
      .maybeSingle();

    if (!directOptionError && directOption) {
      console.info("[resource_read] source_table_used", {
        table: "course_resource_options",
        course_id: params.courseId,
        resource_option_id: selectedId,
      });
      return toStringValue((directOption as GenericRecord).id) || null;
    }
    return null;
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
      const { data: selectedOption } = await supabaseAdmin
        .from("course_resource_options")
        .select("resource_type")
        .eq("id", legacyResourceId)
        .eq("course_id", params.courseId)
        .limit(1)
        .maybeSingle();

      if (selectedOption) {
        resourceType = normalizeResourceType((selectedOption as GenericRecord).resource_type);
      }
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

      const { error } = await supabaseAdmin.from("user_course_resource_selections").insert({
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
    console.warn("[resource_selection] selection_record_failed", {
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
        .from("user_course_resource_selections")
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
          .from("user_course_resource_selections")
          .update({
            completed_at: nowIso,
            test_attempt_id: params.userTestId ?? null,
          })
          .eq("id", toStringValue((latestSelection as GenericRecord).id));
      }
    }

    let resourceType: ResourceType = "tutorial";
    if (params.selectedLegacyResourceId?.trim()) {
      const { data: selectedOption } = await supabaseAdmin
        .from("course_resource_options")
        .select("resource_type")
        .eq("id", params.selectedLegacyResourceId)
        .eq("course_id", params.courseId)
        .limit(1)
        .maybeSingle();

      if (selectedOption) {
        resourceType = normalizeResourceType((selectedOption as GenericRecord).resource_type);
      }
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
    console.warn("[resource_selection] completion_signal_failed", {
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
