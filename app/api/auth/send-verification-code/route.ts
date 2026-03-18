import { NextResponse } from "next/server";
import { Resend } from "resend";
import { sendVerificationCodeSchema } from "@/lib/authValidation";
import { generateVerificationCode } from "@/lib/generateVerificationCode";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type SendCodeResponse = {
  success: boolean;
  message: string;
  devCode?: string;
};

function isLikelyEmailAddress(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = sendVerificationCodeSchema.safeParse(body);

    if (!parsed.success) {
      const message =
        parsed.error.issues[0]?.message ?? "Invalid request payload.";
      const payload: SendCodeResponse = { success: false, message };
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
      const payload: SendCodeResponse = {
        success: false,
        message: "Unable to validate email right now.",
      };
      return NextResponse.json(payload, { status: 500 });
    }

    if (existingUser) {
      const payload: SendCodeResponse = {
        success: false,
        message: "Email is already registered.",
      };
      return NextResponse.json(payload, { status: 409 });
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
      const payload: SendCodeResponse = {
        success: false,
        message: "Failed to create verification code.",
      };
      return NextResponse.json(payload, { status: 500 });
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.FROM_EMAIL ?? "";

    console.log("[send-verification-code] RESEND_API_KEY exists:", Boolean(resendApiKey));
    console.log("[send-verification-code] FROM_EMAIL:", fromEmail || "(empty)");

    if (!resendApiKey) {
      const payload: SendCodeResponse = {
        success: true,
        message: "Verification code generated in development mode.",
        devCode: code,
      };
      return NextResponse.json(payload);
    }

    // For Resend testing, onboarding@resend.dev is the recommended development sender.
    if (!fromEmail || !isLikelyEmailAddress(fromEmail)) {
      const payload: SendCodeResponse = {
        success: false,
        message: "Failed to send verification email.",
      };
      return NextResponse.json(payload, { status: 500 });
    }

    const resend = new Resend(resendApiKey);
    const sendResult = await resend.emails.send({
      from: fromEmail,
      to: email,
      subject: "Your Pathly verification code",
      text: `Your verification code is: ${code}. It expires in 10 minutes.`,
      html: `
        <div style="font-family: Arial, sans-serif; line-height: 1.5; color: #1F2937;">
          <h2 style="margin-bottom: 12px;">Pathly Email Verification</h2>
          <p>Your verification code is:</p>
          <p style="font-size: 28px; font-weight: 700; letter-spacing: 6px; margin: 12px 0;">
            ${code}
          </p>
          <p>This code expires in 10 minutes.</p>
        </div>
      `,
    });

    console.log("[send-verification-code] resend.emails.send result:", sendResult);

    if (sendResult.error || !sendResult.data?.id) {
      const payload: SendCodeResponse = {
        success: false,
        message: "Failed to send verification email.",
      };
      return NextResponse.json(payload, { status: 502 });
    }

    const payload: SendCodeResponse = {
      success: true,
      message: "Verification code sent.",
    };
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[send-verification-code] Unexpected error:", error);
    const payload: SendCodeResponse = {
      success: false,
      message: "Unexpected server error.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}

