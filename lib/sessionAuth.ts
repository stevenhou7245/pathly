import { cookies } from "next/headers";
import {
  AUTH_SESSION_COOKIE_NAME,
  resolveSessionUserByToken,
  type SessionUser,
  type SessionLookupStatus,
} from "@/lib/session";

export type AuthenticatedSessionResolution =
  | {
      authenticated: true;
      user: SessionUser;
      status: "resolved";
      token_present: true;
    }
  | {
      authenticated: false;
      user: null;
      status:
        | "missing_cookie"
        | Exclude<SessionLookupStatus, "resolved" | "user_not_found" | "session_lookup_failed" | "user_lookup_failed">;
      token_present: boolean;
      reason: string;
    };

export type AuthenticatedSessionResolutionWithStatus =
  | {
      authenticated: true;
      user: SessionUser;
      status: "resolved";
      token_present: true;
    }
  | {
      authenticated: false;
      user: null;
      status: "missing_cookie" | Exclude<SessionLookupStatus, "resolved">;
      token_present: boolean;
      reason: string;
    };

export async function resolveAuthenticatedSessionUserWithStatus(): Promise<AuthenticatedSessionResolutionWithStatus> {
  const cookieStore = await cookies();
  const token = cookieStore.get(AUTH_SESSION_COOKIE_NAME)?.value?.trim() ?? "";

  if (!token) {
    return {
      authenticated: false,
      user: null,
      status: "missing_cookie",
      token_present: false,
      reason: "Session cookie missing.",
    };
  }

  const resolved = await resolveSessionUserByToken(token);

  if (resolved.status === "resolved") {
    console.info("[session_auth] resolve", {
      token_present: true,
      status: "resolved",
      user_id: resolved.user.id,
      session_id: resolved.session_id,
    });
    return {
      authenticated: true,
      user: resolved.user,
      status: "resolved",
      token_present: true,
    };
  }

  return {
    authenticated: false,
    user: null,
    status: resolved.status,
    token_present: true,
    reason:
      resolved.status === "session_not_found"
        ? "Session token not found."
      : resolved.status === "session_expired"
        ? "Session token expired."
      : resolved.status === "user_not_found"
        ? "Authenticated session mapping to public.users is missing."
      : resolved.status === "session_lookup_failed" || resolved.status === "user_lookup_failed"
        ? resolved.error_message ?? "Unable to resolve authenticated user."
      : "Session user mapping not found in public.users.",
  };
}

export async function resolveAuthenticatedSessionUser(): Promise<AuthenticatedSessionResolution> {
  const resolved = await resolveAuthenticatedSessionUserWithStatus();

  if (resolved.authenticated) {
    console.info("[session_auth] resolve", {
      token_present: true,
      status: "resolved",
      user_id: resolved.user.id,
    });
    return resolved;
  }

  if (
    resolved.status === "user_not_found" ||
    resolved.status === "session_lookup_failed" ||
    resolved.status === "user_lookup_failed"
  ) {
    console.error("[session_auth] resolve_failed", {
      token_present: resolved.token_present,
      status: resolved.status,
      reason: resolved.reason,
    });
    throw new Error(resolved.reason);
  }

  console.warn("[session_auth] resolve_unauthenticated", {
    token_present: resolved.token_present,
    status: resolved.status,
    reason: resolved.reason,
  });

  if (
    resolved.status !== "missing_cookie" &&
    resolved.status !== "session_not_found" &&
    resolved.status !== "session_expired"
  ) {
    throw new Error("Unexpected session resolution status.");
  }

  const unauthenticatedStatus: "missing_cookie" | "session_not_found" | "session_expired" =
    resolved.status;
  return {
    authenticated: false,
    user: null,
    status: unauthenticatedStatus,
    token_present: resolved.token_present,
    reason: resolved.reason,
  };
}

export async function getAuthenticatedSessionUser(): Promise<SessionUser | null> {
  const resolved = await resolveAuthenticatedSessionUser();
  if (!resolved.authenticated) {
    return null;
  }

  return resolved.user;
}
