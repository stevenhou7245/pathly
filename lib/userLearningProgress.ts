import { supabaseAdmin } from "@/lib/supabaseAdmin";

type LearningFieldRow = {
  id: string;
  user_id: string;
  field_id: string;
  current_level: string | null;
  target_level: string | null;
  active_route_id: string | null;
  started_at: string | null;
  status?: string | null;
};

type GenericRecord = Record<string, unknown>;

export type UserLearningFieldSummary = {
  id: string;
  field_id: string;
  field_title: string;
  current_level: string | null;
  target_level: string | null;
  active_route_id: string | null;
  started_at: string | null;
  completed_steps_count: number;
  total_steps_count: number;
  percentage_progress: number;
};

type JourneyRouteNode = {
  id: string;
  route_id: string;
  course_id: string;
  title: string;
  description: string | null;
  order_index: number;
};

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

function getFieldTitle(field: GenericRecord | undefined) {
  if (!field) {
    return "Untitled Field";
  }
  const title = toStringValue(field.title);
  if (title) {
    return title;
  }
  const name = toStringValue(field.name);
  if (name) {
    return name;
  }
  return "Untitled Field";
}

function getRouteTitle(route: GenericRecord) {
  const explicit = toStringValue(route.title);
  if (explicit) {
    return explicit;
  }
  const start = toStringValue(route.starting_point).trim() || "Current level";
  const end = toStringValue(route.destination).trim() || "Target level";
  return `${start} -> ${end}`;
}

async function loadJourneyPathRows(params: { userId: string; fieldIds: string[] }) {
  if (params.fieldIds.length === 0) {
    return [] as GenericRecord[];
  }

  const { data, error } = await supabaseAdmin
    .from("journey_paths")
    .select("id, user_id, learning_field_id, total_steps, created_at, starting_point, destination")
    .eq("user_id", params.userId)
    .in("learning_field_id", params.fieldIds);

  if (error) {
    throw new Error("Failed to load journey paths.");
  }

  console.info("[journey_read] source_table_used", {
    table: "journey_paths",
    user_id: params.userId,
    field_count: params.fieldIds.length,
  });

  return (data ?? []) as GenericRecord[];
}

async function loadJourneyNodesByRouteIds(routeIds: string[]) {
  if (routeIds.length === 0) {
    return [] as JourneyRouteNode[];
  }

  const { data, error } = await supabaseAdmin
    .from("journey_path_courses")
    .select("id, journey_path_id, course_id, step_number, title, description")
    .in("journey_path_id", routeIds)
    .order("step_number", { ascending: true });

  if (error) {
    throw new Error("Failed to load journey path courses.");
  }

  console.info("[journey_read] source_table_used", {
    table: "journey_path_courses",
    route_count: routeIds.length,
  });

  return ((data ?? []) as GenericRecord[])
    .map((row) => {
      const routeId = toStringValue(row.journey_path_id);
      const courseId = toStringValue(row.course_id);
      const step = Math.max(1, Math.floor(toNumber(row.step_number) || 1));
      if (!routeId || !courseId) {
        return null;
      }
      return {
        id: toStringValue(row.id) || `${routeId}:${courseId}:${step}`,
        route_id: routeId,
        course_id: courseId,
        title: toStringValue(row.title) || `Step ${step}`,
        description: toNullableString(row.description),
        order_index: step,
      } satisfies JourneyRouteNode;
    })
    .filter(Boolean) as JourneyRouteNode[];
}

async function getProgressRowsForRouteIds(params: { userId: string; routeIds: string[] }) {
  if (params.routeIds.length === 0) {
    return [] as GenericRecord[];
  }

  const { data, error } = await supabaseAdmin
    .from("user_course_progress")
    .select("journey_path_id, course_id, status")
    .eq("user_id", params.userId)
    .in("journey_path_id", params.routeIds);

  if (error) {
    throw new Error("Failed to load course progress.");
  }

  return (data ?? []) as GenericRecord[];
}

