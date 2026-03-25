import { NextResponse } from "next/server";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import {
  createDirectMessage,
  getAcceptedFriendshipForUser,
} from "@/lib/messages";
import { sendDirectMessageSchema } from "@/lib/messagesValidation";

export const runtime = "nodejs";

type SendMessageResponse = {
  success: boolean;
  message?: string;
  direct_message?: {
    id: string;
    friendship_id: string;
    sender_id: string;
    body: string;
    is_read: boolean;
    created_at: string | null;
  };
};

export async function POST(request: Request) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: SendMessageResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      const payload: SendMessageResponse = {
        success: false,
        message: "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const parsed = sendDirectMessageSchema.safeParse(body);
    if (!parsed.success) {
      const payload: SendMessageResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const { friendship_id, body: messageBody } = parsed.data;

    console.info("[direct_messages] send_started", {
      friendship_id,
      sender_id: sessionUser.id,
    });

    const access = await getAcceptedFriendshipForUser({
      friendshipId: friendship_id,
      userId: sessionUser.id,
    });

    if (!access.ok) {
      console.warn("[direct_messages] send_forbidden", {
        friendship_id,
        sender_id: sessionUser.id,
        code: access.code,
      });
      if (access.code === "not_found") {
        const payload: SendMessageResponse = {
          success: false,
          message: "Friendship not found.",
        };
        return NextResponse.json(payload, { status: 404 });
      }

      if (access.code === "not_accepted") {
        const payload: SendMessageResponse = {
          success: false,
          message: "Messaging is only available for accepted friendships.",
        };
        return NextResponse.json(payload, { status: 403 });
      }

      const payload: SendMessageResponse = {
        success: false,
        message: "You are not allowed to send messages in this conversation.",
      };
      return NextResponse.json(payload, { status: 403 });
    }

    const directMessage = await createDirectMessage({
      friendshipId: access.friendship.id,
      senderId: sessionUser.id,
      body: messageBody,
    });

    console.info("[direct_messages] send_completed", {
      friendship_id: access.friendship.id,
      sender_id: sessionUser.id,
      message_id: directMessage.id,
      realtime_mode: "postgres_changes",
    });

    const payload: SendMessageResponse = {
      success: true,
      message: "Message sent.",
      direct_message: directMessage,
    };

    return NextResponse.json(payload, { status: 201 });
  } catch (error) {
    console.error("[direct_messages] send_failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    const payload: SendMessageResponse = {
      success: false,
      message: "Unable to send message right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
