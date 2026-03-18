import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";
import { registerRequestSchema } from "@/lib/authValidation";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type RegisterResponse = {
  success: boolean;
  message: string;
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = registerRequestSchema.safeParse(body);

    if (!parsed.success) {
      const message =
        parsed.error.issues[0]?.message ?? "Invalid registration payload.";
      const payload: RegisterResponse = { success: false, message };
      return NextResponse.json(payload, { status: 400 });
    }

    const { username, email, password, verificationCode } = parsed.data;

    const [existingEmailResult, existingUsernameResult] = await Promise.all([
      supabaseAdmin
        .from("users")
        .select("id")
        .ilike("email", email)
        .limit(1)
        .maybeSingle(),
      supabaseAdmin
        .from("users")
        .select("id")
        .ilike("username", username)
        .limit(1)
        .maybeSingle(),
    ]);

    if (existingEmailResult.error || existingUsernameResult.error) {
      const payload: RegisterResponse = {
        success: false,
        message: "Unable to validate account uniqueness right now.",
      };
      return NextResponse.json(payload, { status: 500 });
    }

    if (existingEmailResult.data) {
      const payload: RegisterResponse = {
        success: false,
        message: "Email is already registered.",
      };
      return NextResponse.json(payload, { status: 409 });
    }

    if (existingUsernameResult.data) {
      const payload: RegisterResponse = {
        success: false,
        message: "Username is already taken.",
      };
      return NextResponse.json(payload, { status: 409 });
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
      const payload: RegisterResponse = {
        success: false,
        message: "Unable to verify the verification code right now.",
      };
      return NextResponse.json(payload, { status: 500 });
    }

    const isCodeMissing = !latestCode;
    const isCodeMismatch = latestCode?.code !== verificationCode;
    const isCodeExpired =
      latestCode && new Date(latestCode.expires_at).getTime() <= Date.now();

    if (isCodeMissing || isCodeMismatch || isCodeExpired) {
      const payload: RegisterResponse = {
        success: false,
        message: "Invalid or expired verification code.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const timestamp = new Date().toISOString();

    const { error: createUserError } = await supabaseAdmin.from("users").insert({
      username,
      email,
      password_hash: passwordHash,
      created_at: timestamp,
      updated_at: timestamp,
    });

    if (createUserError) {
      const payload: RegisterResponse = {
        success: false,
        message: "Failed to create account.",
      };
      return NextResponse.json(payload, { status: 500 });
    }

    await supabaseAdmin
      .from("email_verification_codes")
      .update({ used: true })
      .eq("id", latestCode.id);

    const payload: RegisterResponse = {
      success: true,
      message: "Account created successfully.",
    };
    return NextResponse.json(payload);
  } catch {
    const payload: RegisterResponse = {
      success: false,
      message: "Unexpected server error.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
