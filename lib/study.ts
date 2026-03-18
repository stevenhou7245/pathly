import { getFriendshipBetweenUsers } from "@/lib/friends";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type GenericRecord = Record<string, unknown>;

export type StudyInvitationStatus = "pending" | "accepted" | "declined";
export type StudySessionStatus = "active" | "ended";

function toStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function getRelatedObject(value: unknown): GenericRecord | null {
  if (!value) {
    return null;
  }
  if (Array.isArray(value)) {
    const first = value[0];
    return first && typeof first === "object" ? (first as GenericRecord) : null;
  }
  if (typeof value === "object") {
    return value as GenericRecord;
  }
  return null;
}

export async function isUserOnline(userId: string) {
  const withPresence = await supabaseAdmin
    .from("user_profiles")
    .select("is_online")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle<{ is_online: boolean | null }>();

  if (withPresence.error) {
    if (/is_online/i.test(withPresence.error.message)) {
      return false;
    }
    throw new Error("Failed to load user presence.");
  }

  return Boolean(withPresence.data?.is_online);
}

export async function createStudyInvitation(params: {
  senderId: string;
  receiverId: string;
  learningFieldId?: string | null;
}) {
  const friendship = await getFriendshipBetweenUsers(params.senderId, params.receiverId);
  if (!friendship || friendship.status !== "accepted") {
    return {
      ok: false as const,
      code: "NOT_FRIENDS" as const,
    };
  }

  const receiverOnline = await isUserOnline(params.receiverId);
  if (!receiverOnline) {
    return {
      ok: false as const,
      code: "RECEIVER_OFFLINE" as const,
    };
  }

  const { data: existingPending, error: existingPendingError } = await supabaseAdmin
    .from("study_invitations")
    .select("id")
    .eq("sender_id", params.senderId)
    .eq("receiver_id", params.receiverId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (existingPendingError) {
    throw new Error("Failed to validate existing invitation.");
  }

  if (existingPending) {
    return {
      ok: true as const,
      invitation_id: existingPending.id,
      already_pending: true,
    };
  }

  const payload: Record<string, unknown> = {
    sender_id: params.senderId,
    receiver_id: params.receiverId,
    status: "pending",
  };

  if (params.learningFieldId) {
    payload.learning_field_id = params.learningFieldId;
  }

  const { data, error } = await supabaseAdmin
    .from("study_invitations")
    .insert(payload)
    .select("id")
    .limit(1)
    .maybeSingle<{ id: string }>();

  if (error || !data) {
    throw new Error("Failed to create study invitation.");
  }

  return {
    ok: true as const,
    invitation_id: data.id,
    already_pending: false,
  };
}

export async function getPendingStudyInvitationsForUser(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("study_invitations")
    .select(
      "id, sender_id, receiver_id, learning_field_id, status, created_at, responded_at, users!study_invitations_sender_id_fkey(id, username), learning_fields(id, title, name)",
    )
    .eq("receiver_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("Failed to load study invitations.");
  }

  return ((data ?? []) as GenericRecord[]).map((row) => {
    const sender = getRelatedObject(row.users);
    const field = getRelatedObject(row.learning_fields);
    const fieldTitle = toStringValue(field?.title) || toStringValue(field?.name) || null;

    return {
      id: toStringValue(row.id),
      sender_id: toStringValue(row.sender_id),
      receiver_id: toStringValue(row.receiver_id),
      learning_field_id: toNullableString(row.learning_field_id),
      status: (toStringValue(row.status) || "pending") as StudyInvitationStatus,
      created_at: toNullableString(row.created_at),
      responded_at: toNullableString(row.responded_at),
      sender: {
        id: toStringValue(sender?.id),
        username: toStringValue(sender?.username) || "Unknown",
      },
      learning_field_title: fieldTitle,
    };
  });
}

export async function getActiveStudySessionsForUser(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("study_sessions")
    .select(
      "id, invitation_id, user_a_id, user_b_id, learning_field_id, status, created_at, ended_at, learning_fields(id, title, name)",
    )
    .or(`user_a_id.eq.${userId},user_b_id.eq.${userId}`)
    .eq("status", "active")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("Failed to load study sessions.");
  }

  return ((data ?? []) as GenericRecord[]).map((row) => {
    const field = getRelatedObject(row.learning_fields);
    const fieldTitle = toStringValue(field?.title) || toStringValue(field?.name) || null;

    return {
      id: toStringValue(row.id),
      invitation_id: toNullableString(row.invitation_id),
      user_a_id: toStringValue(row.user_a_id),
      user_b_id: toStringValue(row.user_b_id),
      learning_field_id: toNullableString(row.learning_field_id),
      learning_field_title: fieldTitle,
      status: (toStringValue(row.status) || "active") as StudySessionStatus,
      created_at: toNullableString(row.created_at),
      ended_at: toNullableString(row.ended_at),
    };
  });
}

