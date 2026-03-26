import crypto from "node:crypto";
import path from "node:path";
import { getDeepseekClient } from "@/lib/deepseekClient";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type GenericRecord = Record<string, unknown>;

export type StudyRoomPresenceState = "online" | "idle" | "focus" | "offline";
export type StudyRoomGoalStatus = "not_started" | "in_progress" | "completed";
export type StudyRoomResourceSourceKind = "url" | "file";
export type StudyRoomAiSenderType = "user" | "ai" | "system";
export type StudyRoomAiRole = "user" | "assistant" | "system";
export type StudyRoomAiMessageKind = "chat" | "question" | "answer" | "summary";
export type StudyRoomResourceType =
  | "video"
  | "article"
  | "website"
  | "document"
  | "notes"
  | "other";

const STUDY_ROOM_RESOURCE_BUCKET = "study-room-resources";

type MembershipContext = {
  roomId: string;
  userId: string;
  creatorId: string;
  roomStatus: string;
  participantId: string;
  joinedAt: string | null;
  focusMode: boolean;
  focusStartedAt: string | null;
  totalFocusSeconds: number;
  currentStreakSeconds: number;
  goalText: string | null;
  goalStatus: StudyRoomGoalStatus;
};

type RoomMembershipMode = "active_only" | "active_or_closed_historical";
const WORKSPACE_COLLECTION_WINDOW_MINUTES = 15;

function getRoomWriteBlockCode(roomStatus: string) {
  const normalized = roomStatus.trim().toLowerCase();
  if (normalized === "collecting") {
    return "ROOM_COLLECTING" as const;
  }
  if (normalized === "closed") {
    return "ROOM_CLOSED" as const;
  }
  return null;
}

export type StudyRoomParticipantWorkspaceState = {
  id: string;
  room_id: string;
  user_id: string;
  username: string;
  role: string;
  joined_at: string | null;
  last_active_at: string | null;
  presence_state: StudyRoomPresenceState;
  focus_mode: boolean;
  session_seconds: number;
  current_streak_seconds: number;
  total_focus_seconds: number;
  goal_text: string | null;
  goal_status: StudyRoomGoalStatus;
};

export type StudyRoomNoteRecord = {
  id: string | null;
  room_id: string;
  content: string | null;
  updated_by: string | null;
  updated_by_username: string | null;
  updated_at: string | null;
  created_at: string | null;
};

export type StudyRoomNoteEntryRecord = {
  id: string;
  room_id: string;
  author_user_id: string;
  author_username: string | null;
  content_md: string | null;
  created_at: string | null;
  updated_at: string | null;
  is_deleted: boolean;
};

export type StudyRoomSharedResource = {
  id: string;
  room_id: string;
  source_kind: StudyRoomResourceSourceKind;
  resource_type: StudyRoomResourceType;
  title: string;
  url: string | null;
  file_name: string | null;
  file_path: string | null;
  file_size_bytes: number | null;
  mime_type: string | null;
  added_by: string;
  added_by_username: string | null;
  created_at: string | null;
};

export type StudyRoomAiMessage = {
  id: string;
  room_id: string;
  sender_id: string | null;
  linked_user_id: string | null;
  sender_username: string | null;
  sender_type: StudyRoomAiSenderType;
  role: StudyRoomAiRole;
  message_kind: StudyRoomAiMessageKind;
  body: string;
  provider: string | null;
  model: string | null;
  context_summary: string | null;
  metadata: Record<string, unknown>;
  created_at: string | null;
};

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

function toBoolean(value: unknown) {
  return value === true;
}

function normalizeAiSenderType(value: unknown): StudyRoomAiSenderType {
  const normalized = toStringValue(value).trim().toLowerCase();
  if (normalized === "system") {
    return "system";
  }
  if (normalized === "assistant" || normalized === "ai") {
    return "ai";
  }
  return "user";
}

function normalizeAiRole(value: unknown): StudyRoomAiRole {
  const normalized = toStringValue(value).trim().toLowerCase();
  if (normalized === "system") {
    return "system";
  }
  if (normalized === "assistant" || normalized === "ai") {
    return "assistant";
  }
  return "user";
}

function normalizeAiMessageKind(value: unknown): StudyRoomAiMessageKind {
  const normalized = toStringValue(value).trim().toLowerCase();
  if (normalized === "question" || normalized === "answer" || normalized === "summary" || normalized === "chat") {
    return normalized;
  }
  return "chat";
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function normalizePresenceState(value: unknown): StudyRoomPresenceState {
  const normalized = toStringValue(value).trim().toLowerCase();
  if (
    normalized === "online" ||
    normalized === "idle" ||
    normalized === "focus" ||
    normalized === "offline"
  ) {
    return normalized;
  }
  return "online";
}

function normalizeGoalStatus(value: unknown): StudyRoomGoalStatus {
  const normalized = toStringValue(value).trim().toLowerCase();
  if (
    normalized === "not_started" ||
    normalized === "in_progress" ||
    normalized === "completed"
  ) {
    return normalized;
  }
  return "not_started";
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
    (message.includes("column") &&
      message.includes(column.toLowerCase()) &&
      message.includes("does not exist"))
  );
}

function enrichAiMessagesSchemaMismatchMessage(baseMessage: string) {
  if (
    /study_room_ai_messages/i.test(baseMessage) &&
    /column/i.test(baseMessage)
  ) {
    return `${baseMessage}. Run migration: db/2026-03-24_study_room_ai_tutor_context_enrichment.sql`;
  }
  return baseMessage;
}

function parseIsoToMs(value: string | null, fallbackMs: number) {
  if (!value) {
    return fallbackMs;
  }
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) {
    return fallbackMs;
  }
  return parsed;
}

