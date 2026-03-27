import { getDashboardLearningSummary } from "@/lib/dashboardLearningSummary";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type GenericRow = Record<string, unknown>;

type UserLearningFieldRow = {
  id: string;
  field_id: string;
  current_level: string | null;
  target_level: string | null;
  created_at: string | null;
  updated_at: string | null;
  started_at: string | null;
};

type JourneyPathRow = {
  id: string;
  learning_field_id: string;
  created_at: string | null;
};

type CourseProgressRow = {
  journey_path_id: string;
  course_id: string;
  status: string | null;
  completed_at: string | null;
  started_at: string | null;
  last_activity_at: string | null;
  ready_for_test_at: string | null;
  passed_at: string | null;
};

type CourseRow = {
  id: string;
  title: string | null;
};

type JourneyPathCourseRow = {
  journey_path_id: string;
  course_id: string;
  step_number: number;
};

type LearningFieldRow = {
  id: string;
  title: string | null;
  name: string | null;
};

export type CurrentLearningSnapshot = {
  field_id: string | null;
  current_learning_field: string | null;
  current_level: string | null;
  target_level: string | null;
  current_progress: number;
};

export type RecentCompletedCourse = {
  title: string;
  stepNumber: number;
  completedAt: string;
  learningFieldName: string;
};

function toStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function toNumberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed);
    }
  }
  return 0;
}

function pickActivityTimestamp(row: CourseProgressRow) {
  return (
    row.completed_at ??
    row.last_activity_at ??
    row.passed_at ??
    row.ready_for_test_at ??
    row.started_at ??
    ""
  );
}

function pickFieldActivityTimestamp(row: UserLearningFieldRow) {
  return row.updated_at ?? row.created_at ?? row.started_at ?? "";
}

function normalizeStatus(status: string | null | undefined) {
  return status?.trim().toLowerCase() ?? "";
}

export function isCompletedProgressStatus(status: string | null | undefined) {
  const normalized = normalizeStatus(status);
  return normalized === "completed" || normalized === "passed";
}

export function isRealCompletedCourseRow(row: {
  status: string | null | undefined;
  completed_at: string | null | undefined;
}) {
  const completedAt = toStringValue(row.completed_at).trim();
  if (!completedAt) {
    return false;
  }

  const normalized = normalizeStatus(row.status);
  if (!normalized) {
    return true;
  }

  if (
    normalized === "locked" ||
    normalized === "unlocked" ||
    normalized === "not_started" ||
    normalized === "in_progress" ||
    normalized === "ready_for_test"
  ) {
    return false;
  }

  return true;
}

export function computeProgressPercent(params: { completedSteps: number; totalSteps: number }) {
  const total = Math.max(0, Math.floor(params.totalSteps));
  if (total <= 0) {
    return 0;
  }
  const completed = Math.max(0, Math.min(total, Math.floor(params.completedSteps)));
  return Math.max(0, Math.min(100, Math.floor((completed / total) * 100)));
}

export function filterAndLimitRecentCompletedRows<
  T extends { status: string | null | undefined; completed_at: string | null | undefined },
>(rows: T[], limit: number) {
  return rows
    .filter((row) => isRealCompletedCourseRow(row))
    .sort((a, b) =>
      toStringValue(b.completed_at).localeCompare(toStringValue(a.completed_at)),
    )
    .slice(0, Math.max(1, Math.floor(limit)));
}

function dedupeLatestUserLearningFields(rows: UserLearningFieldRow[]) {
  const latestByField = new Map<string, UserLearningFieldRow>();
  rows.forEach((row) => {
    if (!row.field_id) {
      return;
    }

    const existing = latestByField.get(row.field_id);
    if (!existing) {
      latestByField.set(row.field_id, row);
      return;
    }

    const existingTimestamp = pickFieldActivityTimestamp(existing);
    const nextTimestamp = pickFieldActivityTimestamp(row);
    if (nextTimestamp > existingTimestamp) {
      latestByField.set(row.field_id, row);
    }
  });

  return Array.from(latestByField.values()).sort((a, b) =>
    pickFieldActivityTimestamp(b).localeCompare(pickFieldActivityTimestamp(a)),
  );
}

