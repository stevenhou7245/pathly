import { NextResponse } from "next/server";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { getStudySessionForUser } from "@/lib/study";

export const runtime = "nodejs";

type StudySessionResponse = {
  success: boolean;
  message?: string;
  session?: {
    id: string;
    invitation_id: string | null;
    user_a_id: string;
    user_b_id: string;
    learning_field_id: string | null;
    status: string;
    created_at: string | null;
    ended_at: string | null;
  };
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<StudySessionResponse>(
        {
          success: false,
          message: "Unauthorized.",
        },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json<StudySessionResponse>(
        {
          success: false,
          message: "Session id is required.",
        },
        { status: 400 },
      );
    }

    const result = await getStudySessionForUser({
      userId: sessionUser.id,
      sessionId: id,
    });

    if (!result) {
      return NextResponse.json<StudySessionResponse>(
        {
          success: false,
          message: "Study session not found.",
        },
        { status: 404 },
      );
    }

    if (result.forbidden) {
      return NextResponse.json<StudySessionResponse>(
        {
          success: false,
          message: "You are not allowed to access this study session.",
        },
        { status: 403 },
      );
    }

    return NextResponse.json<StudySessionResponse>({
      success: true,
      session: result.session,
    });
  } catch {
    return NextResponse.json<StudySessionResponse>(
      {
        success: false,
        message: "Unable to load study session right now.",
      },
      { status: 500 },
    );
  }
}

