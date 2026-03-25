import { supabaseAdmin } from "@/lib/supabaseAdmin";

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

function normalizeRoleToken(value: unknown) {
  const normalized = toStringValue(value).trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  return normalized.replace(/[^a-z0-9_-]/g, "");
}

function parseReadBy(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as string[];
  }
  return Array.from(
    new Set(
      value
        .map((item) => toStringValue(item).trim())
        .filter(Boolean),
    ),
  );
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

function isMissingRelationOrColumnError(error: unknown) {
  const code = toStringValue((error as GenericRecord)?.code).trim();
  return code === "42P01" || code === "42703";
}

type UserRoleContext = {
  role: string | null;
  isAdmin: boolean;
  isTeacher: boolean;
  sourceTable: string | null;
};

function resolveRoleContextFromRecord(row: GenericRecord | null, sourceTable: string): UserRoleContext | null {
  if (!row) {
    return null;
  }

  const normalizedRole =
    normalizeRoleToken(row.role) ??
    normalizeRoleToken(row.user_role) ??
    normalizeRoleToken(row.account_role);
  const isAdminFlag =
    toBoolean(row.is_admin) ||
    toBoolean(row.isAdmin) ||
    normalizedRole === "admin";
  const isTeacherFlag =
    toBoolean(row.is_teacher) ||
    toBoolean(row.isTeacher) ||
    normalizedRole === "teacher";

  return {
    role: normalizedRole,
    isAdmin: isAdminFlag,
    isTeacher: isTeacherFlag,
    sourceTable,
  };
}

async function tryLoadRoleContextFromUsers(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("users")
    .select("*")
    .eq("id", userId)
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingRelationOrColumnError(error)) {
      return null;
    }
    throw new Error(
      `Failed to load sender role context. table=users user_id=${userId} reason=${toErrorDetails(error).message}`,
    );
  }
  return resolveRoleContextFromRecord((data ?? null) as GenericRecord | null, "users");
}

async function tryLoadRoleContextFromUserProfiles(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_profiles")
    .select("*")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingRelationOrColumnError(error)) {
      return null;
    }
    throw new Error(
      `Failed to load sender role context. table=user_profiles user_id=${userId} reason=${toErrorDetails(error).message}`,
    );
  }
  return resolveRoleContextFromRecord((data ?? null) as GenericRecord | null, "user_profiles");
}

async function tryLoadRoleContextFromUserSettings(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_settings")
    .select("*")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingRelationOrColumnError(error)) {
      return null;
    }
    throw new Error(
      `Failed to load sender role context. table=user_settings user_id=${userId} reason=${toErrorDetails(error).message}`,
    );
  }
  return resolveRoleContextFromRecord((data ?? null) as GenericRecord | null, "user_settings");
}

export async function getUserRoleContextForOfficialMessages(userId: string): Promise<UserRoleContext> {
  const candidates = await Promise.all([
    tryLoadRoleContextFromUsers(userId),
    tryLoadRoleContextFromUserProfiles(userId),
    tryLoadRoleContextFromUserSettings(userId),
  ]);

  const resolved = candidates.find((item) => item !== null) ?? null;
  if (!resolved) {
    return {
      role: null,
      isAdmin: false,
      isTeacher: false,
      sourceTable: null,
    };
  }
  return resolved;
}

export type OfficialMessageForUser = {
  id: string;
  title: string;
  body: string;
  created_at: string | null;
  read: boolean;
};

export async function getOfficialMessagesForUser(userId: string): Promise<OfficialMessageForUser[]> {
  const roleContext = await getUserRoleContextForOfficialMessages(userId);
  const normalizedUserRole = roleContext.role;

  const { data, error } = await supabaseAdmin
    .from("official_messages")
    .select("id, title, body, sender_id, role_target, created_at, read_by")
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    const details = toErrorDetails(error);
    console.error("[official_messages] fetch_failed", {
      table: "official_messages",
      query: "getOfficialMessagesForUser",
      user_id: userId,
      user_role: normalizedUserRole,
      ...details,
    });
    throw new Error(
      `Failed to fetch official messages. table=official_messages query=getOfficialMessagesForUser user_id=${userId} reason=${details.message}`,
    );
  }

  const rows = (data ?? []) as GenericRecord[];
  return rows
    .filter((row) => {
      const targetRole = normalizeRoleToken(row.role_target);
      if (!targetRole) {
        return true;
      }
      return Boolean(normalizedUserRole) && targetRole === normalizedUserRole;
    })
    .map((row) => {
      const readBy = parseReadBy(row.read_by);
      return {
        id: toStringValue(row.id),
        title: toStringValue(row.title),
        body: toStringValue(row.body),
        created_at: toNullableString(row.created_at),
        read: readBy.includes(userId),
      };
    });
}

