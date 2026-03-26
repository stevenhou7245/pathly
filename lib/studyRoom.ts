import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getFriendshipBetweenUsers } from "@/lib/friends";

type GenericRecord = Record<string, unknown>;

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
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function toErrorDetails(error: unknown) {
  const record = (error ?? {}) as GenericRecord;
  return {
    message: toStringValue(record.message) || "Unknown error",
    code: toNullableString(record.code),
    details: toNullableString(record.details),
    hint: toNullableString(record.hint),
  };
}

function hasMissingColumnError(error: unknown, column: string) {
  const details = toErrorDetails(error);
  const message = `${details.message} ${details.details ?? ""} ${details.hint ?? ""}`.toLowerCase();
  return (
    details.code === "42703" ||
    message.includes(`column`) && message.includes(column.toLowerCase()) && message.includes("does not exist")
  );
}

function hasMissingUpsertConstraintError(error: unknown) {
  const details = toErrorDetails(error);
  const message = `${details.message} ${details.details ?? ""} ${details.hint ?? ""}`.toLowerCase();
  return (
    message.includes("no unique") ||
    message.includes("there is no unique or exclusion constraint matching the on conflict specification")
  );
}

function normalizeRoomStyle(value: unknown) {
  const normalized = toStringValue(value).trim().toLowerCase();
  if (!normalized) {
    return "focus";
  }
  return normalized.slice(0, 40);
}

function normalizeRoomStatus(value: unknown) {
  const normalized = toStringValue(value).trim().toLowerCase();
  if (normalized === "collecting") {
    return "collecting";
  }
  if (normalized === "closed") {
    return "closed";
  }
  if (normalized === "expired") {
    return "expired";
  }
  if (normalized === "ended") {
    return "closed";
  }
  return "active";
}

const COLLECTION_WINDOW_MINUTES = 15;

