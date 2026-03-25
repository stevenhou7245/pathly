"use client";

import { mapStudyRoomRealtimeMessage } from "@/lib/chatRealtime";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type StudyRoomListItem = {
  id: string;
  room_id: string;
  name: string;
  style: string;
  status: string;
  max_participants: number;
  duration_minutes: number;
  created_at: string | null;
  expires_at: string | null;
  ended_at: string | null;
  role: string;
  joined_at: string | null;
  creator_id: string;
  password: string;
};

type StudyRoomDetail = {
  id: string;
  creator_id: string;
  name: string;
  style: string;
  max_participants: number;
  duration_minutes: number;
  status: string;
  created_at: string | null;
  expires_at: string | null;
  ended_at: string | null;
  password: string;
  can_close: boolean;
  can_extend: boolean;
  can_leave: boolean;
  viewer_user_id: string;
};

type StudyRoomParticipant = {
  id: string;
  room_id: string;
  user_id: string;
  joined_at: string | null;
  left_at: string | null;
  role: string;
  username: string;
  presence_state: "online" | "idle" | "focus" | "offline";
  focus_mode: boolean;
  focus_started_at: string | null;
  last_active_at: string | null;
  current_streak_seconds: number;
  total_focus_seconds: number;
  session_seconds: number;
  goal_text: string | null;
  goal_status: "not_started" | "in_progress" | "completed";
};

type StudyRoomMessage = {
  id: string;
  room_id: string;
  sender_id: string;
  sender_username?: string | null;
  body: string;
  created_at: string | null;
  type: string;
};

type StudyRoomNotesRecord = {
  id: string | null;
  room_id: string;
  content: string | null;
  updated_by: string | null;
  updated_by_username: string | null;
  updated_at: string | null;
  created_at: string | null;
};

type StudyRoomNoteEntry = {
  id: string;
  room_id: string;
  author_user_id: string;
  author_username: string | null;
  content_md: string | null;
  created_at: string | null;
  updated_at: string | null;
  is_deleted: boolean;
};

type StudyRoomSharedResource = {
  id: string;
  room_id: string;
  source_kind: "url" | "file";
  resource_type: "video" | "article" | "website" | "document" | "notes" | "other";
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

type StudyRoomAiTutorMessage = {
  id: string;
  room_id: string;
  sender_id: string | null;
  sender_username: string | null;
  sender_type: "user" | "ai" | "assistant" | "system";
  role: "user" | "assistant" | "system";
  message_kind?: "chat" | "question" | "answer" | "summary";
  provider?: string | null;
  model?: string | null;
  context_summary?: string | null;
  body: string;
  metadata: Record<string, unknown>;
  created_at: string | null;
};

type FriendListItem = {
  friendship_id: string;
  user_id: string;
  username: string;
  avatar_url: string | null;
  current_learning_field_title: string | null;
  is_online: boolean;
  last_seen_at: string | null;
  friendship_status: string;
};

type StudyRoomsPanelProps = {
  rooms: StudyRoomListItem[];
  activeRoomId: string;
  onSelectRoom: (roomId: string) => void;
  onRoomsUpdated: () => Promise<void> | void;
};

type StudyRoomDetailResponse = {
  success: boolean;
  message?: string;
  room?: StudyRoomDetail;
  participants?: StudyRoomParticipant[];
};

type StudyRoomMessagesResponse = {
  success: boolean;
  message?: string;
  messages?: StudyRoomMessage[];
  sent_message?: StudyRoomMessage;
};

type StudyRoomCreateResponse = {
  success: boolean;
  message?: string;
  room_id?: string;
};

type StudyRoomJoinResponse = {
  success: boolean;
  message?: string;
  room?: {
    id: string;
  };
};

type StudyRoomActionResponse = {
  success: boolean;
  message?: string;
  room?: {
    id: string;
    status: string;
    duration_minutes: number;
    expires_at: string | null;
  };
  invited_count?: number;
  room_id?: string;
};

type StudyRoomPresenceResponse = {
  success: boolean;
  message?: string;
  participants?: StudyRoomParticipant[];
  participant?: StudyRoomParticipant;
};

type StudyRoomGoalsResponse = {
  success: boolean;
  message?: string;
  participants?: StudyRoomParticipant[];
  participant?: StudyRoomParticipant;
};

type StudyRoomNotesResponse = {
  success: boolean;
  message?: string;
  note?: StudyRoomNotesRecord;
  entries?: StudyRoomNoteEntry[];
  my_entry?: StudyRoomNoteEntry | null;
  saved_entry?: StudyRoomNoteEntry;
};

type StudyRoomResourcesResponse = {
  success: boolean;
  message?: string;
  resources?: StudyRoomSharedResource[];
  resource?: StudyRoomSharedResource;
};

type StudyRoomAiTutorResponse = {
  success: boolean;
  message?: string;
  messages?: StudyRoomAiTutorMessage[];
  user_message?: StudyRoomAiTutorMessage;
  assistant_message?: StudyRoomAiTutorMessage;
};

type StudyRoomSavableNoteItem = {
  item_id: string;
  source_kind: "study_room_note";
  source_id: string;
  author_user_id: string;
  author_username: string | null;
  content_md: string;
  timestamp: string | null;
};

type StudyRoomSavableResourceItem = {
  item_id: string;
  source_kind: "study_room_resource";
  source_id: string;
  title: string;
  resource_type: "video" | "article" | "website" | "document" | "notes" | "other";
  source_kind_value: "url" | "file";
  url: string | null;
  file_name: string | null;
  added_by: string;
  added_by_username: string | null;
  timestamp: string | null;
};

type StudyRoomSavableAiExchangeItem = {
  item_id: string;
  source_kind: "study_room_ai_exchange";
  question_message_id: string | null;
  answer_message_id: string | null;
  question_author_id: string | null;
  question_author_username: string | null;
  question_text: string | null;
  answer_text: string | null;
  timestamp: string | null;
};

type StudyRoomLeaveSavableContent = {
  room_id: string;
  shared_notes: StudyRoomSavableNoteItem[];
  shared_resources: StudyRoomSavableResourceItem[];
  ai_exchanges: StudyRoomSavableAiExchangeItem[];
};

type StudyRoomLeaveSaveResponse = {
  success: boolean;
  message?: string;
  content?: StudyRoomLeaveSavableContent;
  notebooks?: Array<{
    id: string;
    name: string;
  }>;
  notebook?: {
    id: string;
    name: string;
  };
  entry?: {
    id: string;
    topic: string;
  };
  selected_summary?: {
    notes_count: number;
    resources_count: number;
    ai_exchanges_count: number;
  };
};

type FriendsApiResponse = {
  success: boolean;
  message?: string;
  current_user_id?: string;
  friends?: FriendListItem[];
};

function appendStudyRoomMessageUnique(
  previous: StudyRoomMessage[],
  incoming: StudyRoomMessage,
) {
  if (previous.some((message) => message.id === incoming.id)) {
    return previous;
  }
  return [...previous, incoming].sort((a, b) =>
    (a.created_at ?? "").localeCompare(b.created_at ?? ""),
  );
}

function upsertStudyRoomMessageByCreatedAt(
  previous: StudyRoomMessage[],
  incoming: StudyRoomMessage,
) {
  const withoutSameId = previous.filter((message) => message.id !== incoming.id);
  return [...withoutSameId, incoming].sort((a, b) =>
    (a.created_at ?? "").localeCompare(b.created_at ?? ""),
  );
}

function formatTimestamp(value: string | null) {
  if (!value) {
    return "Recently";
  }
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) {
    return "Recently";
  }
  return timestamp.toLocaleString();
}

function truncateText(value: string | null | undefined, maxLength = 180) {
  const text = (value ?? "").trim();
  if (!text) {
    return "";
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

function formatShortDurationFromSeconds(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  return `${minutes}m ${seconds}s`;
}

function toSafeString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toSafeNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function toSafeBoolean(value: unknown) {
  return value === true;
}

function toSafeNonNegativeInt(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.floor(parsed));
    }
  }
  return 0;
}

function toSafeNullableNonNegativeInt(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.floor(parsed));
    }
  }
  return null;
}

function normalizePresenceState(value: unknown): StudyRoomParticipant["presence_state"] {
  const normalized = toSafeString(value).trim().toLowerCase();
  if (normalized === "idle" || normalized === "focus" || normalized === "offline") {
    return normalized;
  }
  return "online";
}

function normalizeGoalStatus(value: unknown): StudyRoomParticipant["goal_status"] {
  const normalized = toSafeString(value).trim().toLowerCase();
  if (normalized === "in_progress" || normalized === "completed") {
    return normalized;
  }
  return "not_started";
}

function compareParticipantsByJoinedAt(a: StudyRoomParticipant, b: StudyRoomParticipant) {
  const joinedA = a.joined_at ?? "";
  const joinedB = b.joined_at ?? "";
  if (joinedA !== joinedB) {
    return joinedA.localeCompare(joinedB);
  }
  if (a.user_id !== b.user_id) {
    return a.user_id.localeCompare(b.user_id);
  }
  return a.id.localeCompare(b.id);
}

function normalizeParticipantsByJoinedAt(rows: StudyRoomParticipant[]) {
  const map = new Map<string, StudyRoomParticipant>();
  rows.forEach((row) => {
    if (!row.id) {
      return;
    }
    map.set(row.id, row);
  });
  return Array.from(map.values()).sort(compareParticipantsByJoinedAt);
}

function mergeParticipantRealtimeRow(params: {
  previous: StudyRoomParticipant[];
  row: Record<string, unknown>;
}) {
  const nextRowId = toSafeString(params.row.id);
  if (!nextRowId) {
    return params.previous;
  }
  const existingById = params.previous.find((item) => item.id === nextRowId) ?? null;
  const existingByUserId =
    !existingById && toSafeString(params.row.user_id)
      ? params.previous.find((item) => item.user_id === toSafeString(params.row.user_id)) ?? null
      : null;
  const existing = existingById ?? existingByUserId;

  const merged: StudyRoomParticipant = {
    id: nextRowId,
    room_id: toSafeString(params.row.room_id) || existing?.room_id || "",
    user_id: toSafeString(params.row.user_id) || existing?.user_id || "",
    joined_at: toSafeNullableString(params.row.joined_at) ?? existing?.joined_at ?? null,
    left_at: toSafeNullableString(params.row.left_at) ?? existing?.left_at ?? null,
    role: toSafeString(params.row.role) || existing?.role || "participant",
    username: toSafeString(params.row.username) || existing?.username || "Unknown",
    presence_state:
      params.row.presence_state !== undefined
        ? normalizePresenceState(params.row.presence_state)
        : existing?.presence_state ?? "online",
    focus_mode:
      params.row.focus_mode !== undefined
        ? toSafeBoolean(params.row.focus_mode)
        : existing?.focus_mode ?? false,
    focus_started_at:
      toSafeNullableString(params.row.focus_started_at) ?? existing?.focus_started_at ?? null,
    last_active_at:
      toSafeNullableString(params.row.last_active_at) ?? existing?.last_active_at ?? null,
    current_streak_seconds:
      params.row.current_streak_seconds !== undefined
        ? toSafeNonNegativeInt(params.row.current_streak_seconds)
        : existing?.current_streak_seconds ?? 0,
    total_focus_seconds:
      params.row.total_focus_seconds !== undefined
        ? toSafeNonNegativeInt(params.row.total_focus_seconds)
        : existing?.total_focus_seconds ?? 0,
    session_seconds:
      params.row.session_seconds !== undefined
        ? toSafeNonNegativeInt(params.row.session_seconds)
        : existing?.session_seconds ?? 0,
    goal_text: toSafeNullableString(params.row.goal_text) ?? existing?.goal_text ?? null,
    goal_status:
      params.row.goal_status !== undefined
        ? normalizeGoalStatus(params.row.goal_status)
        : existing?.goal_status ?? "not_started",
  };

  const withoutSameId = params.previous.filter((item) => item.id !== nextRowId);
  return normalizeParticipantsByJoinedAt([...withoutSameId, merged]);
}

function compareByCreatedAtAsc<T extends { created_at: string | null; id: string }>(a: T, b: T) {
  const createdA = a.created_at ?? "";
  const createdB = b.created_at ?? "";
  if (createdA !== createdB) {
    return createdA.localeCompare(createdB);
  }
  return a.id.localeCompare(b.id);
}

function normalizeNoteEntriesByCreatedAt(rows: StudyRoomNoteEntry[]) {
  const map = new Map<string, StudyRoomNoteEntry>();
  rows.forEach((row) => {
    if (!row.id) {
      return;
    }
    map.set(row.id, row);
  });
  return Array.from(map.values()).sort(compareByCreatedAtAsc);
}

function normalizeResourcesByCreatedAt(rows: StudyRoomSharedResource[]) {
  const map = new Map<string, StudyRoomSharedResource>();
  rows.forEach((row) => {
    if (!row.id) {
      return;
    }
    map.set(row.id, row);
  });
  return Array.from(map.values()).sort(compareByCreatedAtAsc);
}

function normalizeAiMessagesByCreatedAt(rows: StudyRoomAiTutorMessage[]) {
  const map = new Map<string, StudyRoomAiTutorMessage>();
  rows.forEach((row) => {
    if (!row.id) {
      return;
    }
    map.set(row.id, row);
  });
  return Array.from(map.values()).sort(compareByCreatedAtAsc);
}

function normalizeAiMessageSenderType(
  value: unknown,
): StudyRoomAiTutorMessage["sender_type"] {
  const normalized = toSafeString(value).trim().toLowerCase();
  if (normalized === "ai") {
    return "ai";
  }
  if (normalized === "assistant") {
    return "assistant";
  }
  if (normalized === "system") {
    return "system";
  }
  return "user";
}

