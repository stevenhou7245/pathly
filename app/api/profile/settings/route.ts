import { NextResponse } from "next/server";
import { updateProfileSettingsSchema } from "@/lib/authValidation";
import {
  getUserSettingsByUserId,
  upsertUserSettingsFields,
  type SettingsFieldsPatch,
} from "@/lib/profile";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";

export const runtime = "nodejs";

type ProfileSettingsApiResponse = {
  success: boolean;
  message?: string;
  settings?: {
    theme: "light" | "dark";
    sound_effects_enabled: boolean;
    animations_enabled: boolean;
  };
};

function unauthorizedResponse() {
  const payload: ProfileSettingsApiResponse = {
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
    const settings = await getUserSettingsByUserId(sessionUser.id);
    marks.db_end = Date.now();
    const payload: ProfileSettingsApiResponse = {
      success: true,
      settings: {
        theme: settings.theme,
        sound_effects_enabled: settings.sound_effects_enabled,
        animations_enabled: settings.animations_enabled,
      },
    };

    console.info("[api/profile/settings][GET] timings", {
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
    console.error("[api/profile/settings][GET] failed", {
      total_ms: Date.now() - requestStartedAt,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    });
    const payload: ProfileSettingsApiResponse = {
      success: false,
      message: "Unable to load settings right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const requestStartedAt = Date.now();
  const marks: Record<string, number> = {};
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      const payload: ProfileSettingsApiResponse = {
        success: false,
        message: "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const parsed = updateProfileSettingsSchema.safeParse(body);
    if (!parsed.success) {
      const payload: ProfileSettingsApiResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    marks.auth_start = Date.now();
    const sessionUser = await getAuthenticatedSessionUser();
    marks.auth_end = Date.now();
    if (!sessionUser) {
      return unauthorizedResponse();
    }

    const settingsPatch: SettingsFieldsPatch = {};
    if (parsed.data.theme !== undefined) {
      settingsPatch.theme = parsed.data.theme;
    }
    if (parsed.data.sound_effects_enabled !== undefined) {
      settingsPatch.sound_effects_enabled = parsed.data.sound_effects_enabled;
    }
    if (parsed.data.animations_enabled !== undefined) {
      settingsPatch.animations_enabled = parsed.data.animations_enabled;
    }

    marks.db_upsert_start = Date.now();
    await upsertUserSettingsFields(sessionUser.id, settingsPatch);
    marks.db_upsert_end = Date.now();

    marks.db_read_start = Date.now();
    const settings = await getUserSettingsByUserId(sessionUser.id);
    marks.db_read_end = Date.now();

    const payload: ProfileSettingsApiResponse = {
      success: true,
      message: "Settings updated successfully.",
      settings: {
        theme: settings.theme,
        sound_effects_enabled: settings.sound_effects_enabled,
        animations_enabled: settings.animations_enabled,
      },
    };
    console.info("[api/profile/settings][PATCH] timings", {
      total_ms: Date.now() - requestStartedAt,
      auth_ms: (marks.auth_end ?? 0) - (marks.auth_start ?? 0),
      db_upsert_ms: (marks.db_upsert_end ?? 0) - (marks.db_upsert_start ?? 0),
      db_read_ms: (marks.db_read_end ?? 0) - (marks.db_read_start ?? 0),
      mapping_ms: Date.now() - (marks.db_read_end ?? Date.now()),
    });
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[api/profile/settings][PATCH] failed", {
      total_ms: Date.now() - requestStartedAt,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    });
    const payload: ProfileSettingsApiResponse = {
      success: false,
      message: "Unable to update settings right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