async function findMostRecentlyActiveFieldId(params: {
  userId: string;
  fieldIds: string[];
}) {
  if (params.fieldIds.length === 0) {
    return null;
  }

  const journeyResult = await supabaseAdmin
    .from("journey_paths")
    .select("id, learning_field_id, created_at")
    .eq("user_id", params.userId)
    .in("learning_field_id", params.fieldIds);
  if (journeyResult.error) {
    return null;
  }

  const journeys = (journeyResult.data ?? []).map((row) => ({
    id: toStringValue((row as GenericRow).id),
    learning_field_id: toStringValue((row as GenericRow).learning_field_id),
    created_at: toNullableString((row as GenericRow).created_at),
  })) as JourneyPathRow[];

  const journeyPathIds = journeys.map((row) => row.id).filter(Boolean);
  if (journeyPathIds.length === 0) {
    return null;
  }

  const fieldIdByJourneyPathId = new Map<string, string>();
  journeys.forEach((row) => {
    if (row.id && row.learning_field_id) {
      fieldIdByJourneyPathId.set(row.id, row.learning_field_id);
    }
  });

  const progressResult = await supabaseAdmin
    .from("user_course_progress")
    .select(
      "journey_path_id, status, completed_at, started_at, last_activity_at, ready_for_test_at, passed_at",
    )
    .eq("user_id", params.userId)
    .in("journey_path_id", journeyPathIds);

  if (progressResult.error) {
    return null;
  }

  let latestFieldId: string | null = null;
  let latestTimestamp = "";
  (progressResult.data ?? []).forEach((row) => {
    const record = row as GenericRow;
    const journeyPathId = toStringValue(record.journey_path_id);
    const fieldId = fieldIdByJourneyPathId.get(journeyPathId) ?? "";
    if (!fieldId) {
      return;
    }

    const rowTimestamp = pickActivityTimestamp({
      journey_path_id: journeyPathId,
      course_id: "",
      status: toNullableString(record.status),
      completed_at: toNullableString(record.completed_at),
      started_at: toNullableString(record.started_at),
      last_activity_at: toNullableString(record.last_activity_at),
      ready_for_test_at: toNullableString(record.ready_for_test_at),
      passed_at: toNullableString(record.passed_at),
    });
    if (!rowTimestamp) {
      return;
    }

    if (rowTimestamp > latestTimestamp) {
      latestTimestamp = rowTimestamp;
      latestFieldId = fieldId;
    }
  });

  return latestFieldId;
}

async function getFallbackSnapshot(params: {
  userId: string;
  selectedUserField: UserLearningFieldRow;
}) {
  const fieldResult = await supabaseAdmin
    .from("learning_fields")
    .select("id, title, name")
    .eq("id", params.selectedUserField.field_id)
    .limit(1)
    .maybeSingle();

  const field = (fieldResult.data ?? null) as GenericRow | null;
  const fieldTitle =
    toStringValue(field?.title).trim() || toStringValue(field?.name).trim() || null;

  const latestJourneyResult = await supabaseAdmin
    .from("journey_paths")
    .select("id, learning_field_id, created_at")
    .eq("user_id", params.userId)
    .eq("learning_field_id", params.selectedUserField.field_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestJourneyResult.error || !latestJourneyResult.data) {
    return {
      field_id: params.selectedUserField.field_id,
      current_learning_field: fieldTitle,
      current_level: params.selectedUserField.current_level,
      target_level: params.selectedUserField.target_level,
      current_progress: 0,
    } satisfies CurrentLearningSnapshot;
  }

  const latestJourneyId = toStringValue((latestJourneyResult.data as GenericRow).id);
  const progressResult = await supabaseAdmin
    .from("user_course_progress")
    .select("status, completed_at")
    .eq("user_id", params.userId)
    .eq("journey_path_id", latestJourneyId);
  if (progressResult.error) {
    return {
      field_id: params.selectedUserField.field_id,
      current_learning_field: fieldTitle,
      current_level: params.selectedUserField.current_level,
      target_level: params.selectedUserField.target_level,
      current_progress: 0,
    } satisfies CurrentLearningSnapshot;
  }

  const progressRows = (progressResult.data ?? []) as GenericRow[];
  const totalSteps = progressRows.length;
  const completedSteps = progressRows.filter((row) =>
    isRealCompletedCourseRow({
      status: toNullableString(row.status),
      completed_at: toNullableString(row.completed_at),
    }),
  ).length;

  return {
    field_id: params.selectedUserField.field_id,
    current_learning_field: fieldTitle,
    current_level: params.selectedUserField.current_level,
    target_level: params.selectedUserField.target_level,
    current_progress: computeProgressPercent({
      completedSteps,
      totalSteps,
    }),
  } satisfies CurrentLearningSnapshot;
}

