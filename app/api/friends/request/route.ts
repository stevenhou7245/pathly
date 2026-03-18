import { NextResponse } from "next/server";
import {
  createFriendRequest,
  ensureUserExists,
  getFriendshipBetweenUsers,
} from "@/lib/friends";
import { sendFriendRequestSchema } from "@/lib/friendsValidation";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";

export const runtime = "nodejs";

type FriendRequestResponse = {
  success: boolean;
  message?: string;
  friendship?: {
    id: string;
    requester_id: string;
    addressee_id: string;
    status: string;
  };
};

export async function POST(request: Request) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: FriendRequestResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      const payload: FriendRequestResponse = {
        success: false,
        message: "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const parsed = sendFriendRequestSchema.safeParse(body);
    if (!parsed.success) {
      const payload: FriendRequestResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const targetUserId = parsed.data.target_user_id;

    if (targetUserId === sessionUser.id) {
      const payload: FriendRequestResponse = {
        success: false,
        message: "You cannot send a friend request to yourself.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const targetExists = await ensureUserExists(targetUserId);
    if (!targetExists) {
      const payload: FriendRequestResponse = {
        success: false,
        message: "Target user not found.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const existingFriendship = await getFriendshipBetweenUsers(sessionUser.id, targetUserId);
    if (existingFriendship) {
      const payload: FriendRequestResponse = {
        success: false,
        message: "Friendship already exists between these users.",
      };
      return NextResponse.json(payload, { status: 409 });
    }

    const friendship = await createFriendRequest({
      requesterId: sessionUser.id,
      addresseeId: targetUserId,
    });

    const payload: FriendRequestResponse = {
      success: true,
      message: "Friend request sent.",
      friendship: {
        id: friendship.id,
        requester_id: friendship.requester_id,
        addressee_id: friendship.addressee_id,
        status: friendship.status,
      },
    };
    return NextResponse.json(payload, { status: 201 });
  } catch {
    const payload: FriendRequestResponse = {
      success: false,
      message: "Unable to send friend request right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
