import { z } from "zod";
import { normalizeLearningLevel } from "@/lib/learningPath";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type GenericRecord = Record<string, unknown>;

export type DashboardLearningSummary = {
  field: {
    id: string;
    title: string;
    level: string | null;
    destination: string | null;
    user_learning_field_id: string | null;
  };
  journey: {
    journey_path_id: string;
    total_steps: number;
    completed_steps: number;
    current_step: number;
    progress_percent: number;
  };
  folder_summary: {
    completed_milestones: number;
    total_milestones: number;
  };
};

type CachedSummaryEntry = {
  expiresAt: number;
  value: DashboardLearningSummary;
};

const SUMMARY_CACHE_TTL_MS = 2000;
const dashboardSummaryCache = new Map<string, CachedSummaryEntry>();
const dashboardSummaryInFlight = new Map<string, Promise<DashboardLearningSummary>>();

export class DashboardLearningSummaryError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = "DashboardLearningSummaryError";
    this.status = status;
  }
}

export const dashboardSummaryQuerySchema = z.object({
  field_id: z.string().uuid("field_id must be a valid UUID."),
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

function pickFirstNumber(row: GenericRecord, keys: string[]) {
  for (const key of keys) {
    const value = toNumberValue(row[key]);
    if (value > 0 || row[key] === 0 || row[key] === "0") {
      return value;
    }
  }
  return 0;
}

function pickFirstString(row: GenericRecord, keys: string[]) {
  for (const key of keys) {
    const value = toStringValue(row[key]).trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function logSummaryStep(step: string, detail?: Record<string, unknown>) {
  if (detail) {
    console.info(`[dashboard_summary] ${step}`, detail);
    return;
  }
  console.info(`[dashboard_summary] ${step}`);
}

async function loadFieldContext(params: {
  userId: string;
  fieldId: string;
  currentLevel?: string | null;
  targetLevel?: string | null;
  userLearningFieldId?: string | null;
  fieldTitle?: string | null;
}) {
  logSummaryStep("load_field_context:start", {
    user_id: params.userId,
    field_id: params.fieldId,
  });

  let currentLevel = params.currentLevel ?? null;
  let targetLevel = params.targetLevel ?? null;
  let userLearningFieldId = params.userLearningFieldId ?? null;
  let fieldTitle = params.fieldTitle ?? null;

  if (currentLevel === null || targetLevel === null || userLearningFieldId === null) {
    const { data: userField, error: userFieldError } = await supabaseAdmin
      .from("user_learning_fields")
      .select("id, current_level, target_level")
      .eq("user_id", params.userId)
      .eq("field_id", params.fieldId)
      .limit(1)
      .maybeSingle();

    if (userFieldError) {
      throw new DashboardLearningSummaryError("Failed to load user learning field.", 500);
    }

    if (!userField) {
      throw new DashboardLearningSummaryError("Learning field is not assigned to this user.", 404);
    }

    currentLevel = toNullableString((userField as GenericRecord).current_level);
    targetLevel = toNullableString((userField as GenericRecord).target_level);
    userLearningFieldId = toNullableString((userField as GenericRecord).id);

    logSummaryStep("load_field_context:user_field_query_result", {
      user_learning_field_id: userLearningFieldId,
      current_level: currentLevel,
      target_level: targetLevel,
    });
  }

  if (!fieldTitle) {
    const { data: fieldRow, error: fieldError } = await supabaseAdmin
      .from("learning_fields")
      .select("id, slug, title, description, icon_name, created_at")
      .eq("id", params.fieldId)
      .limit(1)
      .maybeSingle();

    if (fieldError) {
      throw new DashboardLearningSummaryError("Failed to load learning field metadata.", 500);
    }

    if (!fieldRow) {
      throw new DashboardLearningSummaryError("Learning field not found.", 404);
    }

    const row = fieldRow as GenericRecord;
    fieldTitle = toStringValue(row.title) || "Untitled Field";
    logSummaryStep("load_field_context:field_query_result", {
      id: toStringValue(row.id),
      slug: toStringValue(row.slug),
      title: fieldTitle,
      has_description: Boolean(toStringValue(row.description)),
      icon_name: toStringValue(row.icon_name),
      created_at: toStringValue(row.created_at),
    });
  }

  const normalizedCurrentLevel = normalizeLearningLevel(currentLevel) ?? "Beginner";
  const normalizedTargetLevel = normalizeLearningLevel(targetLevel) ?? normalizedCurrentLevel;

  return {
    fieldTitle,
    userLearningFieldId,
    normalizedCurrentLevel,
    normalizedTargetLevel,
  };
}

async function loadSummaryViaRpc(params: { userId: string; fieldId: string }) {
  const { data, error } = await supabaseAdmin.rpc("get_learning_summary", {
    p_user_id: params.userId,
    p_learning_field_id: params.fieldId,
  });

  if (error) {
    throw new DashboardLearningSummaryError("Failed to load learning summary.", 500);
  }

  if (!data) {
    return null;
  }

  if (Array.isArray(data)) {
    const first = ((data[0] as GenericRecord | undefined) ?? null) as GenericRecord | null;
    logSummaryStep("load_summary_rpc:result", {
      row_shape: "array",
      rows: data.length,
      has_row: Boolean(first),
      journey_path_id: first ? pickFirstString(first, ["journey_path_id", "active_journey_path_id"]) : "",
    });
    return first;
  }

  if (typeof data === "object") {
    const row = data as GenericRecord;
    logSummaryStep("load_summary_rpc:result", {
      row_shape: "object",
      has_row: true,
      journey_path_id: pickFirstString(row, ["journey_path_id", "active_journey_path_id"]),
    });
    return row;
  }

  logSummaryStep("load_summary_rpc:result", {
    row_shape: typeof data,
    has_row: false,
  });
  return null;
}

export async function getDashboardLearningSummary(params: {
  userId: string;
  fieldId: string;
  currentLevel?: string | null;
  targetLevel?: string | null;
  userLearningFieldId?: string | null;
  fieldTitle?: string | null;
}) {
  const startedAt = Date.now();
  const cacheKey = `${params.userId}:${params.fieldId}`;
  const cached = dashboardSummaryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    logSummaryStep("cache_hit", {
      user_id: params.userId,
      field_id: params.fieldId,
      ttl_remaining_ms: cached.expiresAt - Date.now(),
    });
    return cached.value;
  }

  const inFlight = dashboardSummaryInFlight.get(cacheKey);
  if (inFlight) {
    logSummaryStep("inflight_hit", {
      user_id: params.userId,
      field_id: params.fieldId,
    });
    return inFlight;
  }

  const loader = (async () => {
  logSummaryStep("get_summary:start", {
    user_id: params.userId,
    field_id: params.fieldId,
  });

  const fieldContextStartedAt = Date.now();
  const fieldContext = await loadFieldContext(params);
  const fieldContextEndedAt = Date.now();

  const rpcStartedAt = Date.now();
  const rpcSummary = await loadSummaryViaRpc({
    userId: params.userId,
    fieldId: params.fieldId,
  });
  const rpcEndedAt = Date.now();

  const summaryRow = rpcSummary ?? {};
  const journeyPathId = pickFirstString(summaryRow, ["journey_path_id", "active_journey_path_id"]);
  const totalStepsRaw = Math.max(
    0,
    Math.floor(
      pickFirstNumber(summaryRow, ["total_steps", "total_milestones", "folder_total_milestones"]),
    ),
  );
  const completedStepsRaw = Math.max(
    0,
    Math.floor(
      pickFirstNumber(summaryRow, [
        "completed_steps",
        "completed_milestones",
        "folder_completed_milestones",
      ]),
    ),
  );
  const totalSteps = totalStepsRaw;
  const completedSteps = Math.max(0, Math.min(totalSteps, completedStepsRaw));
  const currentStep =
    totalSteps <= 0
      ? 0
      : Math.max(
          1,
          Math.floor(pickFirstNumber(summaryRow, ["current_step", "current_step_number"]) || 1),
        );
  const progressPercent = Math.max(
    0,
    Math.min(
      100,
      Math.floor(
        pickFirstNumber(summaryRow, ["progress_percent", "progress_percentage"]) ||
          (totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0),
      ),
    ),
  );

  const summary: DashboardLearningSummary = {
    field: {
      id: params.fieldId,
      title:
        pickFirstString(summaryRow, ["field_title", "learning_field_title"]) ||
        fieldContext.fieldTitle,
      level:
        pickFirstString(summaryRow, ["current_level"]) ||
        fieldContext.normalizedCurrentLevel.toLowerCase(),
      destination:
        pickFirstString(summaryRow, ["target_level", "destination_level"]) ||
        fieldContext.normalizedTargetLevel.toLowerCase(),
      user_learning_field_id:
        toNullableString(summaryRow.user_learning_field_id) || fieldContext.userLearningFieldId,
    },
    journey: {
      journey_path_id: journeyPathId,
      total_steps: totalSteps,
      completed_steps: completedSteps,
      current_step: currentStep,
      progress_percent: progressPercent,
    },
    folder_summary: {
      completed_milestones: completedSteps,
      total_milestones: totalSteps,
    },
  };

  logSummaryStep("response_mapping:complete", {
    field_id: summary.field.id,
    field_title: summary.field.title,
    journey_path_id: summary.journey.journey_path_id,
    total_steps: summary.journey.total_steps,
    completed_steps: summary.journey.completed_steps,
    current_step: summary.journey.current_step,
    progress_percent: summary.journey.progress_percent,
    used_zero_fallback: !rpcSummary,
    timings: {
      total_ms: Date.now() - startedAt,
      field_context_ms: fieldContextEndedAt - fieldContextStartedAt,
      rpc_ms: rpcEndedAt - rpcStartedAt,
      mapping_ms: Date.now() - rpcEndedAt,
    },
  });

  dashboardSummaryCache.set(cacheKey, {
    value: summary,
    expiresAt: Date.now() + SUMMARY_CACHE_TTL_MS,
  });
  return summary;
  })();

  dashboardSummaryInFlight.set(cacheKey, loader);
  try {
    return await loader;
  } finally {
    dashboardSummaryInFlight.delete(cacheKey);
  }
}
