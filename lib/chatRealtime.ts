type GenericRecord = Record<string, unknown>;

function toStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function toBoolean(value: unknown) {
  return typeof value === "boolean" ? value : false;
}

export type StudyRoomRealtimeMessage = {
  id: string;
  room_id: string;
  sender_id: string;
  body: string;
  created_at: string | null;
  type: string;
};

export type DirectRealtimeMessage = {
  id: string;
  friendship_id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string | null;
  is_read: boolean;
  type: "chat";
};

export function mapStudyRoomRealtimeMessage(payload: unknown): StudyRoomRealtimeMessage {
  const row = (payload ?? {}) as GenericRecord;
  return {
    id: toStringValue(row.id),
    room_id: toStringValue(row.room_id),
    sender_id: toStringValue(row.sender_id),
    body: toStringValue(row.body),
    created_at: toNullableString(row.created_at),
    type: toStringValue(row.type) || "chat",
  };
}

export function mapDirectRealtimeMessage(payload: unknown): DirectRealtimeMessage {
  const row = (payload ?? {}) as GenericRecord;
  const friendshipId = toStringValue(row.friendship_id);
  return {
    id: toStringValue(row.id),
    friendship_id: friendshipId,
    conversation_id: friendshipId,
    sender_id: toStringValue(row.sender_id),
    body: toStringValue(row.body),
    created_at: toNullableString(row.created_at),
    is_read: toBoolean(row.is_read),
    type: "chat",
  };
}

