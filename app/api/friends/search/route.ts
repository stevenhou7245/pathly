import { NextResponse } from "next/server";
import {
  getCurrentLearningFieldTitleByUserIds,
  getFriendshipBetweenUsers,
  getUsersBasicWithProfiles,
} from "@/lib/friends";
import { usernameSchema } from "@/lib/authValidation";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type FriendSearchResponse = {
  success: boolean;
  message?: string;
  user?: {
    id: string;
    username: string;
    avatar_url: string | null;
    age: number | null;
    motto: string | null;
    bio: string | null;
    current_learning_field_title: string | null;
    existing_friendship_status: string | null;
  } | null;
};

type FoundUserRecord = {
  id: string;
};

type UserProfileRecord = {
  age: number | null;
  motto?: string | null;
  bio: string | null;
};

export async function GET(request: Request) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: FriendSearchResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const usernameQuery = searchParams.get("username") ?? "";
    const parsedUsername = usernameSchema.safeParse(usernameQuery);

    if (!parsedUsername.success) {
      const payload: FriendSearchResponse = {
        success: false,
        message: parsedUsername.error.issues[0]?.message ?? "Invalid username.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const targetUsername = parsedUsername.data;

    const { data: foundUser, error: foundUserError } = await supabaseAdmin
      .from("users")
      .select("id")
      .ilike("username", targetUsername)
      .neq("id", sessionUser.id)
      .limit(1)
      .maybeSingle<FoundUserRecord>();

    if (foundUserError) {
      const payload: FriendSearchResponse = {
        success: false,
        message: "Unable to search users right now.",
      };
      return NextResponse.json(payload, { status: 500 });
    }

    if (!foundUser) {
      const payload: FriendSearchResponse = {
        success: true,
        user: null,
      };
      return NextResponse.json(payload, {
        headers: {
          "Cache-Control": "no-store",
        },
      });
    }

    const [usersMap, learningFieldMap, friendship, profileResult] = await Promise.all([
      getUsersBasicWithProfiles([foundUser.id]),
      getCurrentLearningFieldTitleByUserIds([foundUser.id]),
      getFriendshipBetweenUsers(sessionUser.id, foundUser.id),
      supabaseAdmin
        .from("user_profiles")
        .select("*")
        .eq("user_id", foundUser.id)
        .limit(1)
        .maybeSingle<UserProfileRecord>(),
    ]);

    if (profileResult.error) {
      const payload: FriendSearchResponse = {
        success: false,
        message: "Unable to load user profile right now.",
      };
      return NextResponse.json(payload, { status: 500 });
    }

    const basicUser = usersMap.get(foundUser.id);
    if (!basicUser) {
      const payload: FriendSearchResponse = {
        success: false,
        message: "User not found.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const payload: FriendSearchResponse = {
      success: true,
      user: {
        id: basicUser.id,
        username: basicUser.username,
        avatar_url: basicUser.avatar_url,
        age: profileResult.data?.age ?? null,
        motto: profileResult.data?.motto ?? null,
        bio: profileResult.data?.bio ?? null,
        current_learning_field_title: learningFieldMap.get(foundUser.id) ?? null,
        existing_friendship_status: friendship?.status ?? null,
      },
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    const payload: FriendSearchResponse = {
      success: false,
      message: "Unable to search users right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
