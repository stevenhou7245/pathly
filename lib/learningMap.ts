import { supabaseAdmin } from "@/lib/supabaseAdmin";

type GenericRecord = Record<string, unknown>;

export type RouteRatingSummary = {
  average_rating: number;
  rating_count: number;
};

export type RouteRatingRecord = {
  id: string;
  route_id: string;
  user_id: string;
  rating: number;
  review: string | null;
  created_at: string | null;
};

type JourneyPathCourseRow = {
  id: string;
  journey_path_id: string;
  course_id: string | null;
  step_number: number;
  title: string | null;
  description: string | null;
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

function getRouteTitle(route: GenericRecord) {
  const explicit = toStringValue(route.title);
  if (explicit) {
    return explicit;
  }
  const start = toStringValue(route.starting_point).trim() || "Current level";
  const end = toStringValue(route.destination).trim() || "Target level";
  return `${start} -> ${end}`;
}

function normalizeRouteRatingRecord(row: GenericRecord): RouteRatingRecord {
  return {
    id: toStringValue(row.id),
    route_id: toStringValue(row.route_id),
    user_id: toStringValue(row.user_id),
    rating: toNumber(row.rating),
    review: toNullableString(row.review),
    created_at: toNullableString(row.created_at),
  };
}

async function getJourneyPathCoursesByRouteIds(routeIds: string[]) {
  if (routeIds.length === 0) {
    return [] as JourneyPathCourseRow[];
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

  return ((data ?? []) as GenericRecord[]).map((row) => ({
    id: toStringValue(row.id),
    journey_path_id: toStringValue(row.journey_path_id),
    course_id: toNullableString(row.course_id),
    step_number: Math.max(1, Math.floor(toNumber(row.step_number) || 1)),
    title: toNullableString(row.title),
    description: toNullableString(row.description),
  }));
}

function toNodeId(row: JourneyPathCourseRow) {
  return row.id || `${row.journey_path_id}:${row.course_id || "course"}:${row.step_number}`;
}

function buildNodesAndEdges(pathCourses: JourneyPathCourseRow[]) {
  const nodes = pathCourses.map((row) => ({
    id: toNodeId(row),
    route_id: row.journey_path_id,
    course_id: row.course_id,
    title: row.title || `Step ${row.step_number}`,
    description: row.description,
    type: "course",
    link: null,
    order_index: row.step_number,
  }));

  const byRoute = new Map<string, typeof nodes>();
  nodes.forEach((node) => {
    const routeId = toStringValue(node.route_id);
    const existing = byRoute.get(routeId) ?? [];
    existing.push(node);
    byRoute.set(routeId, existing);
  });

  const edges: Array<Record<string, unknown>> = [];
  for (const [routeId, routeNodes] of byRoute.entries()) {
    const sorted = [...routeNodes].sort(
      (a, b) => toNumber(a.order_index) - toNumber(b.order_index),
    );
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const from = sorted[index];
      const to = sorted[index + 1];
      edges.push({
        id: `${routeId}:${toStringValue(from.id)}->${toStringValue(to.id)}`,
        route_id: routeId,
        from_node_id: from.id,
        to_node_id: to.id,
      });
    }
  }

  return { nodes, edges };
}

async function getResourceOptionIdsForRoute(routeId: string) {
  const pathCourses = await getJourneyPathCoursesByRouteIds([routeId]);
  const courseIds = Array.from(
    new Set(pathCourses.map((row) => toStringValue(row.course_id)).filter(Boolean)),
  );
  if (courseIds.length === 0) {
    return [] as string[];
  }

  const { data, error } = await supabaseAdmin
    .from("course_resource_options")
    .select("id")
    .in("course_id", courseIds);

  if (error) {
    throw new Error("Failed to load route resource options.");
  }

  console.info("[resource_read] source_table_used", {
    table: "course_resource_options",
    route_id: routeId,
  });

  return ((data ?? []) as GenericRecord[])
    .map((row) => toStringValue(row.id))
    .filter(Boolean);
}

async function getPrimaryResourceOptionIdForRoute(routeId: string) {
  const pathCourses = await getJourneyPathCoursesByRouteIds([routeId]);
  const sortedCourses = [...pathCourses].sort((a, b) => a.step_number - b.step_number);
  for (const row of sortedCourses) {
    const courseId = toStringValue(row.course_id);
    if (!courseId) {
      continue;
    }
    const { data, error } = await supabaseAdmin
      .from("course_resource_options")
      .select("id")
      .eq("course_id", courseId)
      .order("option_no", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!error && data) {
      return toStringValue((data as GenericRecord).id) || null;
    }
  }
  return null;
}

export async function getLearningFieldById(fieldId: string): Promise<GenericRecord | null> {
  const { data, error } = await supabaseAdmin
    .from("learning_fields")
    .select("*")
    .eq("id", fieldId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load learning field.");
  }

  return (data ?? null) as GenericRecord | null;
}

export async function getRouteById(routeId: string): Promise<GenericRecord | null> {
  const { data, error } = await supabaseAdmin
    .from("journey_paths")
    .select("*")
    .eq("id", routeId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load route.");
  }

  if (!data) {
    return null;
  }

  console.info("[journey_read] source_table_used", {
    table: "journey_paths",
    route_id: routeId,
  });

  return {
    ...(data as GenericRecord),
    field_id: toStringValue((data as GenericRecord).learning_field_id),
    title: getRouteTitle((data as GenericRecord) ?? {}),
  };
}

async function getRoutesByFieldId(fieldId: string): Promise<GenericRecord[]> {
  const { data, error } = await supabaseAdmin
    .from("journey_paths")
    .select("*")
    .eq("learning_field_id", fieldId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("Failed to load field routes.");
  }

  console.info("[journey_read] source_table_used", {
    table: "journey_paths",
    learning_field_id: fieldId,
  });

  return ((data ?? []) as GenericRecord[])
    .filter((row) => toStringValue(row.id))
    .map((row) => ({
      ...row,
      field_id: toStringValue(row.learning_field_id),
      title: getRouteTitle(row),
    }));
}

async function getRouteRatingsByRouteIds(routeIds: string[]) {
  if (routeIds.length === 0) {
    return [] as GenericRecord[];
  }

  const ratingRows: GenericRecord[] = [];
  for (const routeId of routeIds) {
    const resourceIds = await getResourceOptionIdsForRoute(routeId);
    if (resourceIds.length === 0) {
      continue;
    }
    const { data, error } = await supabaseAdmin
      .from("resource_ratings")
      .select("resource_id, user_id, rating")
      .in("resource_id", resourceIds);
    if (error) {
      throw new Error("Failed to load route ratings.");
    }
    ((data ?? []) as GenericRecord[]).forEach((row) => {
      ratingRows.push({
        route_id: routeId,
        user_id: toStringValue(row.user_id),
        rating: toNumber(row.rating),
      });
    });
  }
  return ratingRows;
}

function buildRouteRatingSummaryMap(params: {
  routeIds: string[];
  ratingRows: GenericRecord[];
}) {
  const totalByRoute = new Map<string, number>();
  const countByRoute = new Map<string, number>();
  params.routeIds.forEach((routeId) => {
    totalByRoute.set(routeId, 0);
    countByRoute.set(routeId, 0);
  });

  params.ratingRows.forEach((row) => {
    const routeId = toStringValue(row.route_id);
    if (!routeId || !countByRoute.has(routeId)) {
      return;
    }
    totalByRoute.set(routeId, (totalByRoute.get(routeId) ?? 0) + toNumber(row.rating));
    countByRoute.set(routeId, (countByRoute.get(routeId) ?? 0) + 1);
  });

  const summaryByRoute = new Map<string, RouteRatingSummary>();
  params.routeIds.forEach((routeId) => {
    const total = totalByRoute.get(routeId) ?? 0;
    const count = countByRoute.get(routeId) ?? 0;
    summaryByRoute.set(routeId, {
      average_rating: count === 0 ? 0 : Number((total / count).toFixed(1)),
      rating_count: count,
    });
  });
  return summaryByRoute;
}

export async function getMapDataForField(fieldId: string) {
  const field = await getLearningFieldById(fieldId);
  if (!field) {
    return null;
  }

  const routes = await getRoutesByFieldId(fieldId);
  const routeIds = routes.map((route) => toStringValue(route.id)).filter(Boolean);
  const [pathCourses, ratingRows] = await Promise.all([
    getJourneyPathCoursesByRouteIds(routeIds),
    getRouteRatingsByRouteIds(routeIds),
  ]);
  const { nodes, edges } = buildNodesAndEdges(pathCourses);
  const summaryByRoute = buildRouteRatingSummaryMap({ routeIds, ratingRows });

  const routesWithRatings = routes.map((route) => {
    const routeId = toStringValue(route.id);
    const summary = summaryByRoute.get(routeId) ?? { average_rating: 0, rating_count: 0 };
    return {
      ...route,
      average_rating: summary.average_rating,
      rating_count: summary.rating_count,
    };
  });

  return {
    field,
    routes: routesWithRatings,
    nodes,
    edges,
  };
}

export async function getRouteDetail(routeId: string) {
  const route = await getRouteById(routeId);
  if (!route) {
    return null;
  }

  const [pathCourses, ratingSummary] = await Promise.all([
    getJourneyPathCoursesByRouteIds([routeId]),
    getRouteRatingSummary(routeId),
  ]);
  const { nodes, edges } = buildNodesAndEdges(pathCourses);

  return {
    route,
    nodes,
    edges,
    average_rating: ratingSummary.average_rating,
    rating_count: ratingSummary.rating_count,
  };
}

export async function getRouteRatingSummary(routeId: string): Promise<RouteRatingSummary> {
  const ratings = await getRouteRatingsByRouteIds([routeId]);
  return (
    buildRouteRatingSummaryMap({
      routeIds: [routeId],
      ratingRows: ratings,
    }).get(routeId) ?? { average_rating: 0, rating_count: 0 }
  );
}

export async function getCurrentUserRouteRating(params: {
  routeId: string;
  userId: string;
}): Promise<RouteRatingRecord | null> {
  const resourceIds = await getResourceOptionIdsForRoute(params.routeId);
  if (resourceIds.length === 0) {
    return null;
  }

  const { data, error } = await supabaseAdmin
    .from("resource_ratings")
    .select("id, rating, created_at")
    .eq("user_id", params.userId)
    .in("resource_id", resourceIds)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("Failed to load user route rating.");
  }

  const rows = (data ?? []) as GenericRecord[];
  if (rows.length === 0) {
    return null;
  }

  const avg = Number(
    (rows.reduce((sum, row) => sum + toNumber(row.rating), 0) / rows.length).toFixed(1),
  );
  const latest = rows[0] as GenericRecord;
  return normalizeRouteRatingRecord({
    id: toStringValue(latest.id),
    route_id: params.routeId,
    user_id: params.userId,
    rating: avg,
    review: null,
    created_at: toNullableString(latest.created_at),
  });
}