function truncateText(value: string | null, maxLength: number) {
  const text = (value ?? "").trim();
  if (!text) {
    return "";
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function normalizeSourceKind(value: string): StudyRoomResourceSourceKind {
  return value.trim().toLowerCase() === "file" ? "file" : "url";
}

function normalizeResourceTypeFromInput(inputType: string): StudyRoomResourceType {
  const normalizedType = inputType.trim().toLowerCase();
  if (normalizedType === "video" || normalizedType === "youtube") {
    return "video";
  }
  if (normalizedType === "article") {
    return "article";
  }
  if (normalizedType === "website" || normalizedType === "link" || normalizedType === "url") {
    return "website";
  }
  if (normalizedType === "document" || normalizedType === "pdf") {
    return "document";
  }
  if (normalizedType === "notes") {
    return "notes";
  }
  return "other";
}

function assertValidUrl(url: string) {
  const trimmed = url.trim();
  if (!trimmed) {
    throw new Error("Resource URL is required.");
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error("Resource URL must start with http:// or https://.");
  }
  return trimmed;
}

function inferResourceTypeFromFile(fileName: string, mimeType: string) {
  const ext = path.extname(fileName).trim().toLowerCase();
  const lowerMime = mimeType.trim().toLowerCase();
  if (ext === ".md" || ext === ".txt" || lowerMime.includes("markdown") || lowerMime.includes("plain")) {
    return "notes" as const;
  }
  if (
    ext === ".pdf" ||
    ext === ".doc" ||
    ext === ".docx" ||
    ext === ".ppt" ||
    ext === ".pptx" ||
    lowerMime.includes("pdf") ||
    lowerMime.includes("word") ||
    lowerMime.includes("powerpoint")
  ) {
    return "document" as const;
  }
  return "other" as const;
}

function sanitizeFileName(fileName: string) {
  const trimmed = fileName.trim();
  if (!trimmed) {
    return "resource";
  }
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 140) || "resource";
}

function mapStudyRoomResourceRow(row: GenericRecord, usernamesById: Map<string, string>): StudyRoomSharedResource {
  const addedBy = toStringValue(row.added_by);
  const sourceKind = normalizeSourceKind(toStringValue(row.source_kind));
  const filePath = toNullableString(row.file_path);
  let resolvedUrl = toNullableString(row.url);
  if (sourceKind === "file" && !resolvedUrl && filePath) {
    const publicUrlResult = supabaseAdmin.storage.from(STUDY_ROOM_RESOURCE_BUCKET).getPublicUrl(filePath);
    resolvedUrl = toStringValue(publicUrlResult.data.publicUrl).trim() || null;
  }
  return {
    id: toStringValue(row.id),
    room_id: toStringValue(row.room_id),
    source_kind: sourceKind,
    resource_type: normalizeResourceTypeFromInput(toStringValue(row.resource_type)),
    title: toStringValue(row.title),
    url: resolvedUrl,
    file_name: toNullableString(row.file_name),
    file_path: filePath,
    file_size_bytes: Number.isFinite(toNumberValue(row.file_size_bytes))
      ? Math.max(0, Math.floor(toNumberValue(row.file_size_bytes)))
      : null,
    mime_type: toNullableString(row.mime_type),
    added_by: addedBy,
    added_by_username: usernamesById.get(addedBy) ?? null,
    created_at: toNullableString(row.created_at),
  };
}

const ALLOWED_FILE_EXTENSIONS = new Set([
  ".pdf",
  ".txt",
  ".md",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
]);

const ALLOWED_MIME_PREFIXES = [
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/png",
  "image/jpeg",
  "image/webp",
];

const STUDY_ROOM_RESOURCE_MAX_FILE_BYTES = 25 * 1024 * 1024;

function assertAllowedUploadFile(file: File) {
  if (!(file instanceof File)) {
    throw new Error("File upload is required.");
  }
  const size = Math.max(0, Math.floor(file.size));
  if (size <= 0) {
    throw new Error("Uploaded file is empty.");
  }
  if (size > STUDY_ROOM_RESOURCE_MAX_FILE_BYTES) {
    throw new Error("Uploaded file is too large. Max size is 25MB.");
  }

  const fileName = file.name?.trim() ?? "";
  const ext = path.extname(fileName).toLowerCase();
  const mimeType = (file.type ?? "").trim().toLowerCase();
  const extensionAllowed = ALLOWED_FILE_EXTENSIONS.has(ext);
  const mimeAllowed =
    mimeType.length > 0 &&
    ALLOWED_MIME_PREFIXES.some((allowed) => mimeType === allowed || mimeType.startsWith(`${allowed};`));

  if (!extensionAllowed && !mimeAllowed) {
    throw new Error("Unsupported file type. Allowed: pdf, txt, md, doc, docx, ppt, pptx, png, jpg, jpeg, webp.");
  }

  return {
    size,
    mimeType: mimeType || "application/octet-stream",
    fileName: sanitizeFileName(fileName || "resource"),
    extension: ext || ".bin",
  };
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
    console.error("[study_room_workspace] users_lookup_failed", {
      table: "users",
      query: "loadUsernamesByIds",
      user_ids_count: uniqueIds.length,
      ...details,
    });
    throw new Error(`Failed to load users. table=users reason=${details.message}`);
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

async function requireRoomMembership(params: {
  roomId: string;
  userId: string;
  membershipMode?: RoomMembershipMode;
}) {
  let roomRow: GenericRecord | null = null;
  let roomError: unknown = null;
  const roomLookupWithCollectingColumns = await supabaseAdmin
    .from("study_rooms")
    .select("id, creator_id, status, expires_at, closure_started_at, collection_deadline_at")
    .eq("id", params.roomId)
    .limit(1)
    .maybeSingle();
  roomRow = (roomLookupWithCollectingColumns.data as GenericRecord | null) ?? null;
  roomError = roomLookupWithCollectingColumns.error;
  if (
    roomLookupWithCollectingColumns.error &&
    (hasMissingColumnError(roomLookupWithCollectingColumns.error, "closure_started_at") ||
      hasMissingColumnError(roomLookupWithCollectingColumns.error, "collection_deadline_at"))
  ) {
    const fallbackLookup = await supabaseAdmin
      .from("study_rooms")
      .select("id, creator_id, status, expires_at")
      .eq("id", params.roomId)
      .limit(1)
      .maybeSingle();
    roomRow = (fallbackLookup.data as GenericRecord | null) ?? null;
    roomError = fallbackLookup.error;
  }
  if (roomError) {
    const details = toErrorDetails(roomError);
    console.error("[study_room_workspace] room_lookup_failed", {
      table: "study_rooms",
      query: "requireRoomMembership.room",
      room_id: params.roomId,
      user_id: params.userId,
      ...details,
    });
    throw new Error(
      `Failed to load study room. table=study_rooms room_id=${params.roomId} reason=${details.message}`,
    );
  }
  if (!roomRow) {
    return {
      ok: false as const,
      code: "NOT_FOUND" as const,
    };
  }

  const membershipMode = params.membershipMode ?? "active_only";
  const roomRecord = roomRow as GenericRecord;
  let roomStatus = toStringValue(roomRecord.status) || "active";
  const normalizedCurrentStatus = roomStatus.trim().toLowerCase();
  const expiresAtIso = toNullableString(roomRecord.expires_at);
  const expiresAt = expiresAtIso ? new Date(expiresAtIso) : null;
  const expiresAtMs = expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt.getTime() : null;
  const nowMs = Date.now();
  if (normalizedCurrentStatus === "active" && expiresAtMs !== null && nowMs >= expiresAtMs) {
    const nowIso = new Date(nowMs).toISOString();
    const deadlineIso = new Date(
      nowMs + WORKSPACE_COLLECTION_WINDOW_MINUTES * 60_000,
    ).toISOString();
    const collectingResult = await supabaseAdmin
      .from("study_rooms")
      .update({
        status: "collecting",
        closure_started_at: nowIso,
        collection_deadline_at: deadlineIso,
        ended_at: null,
      })
      .eq("id", params.roomId)
      .eq("status", "active");
    if (collectingResult.error && hasMissingColumnError(collectingResult.error, "closure_started_at")) {
      const fallbackResult = await supabaseAdmin
        .from("study_rooms")
        .update({
          status: "collecting",
          ended_at: null,
        })
        .eq("id", params.roomId)
        .eq("status", "active");
      if (fallbackResult.error) {
        const details = toErrorDetails(fallbackResult.error);
        console.warn("[study_room_workspace] collecting_transition_failed", {
          table: "study_rooms",
          query: "requireRoomMembership.transition_collecting.fallback",
          room_id: params.roomId,
          user_id: params.userId,
          ...details,
        });
      } else {
        roomStatus = "collecting";
      }
    } else if (collectingResult.error) {
      const details = toErrorDetails(collectingResult.error);
      console.warn("[study_room_workspace] collecting_transition_failed", {
        table: "study_rooms",
        query: "requireRoomMembership.transition_collecting",
        room_id: params.roomId,
        user_id: params.userId,
        ...details,
      });
    } else {
      roomStatus = "collecting";
    }
  }
  const normalizedRoomStatus = roomStatus.trim().toLowerCase();
  const allowsClosedHistoricalMembership =
    membershipMode === "active_or_closed_historical" &&
    (normalizedRoomStatus === "closed" || normalizedRoomStatus === "expired" || normalizedRoomStatus === "ended");

  const { data: activeParticipantRow, error: activeParticipantError } = await supabaseAdmin
    .from("study_room_participants")
    .select(
      "id, room_id, user_id, role, joined_at, left_at, presence_state, focus_mode, focus_started_at, last_active_at, current_streak_seconds, total_focus_seconds, session_seconds, goal_text, goal_status",
    )
    .eq("room_id", params.roomId)
    .eq("user_id", params.userId)
    .is("left_at", null)
    .order("joined_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (activeParticipantError) {
    const details = toErrorDetails(activeParticipantError);
    console.error("[study_room_workspace] participant_lookup_failed", {
      table: "study_room_participants",
      query: "requireRoomMembership.active_participant",
      room_id: params.roomId,
      user_id: params.userId,
      membership_mode: membershipMode,
      ...details,
    });
    throw new Error(
      `Failed to load study room participant. table=study_room_participants room_id=${params.roomId} user_id=${params.userId} reason=${details.message}`,
    );
  }

  let participantRow = activeParticipantRow as GenericRecord | null;
  if (!participantRow && allowsClosedHistoricalMembership) {
    const { data: historicalParticipantRow, error: historicalParticipantError } = await supabaseAdmin
      .from("study_room_participants")
      .select(
        "id, room_id, user_id, role, joined_at, left_at, presence_state, focus_mode, focus_started_at, last_active_at, current_streak_seconds, total_focus_seconds, session_seconds, goal_text, goal_status",
      )
      .eq("room_id", params.roomId)
      .eq("user_id", params.userId)
      .order("joined_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (historicalParticipantError) {
      const details = toErrorDetails(historicalParticipantError);
      console.error("[study_room_workspace] participant_lookup_failed", {
        table: "study_room_participants",
        query: "requireRoomMembership.historical_participant",
        room_id: params.roomId,
        user_id: params.userId,
        membership_mode: membershipMode,
        ...details,
      });
      throw new Error(
        `Failed to load study room participant history. table=study_room_participants room_id=${params.roomId} user_id=${params.userId} reason=${details.message}`,
      );
    }
    participantRow = (historicalParticipantRow as GenericRecord | null) ?? null;
  }

  if (!participantRow) {
    return {
      ok: false as const,
      code: "FORBIDDEN" as const,
    };
  }

  const context: MembershipContext = {
    roomId: toStringValue((roomRow as GenericRecord).id),
    userId: params.userId,
    creatorId: toStringValue((roomRow as GenericRecord).creator_id),
    roomStatus,
    participantId: toStringValue((participantRow as GenericRecord).id),
    joinedAt: toNullableString((participantRow as GenericRecord).joined_at),
    focusMode: toBoolean((participantRow as GenericRecord).focus_mode),
    focusStartedAt: toNullableString((participantRow as GenericRecord).focus_started_at),
    totalFocusSeconds: Math.max(
      0,
      Math.floor(toNumberValue((participantRow as GenericRecord).total_focus_seconds)),
    ),
    currentStreakSeconds: Math.max(
      0,
      Math.floor(toNumberValue((participantRow as GenericRecord).current_streak_seconds)),
    ),
    goalText: toNullableString((participantRow as GenericRecord).goal_text),
    goalStatus: normalizeGoalStatus((participantRow as GenericRecord).goal_status),
  };
  return {
    ok: true as const,
    context,
  };
}

function buildParticipantStateRecord(row: GenericRecord, username: string): StudyRoomParticipantWorkspaceState {
  return {
    id: toStringValue(row.id),
    room_id: toStringValue(row.room_id),
    user_id: toStringValue(row.user_id),
    username,
    role: toStringValue(row.role) || "participant",
    joined_at: toNullableString(row.joined_at),
    last_active_at: toNullableString(row.last_active_at),
    presence_state: normalizePresenceState(row.presence_state),
    focus_mode: toBoolean(row.focus_mode),
    session_seconds: Math.max(0, Math.floor(toNumberValue(row.session_seconds))),
    current_streak_seconds: Math.max(0, Math.floor(toNumberValue(row.current_streak_seconds))),
    total_focus_seconds: Math.max(0, Math.floor(toNumberValue(row.total_focus_seconds))),
    goal_text: toNullableString(row.goal_text),
    goal_status: normalizeGoalStatus(row.goal_status),
  };
}

export async function listStudyRoomParticipantWorkspaceState(params: {
  userId: string;
  roomId: string;
}) {
  const membership = await requireRoomMembership(params);
  if (!membership.ok) {
    return membership;
  }

  const { data, error } = await supabaseAdmin
    .from("study_room_participants")
    .select(
      "id, room_id, user_id, role, joined_at, left_at, presence_state, focus_mode, focus_started_at, last_active_at, current_streak_seconds, total_focus_seconds, session_seconds, goal_text, goal_status",
    )
    .eq("room_id", params.roomId)
    .is("left_at", null)
    .order("joined_at", { ascending: true });
  if (error) {
    const details = toErrorDetails(error);
    console.error("[study_room_workspace] participants_state_lookup_failed", {
      table: "study_room_participants",
      query: "listStudyRoomParticipantWorkspaceState",
      room_id: params.roomId,
      user_id: params.userId,
      ...details,
    });
    throw new Error(
      `Failed to load room participant state. table=study_room_participants room_id=${params.roomId} reason=${details.message}`,
    );
  }

  const rows = (data ?? []) as GenericRecord[];
  let usernamesById = new Map<string, string>();
  try {
    usernamesById = await loadUsernamesByIds(rows.map((row) => toStringValue(row.user_id)));
  } catch (error) {
    console.warn("[study_room_workspace] participants_usernames_lookup_partial", {
      table: "users",
      query: "listStudyRoomParticipantWorkspaceState.usernames",
      room_id: params.roomId,
      user_id: params.userId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  return {
    ok: true as const,
    participants: rows.map((row) =>
      buildParticipantStateRecord(row, usernamesById.get(toStringValue(row.user_id)) ?? "Unknown"),
    ),
  };
}

export async function updateStudyRoomPresenceState(params: {
  userId: string;
  roomId: string;
  presenceState?: StudyRoomPresenceState | null;
  focusMode?: boolean | null;
}) {
  const membership = await requireRoomMembership(params);
  if (!membership.ok) {
    return membership;
  }

  const context = membership.context;
  const nowIso = new Date().toISOString();
  const nowMs = Date.now();
  const joinedAtMs = parseIsoToMs(context.joinedAt, nowMs);
  const previousFocusStartedMs = parseIsoToMs(context.focusStartedAt, nowMs);
  const previousFocusMode = context.focusMode;
  const requestedPresence = params.presenceState ?? null;
  const requestedFocusMode = typeof params.focusMode === "boolean" ? params.focusMode : null;

  let nextFocusMode = requestedFocusMode ?? previousFocusMode;
  if (requestedPresence) {
    nextFocusMode = requestedPresence === "focus";
  }
  const nextPresenceState: StudyRoomPresenceState = requestedPresence ?? (nextFocusMode ? "focus" : "online");

  let nextTotalFocusSeconds = context.totalFocusSeconds;
  let nextCurrentStreakSeconds = context.currentStreakSeconds;
  let nextFocusStartedAt: string | null = context.focusStartedAt;

  if (previousFocusMode && !nextFocusMode) {
    const deltaSeconds = Math.max(0, Math.floor((nowMs - previousFocusStartedMs) / 1000));
    nextTotalFocusSeconds += deltaSeconds;
    nextCurrentStreakSeconds = 0;
    nextFocusStartedAt = null;
  } else if (!previousFocusMode && nextFocusMode) {
    nextFocusStartedAt = nowIso;
    nextCurrentStreakSeconds = 0;
  } else if (previousFocusMode && nextFocusMode) {
    nextCurrentStreakSeconds = Math.max(0, Math.floor((nowMs - previousFocusStartedMs) / 1000));
    nextFocusStartedAt = context.focusStartedAt ?? nowIso;
  } else {
    nextCurrentStreakSeconds = 0;
  }

  const payload = {
    presence_state: nextPresenceState,
    focus_mode: nextFocusMode,
    focus_started_at: nextFocusStartedAt,
    last_active_at: nowIso,
    session_seconds: Math.max(0, Math.floor((nowMs - joinedAtMs) / 1000)),
    total_focus_seconds: Math.max(0, Math.floor(nextTotalFocusSeconds)),
    current_streak_seconds: Math.max(0, Math.floor(nextCurrentStreakSeconds)),
  };

  const { data, error } = await supabaseAdmin
    .from("study_room_participants")
    .update(payload)
    .eq("id", context.participantId)
    .select(
      "id, room_id, user_id, role, joined_at, left_at, presence_state, focus_mode, focus_started_at, last_active_at, current_streak_seconds, total_focus_seconds, session_seconds, goal_text, goal_status",
    )
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    const details = toErrorDetails(error);
    console.error("[study_room_workspace] presence_update_failed", {
      table: "study_room_participants",
      query: "updateStudyRoomPresenceState",
      room_id: params.roomId,
      user_id: params.userId,
      payload_keys: Object.keys(payload),
      ...details,
    });
    throw new Error(
      `Failed to update participant presence. table=study_room_participants room_id=${params.roomId} user_id=${params.userId} reason=${details.message}`,
    );
  }

  let username = "Unknown";
  try {
    const usernamesById = await loadUsernamesByIds([params.userId]);
    username = usernamesById.get(params.userId) ?? "Unknown";
  } catch (lookupError) {
    console.warn("[study_room_workspace] presence_user_lookup_partial", {
      table: "users",
      query: "updateStudyRoomPresenceState.username",
      room_id: params.roomId,
      user_id: params.userId,
      reason: lookupError instanceof Error ? lookupError.message : String(lookupError),
    });
  }
  return {
    ok: true as const,
    participant: buildParticipantStateRecord(
      data as GenericRecord,
      username,
    ),
  };
}

export async function updateStudyRoomGoal(params: {
  userId: string;
  roomId: string;
  goalText: string | null;
  goalStatus: StudyRoomGoalStatus;
}) {
  const membership = await requireRoomMembership(params);
  if (!membership.ok) {
    return membership;
  }

  const payload = {
    goal_text: params.goalText?.trim() ? params.goalText.trim().slice(0, 300) : null,
    goal_status: params.goalStatus,
    last_active_at: new Date().toISOString(),
  };

  const { data, error } = await supabaseAdmin
    .from("study_room_participants")
    .update(payload)
    .eq("id", membership.context.participantId)
    .select(
      "id, room_id, user_id, role, joined_at, left_at, presence_state, focus_mode, focus_started_at, last_active_at, current_streak_seconds, total_focus_seconds, session_seconds, goal_text, goal_status",
    )
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    const details = toErrorDetails(error);
    console.error("[study_room_workspace] goal_update_failed", {
      table: "study_room_participants",
      query: "updateStudyRoomGoal",
      room_id: params.roomId,
      user_id: params.userId,
      ...details,
    });
    throw new Error(
      `Failed to update participant goal. table=study_room_participants room_id=${params.roomId} user_id=${params.userId} reason=${details.message}`,
    );
  }

  const usernamesById = await loadUsernamesByIds([params.userId]);
  return {
    ok: true as const,
    participant: buildParticipantStateRecord(
      data as GenericRecord,
      usernamesById.get(params.userId) ?? "Unknown",
    ),
  };
}

export async function getStudyRoomNotes(params: {
  userId: string;
  roomId: string;
  membershipMode?: RoomMembershipMode;
}) {
  const membership = await requireRoomMembership(params);
  if (!membership.ok) {
    return membership;
  }

  const { data: entryRows, error: entriesError } = await supabaseAdmin
    .from("study_room_note_entries")
    .select("id, room_id, author_user_id, content_md, created_at, updated_at, is_deleted")
    .eq("room_id", params.roomId)
    .eq("is_deleted", false)
    .order("updated_at", { ascending: false });

  if (entriesError) {
    const details = toErrorDetails(entriesError);
    console.error("[study_room_workspace] note_entries_lookup_failed", {
      table: "study_room_note_entries",
      query: "getStudyRoomNotes.entries",
      room_id: params.roomId,
      user_id: params.userId,
      ...details,
    });
    throw new Error(
      `Failed to load study room note entries. table=study_room_note_entries room_id=${params.roomId} reason=${details.message}`,
    );
  }

  const entriesRaw = (entryRows ?? []) as GenericRecord[];
  const usernamesById = await loadUsernamesByIds(
    entriesRaw.map((row) => toStringValue(row.author_user_id)).filter(Boolean),
  );
  const entries: StudyRoomNoteEntryRecord[] = entriesRaw.map((row) => {
    const authorUserId = toStringValue(row.author_user_id);
    return {
      id: toStringValue(row.id),
      room_id: toStringValue(row.room_id),
      author_user_id: authorUserId,
      author_username: usernamesById.get(authorUserId) ?? null,
      content_md: toNullableString(row.content_md),
      created_at: toNullableString(row.created_at),
      updated_at: toNullableString(row.updated_at),
      is_deleted: toBoolean(row.is_deleted),
    } satisfies StudyRoomNoteEntryRecord;
  });
  const myEntry =
    entries.find((entry) => entry.author_user_id === params.userId && !entry.is_deleted) ?? null;

  const legacyResult = await supabaseAdmin
    .from("study_room_notes")
    .select("id, room_id, content_md, updated_by, created_at, updated_at")
    .eq("room_id", params.roomId)
    .limit(1)
    .maybeSingle();

  let note: StudyRoomNoteRecord = {
    id: null,
    room_id: params.roomId,
    content: null,
    updated_by: null,
    updated_by_username: null,
    updated_at: null,
    created_at: null,
  };

  if (legacyResult.error) {
    const details = toErrorDetails(legacyResult.error);
    console.warn("[study_room_workspace] legacy_notes_lookup_failed", {
      table: "study_room_notes",
      query: "getStudyRoomNotes.legacy",
      room_id: params.roomId,
      user_id: params.userId,
      ...details,
    });
  } else if (legacyResult.data) {
    const legacyRow = legacyResult.data as GenericRecord;
    const updatedBy = toNullableString(legacyRow.updated_by);
    const legacyNameMap = await loadUsernamesByIds(updatedBy ? [updatedBy] : []);
    note = {
      id: toNullableString(legacyRow.id),
      room_id: params.roomId,
      content: toNullableString(legacyRow.content_md),
      updated_by: updatedBy,
      updated_by_username: updatedBy ? legacyNameMap.get(updatedBy) ?? null : null,
      updated_at: toNullableString(legacyRow.updated_at),
      created_at: toNullableString(legacyRow.created_at),
    };
  }

  return {
    ok: true as const,
    note,
    entries,
    my_entry: myEntry,
  };
}

export async function saveStudyRoomNotes(params: {
  userId: string;
  roomId: string;
  content: string;
  entryId?: string | null;
}) {
  const membership = await requireRoomMembership(params);
  if (!membership.ok) {
    return membership;
  }
  const writeBlockCode = getRoomWriteBlockCode(membership.context.roomStatus);
  if (writeBlockCode) {
    return {
      ok: false as const,
      code: writeBlockCode,
    };
  }

  const nowIso = new Date().toISOString();
  const normalizedContent = params.content.slice(0, 100_000);
  const contentForDb = normalizedContent.trim() ? normalizedContent : null;

  let targetEntryId = params.entryId?.trim() || null;
  if (!targetEntryId) {
    const latestOwnResult = await supabaseAdmin
      .from("study_room_note_entries")
      .select("id")
      .eq("room_id", params.roomId)
      .eq("author_user_id", params.userId)
      .eq("is_deleted", false)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestOwnResult.error) {
      const details = toErrorDetails(latestOwnResult.error);
      console.error("[study_room_workspace] note_entry_lookup_failed", {
        table: "study_room_note_entries",
        query: "saveStudyRoomNotes.findLatestOwn",
        room_id: params.roomId,
        user_id: params.userId,
        ...details,
      });
      throw new Error(
        `Failed to locate user note entry. table=study_room_note_entries room_id=${params.roomId} reason=${details.message}`,
      );
    }
    targetEntryId = toNullableString((latestOwnResult.data as GenericRecord | null)?.id);
  }

  let savedEntryRow: GenericRecord | null = null;
  if (targetEntryId) {
    const updateResult = await supabaseAdmin
      .from("study_room_note_entries")
      .update({
        content_md: contentForDb,
        updated_at: nowIso,
        is_deleted: false,
      })
      .eq("id", targetEntryId)
      .eq("room_id", params.roomId)
      .eq("author_user_id", params.userId)
      .select("id, room_id, author_user_id, content_md, created_at, updated_at, is_deleted")
      .limit(1)
      .maybeSingle();
    if (updateResult.error) {
      const details = toErrorDetails(updateResult.error);
      console.error("[study_room_workspace] note_entry_update_failed", {
        table: "study_room_note_entries",
        query: "saveStudyRoomNotes.update",
        room_id: params.roomId,
        user_id: params.userId,
        entry_id: targetEntryId,
        ...details,
      });
      throw new Error(
        `Failed to update study room note entry. table=study_room_note_entries room_id=${params.roomId} reason=${details.message}`,
      );
    }
    savedEntryRow = (updateResult.data as GenericRecord | null) ?? null;
  }

  if (!savedEntryRow) {
    const insertPayload = {
      room_id: params.roomId,
      author_user_id: params.userId,
      content_md: contentForDb,
      created_at: nowIso,
      updated_at: nowIso,
      is_deleted: false,
    };
    const insertResult = await supabaseAdmin
      .from("study_room_note_entries")
      .insert(insertPayload)
      .select("id, room_id, author_user_id, content_md, created_at, updated_at, is_deleted")
      .limit(1)
      .maybeSingle();
    if (insertResult.error || !insertResult.data) {
      const details = toErrorDetails(insertResult.error);
      console.error("[study_room_workspace] note_entry_insert_failed", {
        table: "study_room_note_entries",
        query: "saveStudyRoomNotes.insert",
        room_id: params.roomId,
        user_id: params.userId,
        payload_keys: Object.keys(insertPayload),
        ...details,
      });
      throw new Error(
        `Failed to save study room note entry. table=study_room_note_entries room_id=${params.roomId} reason=${details.message}`,
      );
    }
    savedEntryRow = insertResult.data as GenericRecord;
  }

  const legacyPayload = {
    room_id: params.roomId,
    content_md: contentForDb,
    updated_by: params.userId,
    updated_at: nowIso,
  };
  const legacyUpsertResult = await supabaseAdmin
    .from("study_room_notes")
    .upsert(legacyPayload, { onConflict: "room_id", ignoreDuplicates: false });
  if (legacyUpsertResult.error) {
    const details = toErrorDetails(legacyUpsertResult.error);
    console.warn("[study_room_workspace] legacy_notes_upsert_failed", {
      table: "study_room_notes",
      query: "saveStudyRoomNotes.legacyUpsert",
      room_id: params.roomId,
      user_id: params.userId,
      ...details,
    });
  }

  const refreshed = await getStudyRoomNotes({
    userId: params.userId,
    roomId: params.roomId,
  });
  if (!refreshed.ok) {
    return refreshed;
  }

  const usernamesById = await loadUsernamesByIds([params.userId]);
  return {
    ok: true as const,
    note: refreshed.note,
    entries: refreshed.entries,
    my_entry: refreshed.my_entry,
    saved_entry: {
      id: toStringValue(savedEntryRow.id),
      room_id: toStringValue(savedEntryRow.room_id),
      author_user_id: toStringValue(savedEntryRow.author_user_id),
      author_username: usernamesById.get(params.userId) ?? null,
      content_md: toNullableString(savedEntryRow.content_md),
      created_at: toNullableString(savedEntryRow.created_at),
      updated_at: toNullableString(savedEntryRow.updated_at),
      is_deleted: toBoolean(savedEntryRow.is_deleted),
    } satisfies StudyRoomNoteEntryRecord,
  };
}

export async function deleteStudyRoomNoteEntry(params: {
  userId: string;
  roomId: string;
  entryId: string;
}) {
  const membership = await requireRoomMembership(params);
  if (!membership.ok) {
    return membership;
  }
  const writeBlockCode = getRoomWriteBlockCode(membership.context.roomStatus);
  if (writeBlockCode) {
    return {
      ok: false as const,
      code: writeBlockCode,
    };
  }

  const entryId = params.entryId.trim();
  if (!entryId) {
    throw new Error("Note entry id is required.");
  }

  const { data: ownedRow, error: ownedRowError } = await supabaseAdmin
    .from("study_room_note_entries")
    .select("id, author_user_id, room_id, is_deleted")
    .eq("id", entryId)
    .eq("room_id", params.roomId)
    .limit(1)
    .maybeSingle();
  if (ownedRowError) {
    const details = toErrorDetails(ownedRowError);
    console.error("[study_room_workspace] note_entry_lookup_failed", {
      table: "study_room_note_entries",
      query: "deleteStudyRoomNoteEntry.lookup",
      room_id: params.roomId,
      user_id: params.userId,
      entry_id: entryId,
      ...details,
    });
    throw new Error(
      `Failed to load study room note entry. table=study_room_note_entries room_id=${params.roomId} reason=${details.message}`,
    );
  }
  if (!ownedRow) {
    return {
      ok: false as const,
      code: "NOTE_ENTRY_NOT_FOUND" as const,
    };
  }
  if (toStringValue((ownedRow as GenericRecord).author_user_id) !== params.userId) {
    return {
      ok: false as const,
      code: "FORBIDDEN" as const,
    };
  }

  const { error: deleteError } = await supabaseAdmin
    .from("study_room_note_entries")
    .update({
      is_deleted: true,
      updated_at: new Date().toISOString(),
      content_md: null,
    })
    .eq("id", entryId)
    .eq("room_id", params.roomId)
    .eq("author_user_id", params.userId);

  if (deleteError) {
    const details = toErrorDetails(deleteError);
    console.error("[study_room_workspace] note_entry_delete_failed", {
      table: "study_room_note_entries",
      query: "deleteStudyRoomNoteEntry.update",
      room_id: params.roomId,
      user_id: params.userId,
      entry_id: entryId,
      ...details,
    });
    throw new Error(
      `Failed to delete study room note entry. table=study_room_note_entries room_id=${params.roomId} reason=${details.message}`,
    );
  }

  const refreshed = await getStudyRoomNotes({
    userId: params.userId,
    roomId: params.roomId,
  });
  if (!refreshed.ok) {
    return refreshed;
  }
  return {
    ok: true as const,
    note: refreshed.note,
    entries: refreshed.entries,
    my_entry: refreshed.my_entry,
  };
}

export async function listStudyRoomResources(params: {
  userId: string;
  roomId: string;
  membershipMode?: RoomMembershipMode;
}) {
  const membership = await requireRoomMembership(params);
  if (!membership.ok) {
    return membership;
  }

  const { data, error } = await supabaseAdmin
    .from("study_room_resources")
    .select(
      "id, room_id, source_kind, resource_type, title, url, file_name, file_path, file_size_bytes, mime_type, added_by, created_at",
    )
    .eq("room_id", params.roomId)
    .order("created_at", { ascending: false });
  if (error) {
    const details = toErrorDetails(error);
    console.error("[study_room_workspace] resources_lookup_failed", {
      table: "study_room_resources",
      query: "listStudyRoomResources",
      room_id: params.roomId,
      user_id: params.userId,
      ...details,
    });
    throw new Error(
      `Failed to load study room resources. table=study_room_resources room_id=${params.roomId} reason=${details.message}`,
    );
  }

  const rows = (data ?? []) as GenericRecord[];
  const usernamesById = await loadUsernamesByIds(rows.map((row) => toStringValue(row.added_by)));
  const resources: StudyRoomSharedResource[] = rows.map((row) =>
    mapStudyRoomResourceRow(row, usernamesById),
  );
  return {
    ok: true as const,
    resources,
  };
}

export async function addStudyRoomLinkResource(params: {
  userId: string;
  roomId: string;
  resourceType: string;
  title: string;
  url: string;
}) {
  const membership = await requireRoomMembership(params);
  if (!membership.ok) {
    return membership;
  }
  const writeBlockCode = getRoomWriteBlockCode(membership.context.roomStatus);
  if (writeBlockCode) {
    return {
      ok: false as const,
      code: writeBlockCode,
    };
  }

  const normalizedUrl = assertValidUrl(params.url);
  const normalizedType = normalizeResourceTypeFromInput(params.resourceType);
  const normalizedTitle = params.title.trim().slice(0, 160);
  if (!normalizedTitle) {
    throw new Error("Resource title is required.");
  }

  const payload = {
    room_id: params.roomId,
    source_kind: "url",
    resource_type: normalizedType,
    title: normalizedTitle,
    url: normalizedUrl,
    file_name: null,
    file_path: null,
    file_size_bytes: null,
    mime_type: null,
    added_by: params.userId,
  };
  const { data, error } = await supabaseAdmin
    .from("study_room_resources")
    .insert(payload)
    .select(
      "id, room_id, source_kind, resource_type, title, url, file_name, file_path, file_size_bytes, mime_type, added_by, created_at",
    )
    .limit(1)
    .maybeSingle();
  if (error || !data) {
    const details = toErrorDetails(error);
    console.error("[study_room_workspace] resource_insert_failed", {
      table: "study_room_resources",
      query: "addStudyRoomResource",
      room_id: params.roomId,
      user_id: params.userId,
      payload_keys: Object.keys(payload),
      ...details,
    });
    throw new Error(
      `Failed to add study room resource. table=study_room_resources room_id=${params.roomId} reason=${details.message}`,
    );
  }

  const usernamesById = await loadUsernamesByIds([params.userId]);
  const resource = mapStudyRoomResourceRow((data as GenericRecord) ?? {}, usernamesById);

  return {
    ok: true as const,
    resource,
  };
}

export async function addStudyRoomFileResource(params: {
  userId: string;
  roomId: string;
  resourceType: string;
  title: string;
  file: File;
}) {
  const membership = await requireRoomMembership(params);
  if (!membership.ok) {
    return membership;
  }
  const writeBlockCode = getRoomWriteBlockCode(membership.context.roomStatus);
  if (writeBlockCode) {
    return {
      ok: false as const,
      code: writeBlockCode,
    };
  }

  const normalizedTitle = params.title.trim().slice(0, 160);
  if (!normalizedTitle) {
    throw new Error("Resource title is required.");
  }

  const validated = assertAllowedUploadFile(params.file);
  const normalizedType =
    normalizeResourceTypeFromInput(params.resourceType) === "other"
      ? inferResourceTypeFromFile(validated.fileName, validated.mimeType)
      : normalizeResourceTypeFromInput(params.resourceType);
  const filePath = `${params.roomId}/${params.userId}/${Date.now()}-${crypto.randomUUID()}-${validated.fileName}`;
  const fileBuffer = Buffer.from(await params.file.arrayBuffer());

  const uploadResult = await supabaseAdmin.storage
    .from(STUDY_ROOM_RESOURCE_BUCKET)
    .upload(filePath, fileBuffer, {
      upsert: false,
      contentType: validated.mimeType,
      cacheControl: "3600",
    });
  if (uploadResult.error) {
    const details = toErrorDetails(uploadResult.error);
    console.error("[study_room_workspace] resource_file_upload_failed", {
      bucket: STUDY_ROOM_RESOURCE_BUCKET,
      room_id: params.roomId,
      user_id: params.userId,
      file_path: filePath,
      ...details,
    });
    throw new Error(
      `Failed to upload study room resource file. bucket=${STUDY_ROOM_RESOURCE_BUCKET} room_id=${params.roomId} reason=${details.message}`,
    );
  }

  const publicUrlResult = supabaseAdmin.storage.from(STUDY_ROOM_RESOURCE_BUCKET).getPublicUrl(filePath);
  const fileUrl = toStringValue(publicUrlResult.data.publicUrl).trim() || null;

  const payload = {
    room_id: params.roomId,
    source_kind: "file",
    resource_type: normalizedType,
    title: normalizedTitle,
    url: fileUrl,
    file_name: validated.fileName,
    file_path: filePath,
    file_size_bytes: validated.size,
    mime_type: validated.mimeType,
    added_by: params.userId,
  };

  const { data, error } = await supabaseAdmin
    .from("study_room_resources")
    .insert(payload)
    .select(
      "id, room_id, source_kind, resource_type, title, url, file_name, file_path, file_size_bytes, mime_type, added_by, created_at",
    )
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    const details = toErrorDetails(error);
    console.error("[study_room_workspace] resource_file_insert_failed", {
      table: "study_room_resources",
      query: "addStudyRoomFileResource",
      room_id: params.roomId,
      user_id: params.userId,
      payload_keys: Object.keys(payload),
      ...details,
    });
    await supabaseAdmin.storage.from(STUDY_ROOM_RESOURCE_BUCKET).remove([filePath]);
    throw new Error(
      `Failed to add study room uploaded resource. table=study_room_resources room_id=${params.roomId} reason=${details.message}`,
    );
  }

  const usernamesById = await loadUsernamesByIds([params.userId]);
  const resource = mapStudyRoomResourceRow((data as GenericRecord) ?? {}, usernamesById);
  return {
    ok: true as const,
    resource,
  };
}

export async function addStudyRoomResource(params: {
  userId: string;
  roomId: string;
  resourceType: string;
  title: string;
  url: string;
}) {
  return addStudyRoomLinkResource(params);
}

export async function removeStudyRoomResource(params: {
  userId: string;
  roomId: string;
  resourceId: string;
}) {
  const membership = await requireRoomMembership(params);
  if (!membership.ok) {
    return membership;
  }
  const writeBlockCode = getRoomWriteBlockCode(membership.context.roomStatus);
  if (writeBlockCode) {
    return {
      ok: false as const,
      code: writeBlockCode,
    };
  }

  const { data: row, error: rowError } = await supabaseAdmin
    .from("study_room_resources")
    .select("id, room_id, source_kind, file_path, added_by")
    .eq("id", params.resourceId)
    .eq("room_id", params.roomId)
    .limit(1)
    .maybeSingle();
  if (rowError) {
    const details = toErrorDetails(rowError);
    console.error("[study_room_workspace] resource_delete_lookup_failed", {
      table: "study_room_resources",
      query: "removeStudyRoomResource.lookup",
      room_id: params.roomId,
      user_id: params.userId,
      resource_id: params.resourceId,
      ...details,
    });
    throw new Error(
      `Failed to remove study room resource. table=study_room_resources room_id=${params.roomId} reason=${details.message}`,
    );
  }
  if (!row) {
    return {
      ok: false as const,
      code: "NOT_FOUND" as const,
    };
  }

  const addedBy = toStringValue((row as GenericRecord).added_by);
  if (addedBy !== params.userId && membership.context.creatorId !== params.userId) {
    return {
      ok: false as const,
      code: "FORBIDDEN" as const,
    };
  }

  const rowRecord = (row ?? {}) as GenericRecord;
  const sourceKind = normalizeSourceKind(toStringValue(rowRecord.source_kind));
  const filePath = toNullableString(rowRecord.file_path);

  const { error } = await supabaseAdmin
    .from("study_room_resources")
    .delete()
    .eq("id", params.resourceId)
    .eq("room_id", params.roomId);
  if (error) {
    const details = toErrorDetails(error);
    console.error("[study_room_workspace] resource_delete_failed", {
      table: "study_room_resources",
      query: "removeStudyRoomResource.delete",
      room_id: params.roomId,
      user_id: params.userId,
      resource_id: params.resourceId,
      ...details,
    });
    throw new Error(
      `Failed to remove study room resource. table=study_room_resources room_id=${params.roomId} reason=${details.message}`,
    );
  }

  if (sourceKind === "file" && filePath) {
    const removeResult = await supabaseAdmin.storage
      .from(STUDY_ROOM_RESOURCE_BUCKET)
      .remove([filePath]);
    if (removeResult.error) {
      const details = toErrorDetails(removeResult.error);
      console.warn("[study_room_workspace] resource_file_remove_failed", {
        bucket: STUDY_ROOM_RESOURCE_BUCKET,
        room_id: params.roomId,
        user_id: params.userId,
        resource_id: params.resourceId,
        file_path: filePath,
        ...details,
      });
    }
  }

  return {
    ok: true as const,
  };
}

export async function listStudyRoomAiMessages(params: {
  userId: string;
  roomId: string;
  membershipMode?: RoomMembershipMode;
}) {
  const membership = await requireRoomMembership(params);
  if (!membership.ok) {
    return membership;
  }

  const { data, error } = await supabaseAdmin
    .from("study_room_ai_messages")
    .select(
      "id, room_id, sender_id, linked_user_id, sender_type, message_kind, body, provider, model, context_summary, metadata, created_at",
    )
    .eq("room_id", params.roomId)
    .order("created_at", { ascending: true });
  if (error) {
    const details = toErrorDetails(error);
    console.error("[study_room_workspace] ai_messages_lookup_failed", {
      table: "study_room_ai_messages",
      query: "listStudyRoomAiMessages",
      room_id: params.roomId,
      user_id: params.userId,
      ...details,
    });
    throw new Error(enrichAiMessagesSchemaMismatchMessage(
      `Failed to load AI tutor messages. table=study_room_ai_messages room_id=${params.roomId} reason=${details.message}`,
    ));
  }

  const rows = (data ?? []) as GenericRecord[];
  const usernamesById = await loadUsernamesByIds(
    rows.map((row) => toStringValue(row.sender_id)).filter(Boolean),
  );
  return {
    ok: true as const,
    messages: rows.map((row) => {
      const senderId = toNullableString(row.sender_id);
      return {
        id: toStringValue(row.id),
        room_id: toStringValue(row.room_id),
        sender_id: senderId,
        linked_user_id: toNullableString(row.linked_user_id),
        sender_username: senderId ? usernamesById.get(senderId) ?? null : null,
        sender_type: normalizeAiSenderType(row.sender_type),
        role: normalizeAiRole(row.sender_type),
        message_kind: normalizeAiMessageKind(row.message_kind),
        body: toStringValue(row.body),
        provider: toNullableString(row.provider),
        model: toNullableString(row.model),
        context_summary: toNullableString(row.context_summary),
        metadata: normalizeMetadata(row.metadata),
        created_at: toNullableString(row.created_at),
      } satisfies StudyRoomAiMessage;
    }),
  };
}

async function appendAiTutorNote(params: { roomId: string; userId: string; question: string; answer: string }) {
  const nowIso = new Date().toISOString();
  const readableDate = new Date(nowIso).toLocaleString("en-US", {
    hour12: false,
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const block = [
    "",
    "## AI Tutor Notes",
    `### ${readableDate}`,
    `- Question: ${truncateText(params.question, 420)}`,
    `- Answer: ${truncateText(params.answer, 900)}`,
  ].join("\n");
  const latestOwnResult = await supabaseAdmin
    .from("study_room_note_entries")
    .select("id, content_md")
    .eq("room_id", params.roomId)
    .eq("author_user_id", params.userId)
    .eq("is_deleted", false)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestOwnResult.error) {
    const details = toErrorDetails(latestOwnResult.error);
    console.warn("[study_room_workspace] ai_tutor_note_entry_lookup_failed", {
      table: "study_room_note_entries",
      query: "appendAiTutorNote.lookupLatestOwn",
      room_id: params.roomId,
      user_id: params.userId,
      ...details,
    });
    return;
  }

  const previousContent = toNullableString((latestOwnResult.data as GenericRecord | null)?.content_md) ?? "";
  const merged = `${previousContent}${block}`.slice(0, 100_000);
  if (latestOwnResult.data) {
    const entryId = toStringValue((latestOwnResult.data as GenericRecord).id);
    if (entryId) {
      const updateResult = await supabaseAdmin
        .from("study_room_note_entries")
        .update({
          content_md: merged,
          updated_at: nowIso,
          is_deleted: false,
        })
        .eq("id", entryId)
        .eq("room_id", params.roomId)
        .eq("author_user_id", params.userId);
      if (updateResult.error) {
        const details = toErrorDetails(updateResult.error);
        console.warn("[study_room_workspace] ai_tutor_note_entry_update_failed", {
          table: "study_room_note_entries",
          query: "appendAiTutorNote.update",
          room_id: params.roomId,
          user_id: params.userId,
          entry_id: entryId,
          ...details,
        });
      }
    }
  } else {
    const insertResult = await supabaseAdmin.from("study_room_note_entries").insert({
      room_id: params.roomId,
      author_user_id: params.userId,
      content_md: merged,
      created_at: nowIso,
      updated_at: nowIso,
      is_deleted: false,
    });
    if (insertResult.error) {
      const details = toErrorDetails(insertResult.error);
      console.warn("[study_room_workspace] ai_tutor_note_entry_insert_failed", {
        table: "study_room_note_entries",
        query: "appendAiTutorNote.insert",
        room_id: params.roomId,
        user_id: params.userId,
        ...details,
      });
    }
  }

  const legacyResult = await supabaseAdmin.from("study_room_notes").upsert(
    {
      room_id: params.roomId,
      content_md: merged,
      updated_by: params.userId,
      updated_at: nowIso,
    },
    {
      onConflict: "room_id",
      ignoreDuplicates: false,
    },
  );
  if (legacyResult.error) {
    const details = toErrorDetails(legacyResult.error);
    console.warn("[study_room_workspace] ai_tutor_legacy_note_upsert_failed", {
      table: "study_room_notes",
      query: "appendAiTutorNote.legacy",
      room_id: params.roomId,
      user_id: params.userId,
      ...details,
    });
  }
}

function extractCompletionText(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        const record = (item ?? {}) as GenericRecord;
        return toStringValue(record.text) || toStringValue(record.value);
      })
      .join(" ")
      .trim();
  }
  return "";
}