export async function respondToStudyInvitation(params: {
  userId: string;
  invitationId: string;
  action: "accepted" | "declined";
}) {
  const { data: invitation, error: invitationError } = await supabaseAdmin
    .from("study_invitations")
    .select("*")
    .eq("id", params.invitationId)
    .limit(1)
    .maybeSingle();

  if (invitationError) {
    throw new Error("Failed to load study invitation.");
  }

  if (!invitation) {
    return {
      ok: false as const,
      code: "NOT_FOUND" as const,
    };
  }

  const receiverId = toStringValue(invitation.receiver_id);
  const senderId = toStringValue(invitation.sender_id);
  const status = toStringValue(invitation.status);
  const learningFieldId = toNullableString(invitation.learning_field_id);

  if (receiverId !== params.userId) {
    return {
      ok: false as const,
      code: "FORBIDDEN" as const,
    };
  }

  if (status !== "pending") {
    return {
      ok: false as const,
      code: "ALREADY_RESPONDED" as const,
    };
  }

  const nowIso = new Date().toISOString();
  const { error: updateError } = await supabaseAdmin
    .from("study_invitations")
    .update({
      status: params.action,
      responded_at: nowIso,
    })
    .eq("id", params.invitationId);

  if (updateError) {
    throw new Error("Failed to update study invitation.");
  }

  if (params.action === "declined") {
    return {
      ok: true as const,
      invitation_id: params.invitationId,
      status: "declined" as const,
      session: null,
    };
  }

  const { data: existingSession, error: existingSessionError } = await supabaseAdmin
    .from("study_sessions")
    .select("*")
    .eq("invitation_id", params.invitationId)
    .limit(1)
    .maybeSingle();

  if (existingSessionError) {
    throw new Error("Failed to validate study session.");
  }

  if (existingSession) {
    return {
      ok: true as const,
      invitation_id: params.invitationId,
      status: "accepted" as const,
      session: {
        id: toStringValue(existingSession.id),
        invitation_id: toNullableString(existingSession.invitation_id),
        user_a_id: toStringValue(existingSession.user_a_id),
        user_b_id: toStringValue(existingSession.user_b_id),
        learning_field_id: toNullableString(existingSession.learning_field_id),
        status: toStringValue(existingSession.status) || "active",
        created_at: toNullableString(existingSession.created_at),
        ended_at: toNullableString(existingSession.ended_at),
      },
    };
  }

  const payload: Record<string, unknown> = {
    invitation_id: params.invitationId,
    user_a_id: senderId,
    user_b_id: receiverId,
    status: "active",
  };

  if (learningFieldId) {
    payload.learning_field_id = learningFieldId;
  }

  const { data: createdSession, error: createdSessionError } = await supabaseAdmin
    .from("study_sessions")
    .insert(payload)
    .select("*")
    .limit(1)
    .maybeSingle();

  if (createdSessionError || !createdSession) {
    throw new Error("Failed to create study session.");
  }

  return {
    ok: true as const,
    invitation_id: params.invitationId,
    status: "accepted" as const,
      session: {
        id: toStringValue(createdSession.id),
        invitation_id: toNullableString(createdSession.invitation_id),
        user_a_id: toStringValue(createdSession.user_a_id),
        user_b_id: toStringValue(createdSession.user_b_id),
        learning_field_id: toNullableString(createdSession.learning_field_id),
        status: toStringValue(createdSession.status) || "active",
        created_at: toNullableString(createdSession.created_at),
        ended_at: toNullableString(createdSession.ended_at),
      },
    };
  }

export async function getStudySessionForUser(params: {
  userId: string;
  sessionId: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("study_sessions")
    .select(
      "id, invitation_id, user_a_id, user_b_id, learning_field_id, status, created_at, ended_at",
    )
    .eq("id", params.sessionId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load study session.");
  }

  if (!data) {
    return null;
  }

  const userAId = toStringValue(data.user_a_id);
  const userBId = toStringValue(data.user_b_id);
  if (params.userId !== userAId && params.userId !== userBId) {
    return {
      forbidden: true as const,
    };
  }

  return {
    forbidden: false as const,
    session: {
      id: toStringValue(data.id),
      invitation_id: toNullableString(data.invitation_id),
      user_a_id: userAId,
      user_b_id: userBId,
      learning_field_id: toNullableString(data.learning_field_id),
      status: (toStringValue(data.status) || "active") as StudySessionStatus,
      created_at: toNullableString(data.created_at),
      ended_at: toNullableString(data.ended_at),
    },
  };
}

export async function getStudySessionMessages(params: {
  sessionId: string;
  limit?: number;
}) {
  const safeLimit =
    typeof params.limit === "number" && Number.isFinite(params.limit)
      ? Math.max(1, Math.min(100, Math.trunc(params.limit)))
      : 100;

  const { data, error } = await supabaseAdmin
    .from("study_session_messages")
    .select("id, session_id, sender_id, body, created_at")
    .eq("session_id", params.sessionId)
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error("Failed to load study session messages.");
  }

  return ((data ?? []) as GenericRecord[])
    .map((row) => ({
      id: toStringValue(row.id),
      session_id: toStringValue(row.session_id),
      sender_id: toStringValue(row.sender_id),
      body: toStringValue(row.body),
      created_at: toNullableString(row.created_at),
    }))
    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
}

export async function createStudySessionMessage(params: {
  sessionId: string;
  senderId: string;
  body: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("study_session_messages")
    .insert({
      session_id: params.sessionId,
      sender_id: params.senderId,
      body: params.body,
    })
    .select("id, session_id, sender_id, body, created_at")
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    throw new Error("Failed to send study session message.");
  }

  return {
    id: toStringValue(data.id),
    session_id: toStringValue(data.session_id),
    sender_id: toStringValue(data.sender_id),
    body: toStringValue(data.body),
    created_at: toNullableString(data.created_at),
  };
}

export async function getPendingStudyInvitationsCount(userId: string) {
  const { count, error } = await supabaseAdmin
    .from("study_invitations")
    .select("id", { count: "exact", head: true })
    .eq("receiver_id", userId)
    .eq("status", "pending");

  if (error) {
    throw new Error("Failed to load study invitation count.");
  }

  return count ?? 0;
}
