import { NextResponse } from "next/server";
import { getSystemMessagesForUser } from "@/lib/inbox";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";

export const runtime = "nodejs";

type SystemMessagesResponse = {
  success: boolean;
  message?: string;
  current_user_id?: string;
  system_messages?: Array<{
    user_message_id: string;
    system_message_id: string;
    title: string;
    body: string;
    created_at: string | null;
    is_read: boolean;
  }>;
};

export async function GET() {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: SystemMessagesResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    const systemMessages = await getSystemMessagesForUser(sessionUser.id);
    const payload: SystemMessagesResponse = {
      success: true,
      current_user_id: sessionUser.id,
      system_messages: systemMessages,
    };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[messages_system] route_failed", {
      route: "/api/messages/system",
      reason,
    });
    const payload: SystemMessagesResponse = {
      success: false,
      message: reason || "Unable to load official messages right now.",
      system_messages: [],
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
