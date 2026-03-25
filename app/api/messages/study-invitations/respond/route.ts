import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { respondToStudyRoomInvitation } from "@/lib/studyRoom";

export const runtime = "nodejs";

const respondSchema = z.object({
  invitation_id: z.string().uuid("invitation_id must be a valid UUID"),
  action: z.enum(["accepted", "declined"]),
});

type RespondInvitationResponse = {
  success: boolean;
  message?: string;
  room_id?: string;
};

export async function POST(request: Request) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<RespondInvitationResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json<RespondInvitationResponse>(
        { success: false, message: "Invalid request payload." },
        { status: 400 },
      );
    }

    const parsed = respondSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<RespondInvitationResponse>(
        { success: false, message: parsed.error.issues[0]?.message ?? "Invalid request payload." },
        { status: 400 },
      );
    }

    console.info("[study_room_invite] respond_started", {
      invitation_id: parsed.data.invitation_id,
      receiver_id: sessionUser.id,
      action: parsed.data.action,
    });

    const result = await respondToStudyRoomInvitation({
      invitationId: parsed.data.invitation_id,
      receiverId: sessionUser.id,
      action: parsed.data.action,
    });

    if (!result.ok) {
      if (result.code === "NOT_FOUND") {
        return NextResponse.json<RespondInvitationResponse>(
          { success: false, message: "Invitation not found." },
          { status: 404 },
        );
      }
      if (result.code === "FORBIDDEN") {
        return NextResponse.json<RespondInvitationResponse>(
          { success: false, message: "You are not allowed to respond to this invitation." },
          { status: 403 },
        );
      }
      if (result.code === "ALREADY_RESPONDED") {
        return NextResponse.json<RespondInvitationResponse>(
          { success: false, message: "This invitation has already been handled." },
          { status: 400 },
        );
      }
      if (result.code === "ROOM_FULL") {
        return NextResponse.json<RespondInvitationResponse>(
          { success: false, message: "This study room is full." },
          { status: 409 },
        );
      }
      if (result.code === "ROOM_EXPIRED") {
        return NextResponse.json<RespondInvitationResponse>(
          { success: false, message: "This study room has expired and is waiting for creator action." },
          { status: 400 },
        );
      }
      if (result.code === "ROOM_CLOSED") {
        return NextResponse.json<RespondInvitationResponse>(
          { success: false, message: "This study room has been closed." },
          { status: 400 },
        );
      }
      return NextResponse.json<RespondInvitationResponse>(
        { success: false, message: "Unable to join this room right now." },
        { status: 400 },
      );
    }

    console.info("[study_room_invite] respond_completed", {
      invitation_id: parsed.data.invitation_id,
      receiver_id: sessionUser.id,
      action: parsed.data.action,
      joined: result.joined,
      room_id: result.room_id,
    });

    return NextResponse.json<RespondInvitationResponse>({
      success: true,
      message:
        parsed.data.action === "accepted"
          ? "Invitation accepted. Joined room."
          : "Invitation declined.",
      room_id: result.room_id,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[study_room_invite] respond_failed", {
      route: "/api/messages/study-invitations/respond",
      reason,
    });
    return NextResponse.json<RespondInvitationResponse>(
      { success: false, message: reason },
      { status: 500 },
    );
  }
}
