import { NextResponse } from "next/server";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import {
  getActiveStudySessionsForUser,
  getPendingStudyInvitationsForUser,
} from "@/lib/study";

export const runtime = "nodejs";

type StudyInvitationsInboxResponse = {
  success: boolean;
  message?: string;
  current_user_id?: string;
  invitations?: Array<{
    id: string;
    sender_id: string;
    receiver_id: string;
    learning_field_id: string | null;
    status: string;
    created_at: string | null;
    responded_at: string | null;
    sender: {
      id: string;
      username: string;
    };
    learning_field_title: string | null;
  }>;
  active_sessions?: Array<{
    id: string;
    invitation_id: string | null;
    user_a_id: string;
    user_b_id: string;
    learning_field_id: string | null;
    learning_field_title: string | null;
    status: string;
    created_at: string | null;
    ended_at: string | null;
  }>;
};

export async function GET() {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<StudyInvitationsInboxResponse>(
        {
          success: false,
          message: "Unauthorized.",
        },
        { status: 401 },
      );
    }

    const [invitations, activeSessions] = await Promise.all([
      getPendingStudyInvitationsForUser(sessionUser.id),
      getActiveStudySessionsForUser(sessionUser.id),
    ]);

    return NextResponse.json<StudyInvitationsInboxResponse>(
      {
        success: true,
        current_user_id: sessionUser.id,
        invitations,
        active_sessions: activeSessions,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    return NextResponse.json<StudyInvitationsInboxResponse>(
      {
        success: false,
        message: "Unable to load study invitations right now.",
      },
      { status: 500 },
    );
  }
}
