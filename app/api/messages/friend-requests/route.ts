import { NextResponse } from "next/server";
import { getIncomingPendingFriendRequestsForUser } from "@/lib/inbox";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";

export const runtime = "nodejs";

type FriendRequestsInboxResponse = {
  success: boolean;
  message?: string;
  current_user_id?: string;
  friend_requests?: Array<{
    friendship_id: string;
    sender: {
      id: string;
      username: string;
      avatar_url: string | null;
      current_learning_field_title: string | null;
    };
    status: string;
    created_at: string | null;
  }>;
};

export async function GET() {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: FriendRequestsInboxResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    const friendRequests = await getIncomingPendingFriendRequestsForUser(sessionUser.id);
    const payload: FriendRequestsInboxResponse = {
      success: true,
      current_user_id: sessionUser.id,
      friend_requests: friendRequests,
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    const payload: FriendRequestsInboxResponse = {
      success: false,
      message: "Unable to load friend requests right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