export async function getCurrentLearningSnapshotFromRealProgress(
  userId: string,
): Promise<CurrentLearningSnapshot> {
  const userFieldResult = await supabaseAdmin
    .from("user_learning_fields")
    .select("id, field_id, current_level, target_level, created_at, updated_at, started_at")
    .eq("user_id", userId);

  if (userFieldResult.error || !userFieldResult.data || userFieldResult.data.length === 0) {
    return {
      field_id: null,
      current_learning_field: null,
      current_level: null,
      target_level: null,
      current_progress: 0,
    };
  }

  const rows = (userFieldResult.data ?? [])
    .map((row) => ({
      id: toStringValue((row as GenericRow).id),
      field_id: toStringValue((row as GenericRow).field_id),
      current_level: toNullableString((row as GenericRow).current_level),
      target_level: toNullableString((row as GenericRow).target_level),
      created_at: toNullableString((row as GenericRow).created_at),
      updated_at: toNullableString((row as GenericRow).updated_at),
      started_at: toNullableString((row as GenericRow).started_at),
    }))
    .filter((row) => row.field_id) as UserLearningFieldRow[];

  if (rows.length === 0) {
    return {
      field_id: null,
      current_learning_field: null,
      current_level: null,
      target_level: null,
      current_progress: 0,
    };
  }

  const deduped = dedupeLatestUserLearningFields(rows);
  const fieldIds = deduped.map((row) => row.field_id);
  const mostRecentlyActiveFieldId =
    (await findMostRecentlyActiveFieldId({
      userId,
      fieldIds,
    })) ?? null;

  const selectedUserField =
    (mostRecentlyActiveFieldId
      ? deduped.find((row) => row.field_id === mostRecentlyActiveFieldId)
      : null) ?? deduped[0];

  try {
    const summary = await getDashboardLearningSummary({
      userId,
      fieldId: selectedUserField.field_id,
      currentLevel: selectedUserField.current_level,
      targetLevel: selectedUserField.target_level,
      userLearningFieldId: selectedUserField.id,
    });

    return {
      field_id: summary.field.id,
      current_learning_field: summary.field.title || null,
      current_level: summary.field.level,
      target_level: summary.field.destination,
      current_progress: summary.journey.progress_percent,
    };
  } catch {
    return getFallbackSnapshot({
      userId,
      selectedUserField,
    });
  }
}

