import { NextResponse } from "next/server";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { closeStudyRoom } from "@/lib/studyRoom";

export const runtime = "nodejs";

type CloseRoomResponse = {
  success: boolean;
  message?: string;
};

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<CloseRoomResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json<CloseRoomResponse>(
        { success: false, message: "Room id is required." },
        { status: 400 },
      );
    }

    const result = await closeStudyRoom({
      userId: sessionUser.id,
      roomId: id,
    });

    if (!result.ok) {
      if (result.code === "NOT_FOUND") {
        return NextResponse.json<CloseRoomResponse>(
          { success: false, message: "Study room not found." },
          { status: 404 },
        );
      }
      return NextResponse.json<CloseRoomResponse>(
        { success: false, message: "Only the creator can close this room." },
        { status: 403 },
      );
    }

    return NextResponse.json<CloseRoomResponse>({
      success: true,
      message: "Study room closed.",
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[study_room_api] close_failed", {
      route: "/api/study-room/[id]/close",
      reason,
    });
    return NextResponse.json<CloseRoomResponse>(
      { success: false, message: reason },
      { status: 500 },
    );
  }
}

