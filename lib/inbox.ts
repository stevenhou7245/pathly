import {
  getCurrentLearningFieldTitleByUserIds,
  getFriendshipsForUser,
  getUsersBasicWithProfiles,
  respondToFriendRequest,
} from "@/lib/friends";
import {
  getOfficialMessagesForUser,
  getUnreadOfficialMessagesCount,
  markOfficialMessageRead,
} from "@/lib/officialMessages";
import { getPendingStudyRoomInvitationsCount } from "@/lib/studyRoom";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type GenericRecord = Record<string, unknown>;

function toStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
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
  const officialMessages = await getOfficialMessagesForUser(userId);
  return officialMessages.map((message) => ({
    user_message_id: message.id,
    system_message_id: message.id,
    title: message.title || "Update from Pathly",
    body: message.body || "",
    created_at: message.created_at,
    is_read: message.read,
  }));
}

export async function markSystemMessageReadForUser(params: {
  userId: string;
  userMessageId: string;
}) {
  const result = await markOfficialMessageRead({
    userId: params.userId,
    messageId: params.userMessageId,
  });
  if (!result.ok) {
    if (result.code === "FORBIDDEN") {
      console.warn("[official_messages] mark_read_forbidden_in_legacy_route", {
        user_id: params.userId,
        message_id: params.userMessageId,
      });
    }
    return null;
  }
  return {
    id: result.message_id,
  };
}

export async function getInboxUnreadSummary(userId: string) {
  const [friendships, unreadSystemMessagesCount, pendingStudyInvitations] = await Promise.all([
    getFriendshipsForUser(userId),
    getUnreadOfficialMessagesCount(userId),
    getPendingStudyRoomInvitationsCount(userId),
  ]);

  const pendingFriendRequestsCount = friendships.filter(
    (row) => row.status === "pending" && row.addressee_id === userId,
  ).length;
  const acceptedFriendshipIds = friendships
    .filter((row) => row.status === "accepted")
    .map((row) => row.id)
    .filter(Boolean);

  let unreadFriendMessagesCount = 0;
  if (acceptedFriendshipIds.length > 0) {
    const unreadMessagesResult = await supabaseAdmin
      .from("direct_messages")
      .select("id", { count: "exact", head: true })
      .in("friendship_id", acceptedFriendshipIds)
      .neq("sender_id", userId)
      .eq("is_read", false);
    if (unreadMessagesResult.error) {
      console.error("[inbox_summary] unread_friend_messages_count_failed", {
        table: "direct_messages",
        user_id: userId,
        accepted_friendship_count: acceptedFriendshipIds.length,
        ...toErrorDetails(unreadMessagesResult.error),
      });
      throw new Error(`Failed to load unread inbox summary. user_id=${userId}`);
    }
    unreadFriendMessagesCount = unreadMessagesResult.count ?? 0;
  }

  return {
    user_id: userId,
    accepted_friendship_ids: acceptedFriendshipIds,
    unread_friend_messages: unreadFriendMessagesCount,
    pending_friend_requests: pendingFriendRequestsCount,
    unread_system_messages: unreadSystemMessagesCount,
    pending_study_invitations: pendingStudyInvitations,
    total_unread: pendingFriendRequestsCount + unreadSystemMessagesCount + pendingStudyInvitations,
  };
}

