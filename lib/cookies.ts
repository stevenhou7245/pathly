import type { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE_NAME } from "@/lib/session";

const isProduction = process.env.NODE_ENV === "production";

export function setAuthSessionCookie(params: {
  response: NextResponse;
  token: string;
  expiresAt: Date;
}) {
  const { response, token, expiresAt } = params;

  response.cookies.set({
    name: AUTH_SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    expires: expiresAt,
  });
}

export function clearAuthSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: AUTH_SESSION_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    expires: new Date(0),
  });
}
