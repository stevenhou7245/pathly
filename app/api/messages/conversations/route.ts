import { NextResponse } from "next/server";
import { getConversationSummariesForUser } from "@/lib/messages";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";

export const runtime = "nodejs";

type ConversationsResponse = {
  success: boolean;
  message?: string;
  conversations?: Array<{
    friendship_id: string;
    other_user: {
      id: string;
      username: string;
      avatar_url: string | null;
    };
    latest_message: {
      id: string;
      sender_id: string;
      body: string;
      created_at: string | null;
      is_read: boolean;
    } | null;
    unread_count: number;
  }>;
};

export async function GET() {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: ConversationsResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    const conversations = await getConversationSummariesForUser(sessionUser.id);

    const payload: ConversationsResponse = {
      success: true,
      conversations,
    };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    const payload: ConversationsResponse = {
      success: false,
      message: "Unable to load conversations right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
