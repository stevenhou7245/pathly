import { NextResponse } from "next/server";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { getStudyRoomDetailsForUser } from "@/lib/studyRoom";

export const runtime = "nodejs";

type StudyRoomDetailResponse = {
  success: boolean;
  message?: string;
  room?: {
    id: string;
    creator_id: string;
    name: string;
    style: string;
    max_participants: number;
    duration_minutes: number;
    status: string;
    created_at: string | null;
    expires_at: string | null;
    ended_at: string | null;
    password: string;
    can_close: boolean;
    can_extend: boolean;
    can_leave: boolean;
    viewer_user_id: string;
  };
  participants?: Array<{
    id: string;
    room_id: string;
    user_id: string;
    joined_at: string | null;
    left_at: string | null;
    role: string;
    username: string;
    presence_state: string;
    focus_mode: boolean;
    focus_started_at: string | null;
    last_active_at: string | null;
    current_streak_seconds: number;
    total_focus_seconds: number;
    session_seconds: number;
    goal_text: string | null;
    goal_status: string;
  }>;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<StudyRoomDetailResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json<StudyRoomDetailResponse>(
        { success: false, message: "Room id is required." },
        { status: 400 },
      );
    }

    const result = await getStudyRoomDetailsForUser({
      userId: sessionUser.id,
      roomId: id,
    });

    if (!result.ok) {
      if (result.code === "NOT_FOUND") {
        return NextResponse.json<StudyRoomDetailResponse>(
          { success: false, message: "Study room not found." },
          { status: 404 },
        );
      }
      return NextResponse.json<StudyRoomDetailResponse>(
        { success: false, message: "You are not a participant of this room." },
        { status: 403 },
      );
    }

    return NextResponse.json<StudyRoomDetailResponse>(
      {
        success: true,
        room: result.room,
        participants: result.participants,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[study_room_api] detail_failed", {
      route: "/api/study-room/[id]",
      reason,
    });
    return NextResponse.json<StudyRoomDetailResponse>(
      { success: false, message: reason },
      { status: 500 },
    );
  }
}
