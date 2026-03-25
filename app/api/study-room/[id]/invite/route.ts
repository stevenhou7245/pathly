import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { createStudyRoomInvitations } from "@/lib/studyRoom";

export const runtime = "nodejs";

const inviteSchema = z.object({
  friend_user_ids: z
    .array(z.string().uuid("friend_user_ids must contain valid UUID values"))
    .min(1, "Select at least one friend."),
});

type InviteResponse = {
  success: boolean;
  message?: string;
  invited_count?: number;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<InviteResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json<InviteResponse>(
        { success: false, message: "Room id is required." },
        { status: 400 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json<InviteResponse>(
        { success: false, message: "Invalid request payload." },
        { status: 400 },
      );
    }

    const parsed = inviteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<InviteResponse>(
        { success: false, message: parsed.error.issues[0]?.message ?? "Invalid request payload." },
        { status: 400 },
      );
    }

    console.info("[study_room_invite] send_started", {
      room_id: id,
      sender_id: sessionUser.id,
      requested_receiver_count: parsed.data.friend_user_ids.length,
    });

    const result = await createStudyRoomInvitations({
      senderId: sessionUser.id,
      roomId: id,
      receiverIds: parsed.data.friend_user_ids,
    });

    if (!result.ok) {
      if (result.code === "NOT_FOUND") {
        return NextResponse.json<InviteResponse>(
          { success: false, message: "Study room not found." },
          { status: 404 },
        );
      }
      if (result.code === "ROOM_CLOSED") {
        return NextResponse.json<InviteResponse>(
          { success: false, message: "This study room has already been closed." },
          { status: 400 },
        );
      }
      return NextResponse.json<InviteResponse>(
        { success: false, message: "Only the creator can invite friends to this room." },
        { status: 403 },
      );
    }

    console.info("[study_room_invite] send_completed", {
      room_id: id,
      sender_id: sessionUser.id,
      invited_count: result.invitations.length,
    });

    return NextResponse.json<InviteResponse>({
      success: true,
      message: result.invitations.length > 0 ? "Invitations sent." : "No eligible friends selected.",
      invited_count: result.invitations.length,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[study_room_invite] send_failed", {
      route: "/api/study-room/[id]/invite",
      reason,
    });
    return NextResponse.json<InviteResponse>(
      { success: false, message: reason },
      { status: 500 },
    );
  }
}