export async function getUserLearningFieldsSummary(
  userId: string,
): Promise<UserLearningFieldSummary[]> {
  const { data: userLearningFields, error: userLearningFieldsError } = await supabaseAdmin
    .from("user_learning_fields")
    .select("id, user_id, field_id, current_level, target_level, active_route_id, started_at")
    .eq("user_id", userId)
    .order("started_at", { ascending: true });

  if (userLearningFieldsError) {
    throw new Error("Failed to load user learning fields.");
  }

  const typedRows = (userLearningFields ?? []) as LearningFieldRow[];
  const fieldIds = Array.from(new Set(typedRows.map((row) => row.field_id).filter(Boolean)));

  const [learningFieldsResult, journeyPaths] = await Promise.all([
    supabaseAdmin.from("learning_fields").select("*").in("id", fieldIds),
    loadJourneyPathRows({ userId, fieldIds }),
  ]);

  if (learningFieldsResult.error) {
    throw new Error("Failed to load learning fields.");
  }

  const learningFieldsById = new Map<string, GenericRecord>();
  ((learningFieldsResult.data ?? []) as GenericRecord[]).forEach((field) => {
    learningFieldsById.set(toStringValue(field.id), field);
  });

  const pathByFieldId = new Map<string, GenericRecord>();
  journeyPaths.forEach((path) => {
    const fieldId = toStringValue(path.learning_field_id);
    const previous = pathByFieldId.get(fieldId);
    if (!previous || (toStringValue(path.created_at) > toStringValue(previous.created_at))) {
      pathByFieldId.set(fieldId, path);
    }
  });

  const routeIds = journeyPaths.map((path) => toStringValue(path.id)).filter(Boolean);
  const [nodes, progressRows] = await Promise.all([
    loadJourneyNodesByRouteIds(routeIds),
    getProgressRowsForRouteIds({ userId, routeIds }),
  ]);

  const completedByRoute = new Map<string, Set<string>>();
  progressRows.forEach((row) => {
    const status = toStringValue(row.status).toLowerCase();
    if (status !== "passed" && status !== "completed") {
      return;
    }
    const routeId = toStringValue(row.journey_path_id);
    const courseId = toStringValue(row.course_id);
    if (!routeId || !courseId) {
      return;
    }
    const existing = completedByRoute.get(routeId) ?? new Set<string>();
    existing.add(courseId);
    completedByRoute.set(routeId, existing);
  });

  const nodeCountByRoute = new Map<string, number>();
  nodes.forEach((node) => {
    nodeCountByRoute.set(node.route_id, (nodeCountByRoute.get(node.route_id) ?? 0) + 1);
  });

  return typedRows.map((row) => {
    const latestPath = pathByFieldId.get(row.field_id);
    const routeId = toStringValue(latestPath?.id);
    const completedCount = completedByRoute.get(routeId)?.size ?? 0;
    const totalCount = Math.max(
      nodeCountByRoute.get(routeId) ?? 0,
      Math.floor(toNumber(latestPath?.total_steps) || 0),
    );
    const percentage =
      totalCount === 0 ? 0 : Number(((completedCount / totalCount) * 100).toFixed(1));

    return {
      id: row.id,
      field_id: row.field_id,
      field_title: getFieldTitle(learningFieldsById.get(row.field_id)),
      current_level: row.current_level,
      target_level: row.target_level,
      active_route_id: row.active_route_id || routeId || null,
      started_at: row.started_at,
      completed_steps_count: completedCount,
      total_steps_count: totalCount,
      percentage_progress: percentage,
    };
  });
}

export async function ensureLearningFieldExists(fieldId: string) {
  const { data: field, error } = await supabaseAdmin
    .from("learning_fields")
    .select("*")
    .eq("id", fieldId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to validate learning field.");
  }

  return field as GenericRecord | null;
}

export async function findLearningFieldByGoal(learningGoal: string) {
  const normalizedGoal = learningGoal.trim().toLowerCase();
  if (!normalizedGoal) {
    return null;
  }

  const { data, error } = await supabaseAdmin.from("learning_fields").select("*");
  if (error) {
    throw new Error("Failed to load learning fields.");
  }

  const fields = (data ?? []) as GenericRecord[];
  const exactMatch = fields.find((field) => {
    const title = toStringValue(field.title).trim().toLowerCase();
    const name = toStringValue(field.name).trim().toLowerCase();
    return title === normalizedGoal || name === normalizedGoal;
  });
  if (exactMatch) {
    return exactMatch;
  }

  return (
    fields.find((field) => {
      const title = toStringValue(field.title).trim().toLowerCase();
      const name = toStringValue(field.name).trim().toLowerCase();
      return title.includes(normalizedGoal) || name.includes(normalizedGoal);
    }) ?? null
  );
}

