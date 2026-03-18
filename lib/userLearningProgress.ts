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

type FieldGraphBundle = {
  learningFieldsById: Map<string, GenericRecord>;
  routesByFieldId: Map<string, GenericRecord[]>;
  nodesByRouteId: Map<string, GenericRecord[]>;
  nodeIds: string[];
};

function toStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function toNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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

function sortNodes(nodes: GenericRecord[]) {
  return [...nodes].sort((a, b) => {
    const aOrder = toNumber(a.order_index) || toNumber(a.position);
    const bOrder = toNumber(b.order_index) || toNumber(b.position);
    return aOrder - bOrder;
  });
}

async function loadFieldGraphBundle(fieldIds: string[]): Promise<FieldGraphBundle> {
  if (fieldIds.length === 0) {
    return {
      learningFieldsById: new Map<string, GenericRecord>(),
      routesByFieldId: new Map<string, GenericRecord[]>(),
      nodesByRouteId: new Map<string, GenericRecord[]>(),
      nodeIds: [],
    };
  }

  const { data: learningFields, error: learningFieldsError } = await supabaseAdmin
    .from("learning_fields")
    .select("*")
    .in("id", fieldIds);

  if (learningFieldsError) {
    throw new Error("Failed to load learning fields.");
  }

  const learningFieldsById = new Map<string, GenericRecord>();
  (learningFields ?? []).forEach((field) => {
    learningFieldsById.set(toStringValue((field as GenericRecord).id), field as GenericRecord);
  });

  const { data: routes, error: routesError } = await supabaseAdmin
    .from("field_routes")
    .select("*")
    .in("field_id", fieldIds);

  if (routesError) {
    throw new Error("Failed to load field routes.");
  }

  const routesByFieldId = new Map<string, GenericRecord[]>();
  const routeIds: string[] = [];

  (routes ?? []).forEach((route) => {
    const routeRecord = route as GenericRecord;
    const fieldId = toStringValue(routeRecord.field_id);
    const routeId = toStringValue(routeRecord.id);
    if (!fieldId || !routeId) {
      return;
    }

    if (!routesByFieldId.has(fieldId)) {
      routesByFieldId.set(fieldId, []);
    }
    routesByFieldId.get(fieldId)?.push(routeRecord);
    routeIds.push(routeId);
  });

  if (routeIds.length === 0) {
    return {
      learningFieldsById,
      routesByFieldId,
      nodesByRouteId: new Map<string, GenericRecord[]>(),
      nodeIds: [],
    };
  }

  const { data: nodes, error: nodesError } = await supabaseAdmin
    .from("route_nodes")
    .select("*")
    .in("route_id", routeIds);

  if (nodesError) {
    throw new Error("Failed to load route nodes.");
  }

  const nodesByRouteId = new Map<string, GenericRecord[]>();
  const nodeIds: string[] = [];

  (nodes ?? []).forEach((node) => {
    const nodeRecord = node as GenericRecord;
    const routeId = toStringValue(nodeRecord.route_id);
    const nodeId = toStringValue(nodeRecord.id);
    if (!routeId || !nodeId) {
      return;
    }

    if (!nodesByRouteId.has(routeId)) {
      nodesByRouteId.set(routeId, []);
    }
    nodesByRouteId.get(routeId)?.push(nodeRecord);
    nodeIds.push(nodeId);
  });

  for (const [routeId, routeNodes] of nodesByRouteId.entries()) {
    nodesByRouteId.set(routeId, sortNodes(routeNodes));
  }

  return {
    learningFieldsById,
    routesByFieldId,
    nodesByRouteId,
    nodeIds,
  };
}

