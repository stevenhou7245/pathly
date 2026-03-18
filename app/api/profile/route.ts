import { NextResponse } from "next/server";
import { updateProfileSchema } from "@/lib/authValidation";
import {
  getPublicUserProfileByUserId,
  upsertUserProfileFields,
  type PublicUserProfile,
  type ProfileFieldsPatch,
} from "@/lib/profile";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type ProfileApiResponse = {
  success: boolean;
  message?: string;
  profile?: PublicUserProfile;
};

function normalizeMotto(value: unknown) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function unauthorizedResponse() {
  const payload: ProfileApiResponse = {
    success: false,
    message: "Unauthorized.",
  };
  return NextResponse.json(payload, { status: 401 });
}

export async function GET() {
  const requestStartedAt = Date.now();
  const marks: Record<string, number> = {};
  try {
    marks.auth_start = Date.now();
    const sessionUser = await getAuthenticatedSessionUser();
    marks.auth_end = Date.now();
    if (!sessionUser) {
      return unauthorizedResponse();
    }

    marks.db_start = Date.now();
    const profile = await getPublicUserProfileByUserId(sessionUser.id);
    marks.db_end = Date.now();
    const safeProfile: PublicUserProfile =
      profile ??
      {
        id: sessionUser.id,
        username: sessionUser.username,
        email: sessionUser.email,
        age: null,
        avatar_url: null,
        bio: null,
        motto: null,
        current_learning_field: null,
        current_level: null,
        target_level: null,
        current_progress: 0,
        theme: "light",
        sound_effects_enabled: true,
        animations_enabled: true,
      };

    const payload: ProfileApiResponse = {
      success: true,
      profile: safeProfile,
    };
    console.info("[api/profile][GET] timings", {
      user_id: sessionUser.id,
      total_ms: Date.now() - requestStartedAt,
      auth_ms: (marks.auth_end ?? 0) - (marks.auth_start ?? 0),
      db_ms: (marks.db_end ?? 0) - (marks.db_start ?? 0),
      mapping_ms: Date.now() - (marks.db_end ?? Date.now()),
    });
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[api/profile][GET] failed", {
      total_ms: Date.now() - requestStartedAt,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    });
    const payload: ProfileApiResponse = {
      success: false,
      message: "Unable to load profile right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      const payload: ProfileApiResponse = {
        success: false,
        message: "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const parsed = updateProfileSchema.safeParse(body);
    if (!parsed.success) {
      const payload: ProfileApiResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return unauthorizedResponse();
    }

    const { username, age, avatar_url, bio, motto } = parsed.data;
    const normalizedMotto = normalizeMotto(motto);

    if (username !== undefined) {
      const { data: existingUsername, error: existingUsernameError } = await supabaseAdmin
        .from("users")
        .select("id")
        .ilike("username", username)
        .limit(1)
        .maybeSingle<{ id: string }>();

      if (existingUsernameError) {
        const payload: ProfileApiResponse = {
          success: false,
          message: "Unable to validate username right now.",
        };
        return NextResponse.json(payload, { status: 500 });
      }

      if (existingUsername && existingUsername.id !== sessionUser.id) {
        const payload: ProfileApiResponse = {
          success: false,
          message: "Username is already taken.",
        };
        return NextResponse.json(payload, { status: 409 });
      }

      const { error: updateUserError } = await supabaseAdmin
        .from("users")
        .update({
          username,
          updated_at: new Date().toISOString(),
        })
        .eq("id", sessionUser.id);

      if (updateUserError) {
        const payload: ProfileApiResponse = {
          success: false,
          message: "Failed to update profile.",
        };
        return NextResponse.json(payload, { status: 500 });
      }
    }

    const profilePatch: ProfileFieldsPatch = {};
    if (age !== undefined) {
      profilePatch.age = age;
    }
    if (avatar_url !== undefined) {
      profilePatch.avatar_url = avatar_url;
    }
    if (bio !== undefined) {
      profilePatch.bio = bio;
    }
    if (normalizedMotto !== undefined) {
      profilePatch.motto = normalizedMotto;
    }

    await upsertUserProfileFields(sessionUser.id, profilePatch);

    const profile = await getPublicUserProfileByUserId(sessionUser.id);
    const safeProfile: PublicUserProfile =
      profile ??
      {
        id: sessionUser.id,
        username: sessionUser.username,
        email: sessionUser.email,
        age: null,
        avatar_url: null,
        bio: null,
        motto: null,
        current_learning_field: null,
        current_level: null,
        target_level: null,
        current_progress: 0,
        theme: "light",
        sound_effects_enabled: true,
        animations_enabled: true,
      };

    const payload: ProfileApiResponse = {
      success: true,
      message: "Profile updated successfully.",
      profile: safeProfile,
    };
    return NextResponse.json(payload);
  } catch {
    const payload: ProfileApiResponse = {
      success: false,
      message: "Unable to update profile right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
