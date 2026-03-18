import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { clearAuthSessionCookie } from "@/lib/cookies";
import { setUserPresence } from "@/lib/presence";
import {
  AUTH_SESSION_COOKIE_NAME,
  invalidateSessionByToken,
  resolveSessionUserByToken,
} from "@/lib/session";

export const runtime = "nodejs";

type LogoutResponse = {
  success: boolean;
  message: string;
};

export async function POST() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(AUTH_SESSION_COOKIE_NAME)?.value;

    if (token) {
      const resolved = await resolveSessionUserByToken(token);
      await invalidateSessionByToken(token);
      if (resolved.status === "resolved") {
        await setUserPresence({
          userId: resolved.user.id,
          isOnline: false,
        });
      }
    }

    const response = NextResponse.json<LogoutResponse>({
      success: true,
      message: "Logged out successfully.",
    });

    clearAuthSessionCookie(response);
    return response;
  } catch {
    const response = NextResponse.json<LogoutResponse>({
      success: true,
      message: "Logged out successfully.",
    });
    clearAuthSessionCookie(response);
    return response;
  }
}