type StudyRoomAiTutorContextBundle = {
  promptContextBlock: string;
  contextSummary: string;
  metadata: Record<string, unknown>;
};

async function loadLatestUserLearningFieldContext(userId: string) {
  const withCreatedAt = await supabaseAdmin
    .from("user_learning_fields")
    .select("id, field_id, current_level, target_level, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!withCreatedAt.error) {
    return (withCreatedAt.data as GenericRecord | null) ?? null;
  }

  if (!/created_at/i.test(withCreatedAt.error.message)) {
    const details = toErrorDetails(withCreatedAt.error);
    console.error("[study_room_workspace] ai_tutor_context_load_failed", {
      table: "user_learning_fields",
      query: "loadLatestUserLearningFieldContext.created_at",
      user_id: userId,
      ...details,
    });
    throw new Error(`Failed to load learning field context. table=user_learning_fields reason=${details.message}`);
  }

  const withStartedAt = await supabaseAdmin
    .from("user_learning_fields")
    .select("id, field_id, current_level, target_level, started_at")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (withStartedAt.error) {
    const details = toErrorDetails(withStartedAt.error);
    console.error("[study_room_workspace] ai_tutor_context_load_failed", {
      table: "user_learning_fields",
      query: "loadLatestUserLearningFieldContext.started_at",
      user_id: userId,
      ...details,
    });
    throw new Error(`Failed to load learning field context. table=user_learning_fields reason=${details.message}`);
  }
  return (withStartedAt.data as GenericRecord | null) ?? null;
}