export async function getUnreadOfficialMessagesCount(userId: string) {
  const messages = await getOfficialMessagesForUser(userId);
  return messages.filter((message) => !message.read).length;
}

export async function sendOfficialMessage(params: {
  senderId: string;
  title: string;
  body: string;
  roleTarget?: string | null;
}) {
  const roleContext = await getUserRoleContextForOfficialMessages(params.senderId);
  const canSend =
    roleContext.isAdmin ||
    roleContext.isTeacher ||
    roleContext.role === "admin" ||
    roleContext.role === "teacher";

  if (!canSend) {
    console.warn("[official_messages] unauthorized_send_attempt", {
      sender_id: params.senderId,
      sender_role: roleContext.role,
      role_source_table: roleContext.sourceTable,
      requested_role_target: normalizeRoleToken(params.roleTarget) ?? null,
      title_preview: params.title.slice(0, 80),
    });
    return {
      ok: false as const,
      code: "FORBIDDEN" as const,
      sender_role: roleContext.role,
    };
  }

  const normalizedRoleTarget = normalizeRoleToken(params.roleTarget) ?? null;
  const payload: Record<string, unknown> = {
    title: params.title,
    body: params.body,
    sender_id: params.senderId,
    role_target: normalizedRoleTarget,
    read_by: [],
  };

  const { data, error } = await supabaseAdmin
    .from("official_messages")
    .insert(payload)
    .select("id, title, body, sender_id, role_target, created_at, read_by")
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    const details = toErrorDetails(error);
    console.error("[official_messages] insert_failed", {
      table: "official_messages",
      query: "sendOfficialMessage",
      sender_id: params.senderId,
      sender_role: roleContext.role,
      payload_keys: Object.keys(payload),
      ...details,
    });
    throw new Error(
      `Failed to send official message. table=official_messages sender_id=${params.senderId} reason=${details.message}`,
    );
  }

  return {
    ok: true as const,
    message: {
      id: toStringValue(data.id),
      title: toStringValue(data.title),
      body: toStringValue(data.body),
      sender_id: toStringValue((data as GenericRecord).sender_id),
      role_target: normalizeRoleToken((data as GenericRecord).role_target),
      created_at: toNullableString((data as GenericRecord).created_at),
    },
  };
}

export async function markOfficialMessageRead(params: {
  userId: string;
  messageId: string;
}) {
  const roleContext = await getUserRoleContextForOfficialMessages(params.userId);
  const normalizedUserRole = roleContext.role;

  const { data: messageRow, error: messageLookupError } = await supabaseAdmin
    .from("official_messages")
    .select("id, role_target, read_by")
    .eq("id", params.messageId)
    .limit(1)
    .maybeSingle();

  if (messageLookupError) {
    const details = toErrorDetails(messageLookupError);
    console.error("[official_messages] mark_read_lookup_failed", {
      table: "official_messages",
      query: "markOfficialMessageRead.lookup",
      message_id: params.messageId,
      user_id: params.userId,
      ...details,
    });
    throw new Error(
      `Failed to mark official message as read. table=official_messages query=lookup message_id=${params.messageId} user_id=${params.userId} reason=${details.message}`,
    );
  }

  if (!messageRow) {
    return {
      ok: false as const,
      code: "NOT_FOUND" as const,
    };
  }

  const targetRole = normalizeRoleToken((messageRow as GenericRecord).role_target);
  if (targetRole && (!normalizedUserRole || targetRole !== normalizedUserRole)) {
    console.warn("[official_messages] mark_read_forbidden", {
      message_id: params.messageId,
      user_id: params.userId,
      user_role: normalizedUserRole,
      role_target: targetRole,
    });
    return {
      ok: false as const,
      code: "FORBIDDEN" as const,
    };
  }

  const existingReadBy = parseReadBy((messageRow as GenericRecord).read_by);
  const nextReadBy = Array.from(new Set([...existingReadBy, params.userId]));

  if (existingReadBy.length === nextReadBy.length) {
    return {
      ok: true as const,
      already_read: true,
      message_id: params.messageId,
    };
  }

  const { data: updatedRow, error: updateError } = await supabaseAdmin
    .from("official_messages")
    .update({
      read_by: nextReadBy,
    })
    .eq("id", params.messageId)
    .select("id")
    .limit(1)
    .maybeSingle();

  if (updateError || !updatedRow) {
    const details = toErrorDetails(updateError);
    console.error("[official_messages] mark_read_update_failed", {
      table: "official_messages",
      query: "markOfficialMessageRead.update",
      message_id: params.messageId,
      user_id: params.userId,
      ...details,
    });
    throw new Error(
      `Failed to mark official message as read. table=official_messages query=update message_id=${params.messageId} user_id=${params.userId} reason=${details.message}`,
    );
  }

  return {
    ok: true as const,
    already_read: false,
    message_id: toStringValue((updatedRow as GenericRecord).id),
  };
}

