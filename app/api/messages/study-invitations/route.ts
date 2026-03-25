import { NextResponse } from "next/server";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { getStudyRoomInvitationsForUser } from "@/lib/studyRoom";

export const runtime = "nodejs";

type StudyInvitationItem = {
  id: string;
  room_id: string;
  sender_id: string;
  receiver_id: string;
  status: string;
  created_at: string | null;
  responded_at: string | null;
  sender_username: string;
  room_name: string;
  room_password: string;
  room_style: string;
  room_duration_minutes: number;
  room_status: string;
  room_expires_at: string | null;
};

type StudyInvitationsResponse = {
  success: boolean;
  message?: string;
  current_user_id?: string;
  study_invitations?: StudyInvitationItem[];
};

export async function GET() {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<StudyInvitationsResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const invitations = await getStudyRoomInvitationsForUser(sessionUser.id);
    return NextResponse.json<StudyInvitationsResponse>(
      {
        success: true,
        current_user_id: sessionUser.id,
        study_invitations: invitations,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[study_room_invite] fetch_failed", {
      route: "/api/messages/study-invitations",
      reason,
    });
    return NextResponse.json<StudyInvitationsResponse>(
      {
        success: false,
        message: reason,
        study_invitations: [],
      },
      { status: 500 },
    );
  }
}