export async function getRecentCompletedCoursesFromRealProgress(params: {
  userId: string;
  days?: number;
  limit?: number;
}) {
  const logContext = {
    user_id: params.userId,
    days: Math.max(1, Math.floor(params.days ?? 7)),
    limit: Math.max(1, Math.floor(params.limit ?? 3)),
  };
  const days = Math.max(1, Math.floor(params.days ?? 7));
  const limit = Math.max(1, Math.floor(params.limit ?? 3));
  const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  console.info("[journey_summary] start", {
    ...logContext,
    completed_at_threshold: threshold,
  });

  const progressResult = await supabaseAdmin
    .from("user_course_progress")
    .select("journey_path_id, course_id, status, completed_at")
    .eq("user_id", params.userId)
    .not("completed_at", "is", null)
    .gte("completed_at", threshold)
    .order("completed_at", { ascending: false })
    .limit(Math.max(limit * 8, 30));

  if (progressResult.error) {
    console.error("[journey_summary] step_failed:user_course_progress", {
      ...logContext,
      error_message: progressResult.error.message,
      error_code: progressResult.error.code ?? null,
      error_details: progressResult.error.details ?? null,
      error_hint: progressResult.error.hint ?? null,
    });
    throw new Error(
      `Journey summary failed at user_course_progress query: ${progressResult.error.message}`,
    );
  }
  console.info("[journey_summary] step_result:user_course_progress", {
    ...logContext,
    row_count: (progressResult.data ?? []).length,
  });

  const completionRows = ((progressResult.data ?? []) as GenericRow[])
    .map((row) => ({
      journey_path_id: toStringValue(row.journey_path_id),
      course_id: toStringValue(row.course_id),
      status: toNullableString(row.status),
      completed_at: toNullableString(row.completed_at),
    }))
    .filter((row) => row.journey_path_id && row.course_id);

  const filteredCompletionRows = filterAndLimitRecentCompletedRows(
    completionRows,
    Math.max(limit * 8, 30),
  );
  console.info("[journey_summary] step_result:filtered_completions", {
    ...logContext,
    completion_row_count: completionRows.length,
    filtered_row_count: filteredCompletionRows.length,
  });

  if (filteredCompletionRows.length === 0) {
    return [] as RecentCompletedCourse[];
  }

  const journeyPathIds = Array.from(
    new Set(filteredCompletionRows.map((row) => row.journey_path_id)),
  );
  const courseIds = Array.from(new Set(filteredCompletionRows.map((row) => row.course_id)));

  const [journeyResult, coursesResult, journeyCoursesResult] = await Promise.all([
    supabaseAdmin
      .from("journey_paths")
      .select("id, learning_field_id, created_at")
      .eq("user_id", params.userId)
      .in("id", journeyPathIds),
    supabaseAdmin.from("courses").select("id, title").in("id", courseIds),
    supabaseAdmin
      .from("journey_path_courses")
      .select("journey_path_id, course_id, step_number")
      .in("journey_path_id", journeyPathIds)
      .in("course_id", courseIds),
  ]);
  console.info("[journey_summary] step_result:journey_paths", {
    ...logContext,
    row_count: (journeyResult.data ?? []).length,
    error_message: journeyResult.error?.message ?? null,
  });
  console.info("[journey_summary] step_result:courses", {
    ...logContext,
    row_count: (coursesResult.data ?? []).length,
    error_message: coursesResult.error?.message ?? null,
  });
  console.info("[journey_summary] step_result:journey_path_courses", {
    ...logContext,
    row_count: (journeyCoursesResult.data ?? []).length,
    error_message: journeyCoursesResult.error?.message ?? null,
  });

  const journeyRows = ((journeyResult.error ? [] : (journeyResult.data ?? [])) as GenericRow[]).map((row) => ({
    id: toStringValue((row as GenericRow).id),
    learning_field_id: toStringValue((row as GenericRow).learning_field_id),
    created_at: toNullableString((row as GenericRow).created_at),
  })) as JourneyPathRow[];
  const learningFieldIds = Array.from(
    new Set(journeyRows.map((row) => row.learning_field_id).filter(Boolean)),
  );

  const learningFieldContextMap = new Map<
    string,
    {
      current_level: string | null;
      target_level: string | null;
      updated_at: string | null;
      created_at: string | null;
    }
  >();
  if (learningFieldIds.length > 0) {
    const learningFieldContextResult = await supabaseAdmin
      .from("user_learning_fields")
      .select("field_id, current_level, target_level, updated_at, created_at")
      .eq("user_id", params.userId)
      .in("field_id", learningFieldIds);
    console.info("[journey_summary] step_result:user_learning_fields", {
      ...logContext,
      row_count: (learningFieldContextResult.data ?? []).length,
      error_message: learningFieldContextResult.error?.message ?? null,
    });
    if (!learningFieldContextResult.error) {
      ((learningFieldContextResult.data ?? []) as GenericRow[]).forEach((row) => {
        const fieldId = toStringValue(row.field_id);
        if (!fieldId) {
          return;
        }
        const nextRecord = {
          current_level: toNullableString(row.current_level),
          target_level: toNullableString(row.target_level),
          updated_at: toNullableString(row.updated_at),
          created_at: toNullableString(row.created_at),
        };
        const existing = learningFieldContextMap.get(fieldId);
        if (!existing) {
          learningFieldContextMap.set(fieldId, nextRecord);
          return;
        }
        const existingTimestamp = toStringValue(existing.updated_at ?? existing.created_at ?? "");
        const nextTimestamp = toStringValue(nextRecord.updated_at ?? nextRecord.created_at ?? "");
        if (nextTimestamp > existingTimestamp) {
          learningFieldContextMap.set(fieldId, nextRecord);
        }
      });
    }
  }

  const journeyFieldMap = new Map<string, string>();
  journeyRows.forEach((row) => {
    if (row.id && row.learning_field_id) {
      journeyFieldMap.set(row.id, row.learning_field_id);
    }
  });

  const courseMap = new Map<string, CourseRow>();
  ((coursesResult.error ? [] : (coursesResult.data ?? [])) as GenericRow[]).forEach((row) => {
    const id = toStringValue(row.id);
    if (!id) {
      return;
    }
    courseMap.set(id, {
      id,
      title: toNullableString(row.title),
    });
  });

  const stepMap = new Map<string, JourneyPathCourseRow>();
  ((journeyCoursesResult.error ? [] : (journeyCoursesResult.data ?? [])) as GenericRow[]).forEach((row) => {
    const journeyPathId = toStringValue(row.journey_path_id);
    const courseId = toStringValue(row.course_id);
    if (!journeyPathId || !courseId) {
      return;
    }
    stepMap.set(`${journeyPathId}:${courseId}`, {
      journey_path_id: journeyPathId,
      course_id: courseId,
      step_number: Math.max(1, toNumberValue(row.step_number)),
    });
  });

  const formatLearningFieldName = (fieldId: string) => {
    const context = learningFieldContextMap.get(fieldId);
    const currentLevel = toStringValue(context?.current_level).trim();
    const targetLevel = toStringValue(context?.target_level).trim();
    if (currentLevel && targetLevel) {
      return `${currentLevel} -> ${targetLevel}`;
    }
    if (targetLevel) {
      return `Target ${targetLevel}`;
    }
    if (currentLevel) {
      return `Current ${currentLevel}`;
    }
    return "Learning Journey";
  };

  const items = filteredCompletionRows
    .map((row) => {
      const fieldId = journeyFieldMap.get(row.journey_path_id) ?? "";
      const learningFieldName = formatLearningFieldName(fieldId);

      const stepRecord = stepMap.get(`${row.journey_path_id}:${row.course_id}`);
      const stepNumber = Math.max(1, stepRecord?.step_number ?? 1);
      const courseTitle = toStringValue(courseMap.get(row.course_id)?.title).trim();
      const title = courseTitle || `${learningFieldName} Course ${stepNumber} completed`;
      const completedAt = toStringValue(row.completed_at);

      return {
        title,
        stepNumber,
        completedAt,
        learningFieldName,
      } satisfies RecentCompletedCourse;
    })
    .filter((item) => Boolean(item.completedAt))
    .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
    .slice(0, limit);

  console.info("[journey_summary] complete", {
    ...logContext,
    journey_path_ids_count: journeyPathIds.length,
    course_ids_count: courseIds.length,
    items_count: items.length,
  });

  return items;
}
