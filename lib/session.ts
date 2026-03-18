import { createHash, randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const AUTH_SESSION_COOKIE_NAME = "pathly-auth-token";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export type SessionUser = {
  id: string;
  username: string;
  email: string;
};

export type SessionResponse =
  | {
      authenticated: true;
      user: SessionUser;
    }
  | {
      authenticated: false;
      user: null;
    };

export type SessionLookupStatus =
  | "resolved"
  | "session_not_found"
  | "session_expired"
  | "user_not_found"
  | "session_lookup_failed"
  | "user_lookup_failed";

export type SessionLookupResult =
  | {
      status: "resolved";
      user: SessionUser;
      session_id: string;
      user_id: string;
      token_hash: string;
      expires_at: string;
    }
  | {
      status: Exclude<SessionLookupStatus, "resolved">;
      user: null;
      session_id?: string;
      user_id?: string;
      token_hash: string;
      expires_at?: string;
      error_message?: string;
    };

function generateSessionToken() {
  return randomBytes(32).toString("hex");
}

function hashSessionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createUserSession(userId: string) {
  const token = generateSessionToken();
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

  const { error } = await supabaseAdmin.from("sessions").insert({
    user_id: userId,
    token_hash: tokenHash,
    expires_at: expiresAt.toISOString(),
  });

  if (error) {
    throw new Error("Failed to create session.");
  }

  return { token, expiresAt };
}

export async function getSessionUserByToken(token: string): Promise<SessionUser | null> {
  const resolved = await resolveSessionUserByToken(token);
  if (resolved.status === "resolved") {
    return resolved.user;
  }

  if (resolved.status === "session_lookup_failed" || resolved.status === "user_lookup_failed") {
    throw new Error(resolved.error_message ?? "Failed to resolve session user.");
  }

  return null;
}

export async function resolveSessionUserByToken(token: string): Promise<SessionLookupResult> {
  const tokenHash = hashSessionToken(token);
  const now = Date.now();

  const { data: session, error: sessionError } = await supabaseAdmin
    .from("sessions")
    .select("id, user_id, expires_at")
    .eq("token_hash", tokenHash)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (sessionError) {
    return {
      status: "session_lookup_failed",
      user: null,
      token_hash: tokenHash,
      error_message: sessionError.message,
    };
  }

  if (!session) {
    return {
      status: "session_not_found",
      user: null,
      token_hash: tokenHash,
    };
  }

  const expiresAtRaw = typeof session.expires_at === "string" ? session.expires_at : "";
  const expiresAtMs = Date.parse(expiresAtRaw);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now) {
    return {
      status: "session_expired",
      user: null,
      session_id: session.id,
      user_id: session.user_id,
      token_hash: tokenHash,
      expires_at: expiresAtRaw,
    };
  }

  const { data: user, error: userError } = await supabaseAdmin
    .from("users")
    .select("id, username, email")
    .eq("id", session.user_id)
    .limit(1)
    .maybeSingle();

  if (userError) {
    return {
      status: "user_lookup_failed",
      user: null,
      session_id: session.id,
      user_id: session.user_id,
      token_hash: tokenHash,
      expires_at: expiresAtRaw,
      error_message: userError.message,
    };
  }

  if (!user) {
    return {
      status: "user_not_found",
      user: null,
      session_id: session.id,
      user_id: session.user_id,
      token_hash: tokenHash,
      expires_at: expiresAtRaw,
    };
  }

  return {
    status: "resolved",
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
    },
    session_id: session.id,
    user_id: session.user_id,
    token_hash: tokenHash,
    expires_at: expiresAtRaw,
  };
}

export async function invalidateSessionByToken(token: string) {
  const tokenHash = hashSessionToken(token);

  await supabaseAdmin
    .from("sessions")
    .delete()
    .eq("token_hash", tokenHash);
}
