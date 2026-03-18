import {
  getCurrentLearningFieldTitleByUserIds,
  getFriendshipsForUser,
  getUsersBasicWithProfiles,
  respondToFriendRequest,
} from "@/lib/friends";
import { getPendingStudyInvitationsCount } from "@/lib/study";
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

function getSystemMessageFromRelation(value: unknown): GenericRecord | null {
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

export async function getIncomingPendingFriendRequestsForUser(userId: string) {
  const friendships = await getFriendshipsForUser(userId);
  const incoming = friendships.filter(
    (friendship) => friendship.status === "pending" && friendship.addressee_id === userId,
  );

  const requesterIds = Array.from(new Set(incoming.map((friendship) => friendship.requester_id)));
  const [usersMap, learningFieldTitleMap] = await Promise.all([
    getUsersBasicWithProfiles(requesterIds),
    getCurrentLearningFieldTitleByUserIds(requesterIds),
  ]);

  return incoming
    .map((friendship) => {
      const sender = usersMap.get(friendship.requester_id);
      if (!sender) {
        return null;
      }
      return {
        friendship_id: friendship.id,
        sender: {
          id: sender.id,
          username: sender.username,
          avatar_url: sender.avatar_url,
          current_learning_field_title: learningFieldTitleMap.get(sender.id) ?? null,
        },
        status: friendship.status,
        created_at: friendship.created_at,
      };
    })
    .filter(Boolean)
    .sort((a, b) => (b?.created_at ?? "").localeCompare(a?.created_at ?? "")) as Array<{
    friendship_id: string;
    sender: {
      id: string;
      username: string;
      avatar_url: string | null;
      current_learning_field_title: string | null;
    };
    status: string;
    created_at: string | null;
  }>;
}

export async function respondToIncomingFriendRequest(params: {
  userId: string;
  friendshipId: string;
  action: "accepted" | "declined";
}) {
  const { data: friendship, error: friendshipError } = await supabaseAdmin
    .from("friendships")
    .select("*")
    .eq("id", params.friendshipId)
    .limit(1)
    .maybeSingle();

  if (friendshipError) {
    throw new Error("Failed to validate friend request.");
  }

  if (!friendship) {
    return {
      ok: false as const,
      code: "NOT_FOUND" as const,
    };
  }

  const addresseeId = toStringValue(friendship.addressee_id);
  const status = toStringValue(friendship.status);

  if (addresseeId !== params.userId) {
    return {
      ok: false as const,
      code: "FORBIDDEN" as const,
    };
  }

  if (status !== "pending") {
    return {
      ok: false as const,
      code: "ALREADY_HANDLED" as const,
    };
  }

  const updated = await respondToFriendRequest({
    friendshipId: params.friendshipId,
    action: params.action,
  });

  if (!updated) {
    return {
      ok: false as const,
      code: "NOT_FOUND" as const,
    };
  }

  return {
    ok: true as const,
    friendship: updated,
  };
}

export async function getSystemMessagesForUser(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("user_system_messages")
    .select(
      "id, user_id, system_message_id, is_read, created_at, read_at, system_messages(id, title, body, created_at)",
    )
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error("Failed to load system messages.");
  }

  return ((data ?? []) as GenericRecord[]).map((row) => {
    const systemMessage = getSystemMessageFromRelation(row.system_messages);

    return {
      user_message_id: toStringValue(row.id),
      system_message_id: toStringValue(row.system_message_id),
      title: toStringValue(systemMessage?.title) || "Update from Pathly",
      body: toStringValue(systemMessage?.body) || "",
      created_at: toNullableString(systemMessage?.created_at) ?? toNullableString(row.created_at),
      is_read: toBoolean(row.is_read),
    };
  });
}

export async function markSystemMessageReadForUser(params: {
  userId: string;
  userMessageId: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("user_system_messages")
    .update({
      is_read: true,
      read_at: new Date().toISOString(),
    })
    .eq("id", params.userMessageId)
    .eq("user_id", params.userId)
    .select("id")
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to mark system message as read.");
  }

  return data ? { id: toStringValue(data.id) } : null;
}

export async function getInboxUnreadSummary(userId: string) {
  const [friendRequestsResult, systemMessagesResult, pendingStudyInvitationsCount] =
    await Promise.all([
    supabaseAdmin
      .from("friendships")
      .select("id", { count: "exact", head: true })
      .eq("addressee_id", userId)
      .eq("status", "pending"),
    supabaseAdmin
      .from("user_system_messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("is_read", false),
    getPendingStudyInvitationsCount(userId),
    ]);

  if (friendRequestsResult.error || systemMessagesResult.error) {
    throw new Error("Failed to load unread inbox summary.");
  }

  const pendingFriendRequestsCount = friendRequestsResult.count ?? 0;
  const unreadSystemMessagesCount = systemMessagesResult.count ?? 0;

  return {
    pending_friend_requests: pendingFriendRequestsCount,
    unread_system_messages: unreadSystemMessagesCount,
    pending_study_invitations: pendingStudyInvitationsCount,
    total_unread:
      pendingFriendRequestsCount + unreadSystemMessagesCount + pendingStudyInvitationsCount,
  };
}

