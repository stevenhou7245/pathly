import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { clearAuthSessionCookie } from "@/lib/cookies";
import { setUserPresence } from "@/lib/presence";
import {
  AUTH_SESSION_COOKIE_NAME,
  type SessionResponse,
} from "@/lib/session";
import { resolveAuthenticatedSessionUser } from "@/lib/sessionAuth";

export const runtime = "nodejs";

function unauthenticatedResponse() {
  const payload: SessionResponse = {
    authenticated: false,
    user: null,
  };
  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

export async function GET() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(AUTH_SESSION_COOKIE_NAME)?.value;

    if (!token) {
      console.info("[api/auth/session] missing_cookie");
      return unauthenticatedResponse();
    }

    const resolved = await resolveAuthenticatedSessionUser();
    if (!resolved.authenticated) {
      console.warn("[api/auth/session] unauthenticated", {
        status: resolved.status,
        reason: resolved.reason,
      });
      const response = unauthenticatedResponse();
      if (
        resolved.status === "session_not_found" ||
        resolved.status === "session_expired"
      ) {
        clearAuthSessionCookie(response);
      }
      return response;
    }

    const user = resolved.user;
    try {
      await setUserPresence({
        userId: user.id,
        isOnline: true,
      });
    } catch {
      // Keep session endpoint responsive even if presence update fails.
    }

    const payload: SessionResponse = {
      authenticated: true,
      user,
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[api/auth/session] failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      {
        authenticated: false,
        user: null,
        message: "Unable to validate session right now.",
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  }
}