function normalizeAiMessageRole(value: unknown): StudyRoomAiTutorMessage["role"] {
  const normalized = toSafeString(value).trim().toLowerCase();
  if (normalized === "assistant" || normalized === "ai") {
    return "assistant";
  }
  if (normalized === "system") {
    return "system";
  }
  return "user";
}

function normalizeAiMessageKind(value: unknown): StudyRoomAiTutorMessage["message_kind"] {
  const normalized = toSafeString(value).trim().toLowerCase();
  if (normalized === "question" || normalized === "answer" || normalized === "summary") {
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

function normalizeStudyRoomSourceKind(value: unknown): StudyRoomSharedResource["source_kind"] {
  return toSafeString(value).trim().toLowerCase() === "file" ? "file" : "url";
}

function normalizeStudyRoomResourceType(value: unknown): StudyRoomSharedResource["resource_type"] {
  const normalized = toSafeString(value).trim().toLowerCase();
  if (
    normalized === "video" ||
    normalized === "article" ||
    normalized === "website" ||
    normalized === "document" ||
    normalized === "notes"
  ) {
    return normalized;
  }
  return "other";
}

function mergeNoteEntryRealtimeRow(params: {
  previous: StudyRoomNoteEntry[];
  row: Record<string, unknown>;
  roomId: string;
  participants: StudyRoomParticipant[];
}) {
  const rowId = toSafeString(params.row.id);
  if (!rowId) {
    return params.previous;
  }
  const existing = params.previous.find((entry) => entry.id === rowId) ?? null;
  const authorUserId = toSafeString(params.row.author_user_id) || existing?.author_user_id || "";
  const authorUsernameFromParticipant =
    params.participants.find((participant) => participant.user_id === authorUserId)?.username ?? null;
  const merged: StudyRoomNoteEntry = {
    id: rowId,
    room_id: toSafeString(params.row.room_id) || existing?.room_id || params.roomId,
    author_user_id: authorUserId,
    author_username:
      toSafeNullableString(params.row.author_username) ??
      existing?.author_username ??
      authorUsernameFromParticipant,
    content_md:
      params.row.content_md !== undefined
        ? toSafeNullableString(params.row.content_md)
        : existing?.content_md ?? null,
    created_at: toSafeNullableString(params.row.created_at) ?? existing?.created_at ?? null,
    updated_at: toSafeNullableString(params.row.updated_at) ?? existing?.updated_at ?? null,
    is_deleted:
      params.row.is_deleted !== undefined
        ? toSafeBoolean(params.row.is_deleted)
        : existing?.is_deleted ?? false,
  };
  if (merged.is_deleted) {
    return normalizeNoteEntriesByCreatedAt(params.previous.filter((entry) => entry.id !== rowId));
  }
  const withoutSameId = params.previous.filter((entry) => entry.id !== rowId);
  return normalizeNoteEntriesByCreatedAt([...withoutSameId, merged]);
}

function mergeResourceRealtimeRow(params: {
  previous: StudyRoomSharedResource[];
  row: Record<string, unknown>;
  roomId: string;
  participants: StudyRoomParticipant[];
}) {
  const rowId = toSafeString(params.row.id);
  if (!rowId) {
    return params.previous;
  }
  const existing = params.previous.find((resource) => resource.id === rowId) ?? null;
  const addedBy = toSafeString(params.row.added_by) || existing?.added_by || "";
  const addedByUsernameFromParticipant =
    params.participants.find((participant) => participant.user_id === addedBy)?.username ?? null;
  const merged: StudyRoomSharedResource = {
    id: rowId,
    room_id: toSafeString(params.row.room_id) || existing?.room_id || params.roomId,
    source_kind:
      params.row.source_kind !== undefined
        ? normalizeStudyRoomSourceKind(params.row.source_kind)
        : existing?.source_kind ?? "url",
    resource_type:
      params.row.resource_type !== undefined
        ? normalizeStudyRoomResourceType(params.row.resource_type)
        : existing?.resource_type ?? "other",
    title: toSafeString(params.row.title) || existing?.title || "Shared resource",
    url:
      params.row.url !== undefined
        ? toSafeNullableString(params.row.url)
        : existing?.url ?? null,
    file_name:
      params.row.file_name !== undefined
        ? toSafeNullableString(params.row.file_name)
        : existing?.file_name ?? null,
    file_path:
      params.row.file_path !== undefined
        ? toSafeNullableString(params.row.file_path)
        : existing?.file_path ?? null,
    file_size_bytes:
      params.row.file_size_bytes !== undefined
        ? toSafeNullableNonNegativeInt(params.row.file_size_bytes)
        : existing?.file_size_bytes ?? null,
    mime_type:
      params.row.mime_type !== undefined
        ? toSafeNullableString(params.row.mime_type)
        : existing?.mime_type ?? null,
    added_by: addedBy,
    added_by_username:
      toSafeNullableString(params.row.added_by_username) ??
      existing?.added_by_username ??
      addedByUsernameFromParticipant,
    created_at: toSafeNullableString(params.row.created_at) ?? existing?.created_at ?? null,
  };
  const withoutSameId = params.previous.filter((resource) => resource.id !== rowId);
  return normalizeResourcesByCreatedAt([...withoutSameId, merged]);
}

function mergeAiMessageRealtimeRow(params: {
  previous: StudyRoomAiTutorMessage[];
  row: Record<string, unknown>;
  roomId: string;
  participants: StudyRoomParticipant[];
}) {
  const rowId = toSafeString(params.row.id);
  if (!rowId) {
    return params.previous;
  }
  const existing = params.previous.find((message) => message.id === rowId) ?? null;
  const senderType =
    params.row.sender_type !== undefined
      ? normalizeAiMessageSenderType(params.row.sender_type)
      : existing?.sender_type ?? "user";
  const senderId =
    params.row.sender_id !== undefined
      ? toSafeNullableString(params.row.sender_id)
      : existing?.sender_id ?? null;
  const senderNameFromParticipant = senderId
    ? params.participants.find((participant) => participant.user_id === senderId)?.username ?? null
    : null;
  const merged: StudyRoomAiTutorMessage = {
    id: rowId,
    room_id: toSafeString(params.row.room_id) || existing?.room_id || params.roomId,
    sender_id: senderId,
    sender_username:
      toSafeNullableString(params.row.sender_username) ??
      existing?.sender_username ??
      (senderType === "user" ? senderNameFromParticipant : "AI Tutor"),
    sender_type: senderType,
    role:
      params.row.sender_type !== undefined
        ? normalizeAiMessageRole(params.row.sender_type)
        : existing?.role ?? normalizeAiMessageRole(senderType),
    message_kind:
      params.row.message_kind !== undefined
        ? normalizeAiMessageKind(params.row.message_kind)
        : existing?.message_kind ?? "chat",
    provider:
      params.row.provider !== undefined
        ? toSafeNullableString(params.row.provider)
        : existing?.provider ?? null,
    model:
      params.row.model !== undefined
        ? toSafeNullableString(params.row.model)
        : existing?.model ?? null,
    context_summary:
      params.row.context_summary !== undefined
        ? toSafeNullableString(params.row.context_summary)
        : existing?.context_summary ?? null,
    body: toSafeString(params.row.body) || existing?.body || "",
    metadata:
      params.row.metadata !== undefined
        ? normalizeMetadata(params.row.metadata)
        : existing?.metadata ?? {},
    created_at: toSafeNullableString(params.row.created_at) ?? existing?.created_at ?? null,
  };
  const withoutSameId = params.previous.filter((message) => message.id !== rowId);
  return normalizeAiMessagesByCreatedAt([...withoutSameId, merged]);
}

function formatBytes(value: number | null) {
  if (!Number.isFinite(value ?? NaN) || (value ?? 0) <= 0) {
    return "Unknown size";
  }
  const bytes = Number(value);
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} KB`;
  }
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
}

function styleBadgeClass(style: string) {
  const normalized = style.trim().toLowerCase();
  if (normalized === "sprint") {
    return "bg-[#FFD84D] text-[#1F2937]";
  }
  if (normalized === "calm") {
    return "bg-[#DDF2FF] text-[#1F2937]";
  }
  if (normalized === "intense") {
    return "bg-[#FFD5D5] text-[#1F2937]";
  }
  return "bg-[#E9FFD8] text-[#1F2937]";
}

function presenceBadgeClass(state: StudyRoomParticipant["presence_state"]) {
  if (state === "focus") {
    return "bg-[#58CC02]/20 text-[#1F2937]";
  }
  if (state === "idle") {
    return "bg-[#FFD84D]/30 text-[#1F2937]";
  }
  if (state === "offline") {
    return "bg-[#E5E7EB] text-[#4B5563]";
  }
  return "bg-[#DDF2FF] text-[#1F2937]";
}

export default function StudyRoomsPanel({
  rooms,
  activeRoomId,
  onSelectRoom,
  onRoomsUpdated,
}: StudyRoomsPanelProps) {
  type WorkspaceSizePreset = 25 | 50 | 75 | 100 | "custom";
  const [panelError, setPanelError] = useState("");
  const [panelMessage, setPanelMessage] = useState("");

  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createStyle, setCreateStyle] = useState("focus");
  const [createDuration, setCreateDuration] = useState("60");
  const [createPassword, setCreatePassword] = useState("");

  const [isJoiningRoom, setIsJoiningRoom] = useState(false);
  const [joinRoomId, setJoinRoomId] = useState("");
  const [joinPassword, setJoinPassword] = useState("");

  const [isLoadingRoom, setIsLoadingRoom] = useState(false);
  const [roomDetail, setRoomDetail] = useState<StudyRoomDetail | null>(null);
  const [participants, setParticipants] = useState<StudyRoomParticipant[]>([]);
  const [messages, setMessages] = useState<StudyRoomMessage[]>([]);

  const [messageDraft, setMessageDraft] = useState("");
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [isLeavingRoom, setIsLeavingRoom] = useState(false);
  const [isClosingRoom, setIsClosingRoom] = useState(false);
  const [isExtendingRoom, setIsExtendingRoom] = useState(false);
  const [isWorkspaceOpen, setIsWorkspaceOpen] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<"chat" | "notes" | "resources" | "ai">("chat");
  const [workspaceSizePreset, setWorkspaceSizePreset] = useState<WorkspaceSizePreset>(75);
  const [workspaceRect, setWorkspaceRect] = useState(() => ({
    x: 80,
    y: 56,
    width: 1180,
    height: 720,
  }));
  const [isDraggingWorkspace, setIsDraggingWorkspace] = useState(false);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const [isResizingWorkspace, setIsResizingWorkspace] = useState(false);
  const [resizeOrigin, setResizeOrigin] = useState({ x: 0, y: 0, width: 1180, height: 720 });
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1280,
  );
  const [viewportHeight, setViewportHeight] = useState(() =>
    typeof window !== "undefined" ? window.innerHeight : 860,
  );
  const [notesRecord, setNotesRecord] = useState<StudyRoomNotesRecord | null>(null);
  const [noteEntries, setNoteEntries] = useState<StudyRoomNoteEntry[]>([]);
  const [myNoteEntryId, setMyNoteEntryId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [resources, setResources] = useState<StudyRoomSharedResource[]>([]);
  const [resourceComposerMode, setResourceComposerMode] = useState<"url" | "file">("url");
  const [newResourceType, setNewResourceType] = useState<
    "video" | "article" | "website" | "document" | "notes" | "other"
  >("website");
  const [newResourceTitle, setNewResourceTitle] = useState("");
  const [newResourceUrl, setNewResourceUrl] = useState<string>("");
  const [newResourceFile, setNewResourceFile] = useState<File | null>(null);
  const [isAddingResource, setIsAddingResource] = useState(false);
  const [isUploadingResourceFile, setIsUploadingResourceFile] = useState(false);
  const [aiMessages, setAiMessages] = useState<StudyRoomAiTutorMessage[]>([]);
  const [aiQuestionDraft, setAiQuestionDraft] = useState("");
  const [isAskingAiTutor, setIsAskingAiTutor] = useState(false);
  const [goalDraft, setGoalDraft] = useState("");
  const [goalStatusDraft, setGoalStatusDraft] = useState<"not_started" | "in_progress" | "completed">(
    "not_started",
  );
  const [isSavingGoal, setIsSavingGoal] = useState(false);
  const [focusModeEnabled, setFocusModeEnabled] = useState(false);
  const lastInteractionAtRef = useRef(Date.now());
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteFriends, setInviteFriends] = useState<FriendListItem[]>([]);
  const [selectedInviteFriendIds, setSelectedInviteFriendIds] = useState<string[]>([]);
  const [isLoadingInviteFriends, setIsLoadingInviteFriends] = useState(false);
  const [isSendingInvites, setIsSendingInvites] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<
    "room_id" | "password" | "invite" | ""
  >("");
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [leaveSaveContent, setLeaveSaveContent] = useState<StudyRoomLeaveSavableContent | null>(null);
  const [leaveSaveNotebooks, setLeaveSaveNotebooks] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedLeaveNotebookId, setSelectedLeaveNotebookId] = useState("");
  const [isLoadingLeaveSaveContent, setIsLoadingLeaveSaveContent] = useState(false);
  const [selectedLeaveItemIds, setSelectedLeaveItemIds] = useState<string[]>([]);
  const [leaveNotebookTopic, setLeaveNotebookTopic] = useState("");
  const [isSavingLeaveSelections, setIsSavingLeaveSelections] = useState(false);
  const [showExpireModal, setShowExpireModal] = useState(false);
  const [showExtendInput, setShowExtendInput] = useState(false);
  const [extendDurationInput, setExtendDurationInput] = useState("60");
  const [countdownNowMs, setCountdownNowMs] = useState(() => Date.now());
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const resourceFileInputRef = useRef<HTMLInputElement | null>(null);
  const previousMessageCountRef = useRef(0);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [newMessagesCount, setNewMessagesCount] = useState(0);
  const participantsRef = useRef<StudyRoomParticipant[]>([]);
  const viewerUserIdRef = useRef("");

  const selectedRoom = useMemo(
    () => rooms.find((room) => room.id === activeRoomId) ?? null,
    [activeRoomId, rooms],
  );
  const isMobileWorkspace = viewportWidth < 900;

  const workspacePresetOptions = [25, 50, 75, 100] as const;

  const computeWorkspaceRectForPreset = useCallback(
    (preset: 25 | 50 | 75 | 100) => {
      const desktopPaddingX = preset === 100 ? 12 : 24;
      const desktopPaddingY = preset === 100 ? 12 : 20;
      const maxWidth = Math.max(420, viewportWidth - desktopPaddingX * 2);
      const maxHeight = Math.max(420, viewportHeight - desktopPaddingY * 2);
      const ratioByPreset: Record<25 | 50 | 75 | 100, { w: number; h: number }> = {
        25: { w: 0.4, h: 0.45 },
        50: { w: 0.58, h: 0.62 },
        75: { w: 0.78, h: 0.8 },
        100: { w: 0.96, h: 0.94 },
      };
      const ratio = ratioByPreset[preset];
      const width = Math.max(420, Math.round(maxWidth * ratio.w));
      const height = Math.max(460, Math.round(maxHeight * ratio.h));
      const x = Math.max(desktopPaddingX, Math.round((viewportWidth - width) / 2));
      const y = Math.max(desktopPaddingY, Math.round((viewportHeight - height) / 2));
      return { x, y, width, height };
    },
    [viewportHeight, viewportWidth],
  );

  const applyWorkspacePreset = useCallback(
    (preset: 25 | 50 | 75 | 100) => {
      setWorkspaceSizePreset(preset);
      if (isMobileWorkspace) {
        return;
      }
      setWorkspaceRect(computeWorkspaceRectForPreset(preset));
    },
    [computeWorkspaceRectForPreset, isMobileWorkspace],
  );

  const timingInfo = useMemo(() => {
    if (!roomDetail) {
      return null;
    }
    const createdAt = roomDetail.created_at ? new Date(roomDetail.created_at) : null;
    const expiresAt = roomDetail.expires_at ? new Date(roomDetail.expires_at) : null;
    const createdAtMs = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.getTime() : null;
    const expiresAtMs = expiresAt && !Number.isNaN(expiresAt.getTime()) ? expiresAt.getTime() : null;
    const remainingSeconds =
      expiresAtMs !== null ? Math.max(0, Math.floor((expiresAtMs - countdownNowMs) / 1000)) : 0;

    return {
      createdAtText: formatTimestamp(roomDetail.created_at),
      originalDurationText: `${roomDetail.duration_minutes} minutes`,
      remainingSeconds,
      remainingText: formatShortDurationFromSeconds(remainingSeconds),
      statusText: roomDetail.status.replaceAll("_", " "),
      hasExpired: roomDetail.status === "expired" || remainingSeconds <= 0,
      createdAtMs,
      expiresAtMs,
    };
  }, [countdownNowMs, roomDetail]);

  const canSendMessages = roomDetail?.status === "active";
  const currentParticipant = useMemo(
    () =>
      roomDetail
        ? participants.find((participant) => participant.user_id === roomDetail.viewer_user_id) ?? null
        : null,
    [participants, roomDetail],
  );
  const sortedNoteEntries = useMemo(
    () => normalizeNoteEntriesByCreatedAt(noteEntries),
    [noteEntries],
  );
  const myLatestNoteEntry = useMemo(() => {
    if (myNoteEntryId) {
      const byId = noteEntries.find((entry) => entry.id === myNoteEntryId);
      if (byId) {
        return byId;
      }
    }
    if (!roomDetail) {
      return null;
    }
    return (
      noteEntries.find((entry) => entry.author_user_id === roomDetail.viewer_user_id && !entry.is_deleted) ?? null
    );
  }, [myNoteEntryId, noteEntries, roomDetail]);
  const selectedLeaveItemCount = selectedLeaveItemIds.length;

  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

  useEffect(() => {
    viewerUserIdRef.current = roomDetail?.viewer_user_id ?? "";
  }, [roomDetail?.viewer_user_id]);

  function scrollMessagesToBottom() {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }
    container.scrollTop = container.scrollHeight;
  }

  function checkIsAtBottom() {
    const container = messagesContainerRef.current;
    if (!container) {
      return true;
    }
    return container.scrollHeight - container.scrollTop - container.clientHeight <= 24;
  }

  const loadRoomData = useCallback(
    async (roomId: string) => {
      if (!roomId) {
        setRoomDetail(null);
        setParticipants([]);
        setMessages([]);
        return;
      }

      setIsLoadingRoom(true);
      setPanelError("");
      try {
        const [detailResponse, messagesResponse] = await Promise.all([
          fetch(`/api/study-room/${encodeURIComponent(roomId)}`, {
            method: "GET",
            cache: "no-store",
          }),
          fetch(`/api/study-room/${encodeURIComponent(roomId)}/messages`, {
            method: "GET",
            cache: "no-store",
          }),
        ]);

        const detailPayload = (await detailResponse.json()) as StudyRoomDetailResponse;
        const messagesPayload = (await messagesResponse.json()) as StudyRoomMessagesResponse;

        if (!detailResponse.ok || !detailPayload.success || !detailPayload.room) {
          throw new Error(detailPayload.message ?? "Unable to load room details.");
        }
        if (!messagesResponse.ok || !messagesPayload.success) {
          throw new Error(messagesPayload.message ?? "Unable to load room messages.");
        }

        setRoomDetail(detailPayload.room);
        setParticipants(normalizeParticipantsByJoinedAt(detailPayload.participants ?? []));
        setMessages((messagesPayload.messages ?? []).sort((a, b) =>
          (a.created_at ?? "").localeCompare(b.created_at ?? ""),
        ));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to load room data.";
        setPanelError(message);
        setRoomDetail(null);
        setParticipants([]);
        setMessages([]);
      } finally {
        setIsLoadingRoom(false);
      }
    },
    [],
  );

  const loadWorkspaceExtras = useCallback(
    async (roomId: string) => {
      if (!roomId) {
        setNotesRecord(null);
        setNoteEntries([]);
        setMyNoteEntryId(null);
        setNotesDraft("");
        setResources([]);
        setAiMessages([]);
        return;
      }

      try {
        const [notesResponse, resourcesResponse, aiResponse, goalsResponse] = await Promise.all([
          fetch(`/api/study-room/${encodeURIComponent(roomId)}/notes`, {
            method: "GET",
            cache: "no-store",
          }),
          fetch(`/api/study-room/${encodeURIComponent(roomId)}/resources`, {
            method: "GET",
            cache: "no-store",
          }),
          fetch(`/api/study-room/${encodeURIComponent(roomId)}/ai-tutor`, {
            method: "GET",
            cache: "no-store",
          }),
          fetch(`/api/study-room/${encodeURIComponent(roomId)}/goals`, {
            method: "GET",
            cache: "no-store",
          }),
        ]);

        const notesPayload = (await notesResponse.json()) as StudyRoomNotesResponse;
        const resourcesPayload = (await resourcesResponse.json()) as StudyRoomResourcesResponse;
        const aiPayload = (await aiResponse.json()) as StudyRoomAiTutorResponse;
        const goalsPayload = (await goalsResponse.json()) as StudyRoomGoalsResponse;

        if (notesResponse.ok && notesPayload.success) {
          setNotesRecord(notesPayload.note ?? null);
          const entries = normalizeNoteEntriesByCreatedAt(notesPayload.entries ?? []);
          setNoteEntries(entries);
          const myEntry = notesPayload.my_entry ?? null;
          setMyNoteEntryId(myEntry?.id ?? null);
          setNotesDraft(myEntry?.content_md ?? "");
        } else {
          setNotesRecord(null);
          setNoteEntries([]);
          setMyNoteEntryId(null);
          setNotesDraft("");
        }
        if (resourcesResponse.ok && resourcesPayload.success) {
          setResources(normalizeResourcesByCreatedAt(resourcesPayload.resources ?? []));
        }
        if (aiResponse.ok && aiPayload.success) {
          setAiMessages(normalizeAiMessagesByCreatedAt(aiPayload.messages ?? []));
        }
        if (goalsResponse.ok && goalsPayload.success && goalsPayload.participants) {
          setParticipants(normalizeParticipantsByJoinedAt(goalsPayload.participants));
        }
      } catch (error) {
        console.warn("[study_room_workspace] extras_load_failed", {
          room_id: roomId,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [],
  );

  useEffect(() => {
    if (!activeRoomId && rooms.length > 0) {
      onSelectRoom(rooms[0].id);
    }
  }, [activeRoomId, onSelectRoom, rooms]);

  useEffect(() => {
    if (!activeRoomId) {
      setRoomDetail(null);
      setParticipants([]);
      setMessages([]);
      return;
    }
    void loadRoomData(activeRoomId);
    void loadWorkspaceExtras(activeRoomId);
  }, [activeRoomId, loadRoomData, loadWorkspaceExtras]);

  useEffect(() => {
    if (!activeRoomId) {
      setIsWorkspaceOpen(false);
      return;
    }
    setWorkspaceSizePreset(75);
    setIsWorkspaceOpen(true);
  }, [activeRoomId]);

  useEffect(() => {
    if (!currentParticipant) {
      return;
    }
    setGoalDraft(currentParticipant.goal_text ?? "");
    setGoalStatusDraft(currentParticipant.goal_status);
    setFocusModeEnabled(currentParticipant.focus_mode || currentParticipant.presence_state === "focus");
  }, [currentParticipant]);

  useEffect(() => {
    const handler = () => {
      setViewportWidth(window.innerWidth);
      setViewportHeight(window.innerHeight);
    };
    handler();
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("resize", handler);
    };
  }, []);

  useEffect(() => {
    if (!isWorkspaceOpen || isMobileWorkspace) {
      return;
    }
    if (workspaceSizePreset === "custom") {
      return;
    }
    setWorkspaceRect(computeWorkspaceRectForPreset(workspaceSizePreset));
  }, [
    computeWorkspaceRectForPreset,
    isMobileWorkspace,
    isWorkspaceOpen,
    viewportHeight,
    viewportWidth,
    workspaceSizePreset,
  ]);

  useEffect(() => {
    previousMessageCountRef.current = 0;
    setNewMessagesCount(0);
    setIsAtBottom(true);
    requestAnimationFrame(() => {
      scrollMessagesToBottom();
    });
  }, [activeRoomId]);

  useEffect(() => {
    if (!roomDetail?.id) {
      return;
    }
    const timer = window.setInterval(() => {
      setCountdownNowMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [roomDetail?.id]);

  useEffect(() => {
    if (!copyFeedback) {
      return;
    }
    const timer = window.setTimeout(() => {
      setCopyFeedback("");
    }, 1600);
    return () => {
      window.clearTimeout(timer);
    };
  }, [copyFeedback]);

  useEffect(() => {
    if (!isWorkspaceOpen || !roomDetail) {
      return;
    }
    const markActive = () => {
      lastInteractionAtRef.current = Date.now();
    };
    window.addEventListener("mousemove", markActive);
    window.addEventListener("keydown", markActive);
    window.addEventListener("click", markActive);
    return () => {
      window.removeEventListener("mousemove", markActive);
      window.removeEventListener("keydown", markActive);
      window.removeEventListener("click", markActive);
    };
  }, [isWorkspaceOpen, roomDetail]);

  useEffect(() => {
    if (!roomDetail || !isWorkspaceOpen) {
      return;
    }
    const tick = window.setInterval(() => {
      const inactiveForMs = Date.now() - lastInteractionAtRef.current;
      const presenceState =
        focusModeEnabled ? "focus" : inactiveForMs > 90_000 ? "idle" : "online";
      void fetch(`/api/study-room/${encodeURIComponent(roomDetail.id)}/presence`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          presence_state: presenceState,
          focus_mode: focusModeEnabled,
        }),
      }).catch(() => {
        // best-effort heartbeat
      });
    }, 20_000);
    return () => {
      window.clearInterval(tick);
    };
  }, [focusModeEnabled, isWorkspaceOpen, roomDetail]);

  useEffect(() => {
    if (!isWorkspaceOpen || !roomDetail || isMobileWorkspace) {
      return;
    }

    const onMouseMove = (event: MouseEvent) => {
      if (isDraggingWorkspace) {
        setWorkspaceRect((previous) => ({
          ...previous,
          x: Math.max(8, Math.min(viewportWidth - previous.width - 8, event.clientX - dragOffset.x)),
          y: Math.max(8, Math.min(viewportHeight - previous.height - 8, event.clientY - dragOffset.y)),
        }));
      }
      if (isResizingWorkspace) {
        const nextWidth = Math.max(
          860,
          Math.min(viewportWidth - 16, resizeOrigin.width + (event.clientX - resizeOrigin.x)),
        );
        const nextHeight = Math.max(
          560,
          Math.min(viewportHeight - 16, resizeOrigin.height + (event.clientY - resizeOrigin.y)),
        );
        setWorkspaceRect((previous) => ({
          ...previous,
          width: nextWidth,
          height: nextHeight,
        }));
      }
    };

    const onMouseUp = () => {
      setIsDraggingWorkspace(false);
      setIsResizingWorkspace(false);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [
    dragOffset.x,
    dragOffset.y,
    isDraggingWorkspace,
    isMobileWorkspace,
    isResizingWorkspace,
    isWorkspaceOpen,
    resizeOrigin.height,
    resizeOrigin.width,
    resizeOrigin.x,
    resizeOrigin.y,
    roomDetail,
    viewportHeight,
    viewportWidth,
  ]);

  useEffect(() => {
    if (!roomDetail || !timingInfo) {
      setShowExpireModal(false);
      setShowExtendInput(false);
      return;
    }
    if (timingInfo.hasExpired && roomDetail.status !== "closed") {
      setShowExpireModal(true);
      console.info("[study_room] duration_expired_notice", {
        room_id: roomDetail.id,
        status: roomDetail.status,
        viewer_user_id: roomDetail.viewer_user_id,
        creator_id: roomDetail.creator_id,
      });
    } else {
      setShowExpireModal(false);
      setShowExtendInput(false);
    }
  }, [roomDetail, timingInfo]);

  useEffect(() => {
    const previousCount = previousMessageCountRef.current;
    const hasNewMessages = messages.length > previousCount;

    if (hasNewMessages) {
      if (isAtBottom) {
        requestAnimationFrame(() => {
          scrollMessagesToBottom();
        });
        setNewMessagesCount(0);
      } else {
        setNewMessagesCount((count) => count + (messages.length - previousCount));
      }
    }

    previousMessageCountRef.current = messages.length;
  }, [isAtBottom, messages]);

  useEffect(() => {
    if (!activeRoomId) {
      return;
    }

    let active = true;
    let supabaseClient: ReturnType<typeof getSupabaseBrowserClient> | null = null;
    try {
      supabaseClient = getSupabaseBrowserClient();
    } catch (error) {
      console.warn("[study_room_realtime] client_init_failed", {
        room_id: activeRoomId,
        reason: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    console.info("[study_room_realtime] subscription_start", {
      room_id: activeRoomId,
      pattern: "friend-chat-style per-table channels",
    });

    const channels: RealtimeChannel[] = [];
    const subscribeTableChannel = (params: {
      channelName: string;
      table: string;
      event: "*" | "INSERT" | "UPDATE" | "DELETE";
      filter: string;
      onEvent: (payload: {
        eventType: "INSERT" | "UPDATE" | "DELETE";
        new: Record<string, unknown> | null;
        old: Record<string, unknown> | null;
      }) => void;
      onError?: () => void;
    }) => {
      const channel = supabaseClient
        .channel(params.channelName)
        .on(
          "postgres_changes",
          {
            event: params.event,
            schema: "public",
            table: params.table,
            filter: params.filter,
          },
          (payload) => {
            if (!active) {
              return;
            }
            params.onEvent({
              eventType: payload.eventType as "INSERT" | "UPDATE" | "DELETE",
              new: (payload.new ?? null) as Record<string, unknown> | null,
              old: (payload.old ?? null) as Record<string, unknown> | null,
            });
          },
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            console.info("[study_room_realtime] subscription_succeeded", {
              room_id: activeRoomId,
              table: params.table,
              channel: params.channelName,
            });
            return;
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.error("[study_room_realtime] subscription_failed", {
              room_id: activeRoomId,
              table: params.table,
              channel: params.channelName,
              status,
            });
            params.onError?.();
          }
        });
      channels.push(channel);
    };

    subscribeTableChannel({
      channelName: `study-room-messages:${activeRoomId}`,
      table: "study_room_messages",
      event: "*",
      filter: `room_id=eq.${activeRoomId}`,
      onEvent: ({ eventType, new: newRow, old: oldRow }) => {
        const changedId = toSafeString(newRow?.id ?? oldRow?.id);
        if (!changedId) {
          return;
        }
        console.info("[study_room_realtime] message_event", {
          room_id: activeRoomId,
          event_type: eventType,
          message_id: changedId,
        });
        if (eventType === "DELETE") {
          setMessages((previous) => {
            const next = previous.filter((message) => message.id !== changedId);
            console.info("[study_room_realtime] message_state_updated", {
              room_id: activeRoomId,
              event_type: eventType,
              count: next.length,
            });
            return next;
          });
          return;
        }
        if (!newRow) {
          return;
        }
        const mapped = mapStudyRoomRealtimeMessage(newRow);
        if (!mapped.id || mapped.room_id !== activeRoomId) {
          return;
        }
        setMessages((previous) => {
          const next = upsertStudyRoomMessageByCreatedAt(previous, {
            id: mapped.id,
            room_id: mapped.room_id,
            sender_id: mapped.sender_id,
            body: mapped.body,
            created_at: mapped.created_at,
            type: mapped.type,
          });
          console.info("[study_room_realtime] message_state_updated", {
            room_id: activeRoomId,
            event_type: eventType,
            count: next.length,
          });
          return next;
        });
      },
      onError: () => {
        void loadRoomData(activeRoomId);
      },
    });

    subscribeTableChannel({
      channelName: `study-room-participants:${activeRoomId}`,
      table: "study_room_participants",
      event: "*",
      filter: `room_id=eq.${activeRoomId}`,
      onEvent: ({ eventType, new: newRow, old: oldRow }) => {
        const changedParticipantId = toSafeString(newRow?.id ?? oldRow?.id);
        console.info("[study_room_realtime] participant_event", {
          room_id: activeRoomId,
          event_type: eventType,
          participant_id: changedParticipantId || null,
          timestamp_field: "joined_at",
        });
        if (!changedParticipantId) {
          return;
        }
        if (eventType === "DELETE") {
          setParticipants((previous) => {
            const next = normalizeParticipantsByJoinedAt(
              previous.filter((item) => item.id !== changedParticipantId),
            );
            console.info("[study_room_realtime] participant_state_updated", {
              room_id: activeRoomId,
              event_type: eventType,
              count: next.length,
            });
            return next;
          });
          void loadRoomData(activeRoomId);
          return;
        }
        if (!newRow) {
          return;
        }
        setParticipants((previous) => {
          const next = mergeParticipantRealtimeRow({
            previous,
            row: newRow,
          });
          console.info("[study_room_realtime] participant_state_updated", {
            room_id: activeRoomId,
            event_type: eventType,
            count: next.length,
          });
          return next;
        });
        if (eventType === "INSERT") {
          void loadRoomData(activeRoomId);
        }
      },
      onError: () => {
        void loadRoomData(activeRoomId);
      },
    });

    subscribeTableChannel({
      channelName: `study-room-notes:${activeRoomId}`,
      table: "study_room_note_entries",
      event: "*",
      filter: `room_id=eq.${activeRoomId}`,
      onEvent: ({ eventType, new: newRow, old: oldRow }) => {
        const changedId = toSafeString(newRow?.id ?? oldRow?.id);
        if (!changedId) {
          return;
        }
        console.info("[study_room_realtime] note_event", {
          room_id: activeRoomId,
          event_type: eventType,
          note_entry_id: changedId,
        });
        if (eventType === "DELETE") {
          setNoteEntries((previous) => {
            const next = normalizeNoteEntriesByCreatedAt(
              previous.filter((entry) => entry.id !== changedId),
            );
            console.info("[study_room_realtime] note_state_updated", {
              room_id: activeRoomId,
              event_type: eventType,
              count: next.length,
            });
            return next;
          });
          setMyNoteEntryId((previous) => (previous === changedId ? null : previous));
          return;
        }
        if (!newRow) {
          return;
        }
        const isDeleted = toSafeBoolean(newRow.is_deleted);
        setNoteEntries((previous) => {
          const next = mergeNoteEntryRealtimeRow({
            previous,
            row: newRow,
            roomId: activeRoomId,
            participants: participantsRef.current,
          });
          console.info("[study_room_realtime] note_state_updated", {
            room_id: activeRoomId,
            event_type: eventType,
            count: next.length,
          });
          return next;
        });
        if (isDeleted) {
          setMyNoteEntryId((previous) => (previous === changedId ? null : previous));
          return;
        }
        const authorUserId = toSafeString(newRow.author_user_id);
        if (authorUserId && authorUserId === viewerUserIdRef.current) {
          setMyNoteEntryId(changedId);
        }
      },
      onError: () => {
        void loadWorkspaceExtras(activeRoomId);
      },
    });

    subscribeTableChannel({
      channelName: `study-room-resources:${activeRoomId}`,
      table: "study_room_resources",
      event: "*",
      filter: `room_id=eq.${activeRoomId}`,
      onEvent: ({ eventType, new: newRow, old: oldRow }) => {
        const changedId = toSafeString(newRow?.id ?? oldRow?.id);
        if (!changedId) {
          return;
        }
        console.info("[study_room_realtime] resource_event", {
          room_id: activeRoomId,
          event_type: eventType,
          resource_id: changedId,
        });
        if (eventType === "DELETE") {
          setResources((previous) => {
            const next = normalizeResourcesByCreatedAt(
              previous.filter((resource) => resource.id !== changedId),
            );
            console.info("[study_room_realtime] resource_state_updated", {
              room_id: activeRoomId,
              event_type: eventType,
              count: next.length,
            });
            return next;
          });
          return;
        }
        if (!newRow) {
          return;
        }
        setResources((previous) => {
          const next = mergeResourceRealtimeRow({
            previous,
            row: newRow,
            roomId: activeRoomId,
            participants: participantsRef.current,
          });
          console.info("[study_room_realtime] resource_state_updated", {
            room_id: activeRoomId,
            event_type: eventType,
            count: next.length,
          });
          return next;
        });
      },
      onError: () => {
        void loadWorkspaceExtras(activeRoomId);
      },
    });

    subscribeTableChannel({
      channelName: `study-room-ai:${activeRoomId}`,
      table: "study_room_ai_messages",
      event: "*",
      filter: `room_id=eq.${activeRoomId}`,
      onEvent: ({ eventType, new: newRow, old: oldRow }) => {
        const changedId = toSafeString(newRow?.id ?? oldRow?.id);
        if (!changedId) {
          return;
        }
        console.info("[study_room_realtime] ai_event", {
          room_id: activeRoomId,
          event_type: eventType,
          ai_message_id: changedId,
        });
        if (eventType === "DELETE") {
          setAiMessages((previous) => {
            const next = normalizeAiMessagesByCreatedAt(
              previous.filter((message) => message.id !== changedId),
            );
            console.info("[study_room_realtime] ai_state_updated", {
              room_id: activeRoomId,
              event_type: eventType,
              count: next.length,
            });
            return next;
          });
          return;
        }
        if (!newRow) {
          return;
        }
        setAiMessages((previous) => {
          const next = mergeAiMessageRealtimeRow({
            previous,
            row: newRow,
            roomId: activeRoomId,
            participants: participantsRef.current,
          });
          console.info("[study_room_realtime] ai_state_updated", {
            room_id: activeRoomId,
            event_type: eventType,
            count: next.length,
          });
          return next;
        });
      },
      onError: () => {
        void loadWorkspaceExtras(activeRoomId);
      },
    });

    subscribeTableChannel({
      channelName: `study-room-state:${activeRoomId}`,
      table: "study_rooms",
      event: "UPDATE",
      filter: `id=eq.${activeRoomId}`,
      onEvent: () => {
        console.info("[study_room_realtime] room_state_changed", {
          room_id: activeRoomId,
        });
        void loadRoomData(activeRoomId);
        void loadWorkspaceExtras(activeRoomId);
      },
      onError: () => {
        void loadRoomData(activeRoomId);
      },
    });

    return () => {
      active = false;
      console.info("[study_room_realtime] subscription_cleanup", {
        room_id: activeRoomId,
      });
      channels.forEach((channel) => {
        void channel.unsubscribe();
        void supabaseClient.removeChannel(channel);
      });
    };
  }, [activeRoomId, loadRoomData, loadWorkspaceExtras]);

  async function handleCreateRoom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPanelError("");
    setPanelMessage("");

    const name = createName.trim();
    const password = createPassword.trim();
    const duration = Math.max(15, Math.min(720, Number(createDuration) || 60));

    if (!name) {
      setPanelError("Room name is required.");
      return;
    }
    if (!password) {
      setPanelError("Password is required.");
      return;
    }

    setIsCreatingRoom(true);
    try {
      const response = await fetch("/api/study-room/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          style: createStyle,
          duration_minutes: duration,
          password,
        }),
      });
      const payload = (await response.json()) as StudyRoomCreateResponse;
      if (!response.ok || !payload.success || !payload.room_id) {
        throw new Error(payload.message ?? "Unable to create study room.");
      }

      await onRoomsUpdated();
      onSelectRoom(payload.room_id);
      setCreateName("");
      setCreatePassword("");
      setCreateDuration("60");
      setPanelMessage("Study room created.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to create study room.";
      setPanelError(message);
    } finally {
      setIsCreatingRoom(false);
    }
  }

  async function handleJoinRoom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPanelError("");
    setPanelMessage("");

    const roomId = joinRoomId.trim();
    const password = joinPassword.trim();
    if (!roomId || !password) {
      setPanelError("Room ID and password are required.");
      return;
    }

    setIsJoiningRoom(true);
    try {
      const response = await fetch("/api/study-room/join", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          room_id: roomId,
          password,
        }),
      });
      const payload = (await response.json()) as StudyRoomJoinResponse;
      if (!response.ok || !payload.success || !payload.room?.id) {
        throw new Error(payload.message ?? "Unable to join study room.");
      }

      await onRoomsUpdated();
      onSelectRoom(payload.room.id);
      setJoinRoomId("");
      setJoinPassword("");
      setPanelMessage("Joined study room.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to join study room.";
      setPanelError(message);
    } finally {
      setIsJoiningRoom(false);
    }
  }

  async function handleSendMessage() {
    if (!activeRoomId) {
      return;
    }
    if (!canSendMessages) {
      setPanelError("This room is not active. Messaging is disabled.");
      return;
    }
    const text = messageDraft.trim();
    if (!text) {
      return;
    }

    setIsSendingMessage(true);
    setPanelError("");
    try {
      const response = await fetch(`/api/study-room/${encodeURIComponent(activeRoomId)}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          body: text,
          type: "chat",
        }),
      });
      const payload = (await response.json()) as StudyRoomMessagesResponse;
      if (!response.ok || !payload.success || !payload.sent_message) {
        throw new Error(payload.message ?? "Unable to send room message.");
      }

      console.info("[study_room_realtime] message_sent", {
        room_id: activeRoomId,
        message_id: payload.sent_message.id,
      });

      setMessages((previous) =>
        appendStudyRoomMessageUnique(previous, payload.sent_message as StudyRoomMessage),
      );
      setMessageDraft("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to send room message.";
      console.error("[study_room_realtime] send_failed", {
        room_id: activeRoomId,
        reason: message,
      });
      setPanelError(message);
    } finally {
      setIsSendingMessage(false);
    }
  }

  async function handleCopyValue(mode: "room_id" | "password" | "invite", value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // ignore clipboard permission errors in unsupported contexts
    }
    setCopyFeedback(mode);
  }

  async function handleOpenInviteModal() {
    if (!roomDetail?.can_close) {
      return;
    }
    setIsInviteModalOpen(true);
    setPanelError("");
    setIsLoadingInviteFriends(true);
    setSelectedInviteFriendIds([]);
    try {
      const response = await fetch("/api/friends", {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json()) as FriendsApiResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to load friends list.");
      }
      const nextFriends = (payload.friends ?? []).filter(
        (friend) => friend.friendship_status === "accepted",
      );
      setInviteFriends(nextFriends);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load friends list.";
      setPanelError(message);
      setInviteFriends([]);
    } finally {
      setIsLoadingInviteFriends(false);
    }
  }

  async function handleSendInvites() {
    if (!roomDetail) {
      return;
    }
    if (selectedInviteFriendIds.length === 0) {
      setPanelError("Please select at least one friend to invite.");
      return;
    }
    setIsSendingInvites(true);
    setPanelError("");
    try {
      console.info("[study_room_invite] sending", {
        room_id: roomDetail.id,
        selected_count: selectedInviteFriendIds.length,
      });
      const response = await fetch(`/api/study-room/${encodeURIComponent(roomDetail.id)}/invite`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          friend_user_ids: selectedInviteFriendIds,
        }),
      });
      const payload = (await response.json()) as StudyRoomActionResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to send invitations.");
      }
      setPanelMessage(
        payload.message ?? `Invitations sent to ${payload.invited_count ?? selectedInviteFriendIds.length} friends.`,
      );
      setIsInviteModalOpen(false);
      setSelectedInviteFriendIds([]);
      setInviteFriends([]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to send invitations.";
      setPanelError(message);
    } finally {
      setIsSendingInvites(false);
    }
  }

  async function handleExtendRoom() {
    if (!roomDetail) {
      return;
    }
    const durationMinutes = Math.max(15, Math.min(720, Number(extendDurationInput) || 60));
    setIsExtendingRoom(true);
    setPanelError("");
    try {
      console.info("[study_room] extension_started", {
        room_id: roomDetail.id,
        duration_minutes: durationMinutes,
      });
      const response = await fetch(`/api/study-room/${encodeURIComponent(roomDetail.id)}/extend`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          duration_minutes: durationMinutes,
        }),
      });
      const payload = (await response.json()) as StudyRoomActionResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to extend room.");
      }
      setPanelMessage("Room duration updated.");
      setShowExtendInput(false);
      setShowExpireModal(false);
      await onRoomsUpdated();
      await loadRoomData(roomDetail.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to extend room.";
      setPanelError(message);
    } finally {
      setIsExtendingRoom(false);
    }
  }

  async function executeLeaveRoom() {
    if (!activeRoomId) {
      return;
    }
    setIsLeavingRoom(true);
    setPanelError("");
    setPanelMessage("");
    try {
      const response = await fetch("/api/study-room/leave", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          room_id: activeRoomId,
        }),
      });
      const payload = (await response.json()) as StudyRoomActionResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to leave room.");
      }

      await onRoomsUpdated();
      setPanelMessage(payload.message ?? "Left room.");
      const nextRoom = rooms.find((room) => room.id !== activeRoomId);
      onSelectRoom(nextRoom?.id ?? "");
      setIsWorkspaceOpen(Boolean(nextRoom?.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to leave room.";
      setPanelError(message);
    } finally {
      setIsLeavingRoom(false);
      setShowLeaveConfirm(false);
      setIsSavingLeaveSelections(false);
    }
  }

  async function loadLeaveSaveContent(roomId: string) {
    setIsLoadingLeaveSaveContent(true);
    setPanelError("");
    try {
      const response = await fetch(`/api/study-room/${encodeURIComponent(roomId)}/leave-save`, {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json()) as StudyRoomLeaveSaveResponse;
      if (!response.ok || !payload.success || !payload.content) {
        throw new Error(payload.message ?? "Unable to load room content for save.");
      }
      setLeaveSaveContent(payload.content);
      const notebooks = (payload.notebooks ?? []).map((item) => ({
        id: item.id,
        name: item.name,
      }));
      setLeaveSaveNotebooks(notebooks);
      setSelectedLeaveItemIds([]);
      setSelectedLeaveNotebookId(notebooks[0]?.id ?? "");
      const defaultTopic = `${roomDetail?.name ?? "Study Room"} Entry`;
      setLeaveNotebookTopic(defaultTopic);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to load room content for save.";
      setPanelError(message);
      setLeaveSaveNotebooks([]);
      setSelectedLeaveNotebookId("");
      setLeaveSaveContent({
        room_id: roomId,
        shared_notes: [],
        shared_resources: [],
        ai_exchanges: [],
      });
    } finally {
      setIsLoadingLeaveSaveContent(false);
    }
  }

  async function handleOpenLeaveModal() {
    if (!activeRoomId) {
      return;
    }
    setShowLeaveConfirm(true);
    await loadLeaveSaveContent(activeRoomId);
  }

  async function handleSaveSelectedBeforeLeave() {
    if (!activeRoomId) {
      return;
    }
    const normalizedTopic = leaveNotebookTopic.trim();
    if (!normalizedTopic) {
      setPanelError("Please enter a notebook topic before saving.");
      return;
    }
    if (selectedLeaveItemIds.length === 0) {
      setPanelError("Select at least one item to save, or choose Leave Without Saving.");
      return;
    }
    if (!selectedLeaveNotebookId) {
      setPanelError("Select a notebook to save into.");
      return;
    }

    setIsSavingLeaveSelections(true);
    setPanelError("");
    try {
      const response = await fetch(`/api/study-room/${encodeURIComponent(activeRoomId)}/leave-save`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          notebook_id: selectedLeaveNotebookId,
          entry_topic: normalizedTopic,
          selected_item_ids: selectedLeaveItemIds,
        }),
      });
      const payload = (await response.json()) as StudyRoomLeaveSaveResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to save selected room content.");
      }
      setPanelMessage(
        payload.notebook && payload.entry
          ? `Saved into "${payload.notebook.name}" as entry "${payload.entry.topic}".`
          : "Room content saved to your notebook entry.",
      );
      await executeLeaveRoom();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save selected room content.";
      setPanelError(message);
      setIsSavingLeaveSelections(false);
    }
  }

  async function handleCloseRoom() {
    if (!activeRoomId) {
      return;
    }
    setIsClosingRoom(true);
    setPanelError("");
    setPanelMessage("");
    try {
      const response = await fetch(`/api/study-room/${encodeURIComponent(activeRoomId)}/close`, {
        method: "POST",
      });
      const payload = (await response.json()) as StudyRoomActionResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to close room.");
      }

      await onRoomsUpdated();
      setPanelMessage("Study room closed.");
      const nextRoom = rooms.find((room) => room.id !== activeRoomId);
      onSelectRoom(nextRoom?.id ?? "");
      setIsWorkspaceOpen(Boolean(nextRoom?.id));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to close room.";
      setPanelError(message);
    } finally {
      setIsClosingRoom(false);
      setShowCloseConfirm(false);
    }
  }

  async function handleToggleFocusMode() {
    if (!roomDetail) {
      return;
    }
    const nextFocus = !focusModeEnabled;
    setFocusModeEnabled(nextFocus);
    lastInteractionAtRef.current = Date.now();
    try {
      const response = await fetch(`/api/study-room/${encodeURIComponent(roomDetail.id)}/presence`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          presence_state: nextFocus ? "focus" : "online",
          focus_mode: nextFocus,
        }),
      });
      const payload = (await response.json()) as StudyRoomPresenceResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to update focus mode.");
      }
      await loadRoomData(roomDetail.id);
    } catch (error) {
      setFocusModeEnabled(!nextFocus);
      const message = error instanceof Error ? error.message : "Unable to update focus mode.";
      setPanelError(message);
    }
  }

  async function handleSaveGoal() {
    if (!roomDetail) {
      return;
    }
    setIsSavingGoal(true);
    setPanelError("");
    try {
      const response = await fetch(`/api/study-room/${encodeURIComponent(roomDetail.id)}/goals`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          goal_text: goalDraft.trim() ? goalDraft.trim() : null,
          goal_status: goalStatusDraft,
        }),
      });
      const payload = (await response.json()) as StudyRoomGoalsResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to save goal.");
      }
      await loadRoomData(roomDetail.id);
      setPanelMessage("Goal updated.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save goal.";
      setPanelError(message);
    } finally {
      setIsSavingGoal(false);
    }
  }

  async function handleSaveNotes() {
    if (!roomDetail) {
      return;
    }
    setIsSavingNotes(true);
    setPanelError("");
    try {
      const response = await fetch(`/api/study-room/${encodeURIComponent(roomDetail.id)}/notes`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content: notesDraft,
          entry_id: myNoteEntryId,
        }),
      });
      const payload = (await response.json()) as StudyRoomNotesResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to save notes.");
      }
      setNotesRecord(payload.note ?? null);
      setNoteEntries(normalizeNoteEntriesByCreatedAt(payload.entries ?? []));
      setMyNoteEntryId(payload.my_entry?.id ?? payload.saved_entry?.id ?? null);
      setNotesDraft((payload.my_entry?.content_md ?? payload.saved_entry?.content_md ?? notesDraft) ?? "");
      setPanelMessage("Your notes were saved.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to save notes.";
      setPanelError(message);
    } finally {
      setIsSavingNotes(false);
    }
  }

  async function handleDeleteNoteEntry(entryId: string) {
    if (!roomDetail) {
      return;
    }
    setPanelError("");
    try {
      const response = await fetch(
        `/api/study-room/${encodeURIComponent(roomDetail.id)}/notes?entry_id=${encodeURIComponent(entryId)}`,
        {
          method: "DELETE",
        },
      );
      const payload = (await response.json()) as StudyRoomNotesResponse;
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to delete note.");
      }
      setNotesRecord(payload.note ?? null);
      setNoteEntries(normalizeNoteEntriesByCreatedAt(payload.entries ?? []));
      setMyNoteEntryId(payload.my_entry?.id ?? null);
      if (!payload.my_entry || payload.my_entry.id === entryId) {
        setNotesDraft(payload.my_entry?.content_md ?? "");
      }
      setPanelMessage("Note removed.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to delete note.";
      setPanelError(message);
    }
  }

  async function handleAddResource() {
    if (!roomDetail) {
      return;
    }
    setIsAddingResource(true);
    setPanelError("");
    try {
      const response = await fetch(`/api/study-room/${encodeURIComponent(roomDetail.id)}/resources`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          source_kind: "url",
          resource_type: newResourceType,
          title: newResourceTitle,
          url: newResourceUrl,
        }),
      });
      const payload = (await response.json()) as StudyRoomResourcesResponse;
      if (!response.ok || !payload.success || !payload.resource) {
        throw new Error(payload.message ?? "Unable to add resource.");
      }
      setResources((previous) =>
        normalizeResourcesByCreatedAt([...previous, payload.resource as StudyRoomSharedResource]),
      );
      setNewResourceTitle("");
      setNewResourceUrl("");
      setPanelMessage("Link resource added.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to add resource.";
      setPanelError(message);
    } finally {
      setIsAddingResource(false);
    }
  }

  async function handleUploadResourceFile() {
    if (!roomDetail || !newResourceFile) {
      return;
    }

    setIsUploadingResourceFile(true);
    setPanelError("");
    try {
      const formData = new FormData();
      formData.set("title", newResourceTitle);
      formData.set("resource_type", newResourceType);
      formData.set("file", newResourceFile);

      const response = await fetch(
        `/api/study-room/${encodeURIComponent(roomDetail.id)}/resources/upload`,
        {
          method: "POST",
          body: formData,
        },
      );
      const payload = (await response.json()) as StudyRoomResourcesResponse;
      if (!response.ok || !payload.success || !payload.resource) {
        throw new Error(payload.message ?? "Unable to upload file resource.");
      }
      setResources((previous) =>
        normalizeResourcesByCreatedAt([...previous, payload.resource as StudyRoomSharedResource]),
      );
      setNewResourceTitle("");
      setNewResourceFile(null);
      if (resourceFileInputRef.current) {
        resourceFileInputRef.current.value = "";
      }
      setPanelMessage("File uploaded and shared.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to upload file resource.";
      setPanelError(message);
    } finally {
      setIsUploadingResourceFile(false);
    }
  }

  async function handleRemoveResource(resourceId: string) {
    if (!roomDetail) {
      return;
    }
    try {
      const response = await fetch(
        `/api/study-room/${encodeURIComponent(roomDetail.id)}/resources/${encodeURIComponent(resourceId)}`,
        {
          method: "DELETE",
        },
      );
      const payload = (await response.json()) as { success: boolean; message?: string };
      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to remove resource.");
      }
      setResources((previous) => previous.filter((resource) => resource.id !== resourceId));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to remove resource.";
      setPanelError(message);
    }
  }

  async function handleAskAiTutor() {
    if (!roomDetail) {
      return;
    }
    const question = aiQuestionDraft.trim();
    if (!question) {
      return;
    }
    setIsAskingAiTutor(true);
    setPanelError("");
    try {
      const response = await fetch(`/api/study-room/${encodeURIComponent(roomDetail.id)}/ai-tutor`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          question,
          include_in_notes: true,
        }),
      });
      const payload = (await response.json()) as StudyRoomAiTutorResponse;
      if (
        !response.ok ||
        !payload.success ||
        !payload.user_message ||
        !payload.assistant_message
      ) {
        throw new Error(payload.message ?? "Unable to ask AI tutor.");
      }
      setAiMessages((previous) =>
        normalizeAiMessagesByCreatedAt([
          ...previous,
          payload.user_message as StudyRoomAiTutorMessage,
          payload.assistant_message as StudyRoomAiTutorMessage,
        ]),
      );
      setAiQuestionDraft("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to ask AI tutor.";
      setPanelError(message);
    } finally {
      setIsAskingAiTutor(false);
    }
  }

  return (
    <section className="rounded-[2rem] border-2 border-[#1F2937] bg-white p-5 shadow-[0_8px_0_#1F2937,0_18px_28px_rgba(31,41,55,0.12)] sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-3xl font-extrabold text-[#1F2937]">Study Rooms</h2>
          <p className="text-sm font-semibold text-[#1F2937]/70">
            Multi-user room chat with shared focus sessions.
          </p>
        </div>
      </div>

      {panelError ? (
        <p className="mt-4 rounded-xl bg-[#fff1f1] px-3 py-2 text-sm font-semibold text-[#c62828]">
          {panelError}
        </p>
      ) : null}
      {panelMessage ? (
        <p className="mt-4 rounded-xl bg-[#ecffe1] px-3 py-2 text-sm font-semibold text-[#2f7d14]">
          {panelMessage}
        </p>
      ) : null}

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <form
          onSubmit={(event) => {
            void handleCreateRoom(event);
          }}
          className="rounded-2xl border-2 border-[#1F2937]/12 bg-[#F8FCFF] p-4"
        >
          <p className="text-sm font-extrabold uppercase tracking-wide text-[#1F2937]/70">
            Create Room
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <input
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              placeholder="Room name"
              className="rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
            />
            <select
              value={createStyle}
              onChange={(event) => setCreateStyle(event.target.value)}
              className="rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
            >
              <option value="focus">focus</option>
              <option value="sprint">sprint</option>
              <option value="calm">calm</option>
              <option value="intense">intense</option>
            </select>
            <input
              type="number"
              min={15}
              max={720}
              value={createDuration}
              onChange={(event) => setCreateDuration(event.target.value)}
              placeholder="Duration (minutes)"
              className="rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
            />
            <input
              value={createPassword}
              onChange={(event) => setCreatePassword(event.target.value)}
              placeholder="Room password"
              className="rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
            />
          </div>
          <button
            type="submit"
            disabled={isCreatingRoom}
            className="btn-3d btn-3d-green mt-4 inline-flex h-10 items-center justify-center px-5 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isCreatingRoom ? "Creating..." : "Create Room"}
          </button>
        </form>

        <form
          onSubmit={(event) => {
            void handleJoinRoom(event);
          }}
          className="rounded-2xl border-2 border-[#1F2937]/12 bg-[#FFF9DD] p-4"
        >
          <p className="text-sm font-extrabold uppercase tracking-wide text-[#1F2937]/70">
            Join Room
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <input
              value={joinRoomId}
              onChange={(event) => setJoinRoomId(event.target.value)}
              placeholder="Room ID"
              className="rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
            />
            <input
              value={joinPassword}
              onChange={(event) => setJoinPassword(event.target.value)}
              placeholder="Password"
              className="rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
            />
          </div>
          <button
            type="submit"
            disabled={isJoiningRoom}
            className="btn-3d btn-3d-white mt-4 inline-flex h-10 items-center justify-center px-5 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
          >
            {isJoiningRoom ? "Joining..." : "Join Room"}
          </button>
        </form>
      </div>

      <div className="mt-6 rounded-2xl border-2 border-[#1F2937]/12 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-extrabold uppercase tracking-wide text-[#1F2937]/70">
            Active Room
          </p>
          {selectedRoom ? (
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-extrabold ${styleBadgeClass(selectedRoom.style)}`}
            >
              {selectedRoom.style}
            </span>
          ) : null}
        </div>

        {!selectedRoom ? (
          <p className="mt-3 text-sm font-semibold text-[#1F2937]/70">
            No active room selected. Create or join one to start.
          </p>
        ) : isLoadingRoom ? (
          <p className="mt-3 text-sm font-semibold text-[#1F2937]/70">Loading room...</p>
        ) : roomDetail ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#1F2937]/10 bg-[#F8FCFF] px-4 py-3">
            <div>
              <p className="text-base font-extrabold text-[#1F2937]">{roomDetail.name}</p>
              <p className="text-xs font-semibold text-[#1F2937]/65">
                {participants.length} participant(s) · status: {roomDetail.status}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsWorkspaceOpen(true)}
              className="btn-3d btn-3d-green inline-flex h-10 items-center justify-center px-4 !text-sm"
            >
              Open Workspace
            </button>
          </div>
        ) : null}
      </div>

      {isWorkspaceOpen && roomDetail ? (
        <div className="fixed inset-0 z-[90] bg-black/35 backdrop-blur-[1px]">
          <div
            className="absolute inset-0"
            onClick={() => {
              setIsWorkspaceOpen(false);
            }}
          />
          <section
            className={`absolute z-[91] overflow-hidden rounded-[1.4rem] border-2 border-[#1F2937] bg-white shadow-[0_8px_0_#1F2937,0_22px_34px_rgba(31,41,55,0.22)] ${
              isMobileWorkspace ? "inset-0 rounded-none border-0 shadow-none" : ""
            }`}
            style={
              isMobileWorkspace
                ? undefined
                : {
                    left: workspaceRect.x,
                    top: workspaceRect.y,
                    width: workspaceRect.width,
                    height: workspaceRect.height,
                  }
            }
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <div className="flex items-center justify-between gap-3 border-b border-[#1F2937]/12 bg-[#F8FCFF] px-4 py-3">
              <div
                className={`min-w-0 ${isMobileWorkspace ? "" : "cursor-move"}`}
                onMouseDown={(event) => {
                  if (isMobileWorkspace || workspaceSizePreset === 100) {
                    return;
                  }
                  setIsDraggingWorkspace(true);
                  setDragOffset({
                    x: event.clientX - workspaceRect.x,
                    y: event.clientY - workspaceRect.y,
                  });
                }}
              >
                <p className="truncate text-base font-extrabold text-[#1F2937]">{roomDetail.name}</p>
                <p className="text-xs font-semibold text-[#1F2937]/65">
                  Room ID: {roomDetail.id} · status: {roomDetail.status}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void handleCopyValue("room_id", roomDetail.id);
                  }}
                  className="rounded-full border border-[#1F2937]/20 bg-white px-2.5 py-1 text-[11px] font-extrabold text-[#1F2937]"
                >
                  {copyFeedback === "room_id" ? "Copied" : "Copy ID"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleCopyValue("password", roomDetail.password);
                  }}
                  className="rounded-full border border-[#1F2937]/20 bg-white px-2.5 py-1 text-[11px] font-extrabold text-[#1F2937]"
                >
                  {copyFeedback === "password" ? "Copied" : "Copy Password"}
                </button>
                {roomDetail.can_close ? (
                  <button
                    type="button"
                    onClick={() => {
                      void handleOpenInviteModal();
                    }}
                    className="rounded-full border border-[#1F2937]/20 bg-[#FFF9DD] px-2.5 py-1 text-[11px] font-extrabold text-[#1F2937]"
                  >
                    Invite
                  </button>
                ) : null}
                <div
                  className="flex items-center gap-1 rounded-full border border-[#1F2937]/20 bg-white px-2 py-1"
                  onWheel={(event) => {
                    if (isMobileWorkspace) {
                      return;
                    }
                    if (!(event.ctrlKey || event.altKey)) {
                      return;
                    }
                    event.preventDefault();
                    const currentPreset =
                      workspaceSizePreset === "custom" ? 75 : workspaceSizePreset;
                    const currentIndex = workspacePresetOptions.indexOf(currentPreset);
                    const direction = event.deltaY < 0 ? 1 : -1;
                    const nextIndex = Math.max(
                      0,
                      Math.min(workspacePresetOptions.length - 1, currentIndex + direction),
                    );
                    const nextPreset = workspacePresetOptions[nextIndex];
                    applyWorkspacePreset(nextPreset);
                  }}
                >
                  <span className="px-1 text-[11px] font-extrabold text-[#1F2937]/70">Size</span>
                  <select
                    value={workspaceSizePreset === "custom" ? "custom" : String(workspaceSizePreset)}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (value === "custom") {
                        setWorkspaceSizePreset("custom");
                        return;
                      }
                      const preset = Number(value) as 25 | 50 | 75 | 100;
                      applyWorkspacePreset(preset);
                    }}
                    className="rounded-full border border-[#1F2937]/15 bg-white px-2 py-0.5 text-[11px] font-extrabold text-[#1F2937] outline-none"
                    title="Hold Ctrl or Alt and use mouse wheel here to resize quickly."
                    disabled={isMobileWorkspace}
                  >
                    {workspacePresetOptions.map((preset) => (
                      <option key={preset} value={preset}>
                        {preset}%
                      </option>
                    ))}
                    {workspaceSizePreset === "custom" ? <option value="custom">Custom</option> : null}
                  </select>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsWorkspaceOpen(false);
                  }}
                  className="rounded-full border border-[#1F2937]/20 bg-white px-2.5 py-1 text-[11px] font-extrabold text-[#1F2937]"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="grid h-[calc(100%-56px)] gap-0 lg:grid-cols-[1.8fr_1fr]">
              <div className="flex min-h-0 flex-col border-r border-[#1F2937]/10">
                <div className="flex flex-wrap items-center gap-2 border-b border-[#1F2937]/10 px-4 py-2">
                  {(["chat", "notes", "resources", "ai"] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setWorkspaceTab(tab)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-extrabold uppercase tracking-wide ${
                        workspaceTab === tab
                          ? "border-[#1F2937] bg-[#58CC02] text-white"
                          : "border-[#1F2937]/15 bg-white text-[#1F2937]"
                      }`}
                    >
                      {tab === "ai" ? "AI Tutor" : tab}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      void handleToggleFocusMode();
                    }}
                    className={`ml-auto rounded-full border px-3 py-1.5 text-xs font-extrabold uppercase tracking-wide ${
                      focusModeEnabled
                        ? "border-[#1F2937] bg-[#58CC02]/20 text-[#1F2937]"
                        : "border-[#1F2937]/15 bg-white text-[#1F2937]"
                    }`}
                  >
                    {focusModeEnabled ? "Focus On" : "Focus Off"}
                  </button>
                </div>

                <div className="min-h-0 flex-1 p-4">
                  {workspaceTab === "chat" ? (
                    <div className="flex h-full flex-col">
                      <div
                        ref={messagesContainerRef}
                        onScroll={() => {
                          const atBottom = checkIsAtBottom();
                          setIsAtBottom(atBottom);
                          if (atBottom) {
                            setNewMessagesCount(0);
                          }
                        }}
                        className="flex-1 overflow-y-auto rounded-xl border-2 border-[#1F2937]/10 bg-[#F9FCFF] p-3"
                      >
                        {messages.length === 0 ? (
                          <p className="my-10 text-center text-sm font-semibold text-[#1F2937]/65">
                            No room messages yet.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {messages.map((message) => {
                              const isMine = message.sender_id === roomDetail.viewer_user_id;
                              const fallbackName =
                                participants.find((participant) => participant.user_id === message.sender_id)?.username ??
                                "Unknown";
                              const senderName = message.sender_username ?? fallbackName;
                              return (
                                <div
                                  key={message.id}
                                  className={`rounded-xl border px-3 py-2 ${
                                    isMine
                                      ? "border-[#58CC02]/40 bg-[#E9FFD8]"
                                      : "border-[#1F2937]/12 bg-white"
                                  }`}
                                >
                                  <p className="text-[11px] font-extrabold uppercase tracking-wide text-[#1F2937]/65">
                                    {senderName}
                                  </p>
                                  <p className="text-sm font-semibold text-[#1F2937]">{message.body}</p>
                                  <p className="mt-1 text-[11px] font-semibold text-[#1F2937]/55">
                                    {formatTimestamp(message.created_at)}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      {newMessagesCount > 0 && !isAtBottom ? (
                        <div className="mt-2 flex justify-center">
                          <button
                            type="button"
                            onClick={() => {
                              scrollMessagesToBottom();
                              setIsAtBottom(true);
                              setNewMessagesCount(0);
                            }}
                            className="rounded-full border-2 border-[#1F2937]/15 bg-[#FFD84D] px-4 py-1.5 text-xs font-extrabold text-[#1F2937]"
                          >
                            New messages ({newMessagesCount})
                          </button>
                        </div>
                      ) : null}
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <input
                          value={messageDraft}
                          onChange={(event) => setMessageDraft(event.target.value)}
                          placeholder="Send a room message..."
                          disabled={!canSendMessages}
                          className="w-full rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            void handleSendMessage();
                          }}
                          disabled={isSendingMessage || !canSendMessages}
                          className="btn-3d btn-3d-green inline-flex h-10 items-center justify-center px-4 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {isSendingMessage ? "Sending..." : "Send"}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  {workspaceTab === "notes" ? (
                    <div className="flex h-full flex-col gap-3">
                      <div className="rounded-xl border border-[#1F2937]/12 bg-[#F7FFE9] p-3">
                        <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/65">
                          Your Notes
                        </p>
                        <textarea
                          value={notesDraft}
                          onChange={(event) => setNotesDraft(event.target.value)}
                          placeholder="Write your own markdown notes here..."
                          className="mt-2 min-h-[160px] w-full resize-none rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
                        />
                        <div className="mt-2 flex items-center justify-between gap-2 text-xs font-semibold text-[#1F2937]/65">
                          <p>
                            {myLatestNoteEntry
                              ? `Your latest update · ${formatTimestamp(
                                  myLatestNoteEntry.updated_at ?? myLatestNoteEntry.created_at,
                                )}`
                              : "No personal note saved yet."}
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              void handleSaveNotes();
                            }}
                            disabled={isSavingNotes}
                            className="btn-3d btn-3d-green inline-flex h-9 items-center justify-center px-4 !text-xs disabled:cursor-not-allowed disabled:opacity-70"
                          >
                            {isSavingNotes ? "Saving..." : "Save My Note"}
                          </button>
                        </div>
                      </div>

                      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-[#1F2937]/12 bg-[#F9FCFF] p-3">
                        <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/65">
                          Room Notes Feed
                        </p>
                        {sortedNoteEntries.length === 0 ? (
                          notesRecord?.content ? (
                            <div className="rounded-xl border border-[#1F2937]/12 bg-white p-3">
                              <p className="text-xs font-extrabold text-[#1F2937]/65">Legacy Shared Note</p>
                              <p className="mt-1 whitespace-pre-wrap text-sm font-semibold text-[#1F2937]">
                                {notesRecord.content}
                              </p>
                              <p className="mt-2 text-[11px] font-semibold text-[#1F2937]/55">
                                Updated by {notesRecord.updated_by_username ?? "Unknown"} ·{" "}
                                {formatTimestamp(notesRecord.updated_at)}
                              </p>
                            </div>
                          ) : (
                            <p className="text-sm font-semibold text-[#1F2937]/65">
                              No room notes yet. Add your first note.
                            </p>
                          )
                        ) : (
                          <div className="space-y-2">
                            {sortedNoteEntries.map((entry) => {
                              const isMine = roomDetail.viewer_user_id === entry.author_user_id;
                              return (
                                <div
                                  key={entry.id}
                                  className={`rounded-xl border p-3 ${
                                    isMine
                                      ? "border-[#58CC02]/35 bg-[#EEFFE3]"
                                      : "border-[#1F2937]/12 bg-white"
                                  }`}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div>
                                      <p className="text-xs font-extrabold text-[#1F2937]/75">
                                        {entry.author_username ?? "Unknown"}
                                        {isMine ? " (You)" : ""}
                                      </p>
                                      <p className="text-[11px] font-semibold text-[#1F2937]/55">
                                        {formatTimestamp(entry.updated_at ?? entry.created_at)}
                                      </p>
                                    </div>
                                    {isMine ? (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          void handleDeleteNoteEntry(entry.id);
                                        }}
                                        className="rounded-full border border-[#1F2937]/20 bg-white px-2 py-0.5 text-[11px] font-extrabold text-[#1F2937]"
                                      >
                                        Delete
                                      </button>
                                    ) : null}
                                  </div>
                                  <p className="mt-2 whitespace-pre-wrap text-sm font-semibold text-[#1F2937]">
                                    {entry.content_md?.trim() ? entry.content_md : "(empty note)"}
                                  </p>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {workspaceTab === "resources" ? (
                    <div className="flex h-full flex-col gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setResourceComposerMode("url");
                            setNewResourceUrl((previous) => previous ?? "");
                          }}
                          className={`rounded-full border px-3 py-1 text-xs font-extrabold ${
                            resourceComposerMode === "url"
                              ? "border-[#58CC02] bg-[#E9FFD8] text-[#1F2937]"
                              : "border-[#1F2937]/20 bg-white text-[#1F2937]/70"
                          }`}
                        >
                          Add Link
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setResourceComposerMode("file");
                            setNewResourceUrl((previous) => previous ?? "");
                          }}
                          className={`rounded-full border px-3 py-1 text-xs font-extrabold ${
                            resourceComposerMode === "file"
                              ? "border-[#58CC02] bg-[#E9FFD8] text-[#1F2937]"
                              : "border-[#1F2937]/20 bg-white text-[#1F2937]/70"
                          }`}
                        >
                          Upload File
                        </button>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-3">
                        <select
                          value={newResourceType}
                          onChange={(event) =>
                            setNewResourceType(
                              event.target.value as
                                | "video"
                                | "article"
                                | "website"
                                | "document"
                                | "notes"
                                | "other",
                            )
                          }
                          className="rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
                        >
                          <option value="video">Video</option>
                          <option value="article">Article</option>
                          <option value="website">Website</option>
                          <option value="document">Document</option>
                          <option value="notes">Notes</option>
                          <option value="other">Other</option>
                        </select>
                        <input
                          value={newResourceTitle}
                          onChange={(event) => setNewResourceTitle(event.target.value)}
                          placeholder="Resource title"
                          className="rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
                        />
                        {resourceComposerMode === "url" ? (
                          <input
                            value={newResourceUrl ?? ""}
                            onChange={(event) => setNewResourceUrl(event.target.value)}
                            placeholder="https://..."
                            className="rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
                          />
                        ) : (
                          <div className="flex items-center gap-2 rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2">
                            <input
                              ref={resourceFileInputRef}
                              type="file"
                              accept=".pdf,.txt,.md,.doc,.docx,.ppt,.pptx,.png,.jpg,.jpeg,.webp"
                              onChange={(event) => {
                                const selectedFile = event.target.files?.[0] ?? null;
                                setNewResourceFile(selectedFile);
                                if (!newResourceTitle.trim() && selectedFile?.name) {
                                  setNewResourceTitle(selectedFile.name.replace(/\.[^.]+$/, ""));
                                }
                              }}
                              className="hidden"
                            />
                            <button
                              type="button"
                              onClick={() => resourceFileInputRef.current?.click()}
                              className="rounded-full border border-[#1F2937]/20 bg-[#E9FFD8] px-3 py-1 text-xs font-extrabold text-[#1F2937]"
                            >
                              Choose File
                            </button>
                            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[#1F2937]/70">
                              {newResourceFile?.name ?? "No file selected"}
                            </span>
                          </div>
                        )}
                      </div>
                      {resourceComposerMode === "url" ? (
                        <button
                          type="button"
                          onClick={() => {
                            void handleAddResource();
                          }}
                          disabled={isAddingResource}
                          className="btn-3d btn-3d-green inline-flex h-9 w-fit items-center justify-center px-4 !text-xs disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {isAddingResource ? "Adding..." : "Add Link"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            void handleUploadResourceFile();
                          }}
                          disabled={isUploadingResourceFile || !newResourceFile}
                          className="btn-3d btn-3d-green inline-flex h-9 w-fit items-center justify-center px-4 !text-xs disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {isUploadingResourceFile ? "Uploading..." : "Upload File"}
                        </button>
                      )}
                      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-[#1F2937]/12 bg-[#F9FCFF] p-3">
                        {resources.length === 0 ? (
                          <p className="text-sm font-semibold text-[#1F2937]/65">No shared resources yet.</p>
                        ) : (
                          <div className="space-y-2">
                            {resources.map((resource) => (
                              <div key={resource.id} className="rounded-xl border border-[#1F2937]/12 bg-white p-3">
                                <div className="flex items-start justify-between gap-2">
                                  <div>
                                    <p className="text-sm font-extrabold text-[#1F2937]">{resource.title}</p>
                                    <p className="text-xs font-semibold text-[#1F2937]/60">
                                      {resource.resource_type.toUpperCase()} ·{" "}
                                      {resource.source_kind.toUpperCase()} · by{" "}
                                      {resource.added_by_username ?? "Unknown"} · {formatTimestamp(resource.created_at)}
                                    </p>
                                    {resource.source_kind === "file" ? (
                                      <p className="text-[11px] font-semibold text-[#1F2937]/55">
                                        {resource.file_name ?? "uploaded file"} · {formatBytes(resource.file_size_bytes)}
                                      </p>
                                    ) : null}
                                  </div>
                                  {roomDetail.viewer_user_id === resource.added_by ||
                                  roomDetail.can_close ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        void handleRemoveResource(resource.id);
                                      }}
                                      className="rounded-full border border-[#1F2937]/20 bg-white px-2 py-0.5 text-[11px] font-extrabold text-[#1F2937]"
                                    >
                                      Remove
                                    </button>
                                  ) : null}
                                </div>
                                {resource.url ? (
                                  <div className="mt-2 flex flex-wrap items-center gap-2">
                                    <a
                                      href={resource.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="inline-flex items-center justify-center rounded-full border border-[#0B66C3]/35 bg-[#EFF7FF] px-3 py-1 text-xs font-extrabold text-[#0B66C3]"
                                    >
                                      {resource.source_kind === "file" ? "Open / Download" : "Open Link"}
                                    </a>
                                    <span className="text-[11px] font-semibold text-[#1F2937]/50 break-all">
                                      {resource.url}
                                    </span>
                                  </div>
                                ) : (
                                  <p className="mt-1 text-xs font-semibold text-[#1F2937]/50">
                                    Resource URL unavailable.
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}

                  {workspaceTab === "ai" ? (
                    <div className="flex h-full flex-col">
                      <div className="flex-1 overflow-y-auto rounded-xl border border-[#1F2937]/12 bg-[#F9FCFF] p-3">
                        {aiMessages.length === 0 ? (
                          <p className="text-sm font-semibold text-[#1F2937]/65">
                            Ask AI Tutor for help on this room&apos;s topic and shared resources.
                          </p>
                        ) : (
                          <div className="space-y-2">
                            {aiMessages.map((message) => (
                              <div
                                key={message.id}
                                className={`rounded-xl border px-3 py-2 ${
                                  message.role === "assistant"
                                    ? "border-[#58CC02]/40 bg-[#E9FFD8]"
                                    : "border-[#1F2937]/12 bg-white"
                                }`}
                              >
                                <p className="text-[11px] font-extrabold uppercase tracking-wide text-[#1F2937]/65">
                                  {message.role === "assistant"
                                    ? "AI Tutor"
                                    : message.sender_username ?? "You"}
                                </p>
                                <p className="text-sm font-semibold whitespace-pre-wrap text-[#1F2937]">
                                  {message.body}
                                </p>
                                <p className="mt-1 text-[11px] font-semibold text-[#1F2937]/55">
                                  {formatTimestamp(message.created_at)}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                        <textarea
                          value={aiQuestionDraft}
                          onChange={(event) => setAiQuestionDraft(event.target.value)}
                          placeholder="Ask AI Tutor..."
                          className="min-h-[44px] w-full rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            void handleAskAiTutor();
                          }}
                          disabled={isAskingAiTutor}
                          className="btn-3d btn-3d-green inline-flex h-10 items-center justify-center px-4 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {isAskingAiTutor ? "Asking..." : "Ask"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>

              <aside className="min-h-0 overflow-y-auto bg-[#FFFDF3] p-4">
                <div className="rounded-2xl border border-[#1F2937]/12 bg-white p-3">
                  <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/60">
                    My Goal
                  </p>
                  <textarea
                    value={goalDraft}
                    onChange={(event) => setGoalDraft(event.target.value)}
                    placeholder="Set your goal..."
                    className="mt-2 min-h-[72px] w-full rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <select
                      value={goalStatusDraft}
                      onChange={(event) =>
                        setGoalStatusDraft(
                          event.target.value as "not_started" | "in_progress" | "completed",
                        )
                      }
                      className="rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-xs font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
                    >
                      <option value="not_started">not_started</option>
                      <option value="in_progress">in_progress</option>
                      <option value="completed">completed</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        void handleSaveGoal();
                      }}
                      disabled={isSavingGoal}
                      className="btn-3d btn-3d-green inline-flex h-9 items-center justify-center px-3 !text-xs disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {isSavingGoal ? "Saving..." : "Save Goal"}
                    </button>
                  </div>
                </div>

                <div className="mt-3 rounded-2xl border border-[#1F2937]/12 bg-white p-3">
                  <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/60">
                    Participants
                  </p>
                  <div className="mt-2 space-y-2">
                    {participants.map((participant) => (
                      <div key={participant.id} className="rounded-xl border border-[#1F2937]/12 bg-[#F8FCFF] px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-extrabold text-[#1F2937]">{participant.username}</p>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${presenceBadgeClass(participant.presence_state)}`}>
                            {participant.presence_state}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] font-semibold text-[#1F2937]/60">
                          {participant.role === "creator" ? "creator" : "participant"} · session{" "}
                          {formatShortDurationFromSeconds(participant.session_seconds)} · streak{" "}
                          {formatShortDurationFromSeconds(participant.current_streak_seconds)}
                        </p>
                        {participant.goal_text ? (
                          <p className="mt-1 text-[11px] font-semibold text-[#1F2937]/75">
                            Goal ({participant.goal_status}): {participant.goal_text}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-3 rounded-2xl border border-[#1F2937]/12 bg-white p-3">
                  <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/60">
                    Room Duration
                  </p>
                  <div className="mt-2 space-y-1 text-xs font-semibold text-[#1F2937]/72">
                    <p>Created: {timingInfo?.createdAtText ?? "Unknown"}</p>
                    <p>Duration: {timingInfo?.originalDurationText ?? "-"}</p>
                    <p>Remaining: {timingInfo?.remainingText ?? "-"}</p>
                    <p>Status: {timingInfo?.statusText ?? "-"}</p>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {roomDetail.can_close ? (
                      <>
                        <button
                          type="button"
                          onClick={() => setShowCloseConfirm(true)}
                          disabled={isClosingRoom}
                          className="btn-3d btn-3d-white inline-flex h-9 items-center justify-center px-3 !text-xs disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          {isClosingRoom ? "Closing..." : "Close Room"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowExtendInput(true);
                            setShowExpireModal(true);
                          }}
                          disabled={isExtendingRoom}
                          className="btn-3d btn-3d-green inline-flex h-9 items-center justify-center px-3 !text-xs disabled:cursor-not-allowed disabled:opacity-70"
                        >
                          Extend
                        </button>
                      </>
                    ) : roomDetail.can_leave ? (
                      <button
                        type="button"
                        onClick={() => {
                          void handleOpenLeaveModal();
                        }}
                        disabled={isLeavingRoom}
                        className="btn-3d btn-3d-white inline-flex h-9 items-center justify-center px-3 !text-xs disabled:cursor-not-allowed disabled:opacity-70"
                      >
                        {isLeavingRoom ? "Leaving..." : "Leave Room"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </aside>
            </div>

            {!isMobileWorkspace && workspaceSizePreset !== 100 ? (
              <button
                type="button"
                aria-label="Resize workspace"
                onMouseDown={(event) => {
                  setIsResizingWorkspace(true);
                  setWorkspaceSizePreset("custom");
                  setResizeOrigin({
                    x: event.clientX,
                    y: event.clientY,
                    width: workspaceRect.width,
                    height: workspaceRect.height,
                  });
                }}
                className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize rounded-tl-lg border-l border-t border-[#1F2937]/20 bg-[#FFF9DD]"
              />
            ) : null}
          </section>
        </div>
      ) : null}

      {showCloseConfirm && roomDetail ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/35 px-4">
          <div className="w-full max-w-md rounded-[1.5rem] border-2 border-[#1F2937] bg-white p-5 shadow-[0_8px_0_#1F2937,0_18px_26px_rgba(31,41,55,0.16)]">
            <p className="text-xl font-extrabold text-[#1F2937]">Close this room early?</p>
            <p className="mt-2 text-sm font-semibold text-[#1F2937]/72">
              Are you sure you want to close this study room now? All participants will be removed from the active session.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCloseConfirm(false)}
                className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-4 !text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleCloseRoom();
                }}
                disabled={isClosingRoom}
                className="btn-3d btn-3d-green inline-flex h-10 items-center justify-center px-4 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isClosingRoom ? "Closing..." : "Confirm Close"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showLeaveConfirm && roomDetail ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/35 px-4">
          <div className="w-full max-w-3xl rounded-[1.5rem] border-2 border-[#1F2937] bg-white p-5 shadow-[0_8px_0_#1F2937,0_18px_26px_rgba(31,41,55,0.16)]">
            <p className="text-xl font-extrabold text-[#1F2937]">Save room content before leaving?</p>
            <p className="mt-2 text-sm font-semibold text-[#1F2937]/72">
              Select shared notes, resources, and AI Tutor exchanges you want to save into your personal notebook.
            </p>

            <div className="mt-3 rounded-xl border border-[#1F2937]/12 bg-[#F8FCFF] p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <label className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/65">
                    Choose Notebook
                  </label>
                  <select
                    value={selectedLeaveNotebookId}
                    onChange={(event) => setSelectedLeaveNotebookId(event.target.value)}
                    className="mt-2 w-full rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
                  >
                    <option value="">Select notebook</option>
                    {leaveSaveNotebooks.map((notebook) => (
                      <option key={notebook.id} value={notebook.id}>
                        {notebook.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/65">
                    New Entry Topic
                  </label>
                  <input
                    value={leaveNotebookTopic}
                    onChange={(event) => setLeaveNotebookTopic(event.target.value)}
                    placeholder="Example: React Room Summary"
                    className="mt-2 w-full rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
                  />
                </div>
              </div>
              {leaveSaveNotebooks.length === 0 && !isLoadingLeaveSaveContent ? (
                <p className="mt-2 text-xs font-semibold text-[#c62828]">
                  No notebook found. Create one in Notes page first.
                </p>
              ) : null}
              <p className="mt-1 text-xs font-semibold text-[#1F2937]/62">
                Selected items: {selectedLeaveItemCount}
              </p>
            </div>

            <div className="mt-3 max-h-[52vh] overflow-y-auto space-y-3">
              {isLoadingLeaveSaveContent ? (
                <p className="text-sm font-semibold text-[#1F2937]/70">Loading room content...</p>
              ) : (
                <>
                  <div className="rounded-xl border border-[#1F2937]/12 bg-[#F9FCFF] p-3">
                    <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/65">
                      Shared Notes
                    </p>
                    {leaveSaveContent?.shared_notes.length ? (
                      <div className="mt-2 space-y-2">
                        {leaveSaveContent.shared_notes.map((item) => {
                          const checked = selectedLeaveItemIds.includes(item.item_id);
                          return (
                            <label
                              key={item.item_id}
                              className="flex items-start justify-between gap-3 rounded-lg border border-[#1F2937]/12 bg-white p-3"
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-extrabold text-[#1F2937]/70">
                                  {item.author_username ?? "Unknown"} · {formatTimestamp(item.timestamp)}
                                </p>
                                <p className="mt-1 whitespace-pre-wrap text-sm font-semibold text-[#1F2937]">
                                  {truncateText(item.content_md, 220)}
                                </p>
                              </div>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => {
                                  setSelectedLeaveItemIds((previous) => {
                                    if (event.target.checked) {
                                      return Array.from(new Set([...previous, item.item_id]));
                                    }
                                    return previous.filter((id) => id !== item.item_id);
                                  });
                                }}
                                className="mt-1 h-4 w-4 shrink-0 accent-[#58CC02]"
                              />
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm font-semibold text-[#1F2937]/65">No shared notes to save.</p>
                    )}
                  </div>

                  <div className="rounded-xl border border-[#1F2937]/12 bg-[#F9FCFF] p-3">
                    <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/65">
                      Shared Resources
                    </p>
                    {leaveSaveContent?.shared_resources.length ? (
                      <div className="mt-2 space-y-2">
                        {leaveSaveContent.shared_resources.map((item) => {
                          const checked = selectedLeaveItemIds.includes(item.item_id);
                          return (
                            <label
                              key={item.item_id}
                              className="flex items-start justify-between gap-3 rounded-lg border border-[#1F2937]/12 bg-white p-3"
                            >
                              <div className="min-w-0">
                                <p className="text-sm font-extrabold text-[#1F2937]">{item.title}</p>
                                <p className="text-xs font-semibold text-[#1F2937]/65">
                                  {item.resource_type} · {item.source_kind_value} · by{" "}
                                  {item.added_by_username ?? "Unknown"} · {formatTimestamp(item.timestamp)}
                                </p>
                                {item.url ? (
                                  <p className="mt-1 truncate text-xs font-semibold text-[#0B66C3]">{item.url}</p>
                                ) : null}
                              </div>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => {
                                  setSelectedLeaveItemIds((previous) => {
                                    if (event.target.checked) {
                                      return Array.from(new Set([...previous, item.item_id]));
                                    }
                                    return previous.filter((id) => id !== item.item_id);
                                  });
                                }}
                                className="mt-1 h-4 w-4 shrink-0 accent-[#58CC02]"
                              />
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm font-semibold text-[#1F2937]/65">No shared resources to save.</p>
                    )}
                  </div>

                  <div className="rounded-xl border border-[#1F2937]/12 bg-[#F9FCFF] p-3">
                    <p className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/65">
                      AI Tutor Content
                    </p>
                    {leaveSaveContent?.ai_exchanges.length ? (
                      <div className="mt-2 space-y-2">
                        {leaveSaveContent.ai_exchanges.map((item) => {
                          const checked = selectedLeaveItemIds.includes(item.item_id);
                          return (
                            <label
                              key={item.item_id}
                              className="flex items-start justify-between gap-3 rounded-lg border border-[#1F2937]/12 bg-white p-3"
                            >
                              <div className="min-w-0">
                                <p className="text-xs font-extrabold text-[#1F2937]/70">
                                  Exchange · {formatTimestamp(item.timestamp)}
                                </p>
                                <p className="mt-1 text-xs font-semibold text-[#1F2937]/70">Question</p>
                                <p className="text-sm font-semibold text-[#1F2937]">
                                  {truncateText(item.question_text, 180) || "(missing question)"}
                                </p>
                                <p className="mt-1 text-xs font-semibold text-[#1F2937]/70">Answer</p>
                                <p className="text-sm font-semibold text-[#1F2937]">
                                  {truncateText(item.answer_text, 220) || "(missing answer)"}
                                </p>
                              </div>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(event) => {
                                  setSelectedLeaveItemIds((previous) => {
                                    if (event.target.checked) {
                                      return Array.from(new Set([...previous, item.item_id]));
                                    }
                                    return previous.filter((id) => id !== item.item_id);
                                  });
                                }}
                                className="mt-1 h-4 w-4 shrink-0 accent-[#58CC02]"
                              />
                            </label>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="mt-2 text-sm font-semibold text-[#1F2937]/65">No AI tutor exchanges to save.</p>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowLeaveConfirm(false)}
                className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-4 !text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void executeLeaveRoom();
                }}
                disabled={isLeavingRoom || isSavingLeaveSelections}
                className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-4 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isLeavingRoom ? "Leaving..." : "Leave Without Saving"}
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleSaveSelectedBeforeLeave();
                }}
                disabled={
                  isSavingLeaveSelections ||
                  isLeavingRoom ||
                  isLoadingLeaveSaveContent ||
                  !selectedLeaveNotebookId ||
                  leaveSaveNotebooks.length === 0
                }
                className="btn-3d btn-3d-green inline-flex h-10 items-center justify-center px-4 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSavingLeaveSelections ? "Saving..." : "Save Selected & Leave"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showExpireModal && roomDetail ? (
        <div className="fixed inset-0 z-[96] flex items-center justify-center bg-black/35 px-4">
          <div className="w-full max-w-lg rounded-[1.5rem] border-2 border-[#1F2937] bg-white p-5 shadow-[0_8px_0_#1F2937,0_18px_26px_rgba(31,41,55,0.16)]">
            <p className="text-xl font-extrabold text-[#1F2937]">Room time is over</p>
            {roomDetail.can_extend ? (
              <>
                <p className="mt-2 text-sm font-semibold text-[#1F2937]/72">
                  Your study room has reached its scheduled end time.
                </p>
                {showExtendInput ? (
                  <div className="mt-3 rounded-xl border border-[#1F2937]/12 bg-[#F8FCFF] p-3">
                    <label className="text-xs font-extrabold uppercase tracking-wide text-[#1F2937]/65">
                      New duration (minutes)
                    </label>
                    <input
                      type="number"
                      min={15}
                      max={720}
                      value={extendDurationInput}
                      onChange={(event) => setExtendDurationInput(event.target.value)}
                      className="mt-2 w-full rounded-xl border-2 border-[#1F2937]/15 bg-white px-3 py-2 text-sm font-semibold text-[#1F2937] outline-none focus:border-[#58CC02]"
                    />
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  {!showExtendInput ? (
                    <button
                      type="button"
                      onClick={() => {
                        void handleCloseRoom();
                      }}
                      disabled={isClosingRoom}
                      className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-4 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {isClosingRoom ? "Closing..." : "Close Room"}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      if (showExtendInput) {
                        void handleExtendRoom();
                        return;
                      }
                      setShowExtendInput(true);
                    }}
                    disabled={isExtendingRoom}
                    className="btn-3d btn-3d-green inline-flex h-10 items-center justify-center px-4 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isExtendingRoom ? "Extending..." : showExtendInput ? "Confirm Extension" : "Continue Room"}
                  </button>
                </div>
              </>
            ) : (
              <p className="mt-2 text-sm font-semibold text-[#1F2937]/72">
                This room has expired and is waiting for the creator’s action. You can review messages, but sending is disabled.
              </p>
            )}
          </div>
        </div>
      ) : null}

      {isInviteModalOpen && roomDetail ? (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/35 px-4">
          <div className="w-full max-w-2xl rounded-[1.5rem] border-2 border-[#1F2937] bg-white p-5 shadow-[0_8px_0_#1F2937,0_18px_26px_rgba(31,41,55,0.16)]">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xl font-extrabold text-[#1F2937]">Invite Friends</p>
                <p className="text-sm font-semibold text-[#1F2937]/70">
                  Select friends to invite into {roomDetail.name}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsInviteModalOpen(false)}
                className="rounded-full border border-[#1F2937]/20 bg-white px-3 py-1 text-xs font-extrabold text-[#1F2937]"
              >
                Close
              </button>
            </div>

            <div className="mt-4 max-h-72 overflow-y-auto rounded-xl border border-[#1F2937]/12 bg-[#F8FCFF] p-3">
              {isLoadingInviteFriends ? (
                <p className="text-sm font-semibold text-[#1F2937]/70">Loading friends...</p>
              ) : inviteFriends.length === 0 ? (
                <p className="text-sm font-semibold text-[#1F2937]/70">No eligible friends found.</p>
              ) : (
                <div className="space-y-2">
                  {inviteFriends.map((friend) => (
                    <label
                      key={friend.user_id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-[#1F2937]/12 bg-white px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-extrabold text-[#1F2937]">{friend.username}</p>
                        <p className="text-[11px] font-semibold text-[#1F2937]/60">
                          {friend.current_learning_field_title ?? "No active field"}
                        </p>
                      </div>
                      <input
                        type="checkbox"
                        checked={selectedInviteFriendIds.includes(friend.user_id)}
                        onChange={(event) => {
                          setSelectedInviteFriendIds((previous) => {
                            if (event.target.checked) {
                              return Array.from(new Set([...previous, friend.user_id]));
                            }
                            return previous.filter((id) => id !== friend.user_id);
                          });
                        }}
                        className="h-4 w-4 accent-[#58CC02]"
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsInviteModalOpen(false)}
                className="btn-3d btn-3d-white inline-flex h-10 items-center justify-center px-4 !text-sm"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleSendInvites();
                }}
                disabled={isSendingInvites || selectedInviteFriendIds.length === 0}
                className="btn-3d btn-3d-green inline-flex h-10 items-center justify-center px-4 !text-sm disabled:cursor-not-allowed disabled:opacity-70"
              >
                {isSendingInvites ? "Sending..." : "Send Invitations"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

