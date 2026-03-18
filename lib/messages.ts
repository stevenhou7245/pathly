import {
  getFriendshipsForUser,
  getFriendUserIdFromFriendship,
  getUsersBasicWithProfiles,
  type FriendshipRow,
} from "@/lib/friends";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type GenericRecord = Record<string, unknown>;

export type DirectMessageRow = {
  id: string;
  friendship_id: string;
  sender_id: string;
  body: string;
  is_read: boolean;
  created_at: string | null;
};

export type FriendshipAccessResult =
  | {
      ok: true;
      friendship: FriendshipRow;
    }
  | {
      ok: false;
      code: "not_found" | "forbidden" | "not_accepted";
    };

export type ConversationSummary = {
  friendship_id: string;
  other_user: {
    id: string;
    username: string;
    avatar_url: string | null;
  };
  latest_message: {
    id: string;
    sender_id: string;
    body: string;
    created_at: string | null;
    is_read: boolean;
  } | null;
  unread_count: number;
};

function toStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function toBoolean(value: unknown) {
  return typeof value === "boolean" ? value : false;
}

function normalizeMessageRow(row: GenericRecord): DirectMessageRow {
  return {
    id: toStringValue(row.id),
    friendship_id: toStringValue(row.friendship_id),
    sender_id: toStringValue(row.sender_id),
    body: toStringValue(row.body),
    is_read: toBoolean(row.is_read),
    created_at: toNullableString(row.created_at),
  };
}

export async function getFriendshipById(friendshipId: string): Promise<FriendshipRow | null> {
  const { data, error } = await supabaseAdmin
    .from("friendships")
    .select("*")
    .eq("id", friendshipId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load friendship.");
  }

  if (!data) {
    return null;
  }

  return {
    id: toStringValue(data.id),
    requester_id: toStringValue(data.requester_id),
    addressee_id: toStringValue(data.addressee_id),
    status: (toStringValue(data.status) || "pending") as FriendshipRow["status"],
    created_at: toNullableString(data.created_at),
  };
}

export async function getAcceptedFriendshipForUser(params: {
  friendshipId: string;
  userId: string;
}): Promise<FriendshipAccessResult> {
  const friendship = await getFriendshipById(params.friendshipId);
  if (!friendship) {
    return {
      ok: false,
      code: "not_found",
    };
  }

  const isParticipant =
    friendship.requester_id === params.userId || friendship.addressee_id === params.userId;

  if (!isParticipant) {
    return {
      ok: false,
      code: "forbidden",
    };
  }

  if (friendship.status !== "accepted") {
    return {
      ok: false,
      code: "not_accepted",
    };
  }

  return {
    ok: true,
    friendship,
  };
}

export async function getMessagesForFriendship(friendshipId: string): Promise<DirectMessageRow[]> {
  return getMessagesForFriendshipWithLimit(friendshipId, 50);
}

function clampMessageLimit(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 50;
  }

  const parsed = Math.trunc(value);
  if (parsed <= 0) {
    return 1;
  }

  return Math.min(50, parsed);
}

export async function getMessagesForFriendshipWithLimit(
  friendshipId: string,
  limit?: number,
): Promise<DirectMessageRow[]> {
  const safeLimit = clampMessageLimit(limit);

  const { data, error } = await supabaseAdmin
    .from("direct_messages")
    .select("id, friendship_id, sender_id, body, is_read, created_at")
    .eq("friendship_id", friendshipId)
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error("Failed to load direct messages.");
  }

  return (data ?? [])
    .map((row) => normalizeMessageRow((row ?? {}) as GenericRecord))
    .filter((row) => row.id && row.friendship_id && row.sender_id)
    .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""));
}

export async function createDirectMessage(params: {
  friendshipId: string;
  senderId: string;
  body: string;
}): Promise<DirectMessageRow> {
  const { data, error } = await supabaseAdmin
    .from("direct_messages")
    .insert({
      friendship_id: params.friendshipId,
      sender_id: params.senderId,
      body: params.body,
      is_read: false,
    })
    .select("id, friendship_id, sender_id, body, is_read, created_at")
    .limit(1)
    .maybeSingle();

  if (error || !data) {
    throw new Error("Failed to send direct message.");
  }

  return normalizeMessageRow((data ?? {}) as GenericRecord);
}

export async function markIncomingMessagesAsRead(params: {
  friendshipId: string;
  currentUserId: string;
}): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("direct_messages")
    .update({
      is_read: true,
    })
    .eq("friendship_id", params.friendshipId)
    .neq("sender_id", params.currentUserId)
    .eq("is_read", false)
    .select("id");

  if (error) {
    throw new Error("Failed to mark messages as read.");
  }

  return (data ?? []).length;
}

export async function getConversationSummariesForUser(
  currentUserId: string,
): Promise<ConversationSummary[]> {
  const friendships = await getFriendshipsForUser(currentUserId);
  const acceptedFriendships = friendships.filter((row) => row.status === "accepted");

  if (acceptedFriendships.length === 0) {
    return [];
  }

  const friendshipIds = acceptedFriendships.map((friendship) => friendship.id);
  const otherUserIds = Array.from(
    new Set(
      acceptedFriendships.map((friendship) =>
        getFriendUserIdFromFriendship({
          friendship,
          currentUserId,
        }),
      ),
    ),
  );

  const [otherUsersMap, messagesResult] = await Promise.all([
    getUsersBasicWithProfiles(otherUserIds),
    supabaseAdmin
      .from("direct_messages")
      .select("id, friendship_id, sender_id, body, is_read, created_at")
      .in("friendship_id", friendshipIds)
      .order("created_at", { ascending: false }),
  ]);

  if (messagesResult.error) {
    throw new Error("Failed to load conversation messages.");
  }

  const messagesByFriendship = new Map<
    string,
    {
      latest: DirectMessageRow | null;
      unreadCount: number;
    }
  >();

  acceptedFriendships.forEach((friendship) => {
    messagesByFriendship.set(friendship.id, {
      latest: null,
      unreadCount: 0,
    });
  });

  (messagesResult.data ?? []).forEach((row) => {
    const message = normalizeMessageRow((row ?? {}) as GenericRecord);
    if (!message.friendship_id) {
      return;
    }

    const existing = messagesByFriendship.get(message.friendship_id);
    if (!existing) {
      return;
    }

    if (!existing.latest) {
      existing.latest = message;
    }

    if (!message.is_read && message.sender_id !== currentUserId) {
      existing.unreadCount += 1;
    }
  });

  const summaries = acceptedFriendships
    .map((friendship) => {
      const otherUserId = getFriendUserIdFromFriendship({
        friendship,
        currentUserId,
      });
      const otherUser = otherUsersMap.get(otherUserId);
      if (!otherUser) {
        return null;
      }

      const messageState = messagesByFriendship.get(friendship.id) ?? {
        latest: null,
        unreadCount: 0,
      };

      return {
        friendship_id: friendship.id,
        other_user: {
          id: otherUser.id,
          username: otherUser.username,
          avatar_url: otherUser.avatar_url,
        },
        latest_message: messageState.latest
          ? {
              id: messageState.latest.id,
              sender_id: messageState.latest.sender_id,
              body: messageState.latest.body,
              created_at: messageState.latest.created_at,
              is_read: messageState.latest.is_read,
            }
          : null,
        unread_count: messageState.unreadCount,
      };
    })
    .filter(Boolean) as ConversationSummary[];

  summaries.sort((a, b) => {
    const aTime = a.latest_message?.created_at ?? "";
    const bTime = b.latest_message?.created_at ?? "";
    return bTime.localeCompare(aTime);
  });

  return summaries;
}
