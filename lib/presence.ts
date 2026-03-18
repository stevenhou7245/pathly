import { supabaseAdmin } from "@/lib/supabaseAdmin";

type PresenceUpdateParams = {
  userId: string;
  isOnline: boolean;
};

export async function setUserPresence(params: PresenceUpdateParams) {
  const nowIso = new Date().toISOString();

  const { data: existing, error: existingError } = await supabaseAdmin
    .from("user_profiles")
    .select("user_id")
    .eq("user_id", params.userId)
    .limit(1)
    .maybeSingle<{ user_id: string }>();

  if (existingError) {
    throw new Error("Failed to load user presence.");
  }

  if (existing) {
    const { error: updateError } = await supabaseAdmin
      .from("user_profiles")
      .update({
        is_online: params.isOnline,
        last_seen_at: nowIso,
      })
      .eq("user_id", params.userId);

    if (updateError) {
      throw new Error("Failed to update user presence.");
    }
    return;
  }

  const { error: insertError } = await supabaseAdmin
    .from("user_profiles")
    .insert({
      user_id: params.userId,
      is_online: params.isOnline,
      last_seen_at: nowIso,
    });

  if (insertError) {
    throw new Error("Failed to create user presence.");
  }
}

