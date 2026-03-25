import { NextResponse } from "next/server";
import { z } from "zod";
import { sendOfficialMessage } from "@/lib/officialMessages";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";

export const runtime = "nodejs";

const sendOfficialMessageSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "title is required")
    .max(200, "title must be at most 200 characters"),
  body: z
    .string()
    .trim()
    .min(1, "body is required")
    .max(10000, "body must be at most 10000 characters"),
  role_target: z
    .union([z.string().trim().min(1), z.null(), z.undefined()])
    .optional(),
});

type SendOfficialMessageResponse = {
  success: boolean;
  message?: string;
  official_message?: {
    id: string;
    title: string;
    body: string;
    sender_id: string;
    role_target: string | null;
    created_at: string | null;
  };
};

export async function POST(request: Request) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<SendOfficialMessageResponse>(
        {
          success: false,
          message: "Unauthorized.",
        },
        { status: 401 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json<SendOfficialMessageResponse>(
        {
          success: false,
          message: "Invalid request payload.",
        },
        { status: 400 },
      );
    }

    const parsed = sendOfficialMessageSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<SendOfficialMessageResponse>(
        {
          success: false,
          message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
        },
        { status: 400 },
      );
    }

    const result = await sendOfficialMessage({
      senderId: sessionUser.id,
      title: parsed.data.title,
      body: parsed.data.body,
      roleTarget: parsed.data.role_target ?? null,
    });

    if (!result.ok) {
      return NextResponse.json<SendOfficialMessageResponse>(
        {
          success: false,
          message: "Only admin or teacher users can send official messages.",
        },
        { status: 403 },
      );
    }

    return NextResponse.json<SendOfficialMessageResponse>(
      {
        success: true,
        message: "Official message sent.",
        official_message: result.message,
      },
      { status: 201 },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[official_messages] send_route_failed", {
      route: "/api/messages/official/send",
      reason,
    });
    return NextResponse.json<SendOfficialMessageResponse>(
      {
        success: false,
        message: reason,
      },
      { status: 500 },
    );
  }
}