async function getCompletedNodeIdSet(userId: string, nodeIds: string[]) {
  if (nodeIds.length === 0) {
    return new Set<string>();
  }

  const { data: progressRows, error: progressRowsError } = await supabaseAdmin
    .from("user_node_progress")
    .select("node_id")
    .eq("user_id", userId)
    .in("node_id", nodeIds);

  if (progressRowsError) {
    throw new Error("Failed to load node progress.");
  }

  return new Set<string>(
    (progressRows ?? [])
      .map((row) => toStringValue((row as GenericRecord).node_id))
      .filter(Boolean),
  );
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
  const fieldIds = Array.from(new Set(typedRows.map((row) => row.field_id)));

  const graphBundle = await loadFieldGraphBundle(fieldIds);
  const completedNodeSet = await getCompletedNodeIdSet(userId, graphBundle.nodeIds);

  return typedRows.map((row) => {
    const routes = graphBundle.routesByFieldId.get(row.field_id) ?? [];
    const routeIds = routes
      .map((route) => toStringValue(route.id))
      .filter(Boolean);
    const nodes = routeIds.flatMap((routeId) => graphBundle.nodesByRouteId.get(routeId) ?? []);
    const totalSteps = nodes.length;
    const completedSteps = nodes.reduce((count, node) => {
      const nodeId = toStringValue(node.id);
      return completedNodeSet.has(nodeId) ? count + 1 : count;
    }, 0);
    const percentage =
      totalSteps === 0 ? 0 : Number(((completedSteps / totalSteps) * 100).toFixed(1));

    return {
      id: row.id,
      field_id: row.field_id,
      field_title: getFieldTitle(graphBundle.learningFieldsById.get(row.field_id)),
      current_level: row.current_level,
      target_level: row.target_level,
      active_route_id: row.active_route_id,
      started_at: row.started_at,
      completed_steps_count: completedSteps,
      total_steps_count: totalSteps,
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

  const { data, error } = await supabaseAdmin
    .from("learning_fields")
    .select("*");

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
    .from("field_routes")
    .select("id, field_id")
    .eq("id", routeId)
    .limit(1)
    .maybeSingle<{ id: string; field_id: string }>();

  if (error) {
    throw new Error("Failed to validate route.");
  }

  if (!route) {
    return false;
  }

  return route.field_id === fieldId;
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

  return (data as GenericRecord | null);
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

  return (data as GenericRecord | null);
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

  const graphBundle = await loadFieldGraphBundle([fieldId]);
  const completedNodeSet = await getCompletedNodeIdSet(userId, graphBundle.nodeIds);

  const fieldRecord = graphBundle.learningFieldsById.get(fieldId);
  const routes = graphBundle.routesByFieldId.get(fieldId) ?? [];

  const formattedRoutes = routes.map((route) => {
    const routeId = toStringValue(route.id);
    const nodes = graphBundle.nodesByRouteId.get(routeId) ?? [];

    return {
      id: routeId,
      title: getRouteTitle(route),
      field_id: toStringValue(route.field_id),
      nodes: nodes.map((node) => ({
        id: toStringValue(node.id),
        route_id: toStringValue(node.route_id),
        title: toNullableString(node.title) ?? "Untitled Node",
        type: toNullableString(node.type),
        link: toNullableString(node.link),
        description: toNullableString(node.description),
        order_index:
          typeof node.order_index === "number"
            ? node.order_index
            : typeof node.position === "number"
              ? node.position
              : null,
      })),
    };
  });

  const totalSteps = formattedRoutes.reduce((count, route) => count + route.nodes.length, 0);
  const completedSteps = formattedRoutes.reduce((count, route) => {
    return (
      count +
      route.nodes.reduce((routeCount, node) => {
        return completedNodeSet.has(node.id) ? routeCount + 1 : routeCount;
      }, 0)
    );
  }, 0);

  return {
    field_id: fieldId,
    field_title: getFieldTitle(fieldRecord),
    current_level: toNullableString(userField.current_level),
    target_level: toNullableString(userField.target_level),
    active_route_id: toNullableString(userField.active_route_id),
    status: toNullableString(userField.status),
    started_at: toNullableString(userField.started_at),
    routes: formattedRoutes,
    completed_node_ids: Array.from(completedNodeSet),
    summary: {
      completed_steps_count: completedSteps,
      total_steps_count: totalSteps,
      percentage_progress:
        totalSteps === 0 ? 0 : Number(((completedSteps / totalSteps) * 100).toFixed(1)),
    },
  };
}

export async function markNodeCompletedForUser(userId: string, nodeId: string) {
  const { data: node, error: nodeError } = await supabaseAdmin
    .from("route_nodes")
    .select("id, route_id")
    .eq("id", nodeId)
    .limit(1)
    .maybeSingle<{ id: string; route_id: string }>();

  if (nodeError) {
    throw new Error("Failed to validate node.");
  }

  if (!node) {
    return {
      ok: false as const,
      reason: "NODE_NOT_FOUND",
    };
  }

  const { data: route, error: routeError } = await supabaseAdmin
    .from("field_routes")
    .select("id, field_id")
    .eq("id", node.route_id)
    .limit(1)
    .maybeSingle<{ id: string; field_id: string }>();

  if (routeError) {
    throw new Error("Failed to validate route.");
  }

  if (!route) {
    return {
      ok: false as const,
      reason: "ROUTE_NOT_FOUND",
    };
  }

  const userField = await getUserLearningFieldByFieldId(userId, route.field_id);
  if (!userField) {
    return {
      ok: false as const,
      reason: "FIELD_NOT_ENROLLED",
      field_id: route.field_id,
    };
  }

  const { data: existingProgress, error: existingProgressError } = await supabaseAdmin
    .from("user_node_progress")
    .select("node_id")
    .eq("user_id", userId)
    .eq("node_id", nodeId)
    .limit(1)
    .maybeSingle<{ node_id: string }>();

  if (existingProgressError) {
    throw new Error("Failed to validate node progress.");
  }

  if (!existingProgress) {
    const { error: insertProgressError } = await supabaseAdmin
      .from("user_node_progress")
      .insert({
        user_id: userId,
        node_id: nodeId,
        completed_at: new Date().toISOString(),
      });

    if (insertProgressError) {
      throw new Error("Failed to mark node as completed.");
    }
  }

  return {
    ok: true as const,
    already_completed: Boolean(existingProgress),
    field_id: route.field_id,
    node_id: nodeId,
  };
}
