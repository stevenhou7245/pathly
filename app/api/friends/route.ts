import { NextResponse } from "next/server";
import { resolveAuthenticatedSessionUserWithStatus } from "@/lib/sessionAuth";
import {
  getCurrentLearningFieldTitleByUserIds,
  getFriendshipsForUser,
  getFriendUserIdFromFriendship,
  getUsersBasicWithProfiles,
} from "@/lib/friends";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type FriendsListResponse = {
  success: boolean;
  message?: string;
  current_user_id?: string;
  friends?: Array<{
    friendship_id: string;
    user_id: string;
    username: string;
    avatar_url: string | null;
    avatar_path: string | null;
    avatar_updated_at: string | null;
    current_learning_field_title: string | null;
    is_online: boolean;
    last_seen_at: string | null;
    friendship_status: string;
  }>;
};

type FriendsEnrichedUser = {
  id: string;
  username: string;
  avatar_url: string | null;
  avatar_path: string | null;
  avatar_updated_at: string | null;
  bio: string | null;
  age: number | null;
  motto: string | null;
  is_online: boolean;
  last_seen_at: string | null;
};

function createTraceId() {
  return `friends-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function loadUsersBasicFallback(userIds: string[]) {
  const map = new Map<string, FriendsEnrichedUser>();
  if (userIds.length === 0) {
    return map;
  }

  const { data, error } = await supabaseAdmin
    .from("users")
    .select("id, username, avatar_url, avatar_path, avatar_updated_at")
    .in("id", userIds);

  if (error) {
    throw new Error("Failed to load users for friends list.");
  }

  (data ?? []).forEach((row) => {
    const typedRow = row as {
      id?: unknown;
      username?: unknown;
      avatar_url?: unknown;
      avatar_path?: unknown;
      avatar_updated_at?: unknown;
    };
    const id = typeof typedRow.id === "string" ? typedRow.id : "";
    const username = typeof typedRow.username === "string" ? typedRow.username : "";
    if (!id || !username) {
      return;
    }
    map.set(id, {
      id,
      username,
      avatar_url: typeof typedRow.avatar_url === "string" ? typedRow.avatar_url : null,
      avatar_path: typeof typedRow.avatar_path === "string" ? typedRow.avatar_path : null,
      avatar_updated_at:
        typeof typedRow.avatar_updated_at === "string" ? typedRow.avatar_updated_at : null,
      bio: null,
      age: null,
      motto: null,
      is_online: false,
      last_seen_at: null,
    });
  });

  return map;
}

export async function GET() {
  const traceId = createTraceId();
  const startedAt = Date.now();
  let step = "request_start";

  console.info(`[api/friends][${traceId}] request:start`);
  try {
    step = "auth_resolve";
    const authResolution = await resolveAuthenticatedSessionUserWithStatus();
    console.info(`[api/friends][${traceId}] auth:resolved`, {
      authenticated: authResolution.authenticated,
      status: authResolution.status,
      token_present: authResolution.token_present,
    });

    if (!authResolution.authenticated) {
      if (authResolution.status === "user_not_found") {
        const payload: FriendsListResponse = {
          success: false,
          message: "Authenticated user not found in public.users.",
        };
        return NextResponse.json(payload, { status: 404 });
      }

      if (
        authResolution.status === "session_lookup_failed" ||
        authResolution.status === "user_lookup_failed"
      ) {
        const payload: FriendsListResponse = {
          success: false,
          message: "Unable to validate session right now.",
        };
        return NextResponse.json(payload, { status: 500 });
      }

      const payload: FriendsListResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }
    const sessionUser = authResolution.user;

    step = "friendships_query";
    const friendships = await getFriendshipsForUser(sessionUser.id);
    const acceptedFriendships = friendships.filter((row) => row.status === "accepted");
    console.info(`[api/friends][${traceId}] friendships:loaded`, {
      user_id: sessionUser.id,
      total_friendships: friendships.length,
      accepted_friendships: acceptedFriendships.length,
    });

    const friendUserIds = Array.from(
      new Set(
        acceptedFriendships.map((friendship) =>
          getFriendUserIdFromFriendship({
            friendship,
            currentUserId: sessionUser.id,
          }),
        ),
      ),
    );
    console.info(`[api/friends][${traceId}] friend_ids:resolved`, {
      user_id: sessionUser.id,
      friend_user_count: friendUserIds.length,
    });

    if (acceptedFriendships.length === 0 || friendUserIds.length === 0) {
      const payload: FriendsListResponse = {
        success: true,
        current_user_id: sessionUser.id,
        friends: [],
      };
      console.info(`[api/friends][${traceId}] response:empty`, {
        user_id: sessionUser.id,
        duration_ms: Date.now() - startedAt,
      });
      return NextResponse.json(payload, {
        headers: {
          "Cache-Control": "no-store",
        },
      });
    }

    let usersMap = new Map<string, FriendsEnrichedUser>();
    step = "friends_profiles_query";
    try {
      usersMap = await getUsersBasicWithProfiles(friendUserIds);
      console.info(`[api/friends][${traceId}] friends_profiles:loaded`, {
        friend_user_count: friendUserIds.length,
        enriched_user_count: usersMap.size,
        source: "profiles",
      });
    } catch (error) {
      console.warn(`[api/friends][${traceId}] friends_profiles:failed_using_fallback`, {
        reason: toErrorMessage(error),
      });
      step = "friends_profiles_fallback_query";
      usersMap = await loadUsersBasicFallback(friendUserIds);
      console.info(`[api/friends][${traceId}] friends_profiles:fallback_loaded`, {
        friend_user_count: friendUserIds.length,
        enriched_user_count: usersMap.size,
        source: "users_only",
      });
    }

    let learningFieldTitleMap = new Map<string, string | null>();
    step = "friends_learning_field_query";
    try {
      learningFieldTitleMap = await getCurrentLearningFieldTitleByUserIds(friendUserIds);
      console.info(`[api/friends][${traceId}] friends_learning_field:loaded`, {
        entries: learningFieldTitleMap.size,
      });
    } catch (error) {
      console.warn(`[api/friends][${traceId}] friends_learning_field:failed_optional`, {
        reason: toErrorMessage(error),
      });
      learningFieldTitleMap = new Map<string, string | null>();
    }

    step = "response_mapping";
    const mappedFriends = acceptedFriendships
      .map((friendship) => {
        const friendUserId = getFriendUserIdFromFriendship({
          friendship,
          currentUserId: sessionUser.id,
        });
        const user = usersMap.get(friendUserId);
        if (!user) {
          return null;
        }
        return {
          friendship_id: friendship.id,
          user_id: user.id,
          username: user.username,
          avatar_url: user.avatar_url,
          avatar_path: user.avatar_path,
          avatar_updated_at: user.avatar_updated_at,
          current_learning_field_title: learningFieldTitleMap.get(user.id) ?? null,
          is_online: user.is_online,
          last_seen_at: user.last_seen_at,
          friendship_status: friendship.status,
        };
      })
      .filter(Boolean) as FriendsListResponse["friends"];
    const friends = mappedFriends ?? [];

    const payload: FriendsListResponse = {
      success: true,
      current_user_id: sessionUser.id,
      friends,
    };
    console.info(`[api/friends][${traceId}] response:success`, {
      user_id: sessionUser.id,
      friend_user_ids: friendUserIds.length,
      response_friends: friends.length,
      avatar_url_count: friends.filter((friend) => Boolean(friend.avatar_url)).length,
      duration_ms: Date.now() - startedAt,
    });
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error(`[api/friends][${traceId}] failed`, {
      step,
      reason: toErrorMessage(error),
      duration_ms: Date.now() - startedAt,
    });
    const payload: FriendsListResponse = {
      success: false,
      message: "Unable to load friends right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
