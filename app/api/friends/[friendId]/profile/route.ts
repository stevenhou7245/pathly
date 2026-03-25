import { NextResponse } from "next/server";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import {
  areUsersAcceptedFriends,
  getLatestLearningFieldForUser,
  getProgressSummaryForField,
  getUsersBasicWithProfiles,
} from "@/lib/friends";

export const runtime = "nodejs";

type FriendProfileResponse = {
  success: boolean;
  message?: string;
  profile?: {
    user_id: string;
    username: string;
    avatar_url: string | null;
    avatar_path: string | null;
    avatar_updated_at: string | null;
    bio: string | null;
    age: number | null;
    motto: string | null;
    is_online: boolean;
    last_seen_at: string | null;
    current_learning_field: {
      field_id: string;
      title: string | null;
      created_at: string | null;
    } | null;
    current_level: string | null;
    target_level: string | null;
    progress_summary: {
      completed_steps_count: number;
      total_steps_count: number;
      percentage_progress: number;
    } | null;
  };
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ friendId: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: FriendProfileResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    const { friendId } = await context.params;
    if (!friendId) {
      const payload: FriendProfileResponse = {
        success: false,
        message: "Friend id is required.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    if (friendId === sessionUser.id) {
      const payload: FriendProfileResponse = {
        success: false,
        message: "Use your own profile endpoint for current user data.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const isFriend = await areUsersAcceptedFriends({
      userId: sessionUser.id,
      friendId,
    });

    if (!isFriend) {
      const payload: FriendProfileResponse = {
        success: false,
        message: "Friend profile is not accessible.",
      };
      return NextResponse.json(payload, { status: 403 });
    }

    const usersMap = await getUsersBasicWithProfiles([friendId]);
    const friend = usersMap.get(friendId);
    if (!friend) {
      const payload: FriendProfileResponse = {
        success: false,
        message: "Friend not found.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const currentLearningField = await getLatestLearningFieldForUser(friendId);
    const progressSummary = currentLearningField
      ? await getProgressSummaryForField({
          userId: friendId,
          fieldId: currentLearningField.field_id,
        })
      : null;

    const payload: FriendProfileResponse = {
      success: true,
      profile: {
        user_id: friend.id,
        username: friend.username,
        avatar_url: friend.avatar_url,
        avatar_path: friend.avatar_path,
        avatar_updated_at: friend.avatar_updated_at,
        bio: friend.bio,
        age: friend.age,
        motto: friend.motto,
        is_online: friend.is_online,
        last_seen_at: friend.last_seen_at,
        current_learning_field: currentLearningField
          ? {
              field_id: currentLearningField.field_id,
              title: currentLearningField.title,
              created_at: currentLearningField.created_at,
            }
          : null,
        current_level: currentLearningField?.current_level ?? null,
        target_level: currentLearningField?.target_level ?? null,
        progress_summary: progressSummary,
      },
    };

    const profilePayload = payload.profile;
    if (process.env.NODE_ENV !== "production" && profilePayload) {
      console.info("[api/friends/profile] avatar_payload_included", {
        user_id: profilePayload.user_id,
        has_avatar_url: Boolean(profilePayload.avatar_url),
        has_avatar_path: Boolean(profilePayload.avatar_path),
        avatar_updated_at: profilePayload.avatar_updated_at,
      });
    }

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[api/friends/profile] failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    const payload: FriendProfileResponse = {
      success: false,
      message: "Unable to load friend profile right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