export async function submitOrUpdateRouteRating(params: {
  routeId: string;
  userId: string;
  rating: number;
  review?: string;
}) {
  const resourceId = await getPrimaryResourceOptionIdForRoute(params.routeId);
  if (!resourceId) {
    throw new Error("Route does not have a rateable resource.");
  }

  const nowIso = new Date().toISOString();
  const { data: upserted, error } = await supabaseAdmin
    .from("resource_ratings")
    .upsert(
      {
        resource_id: resourceId,
        user_id: params.userId,
        rating: params.rating,
        created_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: "resource_id,user_id" },
    )
    .select("id, created_at")
    .limit(1)
    .maybeSingle();

  if (error || !upserted) {
    throw new Error("Failed to submit route rating.");
  }

  return {
    created: true,
    rating: normalizeRouteRatingRecord({
      id: toStringValue((upserted as GenericRecord).id),
      route_id: params.routeId,
      user_id: params.userId,
      rating: params.rating,
      review: toNullableString(params.review),
      created_at: toNullableString((upserted as GenericRecord).created_at),
    }),
  };
}

export async function getUserMapProgressForField(params: {
  fieldId: string;
  userId: string;
}) {
  const { data: userField, error: userFieldError } = await supabaseAdmin
    .from("user_learning_fields")
    .select("id, field_id, active_route_id, started_at, status")
    .eq("user_id", params.userId)
    .eq("field_id", params.fieldId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (userFieldError) {
    throw new Error("Failed to load user field progress.");
  }
  if (!userField) {
    return null;
  }

  const routes = await getRoutesByFieldId(params.fieldId);
  const routeIds = routes.map((route) => toStringValue(route.id)).filter(Boolean);
  const pathCourses = await getJourneyPathCoursesByRouteIds(routeIds);
  const { nodes } = buildNodesAndEdges(pathCourses);

  const { data: progressRows, error: progressRowsError } = await supabaseAdmin
    .from("user_course_progress")
    .select("journey_path_id, course_id, status")
    .eq("user_id", params.userId)
    .in("journey_path_id", routeIds);

  if (progressRowsError) {
    throw new Error("Failed to load user course progress.");
  }

  const completedKey = new Set(
    ((progressRows ?? []) as GenericRecord[])
      .filter((row) => {
        const status = toStringValue(row.status).toLowerCase();
        return status === "passed" || status === "completed";
      })
      .map(
        (row) =>
          `${toStringValue(row.journey_path_id)}:${toStringValue(row.course_id)}`,
      ),
  );

  const completedNodeIds = nodes
    .filter((node) =>
      completedKey.has(
        `${toStringValue(node.route_id)}:${toStringValue(node.course_id)}`,
      ),
    )
    .map((node) => toStringValue(node.id));

  const totalSteps = nodes.length;
  const completedSteps = completedNodeIds.length;

  const activeRouteId = toNullableString((userField as GenericRecord).active_route_id);
  const activeRouteRecord = activeRouteId
    ? routes.find((route) => toStringValue(route.id) === activeRouteId) ?? null
    : null;

  return {
    field_id: params.fieldId,
    user_learning_field_id: toStringValue((userField as GenericRecord).id),
    active_route: activeRouteRecord
      ? {
          id: toStringValue(activeRouteRecord.id),
          field_id: toStringValue(activeRouteRecord.field_id),
          title: getRouteTitle(activeRouteRecord),
        }
      : null,
    active_route_id: activeRouteId,
    started_at: toNullableString((userField as GenericRecord).started_at),
    status: toNullableString((userField as GenericRecord).status),
    completed_node_ids: completedNodeIds,
    summary: {
      completed_steps_count: completedSteps,
      total_steps_count: totalSteps,
      percentage_progress:
        totalSteps === 0 ? 0 : Number(((completedSteps / totalSteps) * 100).toFixed(1)),
    },
  };
}