export async function ensureRouteBelongsToField(routeId: string, fieldId: string) {
  const { data: route, error } = await supabaseAdmin
    .from("journey_paths")
    .select("id, learning_field_id")
    .eq("id", routeId)
    .limit(1)
    .maybeSingle<{ id: string; learning_field_id: string }>();

  if (error) {
    throw new Error("Failed to validate journey path.");
  }
  if (!route) {
    return false;
  }

  console.info("[migration_cleanup] replaced_with_source_of_truth", {
    old_table: "field_routes",
    new_table: "journey_paths",
    route_id: routeId,
    field_id: fieldId,
  });

  return route.learning_field_id === fieldId;
}

export async function getUserLearningFieldById(userId: string, id: string) {
  const { data, error } = await supabaseAdmin
    .from("user_learning_fields")
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load learning field.");
  }
  return data as GenericRecord | null;
}

export async function getUserLearningFieldByFieldId(userId: string, fieldId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_learning_fields")
    .select("*")
    .eq("user_id", userId)
    .eq("field_id", fieldId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load learning field.");
  }
  return data as GenericRecord | null;
}

export async function createUserLearningField(params: {
  userId: string;
  fieldId: string;
  currentLevel: string;
  targetLevel: string;
  activeRouteId?: string;
}) {
  const insertPayload: Record<string, unknown> = {
    user_id: params.userId,
    field_id: params.fieldId,
    current_level: params.currentLevel,
    target_level: params.targetLevel,
    started_at: new Date().toISOString(),
  };

  if (params.activeRouteId !== undefined) {
    insertPayload.active_route_id = params.activeRouteId;
  }

  const { data, error } = await supabaseAdmin
    .from("user_learning_fields")
    .insert(insertPayload)
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to create user learning field.");
  }
  return data as GenericRecord;
}

export async function updateUserLearningField(params: {
  userId: string;
  id: string;
  patch: Record<string, unknown>;
}) {
  const { data, error } = await supabaseAdmin
    .from("user_learning_fields")
    .update(params.patch)
    .eq("id", params.id)
    .eq("user_id", params.userId)
    .select("*")
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to update user learning field.");
  }
  return data as GenericRecord | null;
}

export async function getUserFieldProgress(userId: string, fieldId: string) {
  const userField = await getUserLearningFieldByFieldId(userId, fieldId);
  if (!userField) {
    return null;
  }

  const { data: journeyPaths, error: journeyPathsError } = await supabaseAdmin
    .from("journey_paths")
    .select("id, learning_field_id, starting_point, destination, total_steps, created_at")
    .eq("user_id", userId)
    .eq("learning_field_id", fieldId)
    .order("created_at", { ascending: false });

  if (journeyPathsError) {
    throw new Error("Failed to load journey paths.");
  }

  console.info("[journey_read] source_table_used", {
    table: "journey_paths",
    user_id: userId,
    field_id: fieldId,
  });

  const routes = (journeyPaths ?? []) as GenericRecord[];
  const routeIds = routes.map((route) => toStringValue(route.id)).filter(Boolean);
  const nodes = await loadJourneyNodesByRouteIds(routeIds);
  const progressRows = await getProgressRowsForRouteIds({ userId, routeIds });

  const completedKey = new Set(
    progressRows
      .filter((row) => {
        const status = toStringValue(row.status).toLowerCase();
        return status === "passed" || status === "completed";
      })
      .map((row) => `${toStringValue(row.journey_path_id)}:${toStringValue(row.course_id)}`),
  );

  const formattedRoutes = routes.map((route) => {
    const routeId = toStringValue(route.id);
    const routeNodes = nodes
      .filter((node) => node.route_id === routeId)
      .sort((a, b) => a.order_index - b.order_index);
    return {
      id: routeId,
      title: getRouteTitle(route),
      field_id: toStringValue(route.learning_field_id),
      nodes: routeNodes.map((node) => ({
        id: node.id,
        route_id: routeId,
        title: node.title,
        type: "course",
        link: null,
        description: node.description,
        order_index: node.order_index,
      })),
    };
  });

  const completedNodeIds = nodes
    .filter((node) => completedKey.has(`${node.route_id}:${node.course_id}`))
    .map((node) => node.id);
  const totalSteps = nodes.length;
  const completedSteps = completedNodeIds.length;

  const activeRouteId =
    toNullableString(userField.active_route_id) || toStringValue(routes[0]?.id) || null;
  const fieldRecord = await ensureLearningFieldExists(fieldId);

  return {
    field_id: fieldId,
    field_title: getFieldTitle(fieldRecord ?? undefined),
    current_level: toNullableString(userField.current_level),
    target_level: toNullableString(userField.target_level),
    active_route_id: activeRouteId,
    status: toNullableString(userField.status),
    started_at: toNullableString(userField.started_at),
    routes: formattedRoutes,
    completed_node_ids: completedNodeIds,
    summary: {
      completed_steps_count: completedSteps,
      total_steps_count: totalSteps,
      percentage_progress:
        totalSteps === 0 ? 0 : Number(((completedSteps / totalSteps) * 100).toFixed(1)),
    },
  };
}

