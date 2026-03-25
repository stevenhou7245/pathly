import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getCurrentLearningSnapshotFromRealProgress } from "@/lib/learningProgressAggregation";

export type ProfileTheme = "light" | "dark";

export type PublicUserProfile = {
  id: string;
  username: string;
  email: string;
  age: number | null;
  avatar_url: string | null;
  avatar_path: string | null;
  avatar_updated_at: string | null;
  bio: string | null;
  motto: string | null;
  current_learning_field: string | null;
  current_level: string | null;
  target_level: string | null;
  current_progress: number;
  theme: ProfileTheme;
  sound_effects_enabled: boolean;
  animations_enabled: boolean;
};

type UserRecord = {
  id: string;
  username: string;
  email: string;
  avatar_url: string | null;
  avatar_path: string | null;
  avatar_updated_at: string | null;
};

type UserProfileRecord = {
  age: number | null;
  avatar_url: string | null;
  bio: string | null;
  motto?: string | null;
};

type UserSettingsRecord = {
  theme: string | null;
  sound_effects_enabled: boolean | null;
  animations_enabled: boolean | null;
};

async function loadUserProfileRecord(userId: string): Promise<UserProfileRecord | null> {
  const result = await supabaseAdmin
    .from("user_profiles")
    .select("age, avatar_url, bio, motto")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle<UserProfileRecord>();

  if (result.error) {
    return null;
  }

  return result.data ?? null;
}

async function loadUserSettingsRecord(userId: string): Promise<UserSettingsRecord | null> {
  const settings = await supabaseAdmin
    .from("user_settings")
    .select("theme, sound_effects_enabled, animations_enabled")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle<UserSettingsRecord>();

  if (settings.error) {
    return null;
  }

  return settings.data ?? null;
}

async function ensureUserSettingsRecord(userId: string): Promise<UserSettingsRecord> {
  const existing = await loadUserSettingsRecord(userId);
  if (existing) {
    return existing;
  }

  const defaults = {
    theme: "light",
    sound_effects_enabled: true,
    animations_enabled: true,
  } satisfies UserSettingsRecord;

  const created = await supabaseAdmin
    .from("user_settings")
    .upsert(
      {
        user_id: userId,
        ...defaults,
      },
      {
        onConflict: "user_id",
      },
    )
    .select("theme, sound_effects_enabled, animations_enabled")
    .limit(1)
    .maybeSingle<UserSettingsRecord>();

  if (created.error) {
    return defaults;
  }

  return created.data ?? defaults;
}

export async function getUserSettingsByUserId(userId: string): Promise<{
  theme: ProfileTheme;
  sound_effects_enabled: boolean;
  animations_enabled: boolean;
}> {
  const settings = await ensureUserSettingsRecord(userId);
  return {
    theme: settings?.theme === "dark" ? "dark" : "light",
    sound_effects_enabled: settings?.sound_effects_enabled ?? true,
    animations_enabled: settings?.animations_enabled ?? true,
  };
}

async function loadCurrentLearningSnapshot(userId: string) {
  return getCurrentLearningSnapshotFromRealProgress(userId);
}

export async function getPublicUserProfileByUserId(
  userId: string,
): Promise<PublicUserProfile | null> {
  const userResult = await supabaseAdmin
    .from("users")
    .select("id, username, email, avatar_url, avatar_path, avatar_updated_at")
    .eq("id", userId)
    .limit(1)
    .maybeSingle<UserRecord>();

  if (userResult.error) {
    throw new Error("Failed to load user information.");
  }

  if (!userResult.data) {
    return null;
  }

  const [profile, settings, learningSnapshot] = await Promise.all([
    loadUserProfileRecord(userId),
    ensureUserSettingsRecord(userId),
    loadCurrentLearningSnapshot(userId),
  ]);

  return {
    id: userResult.data.id,
    username: userResult.data.username,
    email: userResult.data.email,
    age: profile?.age ?? null,
    avatar_url: userResult.data.avatar_url ?? profile?.avatar_url ?? null,
    avatar_path: userResult.data.avatar_path ?? null,
    avatar_updated_at: userResult.data.avatar_updated_at ?? null,
    bio: profile?.bio ?? null,
    motto: profile?.motto ?? null,
    current_learning_field: learningSnapshot.current_learning_field,
    current_level: learningSnapshot.current_level,
    target_level: learningSnapshot.target_level,
    current_progress: learningSnapshot.current_progress,
    theme: settings?.theme === "dark" ? "dark" : "light",
    sound_effects_enabled: settings?.sound_effects_enabled ?? true,
    animations_enabled: settings?.animations_enabled ?? true,
  };
}

export type ProfileFieldsPatch = {
  age?: number | null;
  avatar_url?: string | null;
  bio?: string | null;
  motto?: string | null;
};

export async function upsertUserProfileFields(
  userId: string,
  fields: ProfileFieldsPatch,
) {
  if (Object.keys(fields).length === 0) {
    return;
  }

  const { data: existingProfile, error: existingProfileError } = await supabaseAdmin
    .from("user_profiles")
    .select("user_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle<{ user_id: string }>();

  if (existingProfileError) {
    throw new Error("Failed to load current user profile.");
  }

  if (existingProfile) {
    const { error: updateError } = await supabaseAdmin
      .from("user_profiles")
      .update(fields)
      .eq("user_id", userId);

    if (updateError) {
      throw new Error("Failed to update user profile.");
    }
    return;
  }

  const { error: insertError } = await supabaseAdmin
    .from("user_profiles")
    .insert({
      user_id: userId,
      ...fields,
    });

  if (insertError) {
    throw new Error("Failed to create user profile.");
  }
}

export type SettingsFieldsPatch = {
  theme?: ProfileTheme;
  sound_effects_enabled?: boolean;
  animations_enabled?: boolean;
};

export async function upsertUserSettingsFields(
  userId: string,
  fields: SettingsFieldsPatch,
) {
  if (Object.keys(fields).length === 0) {
    return;
  }

  const { data: existingSettings, error: existingSettingsError } = await supabaseAdmin
    .from("user_settings")
    .select("user_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle<{ user_id: string }>();

  if (existingSettingsError) {
    throw new Error("Failed to load current user settings.");
  }

  if (existingSettings) {
    const { error: updateError } = await supabaseAdmin
      .from("user_settings")
      .update(fields)
      .eq("user_id", userId);

    if (updateError) {
      throw new Error("Failed to update user settings.");
    }
    return;
  }

  const { error: insertError } = await supabaseAdmin
    .from("user_settings")
    .insert({
      user_id: userId,
      ...fields,
    });

  if (insertError) {
    throw new Error("Failed to create user settings.");
  }
}
