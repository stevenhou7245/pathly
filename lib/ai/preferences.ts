import {
  clamp,
  isMissingRelationOrColumnError,
  normalizeResourceType,
  sha256Hash,
  toNumberValue,
  toStableJson,
  type ResourceType,
} from "@/lib/ai/common";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type GenericRecord = Record<string, unknown>;

export type ResourcePreferenceSignal = {
  resource_type: ResourceType;
  selection_count: number;
  completion_count: number;
  test_success_count: number;
  weighted_score: number;
  confidence: number;
};

export type ResourcePreferenceProfile = {
  user_id: string;
  signals: ResourcePreferenceSignal[];
};

export async function loadUserResourcePreferenceProfile(userId: string): Promise<ResourcePreferenceProfile> {
  try {
    const { data, error } = await supabaseAdmin
      .from("user_resource_preferences")
      .select("*")
      .eq("user_id", userId)
      .order("weighted_score", { ascending: false });

    if (error) {
      if (isMissingRelationOrColumnError(error)) {
        return {
          user_id: userId,
          signals: [],
        };
      }
      throw error;
    }

    const signals = ((data ?? []) as GenericRecord[]).map((row) => ({
      resource_type: normalizeResourceType(row.resource_type),
      selection_count: Math.max(0, Math.floor(toNumberValue(row.selection_count))),
      completion_count: Math.max(0, Math.floor(toNumberValue(row.completion_count))),
      test_success_count: Math.max(0, Math.floor(toNumberValue(row.test_success_count))),
      weighted_score: Number(toNumberValue(row.weighted_score).toFixed(4)),
      confidence: Number(clamp(toNumberValue(row.confidence), 0, 1).toFixed(4)),
    }));

    return {
      user_id: userId,
      signals,
    };
  } catch (error) {
    console.warn("[preferences] load_profile_failed", {
      user_id: userId,
      reason: error instanceof Error ? error.message : String(error),
    });
    return {
      user_id: userId,
      signals: [],
    };
  }
}

function computeWeightedScore(params: {
  selectionCount: number;
  completionCount: number;
  testSuccessCount: number;
}) {
  const score = params.selectionCount * 1 + params.completionCount * 1.5 + params.testSuccessCount * 2;
  return Number(score.toFixed(4));
}

function computeConfidence(selectionCount: number) {
  return Number(clamp(selectionCount / 12, 0, 1).toFixed(4));
}

export async function updateUserResourcePreferenceSignal(params: {
  userId: string;
  resourceType: ResourceType;
  eventType: "selected" | "completed" | "test_success";
  eventMeta?: Record<string, unknown>;
}) {
  const nowIso = new Date().toISOString();

  try {
    const { data: existingRow, error: existingError } = await supabaseAdmin
      .from("user_resource_preferences")
      .select("*")
      .eq("user_id", params.userId)
      .eq("resource_type", params.resourceType)
      .limit(1)
      .maybeSingle();

    if (existingError) {
      if (isMissingRelationOrColumnError(existingError)) {
        return;
      }
      throw existingError;
    }

    const record = (existingRow as GenericRecord | null) ?? null;
    const selectionCount =
      Math.max(0, Math.floor(toNumberValue(record?.selection_count))) +
      (params.eventType === "selected" ? 1 : 0);
    const completionCount =
      Math.max(0, Math.floor(toNumberValue(record?.completion_count))) +
      (params.eventType === "completed" ? 1 : 0);
    const testSuccessCount =
      Math.max(0, Math.floor(toNumberValue(record?.test_success_count))) +
      (params.eventType === "test_success" ? 1 : 0);

    const weightedScore = computeWeightedScore({
      selectionCount,
      completionCount,
      testSuccessCount,
    });
    const confidence = computeConfidence(selectionCount);

    const history = Array.isArray(record?.signal_history_json)
      ? [...(record?.signal_history_json as unknown[])]
      : [];
    history.push({
      event_type: params.eventType,
      at: nowIso,
      selection_count: selectionCount,
      completion_count: completionCount,
      test_success_count: testSuccessCount,
      weighted_score: weightedScore,
      confidence,
      meta: params.eventMeta ?? {},
    });
    const trimmedHistory = history.slice(-80);

    const sourceHash = sha256Hash({
      user_id: params.userId,
      resource_type: params.resourceType,
      selection_count: selectionCount,
      completion_count: completionCount,
      test_success_count: testSuccessCount,
      weighted_score: weightedScore,
      confidence,
      event_type: params.eventType,
      event_meta: params.eventMeta ?? {},
    });

    const payload: Record<string, unknown> = {
      user_id: params.userId,
      resource_type: params.resourceType,
      selection_count: selectionCount,
      completion_count: completionCount,
      test_success_count: testSuccessCount,
      weighted_score: weightedScore,
      confidence,
      source_hash: sourceHash,
      signal_history_json: JSON.parse(toStableJson(trimmedHistory)),
      updated_at: nowIso,
    };

    if (!record) {
      payload.created_at = nowIso;
      payload.preference_version = 1;
    } else {
      payload.preference_version = Math.max(1, Math.floor(toNumberValue(record.preference_version))) + 1;
    }

    if (params.eventType === "selected") {
      payload.last_selected_at = nowIso;
    }
    if (params.eventType === "completed") {
      payload.last_completed_at = nowIso;
    }
    if (params.eventType === "test_success") {
      payload.last_test_success_at = nowIso;
    }

    const { error: upsertError } = await supabaseAdmin
      .from("user_resource_preferences")
      .upsert(payload, {
        onConflict: "user_id,resource_type",
      });

    if (upsertError) {
      throw upsertError;
    }

    console.info("[preferences] signal_updated", {
      user_id: params.userId,
      resource_type: params.resourceType,
      event_type: params.eventType,
      selection_count: selectionCount,
      completion_count: completionCount,
      test_success_count: testSuccessCount,
      weighted_score: weightedScore,
      confidence,
    });
  } catch (error) {
    console.warn("[preferences] signal_update_failed", {
      user_id: params.userId,
      resource_type: params.resourceType,
      event_type: params.eventType,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
}

export function getResourceTypeBiasMap(profile: ResourcePreferenceProfile | null) {
  const bias = new Map<ResourceType, number>();
  if (!profile || profile.signals.length === 0) {
    return bias;
  }

  profile.signals.forEach((signal) => {
    const score = signal.weighted_score * (0.5 + signal.confidence * 0.5);
    bias.set(signal.resource_type, score);
  });
  return bias;
}

export function sortResourceTypesByPreference(
  resourceTypes: ResourceType[],
  profile: ResourcePreferenceProfile | null,
) {
  const bias = getResourceTypeBiasMap(profile);
  return [...resourceTypes].sort((a, b) => {
    const scoreDiff = (bias.get(b) ?? 0) - (bias.get(a) ?? 0);
    if (scoreDiff !== 0) {
      return scoreDiff;
    }
    return a.localeCompare(b);
  });
}

export function hasStrongPreference(profile: ResourcePreferenceProfile | null, type: ResourceType) {
  const signal = profile?.signals.find((item) => item.resource_type === type);
  if (!signal) {
    return false;
  }
  return signal.selection_count >= 3 && signal.weighted_score >= 4;
}