export async function markNodeCompletedForUser(userId: string, nodeId: string) {
  const nodeLookup = await supabaseAdmin
    .from("journey_path_courses")
    .select("id, journey_path_id, course_id")
    .eq("id", nodeId)
    .limit(1)
    .maybeSingle<{ id: string; journey_path_id: string; course_id: string }>();
  let node = nodeLookup.data ?? null;
  const nodeError = nodeLookup.error;

  if (nodeError) {
    throw new Error("Failed to validate journey step.");
  }

  if (!node) {
    const fallbackByCourse = await supabaseAdmin
      .from("journey_path_courses")
      .select("id, journey_path_id, course_id")
      .eq("course_id", nodeId)
      .order("step_number", { ascending: true })
      .limit(1)
      .maybeSingle<{ id: string; journey_path_id: string; course_id: string }>();
    if (fallbackByCourse.error) {
      throw new Error("Failed to validate journey step.");
    }
    node = fallbackByCourse.data ?? null;
  }

  if (!node) {
    return {
      ok: false as const,
      reason: "NODE_NOT_FOUND",
    };
  }

  const { data: route, error: routeError } = await supabaseAdmin
    .from("journey_paths")
    .select("id, user_id, learning_field_id")
    .eq("id", node.journey_path_id)
    .limit(1)
    .maybeSingle<{ id: string; user_id: string; learning_field_id: string }>();

  if (routeError) {
    throw new Error("Failed to validate journey path.");
  }
  if (!route) {
    return {
      ok: false as const,
      reason: "ROUTE_NOT_FOUND",
    };
  }
  if (route.user_id !== userId) {
    return {
      ok: false as const,
      reason: "FIELD_NOT_ENROLLED",
      field_id: route.learning_field_id,
    };
  }

  const userField = await getUserLearningFieldByFieldId(userId, route.learning_field_id);
  if (!userField) {
    return {
      ok: false as const,
      reason: "FIELD_NOT_ENROLLED",
      field_id: route.learning_field_id,
    };
  }

  const { data: existingProgress, error: existingProgressError } = await supabaseAdmin
    .from("user_course_progress")
    .select("id, status")
    .eq("user_id", userId)
    .eq("journey_path_id", node.journey_path_id)
    .eq("course_id", node.course_id)
    .limit(1)
    .maybeSingle();

  if (existingProgressError) {
    throw new Error("Failed to validate course progress.");
  }

  const nowIso = new Date().toISOString();
  if (existingProgress) {
    const existingStatus = toStringValue((existingProgress as GenericRecord).status).toLowerCase();
    if (existingStatus !== "passed" && existingStatus !== "completed") {
      const { error: updateError } = await supabaseAdmin
        .from("user_course_progress")
        .update({
          status: "passed",
          last_activity_at: nowIso,
        })
        .eq("id", toStringValue((existingProgress as GenericRecord).id));
      if (updateError) {
        throw new Error("Failed to mark course as completed.");
      }
    }
  } else {
    const { error: insertError } = await supabaseAdmin
      .from("user_course_progress")
      .insert({
        user_id: userId,
        journey_path_id: node.journey_path_id,
        course_id: node.course_id,
        status: "passed",
        last_activity_at: nowIso,
      });
    if (insertError) {
      throw new Error("Failed to mark course as completed.");
    }
  }

  return {
    ok: true as const,
    already_completed: Boolean(existingProgress),
    field_id: route.learning_field_id,
    node_id: node.id,
  };
}
