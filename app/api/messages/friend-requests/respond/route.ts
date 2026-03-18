import { NextResponse } from "next/server";
import { respondFriendRequestSchema } from "@/lib/friendsValidation";
import { respondToIncomingFriendRequest } from "@/lib/inbox";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";

export const runtime = "nodejs";

type RespondFriendRequestInboxResponse = {
  success: boolean;
  message?: string;
};

export async function POST(request: Request) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: RespondFriendRequestInboxResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      const payload: RespondFriendRequestInboxResponse = {
        success: false,
        message: "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const parsed = respondFriendRequestSchema.safeParse(body);
    if (!parsed.success) {
      const payload: RespondFriendRequestInboxResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const result = await respondToIncomingFriendRequest({
      userId: sessionUser.id,
      friendshipId: parsed.data.friendship_id,
      action: parsed.data.action,
    });

    if (!result.ok) {
      if (result.code === "NOT_FOUND") {
        const payload: RespondFriendRequestInboxResponse = {
          success: false,
          message: "Friend request not found.",
        };
        return NextResponse.json(payload, { status: 404 });
      }

      if (result.code === "FORBIDDEN") {
        const payload: RespondFriendRequestInboxResponse = {
          success: false,
          message: "You are not allowed to respond to this request.",
        };
        return NextResponse.json(payload, { status: 403 });
      }

      const payload: RespondFriendRequestInboxResponse = {
        success: false,
        message: "This request has already been responded to.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const payload: RespondFriendRequestInboxResponse = {
      success: true,
      message:
        parsed.data.action === "accepted"
          ? "Friend request accepted."
          : "Friend request declined.",
    };
    return NextResponse.json(payload);
  } catch {
    const payload: RespondFriendRequestInboxResponse = {
      success: false,
      message: "Unable to respond to friend request right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
