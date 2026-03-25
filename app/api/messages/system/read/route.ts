import { NextResponse } from "next/server";
import { z } from "zod";
import { markSystemMessageReadForUser } from "@/lib/inbox";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";

export const runtime = "nodejs";

const markSystemMessageReadSchema = z.object({
  user_message_id: z
    .string()
    .trim()
    .min(1, "User message id is required."),
});

type MarkSystemMessageReadResponse = {
  success: boolean;
  message?: string;
};

export async function PATCH(request: Request) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: MarkSystemMessageReadResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      const payload: MarkSystemMessageReadResponse = {
        success: false,
        message: "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const parsed = markSystemMessageReadSchema.safeParse(body);
    if (!parsed.success) {
      const payload: MarkSystemMessageReadResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const updated = await markSystemMessageReadForUser({
      userId: sessionUser.id,
      userMessageId: parsed.data.user_message_id,
    });

    if (!updated) {
      const payload: MarkSystemMessageReadResponse = {
        success: false,
        message: "System message not found.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const payload: MarkSystemMessageReadResponse = {
      success: true,
      message: "System message marked as read.",
    };
    return NextResponse.json(payload);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[messages_system_read] route_failed", {
      route: "/api/messages/system/read",
      reason,
    });
    const payload: MarkSystemMessageReadResponse = {
      success: false,
      message: reason || "Unable to mark system message as read right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
