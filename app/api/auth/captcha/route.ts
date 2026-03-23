import { NextResponse } from "next/server";
import { createCaptchaChallenge } from "@/lib/captcha";

export const runtime = "nodejs";

export async function GET() {
  try {
    const challenge = createCaptchaChallenge();
    return NextResponse.json({
      success: true,
      captchaToken: challenge.token,
      captchaSvgDataUrl: challenge.svgDataUrl,
      expiresAt: challenge.expiresAt,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to generate CAPTCHA challenge.",
      },
      { status: 500 },
    );
  }
}

