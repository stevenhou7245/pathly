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
  const title = toStringValue(route.title);
  if (title) {
    return title;
  }
  const name = toStringValue(route.name);
  if (name) {
    return name;
  }
  return "Route";
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
    const rating = toNumber(row.rating);
    totalByRoute.set(routeId, (totalByRoute.get(routeId) ?? 0) + rating);
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
    .from("field_routes")
    .select("*")
    .eq("id", routeId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load route.");
  }

  return (data ?? null) as GenericRecord | null;
}

async function getRoutesByFieldId(fieldId: string): Promise<GenericRecord[]> {
  const { data, error } = await supabaseAdmin
    .from("field_routes")
    .select("*")
    .eq("field_id", fieldId);

  if (error) {
    throw new Error("Failed to load field routes.");
  }

  return ((data ?? []) as GenericRecord[]).filter((row) => toStringValue(row.id));
}

async function getRouteNodesByRouteIds(routeIds: string[]): Promise<GenericRecord[]> {
  if (routeIds.length === 0) {
    return [];
  }

  const { data, error } = await supabaseAdmin
    .from("route_nodes")
    .select("*")
    .in("route_id", routeIds);

  if (error) {
    throw new Error("Failed to load route nodes.");
  }

  return ((data ?? []) as GenericRecord[]).filter((row) => toStringValue(row.id));
}

async function getRouteEdgesByRouteIds(routeIds: string[]): Promise<GenericRecord[]> {
  if (routeIds.length === 0) {
    return [];
  }

  const { data, error } = await supabaseAdmin
    .from("route_edges")
    .select("*")
    .in("route_id", routeIds);

  if (error) {
    throw new Error("Failed to load route edges.");
  }

  return ((data ?? []) as GenericRecord[]).filter((row) => toStringValue(row.id));
}

async function getRouteRatingsByRouteIds(routeIds: string[]): Promise<GenericRecord[]> {
  if (routeIds.length === 0) {
    return [];
  }

  const { data, error } = await supabaseAdmin
    .from("route_ratings")
    .select("route_id, rating")
    .in("route_id", routeIds);

  if (error) {
    throw new Error("Failed to load route ratings.");
  }

  return (data ?? []) as GenericRecord[];
}

export async function getMapDataForField(fieldId: string) {
  const field = await getLearningFieldById(fieldId);
  if (!field) {
    return null;
  }

  const routes = await getRoutesByFieldId(fieldId);
  const routeIds = routes.map((route) => toStringValue(route.id)).filter(Boolean);

  const [nodes, edges, ratingRows] = await Promise.all([
    getRouteNodesByRouteIds(routeIds),
    getRouteEdgesByRouteIds(routeIds),
    getRouteRatingsByRouteIds(routeIds),
  ]);

  const summaryByRoute = buildRouteRatingSummaryMap({
    routeIds,
    ratingRows,
  });

  const routesWithRatings = routes.map((route) => {
    const routeId = toStringValue(route.id);
    const summary = summaryByRoute.get(routeId) ?? {
      average_rating: 0,
      rating_count: 0,
    };
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

  const [nodes, edges, ratingSummary] = await Promise.all([
    getRouteNodesByRouteIds([routeId]),
    getRouteEdgesByRouteIds([routeId]),
    getRouteRatingSummary(routeId),
  ]);

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
  const summary = buildRouteRatingSummaryMap({
    routeIds: [routeId],
    ratingRows: ratings,
  }).get(routeId);

  return (
    summary ?? {
      average_rating: 0,
      rating_count: 0,
    }
  );
}

export async function getCurrentUserRouteRating(params: {
  routeId: string;
  userId: string;
}): Promise<RouteRatingRecord | null> {
  const { data, error } = await supabaseAdmin
    .from("route_ratings")
    .select("id, route_id, user_id, rating, review, created_at")
    .eq("route_id", params.routeId)
    .eq("user_id", params.userId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load user route rating.");
  }

  if (!data) {
    return null;
  }

  return normalizeRouteRatingRecord((data ?? {}) as GenericRecord);
}

export async function submitOrUpdateRouteRating(params: {
  routeId: string;
  userId: string;
  rating: number;
  review?: string;
}) {
  const review = params.review ?? null;

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("route_ratings")
    .select("id")
    .eq("route_id", params.routeId)
    .eq("user_id", params.userId)
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (existingError) {
    throw new Error("Failed to validate existing route rating.");
  }

  if (existing) {
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("route_ratings")
      .update({
        rating: params.rating,
        review,
      })
      .eq("id", existing.id)
      .select("id, route_id, user_id, rating, review, created_at")
      .limit(1)
      .maybeSingle();

    if (updateError || !updated) {
      throw new Error("Failed to update route rating.");
    }

    return {
      created: false,
      rating: normalizeRouteRatingRecord((updated ?? {}) as GenericRecord),
    };
  }

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("route_ratings")
    .insert({
      route_id: params.routeId,
      user_id: params.userId,
      rating: params.rating,
      review,
    })
    .select("id, route_id, user_id, rating, review, created_at")
    .limit(1)
    .maybeSingle();

  if (insertError || !inserted) {
    throw new Error("Failed to submit route rating.");
  }

  return {
    created: true,
    rating: normalizeRouteRatingRecord((inserted ?? {}) as GenericRecord),
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
  const nodes = await getRouteNodesByRouteIds(routeIds);
  const nodeIds = nodes.map((node) => toStringValue(node.id)).filter(Boolean);

  let completedNodeIds: string[] = [];
  if (nodeIds.length > 0) {
    const { data: completedRows, error: completedRowsError } = await supabaseAdmin
      .from("user_node_progress")
      .select("node_id")
      .eq("user_id", params.userId)
      .in("node_id", nodeIds);

    if (completedRowsError) {
      throw new Error("Failed to load completed nodes.");
    }

    completedNodeIds = (completedRows ?? [])
      .map((row) => toStringValue((row as GenericRecord).node_id))
      .filter(Boolean);
  }

  const uniqueCompletedNodeIds = Array.from(new Set(completedNodeIds));
  const totalSteps = nodeIds.length;
  const completedSteps = uniqueCompletedNodeIds.length;

  const activeRouteId = toNullableString(userField.active_route_id);
  const activeRouteRecord = activeRouteId
    ? routes.find((route) => toStringValue(route.id) === activeRouteId) ?? null
    : null;

  return {
    field_id: params.fieldId,
    user_learning_field_id: toStringValue(userField.id),
    active_route: activeRouteRecord
      ? {
          id: toStringValue(activeRouteRecord.id),
          field_id: toStringValue(activeRouteRecord.field_id),
          title: getRouteTitle(activeRouteRecord),
        }
      : null,
    active_route_id: activeRouteId,
    started_at: toNullableString(userField.started_at),
    status: toNullableString(userField.status),
    completed_node_ids: uniqueCompletedNodeIds,
    summary: {
      completed_steps_count: completedSteps,
      total_steps_count: totalSteps,
      percentage_progress:
        totalSteps === 0 ? 0 : Number(((completedSteps / totalSteps) * 100).toFixed(1)),
    },
  };
}
