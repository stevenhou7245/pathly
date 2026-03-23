import { NextResponse } from "next/server";
import { z } from "zod";
import {
  calculateTotalSteps,
  getPathProgressPercentage,
  normalizeLearningLevel,
  normalizePathState,
} from "@/lib/learningPath";
import { ensureLearningStepsForUserField } from "@/lib/learningSteps";
import {
  computeProgressPercent,
  isRealCompletedCourseRow,
} from "@/lib/learningProgressAggregation";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type GenericRecord = Record<string, unknown>;

const levelSchema = z
  .string()
  .trim()
  .min(1, "Level is required.")
  .max(64, "Level must be 64 characters or fewer.");

const createLearningFieldSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Field title is required.")
      .max(120, "Field title must be 120 characters or fewer.")
      .optional(),
    field_name: z
      .string()
      .trim()
      .min(1, "Field name is required.")
      .max(120, "Field name must be 120 characters or fewer.")
      .optional(),
    learning_goal: z
      .string()
      .trim()
      .min(1, "Learning goal is required.")
      .max(120, "Learning goal must be 120 characters or fewer.")
      .optional(),
    current_level: levelSchema,
    target_level: levelSchema,
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.field_name !== undefined ||
      value.learning_goal !== undefined,
    {
      message: "Title or field name is required.",
    },
  );

type LearningFieldsListResponse = {
  success: boolean;
  message?: string;
  learning_fields?: Array<{
    id: string;
    fieldId: string;
    title: string;
    currentLevel: string | null;
    targetLevel: string | null;
    totalSteps: number;
    currentStepIndex: number;
    progressPercent: number;
    activeRouteId: string | null;
  }>;
};

type CreateLearningFieldResponse = {
  success: boolean;
  message?: string;
  learning_field?: {
    id: string;
    fieldId: string;
    title: string;
    currentLevel: string | null;
    targetLevel: string | null;
    totalSteps: number;
    currentStepIndex: number;
    progressPercent: number;
    activeRouteId: string | null;
  };
  generation?: {
    source: "ai" | "fallback" | "database";
    generated: boolean;
  };
  learning_steps?: Array<{
    id: string;
    step_number: number;
    title: string;
    summary: string | null;
    resources: Array<{
      type: "video" | "article" | "tutorial" | "interactive" | "document";
      title: string;
      url: string;
      reason?: string | null;
    }>;
    status: "locked" | "current" | "completed";
    generation_source: "ai" | "fallback" | "database";
    started_at: string | null;
    completed_at: string | null;
  }>;
};

function unauthorizedResponse() {
  const payload: LearningFieldsListResponse = {
    success: false,
    message: "Unauthorized.",
  };
  return NextResponse.json(payload, { status: 401 });
}

function toStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function toNumber(value: unknown) {
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

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function getFieldTitle(row: GenericRecord | undefined) {
  if (!row) {
    return "Untitled Field";
  }
  const title = toStringValue(row.title);
  if (title) {
    return title;
  }
  return "Untitled Field";
}

async function findLearningFieldByTitleOrSlug(value: string): Promise<GenericRecord | null> {
  const normalizedTitle = value.trim();
  if (!normalizedTitle) {
    return null;
  }

  const fieldSlug = slugify(normalizedTitle);

  if (fieldSlug) {
    const { data: bySlug, error: bySlugError } = await supabaseAdmin
      .from("learning_fields")
      .select("id, title, slug")
      .eq("slug", fieldSlug)
      .limit(1)
      .maybeSingle();

    if (bySlugError) {
      throw new Error("Failed to query learning fields by slug.");
    }

    if (bySlug) {
      return bySlug as GenericRecord;
    }
  }

  const { data: byTitle, error: byTitleError } = await supabaseAdmin
    .from("learning_fields")
    .select("id, title, slug")
    .ilike("title", normalizedTitle)
    .limit(1)
    .maybeSingle();

  if (byTitleError) {
    throw new Error("Failed to query learning fields by title.");
  }

  return (byTitle as GenericRecord | null) ?? null;
}

async function createLearningFieldIfMissing(title: string) {
  const existing = await findLearningFieldByTitleOrSlug(title);
  if (existing) {
    return existing;
  }

  const safeTitle = title.trim();
  const nowIso = new Date().toISOString();
  const slug = slugify(safeTitle) || `field-${Date.now()}`;
  const payloads: Array<Record<string, unknown>> = [
    {
      title: safeTitle,
      slug,
      description: null,
      created_at: nowIso,
    },
    {
      title: safeTitle,
      slug,
      description: null,
    },
    {
      title: safeTitle,
      slug,
    },
    {
      title: safeTitle,
      slug: safeTitle.toLowerCase(),
    },
    {
      title: safeTitle,
    },
  ];

  for (const payload of payloads) {
    const { data, error } = await supabaseAdmin
      .from("learning_fields")
      .insert(payload as never)
      .select("id, title, slug")
      .limit(1)
      .maybeSingle();

    if (!error && data) {
      return data as GenericRecord;
    }

    const isDuplicate = Boolean(error?.message && /duplicate/i.test(error.message));
    if (isDuplicate) {
      break;
    }
  }

  const createdByRace = await findLearningFieldByTitleOrSlug(title);
  if (createdByRace) {
    return createdByRace;
  }

  throw new Error("Failed to create learning field.");
}

export async function GET() {
  const requestStartedAt = Date.now();
  const marks: Record<string, number> = {};
  try {
    marks.auth_start = Date.now();
    const sessionUser = await getAuthenticatedSessionUser();
    marks.auth_end = Date.now();
    if (!sessionUser) {
      return unauthorizedResponse();
    }

    marks.db_user_fields_start = Date.now();
    const { data: userFields, error: userFieldsError } = await supabaseAdmin
      .from("user_learning_fields")
      .select(
        "id, field_id, current_level, target_level, total_steps, current_step_index",
      )
      .eq("user_id", sessionUser.id);
    marks.db_user_fields_end = Date.now();

    if (userFieldsError) {
      throw new Error("Failed to load user learning fields.");
    }

    const rows = (userFields ?? []) as GenericRecord[];
    const fieldIds = Array.from(
      new Set(rows.map((row) => toStringValue(row.field_id)).filter(Boolean)),
    );

    marks.db_metadata_start = Date.now();
    let fieldMap = new Map<string, GenericRecord>();
    if (fieldIds.length > 0) {
      const { data: fields, error: fieldsError } = await supabaseAdmin
        .from("learning_fields")
        .select("id, slug, title, description, icon_name, created_at")
        .in("id", fieldIds);

      if (fieldsError) {
        throw new Error("Failed to load learning field metadata.");
      }

      fieldMap = new Map(
        ((fields ?? []) as GenericRecord[]).map((field) => [toStringValue(field.id), field]),
      );
    }
    marks.db_metadata_end = Date.now();

    marks.db_journeys_start = Date.now();
    const { data: journeys, error: journeysError } =
      fieldIds.length > 0
        ? await supabaseAdmin
            .from("journey_paths")
            .select("id, learning_field_id, created_at")
            .eq("user_id", sessionUser.id)
            .in("learning_field_id", fieldIds)
            .order("created_at", { ascending: false })
        : { data: [], error: null as null };

    if (journeysError) {
      throw new Error("Failed to load journey mappings.");
    }

    const latestJourneyByFieldId = new Map<string, string>();
    ((journeys ?? []) as GenericRecord[]).forEach((row) => {
      const fieldId = toStringValue(row.learning_field_id);
      const journeyId = toStringValue(row.id);
      if (!fieldId || !journeyId) {
        return;
      }
      if (!latestJourneyByFieldId.has(fieldId)) {
        latestJourneyByFieldId.set(fieldId, journeyId);
      }
    });

    const latestJourneyIds = Array.from(new Set(latestJourneyByFieldId.values()));
    const [journeyCoursesResult, progressResult] = await Promise.all([
      latestJourneyIds.length > 0
        ? supabaseAdmin
            .from("journey_path_courses")
            .select("journey_path_id, course_id")
            .in("journey_path_id", latestJourneyIds)
        : Promise.resolve({ data: [], error: null as null }),
      latestJourneyIds.length > 0
        ? supabaseAdmin
            .from("user_course_progress")
            .select("journey_path_id, status, completed_at")
            .eq("user_id", sessionUser.id)
            .in("journey_path_id", latestJourneyIds)
        : Promise.resolve({ data: [], error: null as null }),
    ]);

    if (journeyCoursesResult.error) {
      throw new Error("Failed to load journey path courses.");
    }
    if (progressResult.error) {
      throw new Error("Failed to load user journey progress.");
    }
    marks.db_journeys_end = Date.now();

    const totalStepsByJourneyId = new Map<string, number>();
    ((journeyCoursesResult.data ?? []) as GenericRecord[]).forEach((row) => {
      const journeyId = toStringValue(row.journey_path_id);
      if (!journeyId) {
        return;
      }
      totalStepsByJourneyId.set(journeyId, (totalStepsByJourneyId.get(journeyId) ?? 0) + 1);
    });

    const completedStepsByJourneyId = new Map<string, number>();
    ((progressResult.data ?? []) as GenericRecord[]).forEach((row) => {
      const journeyId = toStringValue(row.journey_path_id);
      if (!journeyId) {
        return;
      }
      if (
        isRealCompletedCourseRow({
          status: toNullableString(row.status),
          completed_at: toNullableString(row.completed_at),
        })
      ) {
        completedStepsByJourneyId.set(journeyId, (completedStepsByJourneyId.get(journeyId) ?? 0) + 1);
      }
    });

    const learningFields = rows.map((row) => {
      const fieldId = toStringValue(row.field_id);
      const rowId = toStringValue(row.id);
      const field = fieldMap.get(fieldId);
      const title = getFieldTitle(field);
      const currentLevel = toNullableString(row.current_level);
      const targetLevel = toNullableString(row.target_level);

      const fallbackTotalSteps = calculateTotalSteps(row.current_level, row.target_level);
      const parsedTotalSteps = toNumber(row.total_steps);
      const parsedCurrentStepIndex = toNumber(row.current_step_index);
      const fallbackPath = normalizePathState(
        parsedTotalSteps > 0 ? parsedTotalSteps : fallbackTotalSteps,
        parsedCurrentStepIndex > 0 ? parsedCurrentStepIndex : 1,
      );
      const fallbackProgressPercent = getPathProgressPercentage(
        fallbackPath.totalSteps,
        fallbackPath.currentStepIndex,
      );

      if (!fieldId) {
        return {
          id: rowId,
          fieldId: "",
          title,
          currentLevel,
          targetLevel,
          totalSteps: fallbackPath.totalSteps,
          currentStepIndex: fallbackPath.currentStepIndex,
          progressPercent: fallbackProgressPercent,
          activeRouteId: null,
        };
      }

      const journeyPathId = latestJourneyByFieldId.get(fieldId) ?? null;
      const journeyTotalSteps = journeyPathId ? totalStepsByJourneyId.get(journeyPathId) ?? 0 : 0;
      const journeyCompletedSteps = journeyPathId
        ? completedStepsByJourneyId.get(journeyPathId) ?? 0
        : 0;

      const totalSteps = journeyTotalSteps > 0 ? journeyTotalSteps : fallbackPath.totalSteps;
      const completedSteps = Math.max(0, Math.min(totalSteps, journeyCompletedSteps));
      const currentStepIndex =
        totalSteps <= 0
          ? fallbackPath.currentStepIndex
          : completedSteps >= totalSteps
            ? totalSteps
            : completedSteps + 1;
      const progressPercent =
        journeyTotalSteps > 0
          ? computeProgressPercent({
              completedSteps,
              totalSteps,
            })
          : fallbackProgressPercent;

      return {
        id: rowId,
        fieldId,
        title,
        currentLevel,
        targetLevel,
        totalSteps,
        currentStepIndex,
        progressPercent,
        activeRouteId: journeyPathId,
      };
    });

    const payload: LearningFieldsListResponse = {
      success: true,
      learning_fields: learningFields,
    };
    console.info("[api/user/learning-fields][GET] timings", {
      user_id: sessionUser.id,
      total_ms: Date.now() - requestStartedAt,
      auth_ms: (marks.auth_end ?? 0) - (marks.auth_start ?? 0),
      db_user_fields_ms: (marks.db_user_fields_end ?? 0) - (marks.db_user_fields_start ?? 0),
      db_metadata_ms: (marks.db_metadata_end ?? 0) - (marks.db_metadata_start ?? 0),
      db_journeys_ms: (marks.db_journeys_end ?? 0) - (marks.db_journeys_start ?? 0),
      mapping_ms: Date.now() - (marks.db_journeys_end ?? Date.now()),
      fields_count: learningFields.length,
      active_journeys_count: latestJourneyIds.length,
    });
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[api/user/learning-fields][GET] failed", {
      total_ms: Date.now() - requestStartedAt,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    });
    const payload: LearningFieldsListResponse = {
      success: false,
      message: "Unable to load user learning fields right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      const payload: CreateLearningFieldResponse = {
        success: false,
        message: "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const parsed = createLearningFieldSchema.safeParse(body);
    if (!parsed.success) {
      const payload: CreateLearningFieldResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: CreateLearningFieldResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    const {
      title,
      field_name,
      learning_goal,
      current_level,
      target_level,
    } = parsed.data;
    console.info("[api/user/learning-fields][POST] input", {
      user_id: sessionUser.id,
      requested_field: (title ?? field_name ?? learning_goal ?? "").trim(),
      current_level,
      target_level,
    });

    const normalizedCurrentLevel = normalizeLearningLevel(current_level);
    const normalizedTargetLevel = normalizeLearningLevel(target_level);

    if (!normalizedCurrentLevel || !normalizedTargetLevel) {
      const payload: CreateLearningFieldResponse = {
        success: false,
        message:
          "Levels must be one of: Beginner, Basic, Intermediate, Advanced, Expert.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const totalSteps = calculateTotalSteps(normalizedCurrentLevel, normalizedTargetLevel);
    const currentStepIndex = 1;

    const inputTitle = (title ?? field_name ?? learning_goal ?? "").trim();
    if (!inputTitle) {
      const payload: CreateLearningFieldResponse = {
        success: false,
        message: "Field title is required.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const learningField = await createLearningFieldIfMissing(inputTitle);
    const resolvedFieldId = toStringValue(learningField.id);
    const resolvedFieldTitle = getFieldTitle(learningField);
    const { count: existingCourseCount, error: existingCourseCountError } = await supabaseAdmin
      .from("courses")
      .select("id", {
        count: "exact",
        head: true,
      })
      .eq("learning_field_id", resolvedFieldId);
    if (existingCourseCountError) {
      console.warn("[api/user/learning-fields][POST] existing_course_lookup_failed", {
        user_id: sessionUser.id,
        learning_field_id: resolvedFieldId,
        reason: existingCourseCountError.message,
      });
    } else {
      console.info("[api/user/learning-fields][POST] existing_course_lookup", {
        user_id: sessionUser.id,
        learning_field_id: resolvedFieldId,
        existing_course_count: existingCourseCount ?? 0,
      });
    }

    const { data: existingUserField, error: existingUserFieldError } = await supabaseAdmin
      .from("user_learning_fields")
      .select("id")
      .eq("user_id", sessionUser.id)
      .eq("field_id", resolvedFieldId)
      .limit(1)
      .maybeSingle();

    if (existingUserFieldError) {
      throw new Error("Failed to validate existing learning field.");
    }

    if (existingUserField) {
      const payload: CreateLearningFieldResponse = {
        success: false,
        message: "Learning field already exists for this user.",
      };
      return NextResponse.json(payload, { status: 409 });
    }

    const baseInsertPayload: Record<string, unknown> = {
      user_id: sessionUser.id,
      field_id: resolvedFieldId,
      current_level: normalizedCurrentLevel,
      target_level: normalizedTargetLevel,
      total_steps: totalSteps,
      current_step_index: currentStepIndex,
      updated_at: new Date().toISOString(),
    };

    const insertPayloads = [
      { ...baseInsertPayload, status: "active" },
      baseInsertPayload,
    ];

    let created: GenericRecord | null = null;
    let createErrorMessage = "";

    for (const insertPayload of insertPayloads) {
      const { data, error } = await supabaseAdmin
        .from("user_learning_fields")
        .insert(insertPayload as never)
        .select("id, field_id, current_level, target_level, total_steps, current_step_index")
        .limit(1)
        .maybeSingle();

      if (!error && data) {
        created = data as GenericRecord;
        break;
      }

      createErrorMessage = error?.message ?? "";
      if (/column .*status/i.test(createErrorMessage)) {
        continue;
      }
    }

    if (!created) {
      if (/total_steps|current_step_index/i.test(createErrorMessage)) {
        const payload: CreateLearningFieldResponse = {
          success: false,
          message:
            "Database columns total_steps/current_step_index are missing. Apply the SQL migration first.",
        };
        return NextResponse.json(payload, { status: 500 });
      }
      if (/duplicate key value|already exists/i.test(createErrorMessage)) {
        const payload: CreateLearningFieldResponse = {
          success: false,
          message: "Learning field already exists for this user.",
        };
        return NextResponse.json(payload, { status: 409 });
      }

      throw new Error("Failed to create user learning field.");
    }

    const storedTotalSteps = toNumber(created.total_steps);
    const storedCurrentStepIndex = toNumber(created.current_step_index);
    const normalizedPath = normalizePathState(
      storedTotalSteps > 0 ? storedTotalSteps : totalSteps,
      storedCurrentStepIndex > 0 ? storedCurrentStepIndex : currentStepIndex,
    );

    const payload: CreateLearningFieldResponse = {
      success: true,
      message: "Learning field created successfully.",
      learning_field: {
        id: toStringValue(created.id),
        fieldId: toStringValue(created.field_id),
        title: resolvedFieldTitle,
        currentLevel: toNullableString(created.current_level),
        targetLevel: toNullableString(created.target_level),
        totalSteps: normalizedPath.totalSteps,
        currentStepIndex: normalizedPath.currentStepIndex,
        progressPercent: getPathProgressPercentage(
          normalizedPath.totalSteps,
          normalizedPath.currentStepIndex,
        ),
        activeRouteId: null,
      },
    };

    try {
      const ensureResult = await ensureLearningStepsForUserField({
        userId: sessionUser.id,
        userFieldId: toStringValue(created.id),
      });
      console.info("[api/user/learning-fields][POST] learning_steps_ready", {
        user_id: sessionUser.id,
        user_field_id: toStringValue(created.id),
        learning_field_id: toStringValue(created.field_id),
        generated: ensureResult?.generated ?? false,
        generation_source: ensureResult?.generationSource ?? "database",
        total_steps: ensureResult?.totalSteps ?? normalizedPath.totalSteps,
      });
      if (ensureResult) {
        payload.generation = {
          source: ensureResult.generationSource,
          generated: ensureResult.generated,
        };
        payload.learning_steps = ensureResult.steps;
      }
    } catch (error) {
      console.warn("[api/user/learning-fields][POST] learning_steps_generation_failed", {
        user_id: sessionUser.id,
        user_field_id: toStringValue(created.id),
        learning_field_id: toStringValue(created.field_id),
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    return NextResponse.json(payload, { status: 201 });
  } catch (error) {
    console.error("[api/user/learning-fields][POST] failed", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    });
    const payload: CreateLearningFieldResponse = {
      success: false,
      message: "Unable to create learning field right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
