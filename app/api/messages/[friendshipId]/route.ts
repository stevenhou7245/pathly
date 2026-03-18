import { NextResponse } from "next/server";
import {
  getAcceptedFriendshipForUser,
  getMessagesForFriendshipWithLimit,
} from "@/lib/messages";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";

export const runtime = "nodejs";

type FriendshipMessagesResponse = {
  success: boolean;
  message?: string;
  messages?: Array<{
    id: string;
    friendship_id: string;
    sender_id: string;
    body: string;
    is_read: boolean;
    created_at: string | null;
  }>;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ friendshipId: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: FriendshipMessagesResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    const { friendshipId } = await context.params;
    if (!friendshipId) {
      const payload: FriendshipMessagesResponse = {
        success: false,
        message: "Friendship id is required.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const access = await getAcceptedFriendshipForUser({
      friendshipId,
      userId: sessionUser.id,
    });

    if (!access.ok) {
      if (access.code === "not_found") {
        const payload: FriendshipMessagesResponse = {
          success: false,
          message: "Friendship not found.",
        };
        return NextResponse.json(payload, { status: 404 });
      }

      if (access.code === "not_accepted") {
        const payload: FriendshipMessagesResponse = {
          success: false,
          message: "Messaging is only available for accepted friendships.",
        };
        return NextResponse.json(payload, { status: 403 });
      }

      const payload: FriendshipMessagesResponse = {
        success: false,
        message: "You are not allowed to access this conversation.",
      };
      return NextResponse.json(payload, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const limitValue = searchParams.get("limit");
    const requestedLimit =
      typeof limitValue === "string" && limitValue.trim()
        ? Number(limitValue)
        : undefined;

    const messages = await getMessagesForFriendshipWithLimit(
      access.friendship.id,
      requestedLimit,
    );

    const payload: FriendshipMessagesResponse = {
      success: true,
      messages,
    };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    const payload: FriendshipMessagesResponse = {
      success: false,
      message: "Unable to load messages right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
