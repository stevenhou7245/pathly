import { NextResponse } from "next/server";
import { verifyCaptchaChallenge } from "@/lib/captcha";
import { resetPasswordRequestSchema } from "@/lib/authValidation";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type ResetPasswordResponse = {
  success: boolean;
  message: string;
  refreshCaptcha?: boolean;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = resetPasswordRequestSchema.safeParse(body);

    if (!parsed.success) {
      const payload: ResetPasswordResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid reset password payload.",
        refreshCaptcha: true,
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const { email, captchaInput, captchaToken } = parsed.data;
    const captchaResult = verifyCaptchaChallenge({
      captchaInput,
      captchaToken,
    });
    if (!captchaResult.ok) {
      const payload: ResetPasswordResponse = {
        success: false,
        message: "CAPTCHA verification failed. Please try again.",
        refreshCaptcha: true,
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const lookupResult = await supabaseAdmin
      .from("users")
      .select("id")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();
    if (lookupResult.error) {
      const payload: ResetPasswordResponse = {
        success: false,
        message: "Unable to process password reset request right now.",
      };
      return NextResponse.json(payload, { status: 500 });
    }

    const payload: ResetPasswordResponse = {
      success: true,
      message:
        "Password reset via email codes has been removed for security. Please contact support from your account settings for assisted reset.",
    };
    return NextResponse.json(payload);
  } catch {
    const payload: ResetPasswordResponse = {
      success: false,
      message: "Unexpected server error.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}

