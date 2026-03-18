import { NextResponse } from "next/server";
import { respondFriendRequestSchema } from "@/lib/friendsValidation";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { respondToFriendRequest } from "@/lib/friends";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type RespondFriendRequestResponse = {
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
      const payload: RespondFriendRequestResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      const payload: RespondFriendRequestResponse = {
        success: false,
        message: "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const parsed = respondFriendRequestSchema.safeParse(body);
    if (!parsed.success) {
      const payload: RespondFriendRequestResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const { friendship_id, action } = parsed.data;

    const { data: friendship, error: friendshipError } = await supabaseAdmin
      .from("friendships")
      .select("*")
      .eq("id", friendship_id)
      .limit(1)
      .maybeSingle();

    if (friendshipError) {
      const payload: RespondFriendRequestResponse = {
        success: false,
        message: "Unable to validate friend request right now.",
      };
      return NextResponse.json(payload, { status: 500 });
    }

    if (!friendship) {
      const payload: RespondFriendRequestResponse = {
        success: false,
        message: "Friend request not found.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const requesterId = typeof friendship.requester_id === "string" ? friendship.requester_id : "";
    const addresseeId = typeof friendship.addressee_id === "string" ? friendship.addressee_id : "";
    const currentStatus = typeof friendship.status === "string" ? friendship.status : "";

    if (addresseeId !== sessionUser.id) {
      const payload: RespondFriendRequestResponse = {
        success: false,
        message: "You are not allowed to respond to this request.",
      };
      return NextResponse.json(payload, { status: 403 });
    }

    if (currentStatus !== "pending") {
      const payload: RespondFriendRequestResponse = {
        success: false,
        message: "This request has already been responded to.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const updated = await respondToFriendRequest({
      friendshipId: friendship_id,
      action,
    });

    if (!updated) {
      const payload: RespondFriendRequestResponse = {
        success: false,
        message: "Friend request not found.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const payload: RespondFriendRequestResponse = {
      success: true,
      message: action === "accepted" ? "Friend request accepted." : "Friend request declined.",
      friendship: {
        id: updated.id,
        requester_id: requesterId,
        addressee_id: addresseeId,
        status: updated.status,
      },
    };
    return NextResponse.json(payload);
  } catch {
    const payload: RespondFriendRequestResponse = {
      success: false,
      message: "Unable to respond to friend request right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
