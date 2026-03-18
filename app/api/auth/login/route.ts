import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { loginRequestSchema } from "@/lib/authValidation";
import { setAuthSessionCookie } from "@/lib/cookies";
import { setUserPresence } from "@/lib/presence";
import { createUserSession } from "@/lib/session";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type LoginResponse = {
  success: boolean;
  message: string;
  redirectTo?: string;
};

const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password.";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = loginRequestSchema.safeParse(body);

    if (!parsed.success) {
      const payload: LoginResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid login payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const { email, password } = parsed.data;

    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("id, username, email, password_hash")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();

    if (userError || !user) {
      const payload: LoginResponse = {
        success: false,
        message: INVALID_CREDENTIALS_MESSAGE,
      };
      return NextResponse.json(payload, { status: 401 });
    }

    const passwordHash = user.password_hash ?? "";
    const isPasswordValid = await bcrypt.compare(password, passwordHash);

    if (!isPasswordValid) {
      const payload: LoginResponse = {
        success: false,
        message: INVALID_CREDENTIALS_MESSAGE,
      };
      return NextResponse.json(payload, { status: 401 });
    }

    const { token, expiresAt } = await createUserSession(user.id);
    const { data: onboardingRow, error: onboardingError } = await supabaseAdmin
      .from("user_learning_fields")
      .select("id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle<{ id: string }>();

    if (onboardingError) {
      const payload: LoginResponse = {
        success: false,
        message: "Unable to log in right now.",
      };
      return NextResponse.json(payload, { status: 500 });
    }

    const redirectTo = onboardingRow ? "/dashboard" : "/onboarding";
    try {
      await setUserPresence({
        userId: user.id,
        isOnline: true,
      });
    } catch {
      // Keep login successful even if presence update fails.
    }

    const response = NextResponse.json<LoginResponse>({
      success: true,
      message: "Login successful.",
      redirectTo,
    });

    setAuthSessionCookie({
      response,
      token,
      expiresAt,
    });

    return response;
  } catch (error) {
    console.error("[login] unexpected error:", error);

    const payload: LoginResponse = {
      success: false,
      message: "Unable to log in right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