async function buildStudyRoomAiTutorContext(params: {
  userId: string;
  roomId: string;
  question: string;
  participantGoalText: string | null;
  participantGoalStatus: StudyRoomGoalStatus;
}) {
  const [roomResult, resourcesResult, userNotesResult, sharedNotesResult, legacyNotesResult, roomHistoryResult, userHistoryResult] =
    await Promise.all([
    supabaseAdmin
      .from("study_rooms")
      .select("id, name, style, status, created_at, expires_at, duration_minutes")
      .eq("id", params.roomId)
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("study_room_resources")
      .select("id, source_kind, resource_type, title, url, file_name, created_at")
      .eq("room_id", params.roomId)
      .order("created_at", { ascending: false })
      .limit(8),
    supabaseAdmin
      .from("study_room_note_entries")
      .select("id, author_user_id, content_md, created_at, updated_at")
      .eq("room_id", params.roomId)
      .eq("author_user_id", params.userId)
      .eq("is_deleted", false)
      .order("updated_at", { ascending: false })
      .limit(8),
    supabaseAdmin
      .from("study_room_note_entries")
      .select("id, author_user_id, content_md, created_at, updated_at")
      .eq("room_id", params.roomId)
      .neq("author_user_id", params.userId)
      .eq("is_deleted", false)
      .order("updated_at", { ascending: false })
      .limit(8),
    supabaseAdmin
      .from("study_room_notes")
      .select("content_md, updated_at")
      .eq("room_id", params.roomId)
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("study_room_ai_messages")
      .select("sender_type, message_kind, body, created_at")
      .eq("room_id", params.roomId)
      .order("created_at", { ascending: false })
      .limit(10),
    supabaseAdmin
      .from("study_room_ai_messages")
      .select("sender_type, message_kind, body, created_at")
      .eq("room_id", params.roomId)
      .eq("linked_user_id", params.userId)
      .order("created_at", { ascending: false })
      .limit(6),
  ]);

  if (roomResult.error || !roomResult.data) {
    const details = toErrorDetails(roomResult.error);
    console.error("[study_room_workspace] ai_tutor_context_load_failed", {
      table: "study_rooms",
      query: "buildStudyRoomAiTutorContext.room",
      room_id: params.roomId,
      user_id: params.userId,
      ...details,
    });
    throw new Error(`Failed to load room context. table=study_rooms reason=${details.message}`);
  }

  if (resourcesResult.error) {
    const details = toErrorDetails(resourcesResult.error);
    console.error("[study_room_workspace] ai_tutor_context_load_failed", {
      table: "study_room_resources",
      query: "buildStudyRoomAiTutorContext.resources",
      room_id: params.roomId,
      user_id: params.userId,
      ...details,
    });
    throw new Error(`Failed to load room resources context. table=study_room_resources reason=${details.message}`);
  }

  if (userNotesResult.error) {
    const details = toErrorDetails(userNotesResult.error);
    console.error("[study_room_workspace] ai_tutor_context_load_notes_failed", {
      table: "study_room_note_entries",
      query: "buildStudyRoomAiTutorContext.user_notes",
      room_id: params.roomId,
      user_id: params.userId,
      ...details,
    });
  }

  if (sharedNotesResult.error) {
    const details = toErrorDetails(sharedNotesResult.error);
    console.error("[study_room_workspace] ai_tutor_context_load_notes_failed", {
      table: "study_room_note_entries",
      query: "buildStudyRoomAiTutorContext.shared_notes",
      room_id: params.roomId,
      user_id: params.userId,
      ...details,
    });
  }

  if (legacyNotesResult.error) {
    const details = toErrorDetails(legacyNotesResult.error);
    console.warn("[study_room_workspace] ai_tutor_context_load_notes_failed", {
      table: "study_room_notes",
      query: "buildStudyRoomAiTutorContext.legacy_notes",
      room_id: params.roomId,
      user_id: params.userId,
      ...details,
    });
  }

  if (roomHistoryResult.error) {
    const details = toErrorDetails(roomHistoryResult.error);
    console.error("[study_room_workspace] ai_tutor_context_history_load_failed", {
      table: "study_room_ai_messages",
      query: "buildStudyRoomAiTutorContext.room_history",
      room_id: params.roomId,
      user_id: params.userId,
      ...details,
    });
  }

  if (userHistoryResult.error) {
    const details = toErrorDetails(userHistoryResult.error);
    console.error("[study_room_workspace] ai_tutor_context_history_load_failed", {
      table: "study_room_ai_messages",
      query: "buildStudyRoomAiTutorContext.user_history",
      room_id: params.roomId,
      user_id: params.userId,
      ...details,
    });
  }

  let learningFieldRow: GenericRecord | null = null;
  try {
    learningFieldRow = await loadLatestUserLearningFieldContext(params.userId);
  } catch (error) {
    console.warn("[study_room_workspace] ai_tutor_learning_context_partial", {
      table: "user_learning_fields",
      room_id: params.roomId,
      user_id: params.userId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  const learningFieldId = toStringValue(learningFieldRow?.field_id);
  const currentLevel = toStringValue(learningFieldRow?.current_level) || null;
  const targetLevel = toStringValue(learningFieldRow?.target_level) || null;

  let learningFieldTitle: string | null = null;
  if (learningFieldId) {
    const fieldResult = await supabaseAdmin
      .from("learning_fields")
      .select("id, title")
      .eq("id", learningFieldId)
      .limit(1)
      .maybeSingle();
    if (fieldResult.error) {
      console.warn("[study_room_workspace] ai_tutor_learning_context_partial", {
        table: "learning_fields",
        room_id: params.roomId,
        user_id: params.userId,
        learning_field_id: learningFieldId,
        reason: toErrorDetails(fieldResult.error).message,
      });
    } else {
      learningFieldTitle = toStringValue((fieldResult.data as GenericRecord | null)?.title) || null;
    }
  }

  const progressResult = await supabaseAdmin
    .from("user_course_progress")
    .select(
      "course_id, journey_path_id, status, last_test_score, best_test_score, attempt_count, last_activity_at, started_at, ready_for_test_at, passed_at",
    )
    .eq("user_id", params.userId)
    .order("last_activity_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (progressResult.error) {
    console.warn("[study_room_workspace] ai_tutor_learning_context_partial", {
      table: "user_course_progress",
      room_id: params.roomId,
      user_id: params.userId,
      reason: toErrorDetails(progressResult.error).message,
    });
  }
  const progressRow = (progressResult.data as GenericRecord | null) ?? null;
  const currentCourseId = toStringValue(progressRow?.course_id) || null;
  const currentJourneyPathId = toStringValue(progressRow?.journey_path_id) || null;

  let courseRow: GenericRecord | null = null;
  if (currentCourseId) {
    const currentCourseResult = await supabaseAdmin
      .from("courses")
      .select("id, title, description, difficulty_level")
      .eq("id", currentCourseId)
      .limit(1)
      .maybeSingle();
    if (currentCourseResult.error) {
      console.warn("[study_room_workspace] ai_tutor_learning_context_partial", {
        table: "courses",
        room_id: params.roomId,
        user_id: params.userId,
        course_id: currentCourseId,
        reason: toErrorDetails(currentCourseResult.error).message,
      });
    } else {
      courseRow = (currentCourseResult.data as GenericRecord | null) ?? null;
    }
  }

  let stepNumber: number | null = null;
  if (currentCourseId && currentJourneyPathId) {
    const stepResult = await supabaseAdmin
      .from("journey_path_courses")
      .select("step_number")
      .eq("journey_path_id", currentJourneyPathId)
      .eq("course_id", currentCourseId)
      .limit(1)
      .maybeSingle();
    if (!stepResult.error) {
      const parsedStep = Math.floor(toNumberValue((stepResult.data as GenericRecord | null)?.step_number));
      stepNumber = parsedStep > 0 ? parsedStep : null;
    }
  }

  let recentAiTests: GenericRecord[] = [];
  if (currentCourseId) {
    const aiTestsResult = await supabaseAdmin
      .from("ai_user_tests")
      .select("earned_score, total_score, pass_status, status, graded_at, created_at, attempt_number")
      .eq("user_id", params.userId)
      .eq("course_id", currentCourseId)
      .order("created_at", { ascending: false })
      .limit(3);
    if (aiTestsResult.error) {
      console.warn("[study_room_workspace] ai_tutor_learning_context_partial", {
        table: "ai_user_tests",
        room_id: params.roomId,
        user_id: params.userId,
        course_id: currentCourseId,
        reason: toErrorDetails(aiTestsResult.error).message,
      });
    } else {
      recentAiTests = (aiTestsResult.data ?? []) as GenericRecord[];
    }
  }

  const roomRow = (roomResult.data ?? {}) as GenericRecord;
  const resourcesRows = (resourcesResult.data ?? []) as GenericRecord[];
  const userNoteRows = (userNotesResult.data ?? []) as GenericRecord[];
  const sharedNoteRows = (sharedNotesResult.data ?? []) as GenericRecord[];
  const legacyNotesContent = truncateText(
    toNullableString(((legacyNotesResult.data as GenericRecord | null) ?? {}).content_md),
    1200,
  );

  let noteAuthorNamesById = new Map<string, string>();
  try {
    noteAuthorNamesById = await loadUsernamesByIds(
      [...userNoteRows, ...sharedNoteRows]
        .map((row) => toStringValue(row.author_user_id))
        .filter(Boolean),
    );
  } catch (error) {
    console.warn("[study_room_workspace] ai_tutor_context_note_authors_partial", {
      table: "users",
      query: "buildStudyRoomAiTutorContext.note_authors",
      room_id: params.roomId,
      user_id: params.userId,
      reason: error instanceof Error ? error.message : String(error),
    });
  }

  const userNotesLines = userNoteRows
    .map((row, index) => {
      const content = truncateText(toNullableString(row.content_md), 520);
      if (!content) {
        return "";
      }
      const authorId = toStringValue(row.author_user_id);
      const author = noteAuthorNamesById.get(authorId) ?? "You";
      return `${index + 1}. ${author}: ${content}`;
    })
    .filter(Boolean);

  const sharedNotesLines = sharedNoteRows
    .map((row, index) => {
      const content = truncateText(toNullableString(row.content_md), 360);
      if (!content) {
        return "";
      }
      const authorId = toStringValue(row.author_user_id);
      const author = noteAuthorNamesById.get(authorId) ?? "Participant";
      return `${index + 1}. ${author}: ${content}`;
    })
    .filter(Boolean);

  if (userNotesLines.length === 0 && sharedNotesLines.length === 0 && !legacyNotesContent) {
    console.info("[study_room_workspace] ai_tutor_context_notes_empty", {
      table: "study_room_note_entries",
      query: "buildStudyRoomAiTutorContext.personalized_notes",
      room_id: params.roomId,
      user_id: params.userId,
      user_notes_count: userNoteRows.length,
      shared_notes_count: sharedNoteRows.length,
      has_legacy_notes: Boolean(legacyNotesContent),
    });
  }
  const roomHistoryRows = (
    roomHistoryResult.error ? [] : ((roomHistoryResult.data ?? []) as GenericRecord[])
  ).reverse();
  const userHistoryRows = (
    userHistoryResult.error ? [] : ((userHistoryResult.data ?? []) as GenericRecord[])
  ).reverse();

  if (roomHistoryResult.error || userHistoryResult.error) {
    console.warn("[study_room_workspace] ai_tutor_context_history_degraded", {
      room_id: params.roomId,
      user_id: params.userId,
      room_history_query_failed: Boolean(roomHistoryResult.error),
      user_history_query_failed: Boolean(userHistoryResult.error),
      room_history_count_after_fallback: roomHistoryRows.length,
      user_history_count_after_fallback: userHistoryRows.length,
    });
  }

  const resourcesLines = resourcesRows.map((resource, index) => {
    const sourceKind = toStringValue(resource.source_kind) || "url";
    const location = toNullableString(resource.url) || toNullableString(resource.file_name) || "n/a";
    return `${index + 1}. ${toStringValue(resource.title)} [${toStringValue(resource.resource_type)} | ${sourceKind}] (${location})`;
  });

  const roomHistoryLines = roomHistoryRows.map((message) => {
    const senderLabel = normalizeAiRole(message.sender_type) === "assistant" ? "AI" : "User";
    const kind = normalizeAiMessageKind(message.message_kind);
    return `- ${senderLabel} (${kind}): ${truncateText(toStringValue(message.body), 260)}`;
  });

  const userHistoryLines = userHistoryRows.map((message) => {
    const senderLabel = normalizeAiRole(message.sender_type) === "assistant" ? "AI" : "User";
    const kind = normalizeAiMessageKind(message.message_kind);
    return `- ${senderLabel} (${kind}): ${truncateText(toStringValue(message.body), 200)}`;
  });

  const recentScoreLine =
    recentAiTests.length > 0
      ? recentAiTests
          .map((row) => {
            const earned = Math.max(0, Math.floor(toNumberValue(row.earned_score)));
            const total = Math.max(0, Math.floor(toNumberValue(row.total_score)));
            const passStatus = toStringValue(row.pass_status) || "unknown";
            const attempt = Math.max(0, Math.floor(toNumberValue(row.attempt_number)));
            return `attempt ${attempt || "?"}: ${earned}/${total || "?"} (${passStatus})`;
          })
          .join("; ")
      : "none";

  const learningSummaryParts = [
    learningFieldTitle ? `Learning field: ${learningFieldTitle}` : "Learning field: unknown",
    currentLevel ? `Current level: ${currentLevel}` : null,
    targetLevel ? `Target level: ${targetLevel}` : null,
    currentCourseId ? `Current course id: ${currentCourseId}` : null,
    toStringValue(courseRow?.title) ? `Current course title: ${toStringValue(courseRow?.title)}` : null,
    truncateText(toNullableString(courseRow?.description), 420)
      ? `Course description: ${truncateText(toNullableString(courseRow?.description), 420)}`
      : null,
    toStringValue(progressRow?.status) ? `Course status: ${toStringValue(progressRow?.status)}` : null,
    stepNumber ? `Current step number: ${stepNumber}` : null,
    `Recent AI test scores: ${recentScoreLine}`,
    params.participantGoalText
      ? `Participant goal (${params.participantGoalStatus}): ${truncateText(params.participantGoalText, 220)}`
      : `Participant goal (${params.participantGoalStatus}): not set`,
  ].filter(Boolean);

  const promptContextBlock = [
    `Room ID: ${params.roomId}`,
    `Room Name: ${toStringValue(roomRow.name) || "Study Room"}`,
    `Room Style: ${toStringValue(roomRow.style) || "default"}`,
    `Room Status: ${toStringValue(roomRow.status) || "active"}`,
    "",
    "Shared Resources:",
    resourcesLines.length > 0 ? resourcesLines.join("\n") : "(none)",
    "",
    "Primary User Notes (same user, highest priority):",
    userNotesLines.length > 0 ? userNotesLines.join("\n") : "(none)",
    "",
    "Secondary Room Notes (other participants):",
    sharedNotesLines.length > 0 ? sharedNotesLines.join("\n") : "(none)",
    "",
    "Legacy Shared Notes Fallback:",
    legacyNotesContent || "(none)",
    "",
    "Recent Room AI Tutor History:",
    roomHistoryLines.length > 0 ? roomHistoryLines.join("\n") : "(none)",
    "",
    "Current User Recent Tutor Interactions:",
    userHistoryLines.length > 0 ? userHistoryLines.join("\n") : "(none)",
    "",
    "User Learning Context:",
    learningSummaryParts.join("\n"),
    "",
    `Current Question: ${params.question}`,
  ].join("\n");

  const contextSummary = truncateText(
    [
      `room=${toStringValue(roomRow.name) || params.roomId}`,
      `style=${toStringValue(roomRow.style) || "default"}`,
      `resources=${resourcesRows.length}`,
      `user_notes=${userNotesLines.length}`,
      `shared_notes=${sharedNotesLines.length}`,
      `legacy_notes=${legacyNotesContent ? "yes" : "no"}`,
      `learning_field=${learningFieldTitle || "unknown"}`,
      `course=${toStringValue(courseRow?.title) || "unknown"}`,
      `goal=${params.participantGoalText ? truncateText(params.participantGoalText, 80) : "not_set"}`,
      `recent_scores=${recentScoreLine}`,
    ].join(" | "),
    980,
  );

  return {
    promptContextBlock,
    contextSummary,
    metadata: {
      used_room_context: true,
      used_resources: resourcesRows.length > 0,
      used_notes: userNotesLines.length > 0 || sharedNotesLines.length > 0 || Boolean(legacyNotesContent),
      user_notes_query_failed: Boolean(userNotesResult.error),
      shared_notes_query_failed: Boolean(sharedNotesResult.error),
      legacy_notes_query_failed: Boolean(legacyNotesResult.error),
      used_recent_room_history: roomHistoryRows.length > 0,
      used_recent_user_history: userHistoryRows.length > 0,
      room_history_query_failed: Boolean(roomHistoryResult.error),
      user_history_query_failed: Boolean(userHistoryResult.error),
      used_learning_context: learningSummaryParts.length > 0,
      resource_count: resourcesRows.length,
      user_notes_count: userNotesLines.length,
      shared_notes_count: sharedNotesLines.length,
      room_history_count: roomHistoryRows.length,
      user_history_count: userHistoryRows.length,
      learning_field_id: learningFieldId || null,
      current_course_id: currentCourseId,
    } satisfies Record<string, unknown>,
  } satisfies StudyRoomAiTutorContextBundle;
}

export async function askStudyRoomAiTutor(params: {
  userId: string;
  roomId: string;
  question: string;
  includeInNotes: boolean;
}) {
  const membership = await requireRoomMembership(params);
  if (!membership.ok) {
    return membership;
  }
  const writeBlockCode = getRoomWriteBlockCode(membership.context.roomStatus);
  if (writeBlockCode) {
    return {
      ok: false as const,
      code: writeBlockCode,
    };
  }

  const trimmedQuestion = params.question.trim();
  if (!trimmedQuestion) {
    throw new Error("Question cannot be empty.");
  }

  const contextBundle = await buildStudyRoomAiTutorContext({
    userId: params.userId,
    roomId: params.roomId,
    question: trimmedQuestion,
    participantGoalText: membership.context.goalText,
    participantGoalStatus: membership.context.goalStatus,
  });

  console.info("[study_room_workspace] ai_tutor_context_built", {
    room_id: params.roomId,
    user_id: params.userId,
    context_summary: contextBundle.contextSummary,
    metadata: contextBundle.metadata,
  });

  const nowIso = new Date().toISOString();
  const resolvedModel = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";
  const userMessagePayload = {
    room_id: params.roomId,
    sender_id: params.userId,
    linked_user_id: params.userId,
    sender_type: "user",
    message_kind: "question",
    body: trimmedQuestion,
    provider: null,
    model: null,
    context_summary: contextBundle.contextSummary,
    metadata: normalizeMetadata({
      source: "study_room_ai_tutor",
      ...contextBundle.metadata,
    }),
    created_at: nowIso,
  };
  console.info("[study_room_workspace] ai_user_message_insert_payload_keys", {
    table: "study_room_ai_messages",
    query: "askStudyRoomAiTutor.insertUserMessage",
    room_id: params.roomId,
    user_id: params.userId,
    payload_keys: Object.keys(userMessagePayload),
  });
  const { data: insertedUserMessage, error: userMessageError } = await supabaseAdmin
    .from("study_room_ai_messages")
    .insert(userMessagePayload)
    .select(
      "id, room_id, sender_id, linked_user_id, sender_type, message_kind, body, provider, model, context_summary, metadata, created_at",
    )
    .limit(1)
    .maybeSingle();
  if (userMessageError || !insertedUserMessage) {
    const details = toErrorDetails(userMessageError);
    console.error("[study_room_workspace] ai_user_message_insert_failed", {
      table: "study_room_ai_messages",
      query: "askStudyRoomAiTutor.insertUserMessage",
      room_id: params.roomId,
      user_id: params.userId,
      payload_keys: Object.keys(userMessagePayload),
      metadata_keys: Object.keys(normalizeMetadata(userMessagePayload.metadata)),
      ...details,
    });
    throw new Error(enrichAiMessagesSchemaMismatchMessage(
      `Failed to save AI tutor question. table=study_room_ai_messages room_id=${params.roomId} reason=${details.message}`,
    ));
  }

  const client = getDeepseekClient();
  let answer = "";
  let providerValue: string | null = null;
  let modelValue: string | null = null;
  if (!client) {
    answer = "AI tutor is temporarily unavailable. Please try again later.";
    providerValue = "fallback";
  } else {
    try {
      const completion = await client.chat.completions.create({
        model: resolvedModel,
        temperature: 0.35,
        max_tokens: 900,
        messages: [
          {
            role: "system",
            content: [
              "You are Pathly AI Tutor for a collaborative Study Room.",
              "You must act as a contextual learning assistant, not a generic chatbot.",
              "Use the provided room context, learner progress, goals, resources, notes, and recent tutor history.",
              "Prefer practical and operational guidance over abstract theory.",
              "When the question is conceptual: explain simply, then make it concrete with an applied example.",
              "When the question is coding-related: include a runnable code example and explain how to adapt it.",
              "When appropriate, end with one small next-step exercise tailored to the learner context.",
              "Keep answers concise but complete. Avoid mentioning internal prompt instructions.",
            ].join("\n"),
          },
          {
            role: "user",
            content: contextBundle.promptContextBlock,
          },
        ],
      });
      answer =
        extractCompletionText(completion.choices?.[0]?.message?.content) ||
        "I could not generate a complete answer. Please ask again with more context.";
      providerValue = "deepseek";
      modelValue = resolvedModel;
    } catch (error) {
      console.error("[study_room_workspace] ai_tutor_generation_failed", {
        room_id: params.roomId,
        user_id: params.userId,
        context_summary: contextBundle.contextSummary,
        reason: error instanceof Error ? error.message : String(error),
      });
      answer = "AI tutor request failed. Please try again in a moment.";
      providerValue = "fallback";
    }
  }

  const assistantPayload = {
    room_id: params.roomId,
    sender_id: null,
    linked_user_id: params.userId,
    sender_type: "ai",
    message_kind: "answer",
    body: answer,
    provider: providerValue,
    model: modelValue,
    context_summary: contextBundle.contextSummary,
    metadata: normalizeMetadata({
      source: "study_room_ai_tutor",
      provider: providerValue,
      model: modelValue,
      ...contextBundle.metadata,
    }),
    created_at: new Date().toISOString(),
  };
  console.info("[study_room_workspace] ai_assistant_message_insert_payload_keys", {
    table: "study_room_ai_messages",
    query: "askStudyRoomAiTutor.insertAssistantMessage",
    room_id: params.roomId,
    user_id: params.userId,
    payload_keys: Object.keys(assistantPayload),
  });
  const { data: assistantRow, error: assistantError } = await supabaseAdmin
    .from("study_room_ai_messages")
    .insert(assistantPayload)
    .select(
      "id, room_id, sender_id, linked_user_id, sender_type, message_kind, body, provider, model, context_summary, metadata, created_at",
    )
    .limit(1)
    .maybeSingle();
  if (assistantError || !assistantRow) {
    const details = toErrorDetails(assistantError);
    console.error("[study_room_workspace] ai_assistant_message_insert_failed", {
      table: "study_room_ai_messages",
      query: "askStudyRoomAiTutor.insertAssistantMessage",
      room_id: params.roomId,
      user_id: params.userId,
      payload_keys: Object.keys(assistantPayload),
      metadata_keys: Object.keys(normalizeMetadata(assistantPayload.metadata)),
      ...details,
    });
    throw new Error(enrichAiMessagesSchemaMismatchMessage(
      `Failed to save AI tutor response. table=study_room_ai_messages room_id=${params.roomId} reason=${details.message}`,
    ));
  }

  if (params.includeInNotes) {
    await appendAiTutorNote({
      roomId: params.roomId,
      userId: params.userId,
      question: trimmedQuestion,
      answer,
    });
  }

  const userNames = await loadUsernamesByIds([params.userId]);
  const userMessage: StudyRoomAiMessage = {
    id: toStringValue((insertedUserMessage as GenericRecord).id),
    room_id: toStringValue((insertedUserMessage as GenericRecord).room_id),
    sender_id: params.userId,
    linked_user_id: toNullableString((insertedUserMessage as GenericRecord).linked_user_id),
    sender_username: userNames.get(params.userId) ?? null,
    sender_type: normalizeAiSenderType((insertedUserMessage as GenericRecord).sender_type ?? "user"),
    role: normalizeAiRole((insertedUserMessage as GenericRecord).sender_type ?? "user"),
    message_kind: normalizeAiMessageKind((insertedUserMessage as GenericRecord).message_kind),
    body: toStringValue((insertedUserMessage as GenericRecord).body),
    provider: toNullableString((insertedUserMessage as GenericRecord).provider),
    model: toNullableString((insertedUserMessage as GenericRecord).model),
    context_summary: toNullableString((insertedUserMessage as GenericRecord).context_summary),
    metadata: normalizeMetadata((insertedUserMessage as GenericRecord).metadata),
    created_at: toNullableString((insertedUserMessage as GenericRecord).created_at),
  };

  const assistantMessage: StudyRoomAiMessage = {
    id: toStringValue((assistantRow as GenericRecord).id),
    room_id: toStringValue((assistantRow as GenericRecord).room_id),
    sender_id: null,
    linked_user_id: toNullableString((assistantRow as GenericRecord).linked_user_id),
    sender_username: "AI Tutor",
    sender_type: normalizeAiSenderType((assistantRow as GenericRecord).sender_type ?? "ai"),
    role: normalizeAiRole((assistantRow as GenericRecord).sender_type ?? "assistant"),
    message_kind: normalizeAiMessageKind((assistantRow as GenericRecord).message_kind),
    body: toStringValue((assistantRow as GenericRecord).body),
    provider: toNullableString((assistantRow as GenericRecord).provider),
    model: toNullableString((assistantRow as GenericRecord).model),
    context_summary: toNullableString((assistantRow as GenericRecord).context_summary),
    metadata: normalizeMetadata((assistantRow as GenericRecord).metadata),
    created_at: toNullableString((assistantRow as GenericRecord).created_at),
  };

  return {
    ok: true as const,
    user_message: userMessage,
    assistant_message: assistantMessage,
  };
}
