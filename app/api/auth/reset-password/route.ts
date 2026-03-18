import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { resetPasswordRequestSchema } from "@/lib/authValidation";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type ResetPasswordResponse = {
  success: boolean;
  message: string;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = resetPasswordRequestSchema.safeParse(body);

    if (!parsed.success) {
      const payload: ResetPasswordResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid reset password payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const { email, verificationCode, newPassword } = parsed.data;

    const { data: user, error: userError } = await supabaseAdmin
      .from("users")
      .select("id, password_hash")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();

    if (userError) {
      const payload: ResetPasswordResponse = {
        success: false,
        message: "Unable to validate email right now.",
      };
      return NextResponse.json(payload, { status: 500 });
    }

    if (!user) {
      const payload: ResetPasswordResponse = {
        success: false,
        message: "No account found with this email.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const { data: latestCode, error: latestCodeError } = await supabaseAdmin
      .from("email_verification_codes")
      .select("id, code, expires_at, used, created_at")
      .eq("email", email)
      .eq("used", false)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestCodeError) {
      const payload: ResetPasswordResponse = {
        success: false,
        message: "Unable to verify the reset code right now.",
      };
      return NextResponse.json(payload, { status: 500 });
    }

    const isCodeMissing = !latestCode;
    const isCodeMismatch = latestCode?.code !== verificationCode;
    const isCodeExpired =
      latestCode && new Date(latestCode.expires_at).getTime() <= Date.now();

    if (isCodeMissing || isCodeMismatch || isCodeExpired) {
      const payload: ResetPasswordResponse = {
        success: false,
        message: "Invalid or expired verification code.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const currentPasswordHash = user.password_hash ?? "";
    const isSameAsOldPassword = await bcrypt.compare(newPassword, currentPasswordHash);

    if (isSameAsOldPassword) {
      const payload: ResetPasswordResponse = {
        success: false,
        message: "New password cannot be the same as the old password.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const newPasswordHash = await bcrypt.hash(newPassword, 10);
    const nowIso = new Date().toISOString();

    const { error: updatePasswordError } = await supabaseAdmin
      .from("users")
      .update({
        password_hash: newPasswordHash,
        updated_at: nowIso,
      })
      .eq("id", user.id);

    if (updatePasswordError) {
      const payload: ResetPasswordResponse = {
        success: false,
        message: "Failed to update password.",
      };
      return NextResponse.json(payload, { status: 500 });
    }

    await supabaseAdmin
      .from("email_verification_codes")
      .update({ used: true })
      .eq("id", latestCode.id);

    const payload: ResetPasswordResponse = {
      success: true,
      message: "Password reset successfully.",
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