function toDateOrNull(value: string | null) {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function computeExpiresAt(createdAtIso: string | null, durationMinutes: number) {
  const createdAt = toDateOrNull(createdAtIso);
  if (!createdAt) {
    return null;
  }
  return new Date(createdAt.getTime() + Math.max(1, durationMinutes) * 60_000).toISOString();
}

async function loadUsernamesByIds(userIds: string[]) {
  const uniqueIds = Array.from(new Set(userIds.map((value) => value.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) {
    return new Map<string, string>();
  }

  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, username")
    .in("id", uniqueIds);
  if (error) {
    const details = toErrorDetails(error);
    console.error("[study_room] users_lookup_failed", {
      table: "users",
      query: "loadUsernamesByIds",
      user_ids_count: uniqueIds.length,
      ...details,
    });
    throw new Error(
      `Failed to load users. table=users query=loadUsernamesByIds reason=${details.message}`,
    );
  }

  const usernamesById = new Map<string, string>();
  ((data ?? []) as GenericRecord[]).forEach((row) => {
    const id = toStringValue(row.id);
    if (!id) {
      return;
    }
    usernamesById.set(id, toStringValue(row.username) || "Unknown");
  });
  return usernamesById;
}

async function loadRoomsByIds(roomIds: string[]) {
  const uniqueIds = Array.from(new Set(roomIds.map((value) => value.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) {
    return new Map<string, ReturnType<typeof sanitizeRoomRow>>();
  }

  const withExpiresSelect =
    "id, creator_id, name, style, max_participants, password, duration_minutes, status, created_at, expires_at, closure_started_at, collection_deadline_at, ended_at";
  const fallbackSelect =
    "id, creator_id, name, style, max_participants, password, duration_minutes, status, created_at, ended_at";

  let data: GenericRecord[] | null = null;
  const withExpires = await supabaseAdmin
    .from("study_rooms")
    .select(withExpiresSelect)
    .in("id", uniqueIds);

  if (withExpires.error && hasMissingColumnError(withExpires.error, "expires_at")) {
    console.warn("[study_room] rooms_lookup_missing_column_fallback", {
      table: "study_rooms",
      query: "loadRoomsByIds",
      missing_column: "expires_at",
      room_ids_count: uniqueIds.length,
      ...toErrorDetails(withExpires.error),
    });
    const fallback = await supabaseAdmin
      .from("study_rooms")
      .select(fallbackSelect)
      .in("id", uniqueIds);
    if (fallback.error) {
      const details = toErrorDetails(fallback.error);
      console.error("[study_room] rooms_lookup_failed", {
        table: "study_rooms",
        query: "loadRoomsByIds.fallback",
        room_ids_count: uniqueIds.length,
        ...details,
      });
      throw new Error(
        `Failed to load study rooms. table=study_rooms query=loadRoomsByIds reason=${details.message}`,
      );
    }
    data = (fallback.data ?? []) as GenericRecord[];
  } else if (withExpires.error) {
    const details = toErrorDetails(withExpires.error);
    console.error("[study_room] rooms_lookup_failed", {
      table: "study_rooms",
      query: "loadRoomsByIds",
      room_ids_count: uniqueIds.length,
      ...details,
    });
    throw new Error(
      `Failed to load study rooms. table=study_rooms query=loadRoomsByIds reason=${details.message}`,
    );
  } else {
    data = (withExpires.data ?? []) as GenericRecord[];
  }

  const map = new Map<string, ReturnType<typeof sanitizeRoomRow>>();
  (data ?? []).forEach((row) => {
    const room = sanitizeRoomRow(row);
    if (!room.id) {
      return;
    }
    map.set(room.id, room);
  });
  return map;
}

function sanitizeRoomRow(row: GenericRecord) {
  const durationMinutes = Math.max(15, Math.floor(toNumberValue(row.duration_minutes) || 60));
  const createdAt = toNullableString(row.created_at);
  const expiresAt =
    toNullableString(row.expires_at) ?? computeExpiresAt(createdAt, durationMinutes);

  return {
    id: toStringValue(row.id),
    creator_id: toStringValue(row.creator_id),
    name: toStringValue(row.name),
    style: normalizeRoomStyle(row.style),
    max_participants: Math.max(1, Math.floor(toNumberValue(row.max_participants) || 10)),
    password: toStringValue(row.password),
    duration_minutes: durationMinutes,
    status: normalizeRoomStatus(row.status),
    created_at: createdAt,
    expires_at: expiresAt,
    closure_started_at: toNullableString(row.closure_started_at),
    collection_deadline_at: toNullableString(row.collection_deadline_at),
    ended_at: toNullableString(row.ended_at),
  };
}

async function beginRoomCollectingPhase(params: {
  roomId: string;
  trigger: "timer_expired" | "creator_closed";
}) {
  const nowIso = new Date().toISOString();
  const deadlineIso = new Date(
    new Date(nowIso).getTime() + COLLECTION_WINDOW_MINUTES * 60_000,
  ).toISOString();

  const collectingPayload = {
    status: "collecting",
    closure_started_at: nowIso,
    collection_deadline_at: deadlineIso,
    ended_at: null,
  };

  const collectingResult = await supabaseAdmin
    .from("study_rooms")
    .update(collectingPayload)
    .eq("id", params.roomId)
    .in("status", ["active", "collecting"]);

  if (collectingResult.error && hasMissingColumnError(collectingResult.error, "closure_started_at")) {
    console.warn("[study_room] collecting_phase_missing_column_fallback", {
      table: "study_rooms",
      query: "beginRoomCollectingPhase",
      room_id: params.roomId,
      trigger: params.trigger,
      missing_column: "closure_started_at/collection_deadline_at",
      ...toErrorDetails(collectingResult.error),
    });
    const fallbackResult = await supabaseAdmin
      .from("study_rooms")
      .update({
        status: "collecting",
        ended_at: null,
      })
      .eq("id", params.roomId)
      .in("status", ["active", "collecting"]);
    if (fallbackResult.error) {
      console.warn("[study_room] collecting_phase_failed", {
        table: "study_rooms",
        query: "beginRoomCollectingPhase.fallback",
        room_id: params.roomId,
        trigger: params.trigger,
        ...toErrorDetails(fallbackResult.error),
      });
      return {
        ok: false as const,
      };
    }
    console.info("[study_room] collecting_phase_started", {
      room_id: params.roomId,
      trigger: params.trigger,
      closure_started_at: nowIso,
      collection_deadline_at: null,
      fallback_mode: true,
    });
    return {
      ok: true as const,
      closureStartedAt: nowIso,
      collectionDeadlineAt: null as string | null,
    };
  }

  if (collectingResult.error) {
    console.warn("[study_room] collecting_phase_failed", {
      table: "study_rooms",
      query: "beginRoomCollectingPhase",
      room_id: params.roomId,
      trigger: params.trigger,
      ...toErrorDetails(collectingResult.error),
    });
    return {
      ok: false as const,
    };
  }

  console.info("[study_room] collecting_phase_started", {
    room_id: params.roomId,
    trigger: params.trigger,
    closure_started_at: nowIso,
    collection_deadline_at: deadlineIso,
  });
  return {
    ok: true as const,
    closureStartedAt: nowIso,
    collectionDeadlineAt: deadlineIso,
  };
}

async function finalizeRoomClosed(params: {
  roomId: string;
  reason: "all_participants_collected" | "collection_deadline_reached" | "force_close";
}) {
  const nowIso = new Date().toISOString();

  const closeRoomResult = await supabaseAdmin
    .from("study_rooms")
    .update({
      status: "closed",
      ended_at: nowIso,
    })
    .eq("id", params.roomId)
    .neq("status", "closed");
  if (closeRoomResult.error) {
    console.warn("[study_room] close_finalize_failed", {
      table: "study_rooms",
      query: "finalizeRoomClosed.update_room",
      room_id: params.roomId,
      reason: params.reason,
      ...toErrorDetails(closeRoomResult.error),
    });
    return {
      ok: false as const,
    };
  }

  const participantFinalizeResult = await supabaseAdmin
    .from("study_room_participants")
    .update({
      left_at: nowIso,
      presence_state: "offline",
      focus_mode: false,
      focus_started_at: null,
      current_streak_seconds: 0,
      last_active_at: nowIso,
      collection_status: "skipped",
      collection_completed_at: nowIso,
    })
    .eq("room_id", params.roomId)
    .is("left_at", null);

  if (participantFinalizeResult.error && hasMissingColumnError(participantFinalizeResult.error, "collection_status")) {
    const participantFallback = await supabaseAdmin
      .from("study_room_participants")
      .update({
        left_at: nowIso,
        presence_state: "offline",
        focus_mode: false,
        focus_started_at: null,
        current_streak_seconds: 0,
        last_active_at: nowIso,
      })
      .eq("room_id", params.roomId)
      .is("left_at", null);
    if (participantFallback.error) {
      console.warn("[study_room] close_finalize_participants_failed", {
        table: "study_room_participants",
        query: "finalizeRoomClosed.update_participants.fallback",
        room_id: params.roomId,
        reason: params.reason,
        ...toErrorDetails(participantFallback.error),
      });
    }
  } else if (participantFinalizeResult.error) {
    console.warn("[study_room] close_finalize_participants_failed", {
      table: "study_room_participants",
      query: "finalizeRoomClosed.update_participants",
      room_id: params.roomId,
      reason: params.reason,
      ...toErrorDetails(participantFinalizeResult.error),
    });
  }

  console.info("[study_room] closed_finalized", {
    room_id: params.roomId,
    reason: params.reason,
    ended_at: nowIso,
  });

  return {
    ok: true as const,
  };
}

async function maybeFinalizeRoomCollection(params: {
  room: ReturnType<typeof sanitizeRoomRow>;
  reason: "lifecycle_check" | "participant_leave";
}) {
  const status = normalizeRoomStatus(params.room.status);
  if (status !== "collecting") {
    return {
      room: params.room,
      closed: false,
    };
  }

  const { count, error } = await supabaseAdmin
    .from("study_room_participants")
    .select("id", { count: "exact", head: true })
    .eq("room_id", params.room.id)
    .is("left_at", null);
  if (error) {
    console.warn("[study_room] collecting_active_participants_count_failed", {
      table: "study_room_participants",
      query: "maybeFinalizeRoomCollection.count_active",
      room_id: params.room.id,
      reason: params.reason,
      ...toErrorDetails(error),
    });
    return {
      room: params.room,
      closed: false,
    };
  }

  const activeCount = count ?? 0;
  const nowMs = Date.now();
  const deadlineMs = toDateOrNull(params.room.collection_deadline_at)?.getTime() ?? null;
  const deadlineReached = deadlineMs !== null && nowMs >= deadlineMs;
  const shouldFinalize = activeCount === 0 || deadlineReached;
  if (!shouldFinalize) {
    return {
      room: params.room,
      closed: false,
    };
  }

  const finalize = await finalizeRoomClosed({
    roomId: params.room.id,
    reason: activeCount === 0 ? "all_participants_collected" : "collection_deadline_reached",
  });
  if (!finalize.ok) {
    return {
      room: params.room,
      closed: false,
    };
  }

  const refreshed = await loadRoomById(params.room.id);
  return {
    room: refreshed ?? { ...params.room, status: "closed", ended_at: new Date().toISOString() },
    closed: true,
  };
}

async function loadRoomById(roomId: string) {
  const roomsById = await loadRoomsByIds([roomId]);
  return roomsById.get(roomId) ?? null;
}

async function ensureRoomLifecycle(room: ReturnType<typeof sanitizeRoomRow>) {
  if (room.status === "closed") {
    return {
      active: false,
      room,
      code: "ROOM_CLOSED" as const,
    } as const;
  }

  if (room.status === "collecting") {
    const finalized = await maybeFinalizeRoomCollection({
      room,
      reason: "lifecycle_check",
    });
    if (finalized.closed || finalized.room.status === "closed") {
      return {
        active: false,
        room: finalized.room,
        code: "ROOM_CLOSED" as const,
      } as const;
    }
    return {
      active: false,
      room: finalized.room,
      code: "ROOM_COLLECTING" as const,
    } as const;
  }

  const expiresAt = toDateOrNull(room.expires_at);
  const now = Date.now();
  if (room.status === "active" && expiresAt && now >= expiresAt.getTime()) {
    const collecting = await beginRoomCollectingPhase({
      roomId: room.id,
      trigger: "timer_expired",
    });
    return {
      active: false,
      room: {
        ...room,
        status: collecting.ok ? "collecting" : room.status,
        closure_started_at: collecting.ok ? collecting.closureStartedAt : room.closure_started_at,
        collection_deadline_at: collecting.ok ? collecting.collectionDeadlineAt : room.collection_deadline_at,
      },
      code: "ROOM_COLLECTING" as const,
    } as const;
  }

  if (room.status === "expired") {
    return {
      active: false,
      room,
      code: "ROOM_COLLECTING" as const,
    } as const;
  }

  return {
    active: true,
    room,
    code: "ACTIVE" as const,
  } as const;
}

async function getActiveParticipantCount(roomId: string) {
  const { count, error } = await supabaseAdmin
    .from("study_room_participants")
    .select("id", { count: "exact", head: true })
    .eq("room_id", roomId)
    .is("left_at", null);
  if (error) {
    const details = toErrorDetails(error);
    console.error("[study_room] participant_count_failed", {
      table: "study_room_participants",
      query: "getActiveParticipantCount",
      room_id: roomId,
      ...details,
    });
    throw new Error(
      `Failed to load room participant count. table=study_room_participants room_id=${roomId} reason=${details.message}`,
    );
  }
  return count ?? 0;
}

async function getActiveParticipantRow(params: { roomId: string; userId: string }) {
  const { data, error } = await supabaseAdmin
    .from("study_room_participants")
    .select("id, room_id, user_id, joined_at, left_at, role")
    .eq("room_id", params.roomId)
    .eq("user_id", params.userId)
    .is("left_at", null)
    .order("joined_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    const details = toErrorDetails(error);
    console.error("[study_room] participant_lookup_failed", {
      table: "study_room_participants",
      query: "getActiveParticipantRow",
      room_id: params.roomId,
      user_id: params.userId,
      ...details,
    });
    throw new Error(
      `Failed to load room participant. table=study_room_participants room_id=${params.roomId} user_id=${params.userId} reason=${details.message}`,
    );
  }
  return (data ?? null) as GenericRecord | null;
}

export async function createStudyRoom(params: {
  creatorId: string;
  name: string;
  style: string;
  durationMinutes: number;
  password: string;
  maxParticipants?: number;
}) {
  const nowIso = new Date().toISOString();
  const durationMinutes = Math.max(15, Math.min(720, Math.floor(params.durationMinutes)));
  const expiresAt = new Date(new Date(nowIso).getTime() + durationMinutes * 60_000).toISOString();
  const payload = {
    creator_id: params.creatorId,
    name: params.name,
    style: normalizeRoomStyle(params.style),
    max_participants: Math.max(2, Math.min(50, Math.floor(params.maxParticipants ?? 10))),
    password: params.password,
    duration_minutes: durationMinutes,
    status: "active",
    created_at: nowIso,
    expires_at: expiresAt,
  };

  const { data: roomRow, error: roomError } = await supabaseAdmin
    .from("study_rooms")
    .insert(payload)
    .select(
      "id, creator_id, name, style, max_participants, password, duration_minutes, status, created_at, expires_at, ended_at",
    )
    .limit(1)
    .maybeSingle();

  if (roomError || !roomRow) {
    const details = toErrorDetails(roomError);
    console.error("[study_room] create_failed", {
      table: "study_rooms",
      query: "createStudyRoom.insertRoom",
      creator_id: params.creatorId,
      payload_keys: Object.keys(payload),
      ...details,
    });
    throw new Error(
      `Failed to create study room. table=study_rooms creator_id=${params.creatorId} reason=${details.message}`,
    );
  }

  const room = sanitizeRoomRow(roomRow as GenericRecord);

  const { error: participantError } = await supabaseAdmin
    .from("study_room_participants")
    .insert({
      room_id: room.id,
      user_id: params.creatorId,
      joined_at: nowIso,
      role: "creator",
      presence_state: "online",
      focus_mode: false,
      focus_started_at: null,
      last_active_at: nowIso,
      current_streak_seconds: 0,
      total_focus_seconds: 0,
      session_seconds: 0,
      goal_text: null,
      goal_status: "not_started",
    });
  if (participantError) {
    const details = toErrorDetails(participantError);
    console.error("[study_room] create_participant_failed", {
      table: "study_room_participants",
      query: "createStudyRoom.insertCreatorParticipant",
      room_id: room.id,
      creator_id: params.creatorId,
      ...details,
    });
    throw new Error(
      `Failed to create room participant. table=study_room_participants room_id=${room.id} creator_id=${params.creatorId} reason=${details.message}`,
    );
  }

  console.info("[study_room] created", {
    room_id: room.id,
    creator_id: params.creatorId,
    style: room.style,
    max_participants: room.max_participants,
    duration_minutes: room.duration_minutes,
    expires_at: room.expires_at,
  });

  return room;
}

export async function joinStudyRoom(params: {
  userId: string;
  roomId: string;
  password?: string | null;
  bypassPassword?: boolean;
}) {
  const room = await loadRoomById(params.roomId);
  if (!room) {
    return {
      ok: false as const,
      code: "NOT_FOUND" as const,
    };
  }
  const activeCheck = await ensureRoomLifecycle(room);
  if (!activeCheck.active) {
    return {
      ok: false as const,
      code: activeCheck.code,
    };
  }
  if (!params.bypassPassword && room.password !== toStringValue(params.password).trim()) {
    return {
      ok: false as const,
      code: "INVALID_PASSWORD" as const,
    };
  }

  const activeParticipantRow = await getActiveParticipantRow({
    roomId: params.roomId,
    userId: params.userId,
  });
  if (activeParticipantRow) {
    return {
      ok: true as const,
      already_joined: true,
      room,
    };
  }

  const activeCount = await getActiveParticipantCount(params.roomId);
  if (activeCount >= room.max_participants) {
    return {
      ok: false as const,
      code: "ROOM_FULL" as const,
    };
  }

  const { data: existingRow, error: existingRowError } = await supabaseAdmin
    .from("study_room_participants")
    .select("id")
    .eq("room_id", params.roomId)
    .eq("user_id", params.userId)
    .order("joined_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingRowError) {
    const details = toErrorDetails(existingRowError);
    console.error("[study_room] join_existing_lookup_failed", {
      table: "study_room_participants",
      query: "joinStudyRoom.lookupExistingParticipant",
      room_id: params.roomId,
      user_id: params.userId,
      ...details,
    });
    throw new Error(
      `Failed to join study room. table=study_room_participants room_id=${params.roomId} user_id=${params.userId} reason=${details.message}`,
    );
  }

  const nowIso = new Date().toISOString();
  if (existingRow?.id) {
    const { error: updateError } = await supabaseAdmin
      .from("study_room_participants")
      .update({
        joined_at: nowIso,
        left_at: null,
        role: "participant",
        presence_state: "online",
        focus_mode: false,
        focus_started_at: null,
        last_active_at: nowIso,
        current_streak_seconds: 0,
        session_seconds: 0,
      })
      .eq("id", toStringValue(existingRow.id));
    if (updateError) {
      const details = toErrorDetails(updateError);
      console.error("[study_room] rejoin_update_failed", {
        table: "study_room_participants",
        query: "joinStudyRoom.rejoin",
        room_id: params.roomId,
        user_id: params.userId,
        ...details,
      });
      throw new Error(
        `Failed to join study room. table=study_room_participants room_id=${params.roomId} user_id=${params.userId} reason=${details.message}`,
      );
    }
  } else {
    const { error: insertError } = await supabaseAdmin
      .from("study_room_participants")
      .insert({
        room_id: params.roomId,
        user_id: params.userId,
        joined_at: nowIso,
        role: "participant",
        presence_state: "online",
        focus_mode: false,
        focus_started_at: null,
        last_active_at: nowIso,
        current_streak_seconds: 0,
        total_focus_seconds: 0,
        session_seconds: 0,
        goal_text: null,
        goal_status: "not_started",
      });
    if (insertError) {
      const details = toErrorDetails(insertError);
      console.error("[study_room] join_insert_failed", {
        table: "study_room_participants",
        query: "joinStudyRoom.insertParticipant",
        room_id: params.roomId,
        user_id: params.userId,
        ...details,
      });
      throw new Error(
        `Failed to join study room. table=study_room_participants room_id=${params.roomId} user_id=${params.userId} reason=${details.message}`,
      );
    }
  }

  console.info("[study_room] joined", {
    room_id: params.roomId,
    user_id: params.userId,
  });

  return {
    ok: true as const,
    already_joined: false,
    room,
  };
}

export async function leaveStudyRoom(params: {
  userId: string;
  roomId: string;
  collectionStatus?: "completed" | "skipped" | null;
}) {
  console.info("[study_room] leave_attempt", {
    room_id: params.roomId,
    user_id: params.userId,
    collection_status: params.collectionStatus ?? null,
  });

  const room = await loadRoomById(params.roomId);
  if (!room) {
    return {
      ok: false as const,
      code: "NOT_FOUND" as const,
    };
  }
  if (room.creator_id === params.userId && room.status === "active") {
    return {
      ok: false as const,
      code: "CREATOR_CANNOT_LEAVE" as const,
    };
  }

  const nowIso = new Date().toISOString();
  const normalizedRoomStatus = normalizeRoomStatus(room.status);
  const effectiveCollectionStatus =
    normalizedRoomStatus === "collecting"
      ? (params.collectionStatus ?? "skipped")
      : params.collectionStatus ?? null;

  const updatePayload: Record<string, unknown> = {
    left_at: nowIso,
    presence_state: "offline",
    focus_mode: false,
    focus_started_at: null,
    current_streak_seconds: 0,
    last_active_at: nowIso,
  };
  if (effectiveCollectionStatus) {
    updatePayload.collection_status = effectiveCollectionStatus;
    updatePayload.collection_completed_at = nowIso;
  }

  const { data, error } = await supabaseAdmin
    .from("study_room_participants")
    .update(updatePayload)
    .eq("room_id", params.roomId)
    .eq("user_id", params.userId)
    .is("left_at", null)
    .select("id")
    .limit(1)
    .maybeSingle();

  let updatedRow = data;
  if (error && hasMissingColumnError(error, "collection_status")) {
    const fallback = await supabaseAdmin
      .from("study_room_participants")
      .update({
        left_at: nowIso,
        presence_state: "offline",
        focus_mode: false,
        focus_started_at: null,
        current_streak_seconds: 0,
        last_active_at: nowIso,
      })
      .eq("room_id", params.roomId)
      .eq("user_id", params.userId)
      .is("left_at", null)
      .select("id")
      .limit(1)
      .maybeSingle();
    if (fallback.error) {
      const details = toErrorDetails(fallback.error);
      console.error("[study_room] leave_failed", {
        table: "study_room_participants",
        query: "leaveStudyRoom.fallback_no_collection_columns",
        room_id: params.roomId,
        user_id: params.userId,
        ...details,
      });
      throw new Error(
        `Failed to leave study room. table=study_room_participants room_id=${params.roomId} user_id=${params.userId} reason=${details.message}`,
      );
    }
    updatedRow = fallback.data;
  } else if (error) {
    const details = toErrorDetails(error);
    console.error("[study_room] leave_failed", {
      table: "study_room_participants",
      query: "leaveStudyRoom",
      room_id: params.roomId,
      user_id: params.userId,
      ...details,
    });
    throw new Error(
      `Failed to leave study room. table=study_room_participants room_id=${params.roomId} user_id=${params.userId} reason=${details.message}`,
    );
  }

  if (normalizedRoomStatus === "collecting") {
    const refreshedRoom = await loadRoomById(params.roomId);
    if (refreshedRoom) {
      await maybeFinalizeRoomCollection({
        room: refreshedRoom,
        reason: "participant_leave",
      });
    }
  }

  console.info("[study_room] left", {
    room_id: params.roomId,
    user_id: params.userId,
    had_active_membership: Boolean(updatedRow),
    collection_status: effectiveCollectionStatus,
  });
  return {
    ok: Boolean(updatedRow),
    code: updatedRow ? "LEFT" as const : "NO_ACTIVE_MEMBERSHIP" as const,
  };
}

export async function listActiveStudyRoomsForUser(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("study_room_participants")
    .select("id, room_id, user_id, joined_at, left_at, role")
    .eq("user_id", userId)
    .is("left_at", null)
    .order("joined_at", { ascending: false });
  if (error) {
    const details = toErrorDetails(error);
    console.error("[study_room] list_my_rooms_failed", {
      table: "study_room_participants",
      query: "listActiveStudyRoomsForUser",
      user_id: userId,
      ...details,
    });
    throw new Error(
      `Failed to load study rooms. table=study_room_participants user_id=${userId} reason=${details.message}`,
    );
  }

  const rows = (data ?? []) as GenericRecord[];
  const roomIds = Array.from(
    new Set(rows.map((row) => toStringValue(row.room_id)).filter(Boolean)),
  );
  const roomsById = await loadRoomsByIds(roomIds);

  const activeRooms: Array<{
    id: string;
    name: string;
    style: string;
    status: string;
    max_participants: number;
    duration_minutes: number;
    created_at: string | null;
    expires_at: string | null;
    ended_at: string | null;
    room_id: string;
    role: string;
    joined_at: string | null;
    creator_id: string;
    password: string;
  }> = [];
  for (const row of rows) {
    const roomId = toStringValue(row.room_id);
    const current = roomsById.get(roomId) ?? null;
    if (!current) {
      continue;
    }
    const activeCheck = await ensureRoomLifecycle(current);
    if (activeCheck.code === "ROOM_CLOSED") {
      continue;
    }
    activeRooms.push({
      id: activeCheck.room.id,
      room_id: activeCheck.room.id,
      name: activeCheck.room.name,
      style: activeCheck.room.style,
      status: activeCheck.room.status,
      max_participants: activeCheck.room.max_participants,
      duration_minutes: activeCheck.room.duration_minutes,
      created_at: activeCheck.room.created_at,
      expires_at: activeCheck.room.expires_at,
      ended_at: activeCheck.room.ended_at,
      role: toStringValue(row.role) || "participant",
      joined_at: toNullableString(row.joined_at),
      creator_id: activeCheck.room.creator_id,
      password: activeCheck.room.password,
    });
  }
  return activeRooms;
}

export async function getStudyRoomDetailsForUser(params: {
  userId: string;
  roomId: string;
}) {
  const room = await loadRoomById(params.roomId);
  if (!room) {
    return {
      ok: false as const,
      code: "NOT_FOUND" as const,
    };
  }

  const participant = await getActiveParticipantRow({
    roomId: params.roomId,
    userId: params.userId,
  });
  if (!participant) {
    return {
      ok: false as const,
      code: "FORBIDDEN" as const,
    };
  }

  const activeCheck = await ensureRoomLifecycle(room);
  const roomAfterCheck = activeCheck.room;

  const { data: participantsData, error: participantsError } = await supabaseAdmin
    .from("study_room_participants")
    .select(
      "id, room_id, user_id, joined_at, left_at, role, presence_state, focus_mode, focus_started_at, last_active_at, current_streak_seconds, total_focus_seconds, session_seconds, goal_text, goal_status",
    )
    .eq("room_id", params.roomId)
    .is("left_at", null)
    .order("joined_at", { ascending: true });
  if (participantsError) {
    const details = toErrorDetails(participantsError);
    console.error("[study_room] participants_lookup_failed", {
      table: "study_room_participants",
      query: "getStudyRoomDetailsForUser",
      room_id: params.roomId,
      user_id: params.userId,
      ...details,
    });
    throw new Error(
      `Failed to load room participants. table=study_room_participants room_id=${params.roomId} user_id=${params.userId} reason=${details.message}`,
    );
  }

  const participantRows = (participantsData ?? []) as GenericRecord[];
  const usernamesById = await loadUsernamesByIds(
    participantRows.map((row) => toStringValue(row.user_id)),
  );

  const participants = participantRows.map((row) => {
    const participantUserId = toStringValue(row.user_id);
    return {
      id: toStringValue(row.id),
      room_id: toStringValue(row.room_id),
      user_id: participantUserId,
      joined_at: toNullableString(row.joined_at),
      left_at: toNullableString(row.left_at),
      role: toStringValue(row.role) || "participant",
      username: usernamesById.get(participantUserId) ?? "Unknown",
      presence_state: toStringValue(row.presence_state) || "online",
      focus_mode: row.focus_mode === true,
      focus_started_at: toNullableString(row.focus_started_at),
      last_active_at: toNullableString(row.last_active_at),
      current_streak_seconds: Math.max(0, Math.floor(toNumberValue(row.current_streak_seconds))),
      total_focus_seconds: Math.max(0, Math.floor(toNumberValue(row.total_focus_seconds))),
      session_seconds: Math.max(0, Math.floor(toNumberValue(row.session_seconds))),
      goal_text: toNullableString(row.goal_text),
      goal_status: toStringValue(row.goal_status) || "not_started",
    };
  });

  return {
    ok: true as const,
    room: {
      id: roomAfterCheck.id,
      creator_id: roomAfterCheck.creator_id,
      name: roomAfterCheck.name,
      style: roomAfterCheck.style,
      max_participants: roomAfterCheck.max_participants,
      duration_minutes: roomAfterCheck.duration_minutes,
      status: roomAfterCheck.status,
      created_at: roomAfterCheck.created_at,
      expires_at: roomAfterCheck.expires_at,
      ended_at: roomAfterCheck.ended_at,
      password: roomAfterCheck.password,
      can_close: roomAfterCheck.creator_id === params.userId && roomAfterCheck.status === "active",
      can_extend: roomAfterCheck.creator_id === params.userId && roomAfterCheck.status === "active",
      can_leave:
        roomAfterCheck.status === "collecting" || roomAfterCheck.creator_id !== params.userId,
      viewer_user_id: params.userId,
    },
    participants,
  };
}

export async function getStudyRoomMessagesForUser(params: {
  userId: string;
  roomId: string;
}) {
  const participant = await getActiveParticipantRow({
    roomId: params.roomId,
    userId: params.userId,
  });
  if (!participant) {
    return {
      ok: false as const,
      code: "FORBIDDEN" as const,
    };
  }
  const room = await loadRoomById(params.roomId);
  if (!room) {
    return {
      ok: false as const,
      code: "NOT_FOUND" as const,
    };
  }
  await ensureRoomLifecycle(room);

  const { data, error } = await supabaseAdmin
    .from("study_room_messages")
    .select("id, room_id, sender_id, body, created_at, type")
    .eq("room_id", params.roomId)
    .order("created_at", { ascending: true });
  if (error) {
    const details = toErrorDetails(error);
    console.error("[study_room] messages_lookup_failed", {
      table: "study_room_messages",
      query: "getStudyRoomMessagesForUser",
      room_id: params.roomId,
      user_id: params.userId,
      ...details,
    });
    throw new Error(
      `Failed to load room messages. table=study_room_messages room_id=${params.roomId} user_id=${params.userId} reason=${details.message}`,
    );
  }
  const messageRows = (data ?? []) as GenericRecord[];
  const usernamesById = await loadUsernamesByIds(
    messageRows.map((row) => toStringValue(row.sender_id)),
  );

  return {
    ok: true as const,
    messages: messageRows.map((row) => {
      const senderId = toStringValue(row.sender_id);
      return {
        id: toStringValue(row.id),
        room_id: toStringValue(row.room_id),
        sender_id: senderId,
        sender_username: usernamesById.get(senderId) ?? null,
        body: toStringValue(row.body),
        created_at: toNullableString(row.created_at),
        type: toStringValue(row.type) || "chat",
      };
    }),
  };
}

export async function sendStudyRoomMessage(params: {
  userId: string;
  roomId: string;
  body: string;
  type?: string | null;
}) {
  const participant = await getActiveParticipantRow({
    roomId: params.roomId,
    userId: params.userId,
  });
  if (!participant) {
    return {
      ok: false as const,
      code: "FORBIDDEN" as const,
    };
  }
  const room = await loadRoomById(params.roomId);
  if (!room) {
    return {
      ok: false as const,
      code: "NOT_FOUND" as const,
    };
  }
  const activeCheck = await ensureRoomLifecycle(room);
  if (!activeCheck.active) {
    return {
      ok: false as const,
      code: activeCheck.code,
    };
  }

  const payload = {
    room_id: params.roomId,
    sender_id: params.userId,
    body: params.body,
    type: toStringValue(params.type).trim() || "chat",
  };
  const { data, error } = await supabaseAdmin
    .from("study_room_messages")
    .insert(payload)
    .select("id, room_id, sender_id, body, created_at, type")
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    const details = toErrorDetails(error);
    console.error("[study_room] message_send_failed", {
      table: "study_room_messages",
      query: "sendStudyRoomMessage",
      room_id: params.roomId,
      user_id: params.userId,
      ...details,
    });
    throw new Error(
      `Failed to send room message. table=study_room_messages room_id=${params.roomId} user_id=${params.userId} reason=${details.message}`,
    );
  }
  console.info("[study_room] message_sent", {
    room_id: params.roomId,
    sender_id: params.userId,
  });
  const senderUsernames = await loadUsernamesByIds([params.userId]);

  return {
    ok: true as const,
    message: {
      id: toStringValue((data as GenericRecord).id),
      room_id: toStringValue((data as GenericRecord).room_id),
      sender_id: toStringValue((data as GenericRecord).sender_id),
      sender_username: senderUsernames.get(params.userId) ?? null,
      body: toStringValue((data as GenericRecord).body),
      created_at: toNullableString((data as GenericRecord).created_at),
      type: toStringValue((data as GenericRecord).type) || "chat",
    },
  };
}

export async function closeStudyRoom(params: { userId: string; roomId: string }) {
  console.info("[study_room] close_attempt", {
    room_id: params.roomId,
    user_id: params.userId,
  });

  const room = await loadRoomById(params.roomId);
  if (!room) {
    return {
      ok: false as const,
      code: "NOT_FOUND" as const,
    };
  }
  if (room.creator_id !== params.userId) {
    return {
      ok: false as const,
      code: "FORBIDDEN" as const,
    };
  }

  const collecting = await beginRoomCollectingPhase({
    roomId: params.roomId,
    trigger: "creator_closed",
  });
  if (!collecting.ok) {
    throw new Error(
      `Failed to start room collection phase. table=study_rooms room_id=${params.roomId} user_id=${params.userId}`,
    );
  }

  console.info("[study_room] collecting_started_by_creator", {
    room_id: params.roomId,
    user_id: params.userId,
    closure_started_at: collecting.closureStartedAt,
    collection_deadline_at: collecting.collectionDeadlineAt,
  });
  return {
    ok: true as const,
  };
}

export async function extendStudyRoomDuration(params: {
  userId: string;
  roomId: string;
  durationMinutes: number;
}) {
  console.info("[study_room] extend_attempt", {
    room_id: params.roomId,
    user_id: params.userId,
    duration_minutes: params.durationMinutes,
  });

  const room = await loadRoomById(params.roomId);
  if (!room) {
    return {
      ok: false as const,
      code: "NOT_FOUND" as const,
    };
  }
  if (room.creator_id !== params.userId) {
    return {
      ok: false as const,
      code: "FORBIDDEN" as const,
    };
  }
  if (room.status === "closed") {
    return {
      ok: false as const,
      code: "ROOM_CLOSED" as const,
    };
  }

  const nowIso = new Date().toISOString();
  const safeDuration = Math.max(15, Math.min(720, Math.floor(params.durationMinutes)));
  const newExpiresAt = new Date(new Date(nowIso).getTime() + safeDuration * 60_000).toISOString();

  const { data, error } = await supabaseAdmin
    .from("study_rooms")
    .update({
      status: "active",
      duration_minutes: safeDuration,
      expires_at: newExpiresAt,
      ended_at: null,
    })
    .eq("id", params.roomId)
    .select(
      "id, creator_id, name, style, max_participants, password, duration_minutes, status, created_at, expires_at, ended_at",
    )
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    const details = toErrorDetails(error);
    console.error("[study_room] extend_failed", {
      table: "study_rooms",
      query: "extendStudyRoomDuration",
      room_id: params.roomId,
      user_id: params.userId,
      ...details,
    });
    throw new Error(
      `Failed to extend study room. table=study_rooms room_id=${params.roomId} user_id=${params.userId} reason=${details.message}`,
    );
  }

  console.info("[study_room] extended", {
    room_id: params.roomId,
    user_id: params.userId,
    duration_minutes: safeDuration,
    expires_at: newExpiresAt,
  });

  return {
    ok: true as const,
    room: sanitizeRoomRow(data as GenericRecord),
  };
}

function mapInvitationRow(params: {
  row: GenericRecord;
  senderUsername: string | null;
  room: ReturnType<typeof sanitizeRoomRow> | null;
}) {
  const { row, senderUsername, room } = params;
  return {
    id: toStringValue(row.id),
    room_id: toStringValue(row.room_id),
    sender_id: toStringValue(row.sender_id),
    receiver_id: toStringValue(row.receiver_id),
    status: toStringValue(row.status) || "pending",
    created_at: toNullableString(row.created_at),
    responded_at: toNullableString(row.responded_at),
    sender_username: senderUsername ?? "Unknown",
    room_name: room?.name ?? "",
    room_password: room?.password ?? "",
    room_style: room?.style ?? "focus",
    room_duration_minutes: room?.duration_minutes ?? 60,
    room_status: room?.status ?? "active",
    room_expires_at: room?.expires_at ?? null,
  };
}

export async function createStudyRoomInvitations(params: {
  senderId: string;
  roomId: string;
  receiverIds: string[];
}) {
  const room = await loadRoomById(params.roomId);
  if (!room) {
    return {
      ok: false as const,
      code: "NOT_FOUND" as const,
    };
  }
  if (room.creator_id !== params.senderId) {
    return {
      ok: false as const,
      code: "FORBIDDEN" as const,
    };
  }

  const lifecycle = await ensureRoomLifecycle(room);
  if (lifecycle.code === "ROOM_CLOSED") {
    return {
      ok: false as const,
      code: "ROOM_CLOSED" as const,
    };
  }

  const uniqueReceivers = Array.from(
    new Set(
      params.receiverIds
        .map((value) => value.trim())
        .filter((value) => value && value !== params.senderId),
    ),
  );
  if (uniqueReceivers.length === 0) {
    return {
      ok: true as const,
      invitations: [] as Array<{ id: string; receiver_id: string }>,
    };
  }

  const validReceiverIds: string[] = [];
  for (const receiverId of uniqueReceivers) {
    const friendship = await getFriendshipBetweenUsers(params.senderId, receiverId);
    if (friendship?.status === "accepted") {
      validReceiverIds.push(receiverId);
    }
  }

  const nowIso = new Date().toISOString();
  const payload = validReceiverIds.map((receiverId) => ({
    room_id: params.roomId,
    sender_id: params.senderId,
    receiver_id: receiverId,
    status: "pending",
    created_at: nowIso,
    responded_at: null,
  }));

  if (payload.length === 0) {
    return {
      ok: true as const,
      invitations: [] as Array<{ id: string; receiver_id: string }>,
    };
  }

  const { data, error } = await supabaseAdmin
    .from("study_room_invitations")
    .upsert(payload, {
      onConflict: "room_id,sender_id,receiver_id",
      ignoreDuplicates: false,
    })
    .select("id, receiver_id");
  if (error && hasMissingUpsertConstraintError(error)) {
    console.warn("[study_room] invite_upsert_constraint_missing_fallback", {
      table: "study_room_invitations",
      query: "createStudyRoomInvitations.upsert",
      room_id: params.roomId,
      sender_id: params.senderId,
      receiver_count: payload.length,
      ...toErrorDetails(error),
    });

    const inserted: Array<{ id: string; receiver_id: string }> = [];
    for (const row of payload) {
      const { data: existingPendingRow, error: existingPendingError } = await supabaseAdmin
        .from("study_room_invitations")
        .select("id, receiver_id, status")
        .eq("room_id", row.room_id)
        .eq("sender_id", row.sender_id)
        .eq("receiver_id", row.receiver_id)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingPendingError) {
        const details = toErrorDetails(existingPendingError);
        console.error("[study_room] invite_existing_lookup_failed", {
          table: "study_room_invitations",
          query: "createStudyRoomInvitations.lookup_existing_pending",
          room_id: params.roomId,
          sender_id: params.senderId,
          receiver_id: row.receiver_id,
          ...details,
        });
        throw new Error(
          `Failed to send study room invites. table=study_room_invitations room_id=${params.roomId} sender_id=${params.senderId} reason=${details.message}`,
        );
      }
      if (existingPendingRow?.id) {
        inserted.push({
          id: toStringValue(existingPendingRow.id),
          receiver_id: toStringValue(existingPendingRow.receiver_id),
        });
        continue;
      }

      const { data: insertedRow, error: insertError } = await supabaseAdmin
        .from("study_room_invitations")
        .insert(row)
        .select("id, receiver_id")
        .limit(1)
        .maybeSingle();
      if (insertError || !insertedRow) {
        const details = toErrorDetails(insertError);
        console.error("[study_room] invite_insert_failed", {
          table: "study_room_invitations",
          query: "createStudyRoomInvitations.insert_fallback",
          room_id: params.roomId,
          sender_id: params.senderId,
          receiver_id: row.receiver_id,
          ...details,
        });
        throw new Error(
          `Failed to send study room invites. table=study_room_invitations room_id=${params.roomId} sender_id=${params.senderId} reason=${details.message}`,
        );
      }
      inserted.push({
        id: toStringValue((insertedRow as GenericRecord).id),
        receiver_id: toStringValue((insertedRow as GenericRecord).receiver_id),
      });
    }

    console.info("[study_room] invite_sent", {
      room_id: params.roomId,
      sender_id: params.senderId,
      receiver_count: inserted.length,
      mode: "fallback_insert",
    });

    return {
      ok: true as const,
      invitations: inserted,
    };
  }

  if (error) {
    const details = toErrorDetails(error);
    console.error("[study_room] invite_insert_failed", {
      table: "study_room_invitations",
      query: "createStudyRoomInvitations",
      room_id: params.roomId,
      sender_id: params.senderId,
      receiver_count: payload.length,
      ...details,
    });
    throw new Error(
      `Failed to send study room invites. table=study_room_invitations room_id=${params.roomId} sender_id=${params.senderId} reason=${details.message}`,
    );
  }

  console.info("[study_room] invite_sent", {
    room_id: params.roomId,
    sender_id: params.senderId,
    receiver_count: payload.length,
  });

  return {
    ok: true as const,
    invitations: ((data ?? []) as GenericRecord[]).map((row) => ({
      id: toStringValue(row.id),
      receiver_id: toStringValue(row.receiver_id),
    })),
  };
}

export async function getStudyRoomInvitationsForUser(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("study_room_invitations")
    .select("id, room_id, sender_id, receiver_id, status, created_at, responded_at")
    .eq("receiver_id", userId)
    .order("created_at", { ascending: false });
  if (error) {
    const details = toErrorDetails(error);
    console.error("[study_room] invite_lookup_failed", {
      table: "study_room_invitations",
      query: "getStudyRoomInvitationsForUser",
      user_id: userId,
      ...details,
    });
    throw new Error(
      `Failed to load study room invitations. table=study_room_invitations user_id=${userId} reason=${details.message}`,
    );
  }
  const invitationRows = (data ?? []) as GenericRecord[];
  const senderIds = invitationRows.map((row) => toStringValue(row.sender_id));
  const roomIds = invitationRows.map((row) => toStringValue(row.room_id));
  const [senderUsernamesById, roomsById] = await Promise.all([
    loadUsernamesByIds(senderIds),
    loadRoomsByIds(roomIds),
  ]);

  return invitationRows.map((row) =>
    mapInvitationRow({
      row,
      senderUsername: senderUsernamesById.get(toStringValue(row.sender_id)) ?? null,
      room: roomsById.get(toStringValue(row.room_id)) ?? null,
    }),
  );
}

export async function getPendingStudyRoomInvitationsCount(userId: string) {
  const { count, error } = await supabaseAdmin
    .from("study_room_invitations")
    .select("id", { count: "exact", head: true })
    .eq("receiver_id", userId)
    .eq("status", "pending");
  if (error) {
    const details = toErrorDetails(error);
    console.error("[study_room] invite_count_failed", {
      table: "study_room_invitations",
      query: "getPendingStudyRoomInvitationsCount",
      user_id: userId,
      ...details,
    });
    throw new Error(
      `Failed to load pending study room invitations. table=study_room_invitations user_id=${userId} reason=${details.message}`,
    );
  }
  return count ?? 0;
}

export async function respondToStudyRoomInvitation(params: {
  invitationId: string;
  receiverId: string;
  action: "accepted" | "declined";
}) {
  const { data: row, error: rowError } = await supabaseAdmin
    .from("study_room_invitations")
    .select("id, room_id, sender_id, receiver_id, status")
    .eq("id", params.invitationId)
    .limit(1)
    .maybeSingle();
  if (rowError) {
    const details = toErrorDetails(rowError);
    console.error("[study_room] invite_respond_lookup_failed", {
      table: "study_room_invitations",
      query: "respondToStudyRoomInvitation.lookup",
      invitation_id: params.invitationId,
      receiver_id: params.receiverId,
      ...details,
    });
    throw new Error(
      `Failed to respond to study room invite. table=study_room_invitations invitation_id=${params.invitationId} reason=${details.message}`,
    );
  }

  const invitation = (row ?? null) as GenericRecord | null;
  if (!invitation) {
    return {
      ok: false as const,
      code: "NOT_FOUND" as const,
    };
  }

  if (toStringValue(invitation.receiver_id) !== params.receiverId) {
    return {
      ok: false as const,
      code: "FORBIDDEN" as const,
    };
  }

  if (toStringValue(invitation.status) !== "pending") {
    return {
      ok: false as const,
      code: "ALREADY_RESPONDED" as const,
    };
  }

  const nowIso = new Date().toISOString();
  if (params.action === "declined") {
    const { error: declineError } = await supabaseAdmin
      .from("study_room_invitations")
      .update({
        status: "declined",
        responded_at: nowIso,
      })
      .eq("id", params.invitationId);
    if (declineError) {
      const details = toErrorDetails(declineError);
      console.error("[study_room] invite_respond_update_failed", {
        table: "study_room_invitations",
        query: "respondToStudyRoomInvitation.update_declined",
        invitation_id: params.invitationId,
        receiver_id: params.receiverId,
        action: params.action,
        ...details,
      });
      throw new Error(
        `Failed to respond to study room invite. table=study_room_invitations invitation_id=${params.invitationId} reason=${details.message}`,
      );
    }
    return {
      ok: true as const,
      joined: false,
      room_id: toStringValue(invitation.room_id),
    };
  }

  const join = await joinStudyRoom({
    userId: params.receiverId,
    roomId: toStringValue(invitation.room_id),
    bypassPassword: true,
  });

  if (!join.ok) {
    return {
      ok: false as const,
      code: join.code,
    };
  }

  const { error: acceptError } = await supabaseAdmin
    .from("study_room_invitations")
    .update({
      status: "accepted",
      responded_at: nowIso,
    })
    .eq("id", params.invitationId);
  if (acceptError) {
    const details = toErrorDetails(acceptError);
    console.error("[study_room] invite_respond_update_failed", {
      table: "study_room_invitations",
      query: "respondToStudyRoomInvitation.update_accepted",
      invitation_id: params.invitationId,
      receiver_id: params.receiverId,
      action: params.action,
      ...details,
    });
    throw new Error(
      `Failed to respond to study room invite. table=study_room_invitations invitation_id=${params.invitationId} reason=${details.message}`,
    );
  }

  return {
    ok: true as const,
    joined: true,
    room_id: join.room.id,
  };
}
