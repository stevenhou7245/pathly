import { NextResponse } from "next/server";
import { sendResetCodeSchema } from "@/lib/authValidation";
import { sendResetCodeEmail } from "@/lib/email";
import { generateVerificationCode } from "@/lib/generateVerificationCode";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type SendResetCodeResponse = {
  success: boolean;
  message: string;
  devCode?: string;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = sendResetCodeSchema.safeParse(body);

    if (!parsed.success) {
      const payload: SendResetCodeResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const { email } = parsed.data;

    const { data: existingUser, error: existingUserError } = await supabaseAdmin
      .from("users")
      .select("id")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();

    if (existingUserError) {
      const payload: SendResetCodeResponse = {
        success: false,
        message: "Unable to validate email right now.",
      };
      return NextResponse.json(payload, { status: 500 });
    }

    if (!existingUser) {
      const payload: SendResetCodeResponse = {
        success: false,
        message: "No account found with this email.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const code = generateVerificationCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    const { error: insertCodeError } = await supabaseAdmin
      .from("email_verification_codes")
      .insert({
        email,
        code,
        expires_at: expiresAt,
        used: false,
      });

    if (insertCodeError) {
      const payload: SendResetCodeResponse = {
        success: false,
        message: "Failed to create reset code.",
      };
      return NextResponse.json(payload, { status: 500 });
    }

    const sendResult = await sendResetCodeEmail({
      toEmail: email,
      code,
    });

    if (sendResult.mode === "development") {
      const payload: SendResetCodeResponse = {
        success: true,
        message: "Reset code generated in development mode.",
        devCode: code,
      };
      return NextResponse.json(payload);
    }

    const payload: SendResetCodeResponse = {
      success: true,
      message: "Reset code sent.",
    };
    return NextResponse.json(payload);
  } catch {
    const payload: SendResetCodeResponse = {
      success: false,
      message: "Unexpected server error.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
