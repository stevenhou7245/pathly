import { NextResponse } from "next/server";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { listActiveStudyRoomsForUser } from "@/lib/studyRoom";

export const runtime = "nodejs";

type ListMyRoomsResponse = {
  success: boolean;
  message?: string;
  current_user_id?: string;
  rooms?: Array<{
    id: string;
    room_id: string;
    name: string;
    style: string;
    status: string;
    max_participants: number;
    duration_minutes: number;
    created_at: string | null;
    expires_at: string | null;
    ended_at: string | null;
    role: string;
    joined_at: string | null;
    creator_id: string;
    password: string;
  }>;
};

export async function GET() {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<ListMyRoomsResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const rooms = await listActiveStudyRoomsForUser(sessionUser.id);
    return NextResponse.json<ListMyRoomsResponse>(
      {
        success: true,
        current_user_id: sessionUser.id,
        rooms,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[study_room_api] list_my_failed", {
      route: "/api/study-room/my",
      reason,
    });
    return NextResponse.json<ListMyRoomsResponse>(
      { success: false, message: reason, rooms: [] },
      { status: 500 },
    );
  }
}
