import { NextResponse } from "next/server";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import {
  getAcceptedFriendshipForUser,
  markIncomingMessagesAsRead,
} from "@/lib/messages";
import { markMessagesReadSchema } from "@/lib/messagesValidation";

export const runtime = "nodejs";

type MarkReadResponse = {
  success: boolean;
  message?: string;
  read_count?: number;
};

export async function PATCH(request: Request) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: MarkReadResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      const payload: MarkReadResponse = {
        success: false,
        message: "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const parsed = markMessagesReadSchema.safeParse(body);
    if (!parsed.success) {
      const payload: MarkReadResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const { friendship_id } = parsed.data;
    const access = await getAcceptedFriendshipForUser({
      friendshipId: friendship_id,
      userId: sessionUser.id,
    });

    if (!access.ok) {
      if (access.code === "not_found") {
        const payload: MarkReadResponse = {
          success: false,
          message: "Friendship not found.",
        };
        return NextResponse.json(payload, { status: 404 });
      }

      if (access.code === "not_accepted") {
        const payload: MarkReadResponse = {
          success: false,
          message: "Messaging is only available for accepted friendships.",
        };
        return NextResponse.json(payload, { status: 403 });
      }

      const payload: MarkReadResponse = {
        success: false,
        message: "You are not allowed to access this conversation.",
      };
      return NextResponse.json(payload, { status: 403 });
    }

    const readCount = await markIncomingMessagesAsRead({
      friendshipId: access.friendship.id,
      currentUserId: sessionUser.id,
    });

    const payload: MarkReadResponse = {
      success: true,
      message: "Messages marked as read.",
      read_count: readCount,
    };
    return NextResponse.json(payload);
  } catch {
    const payload: MarkReadResponse = {
      success: false,
      message: "Unable to mark messages as read right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
