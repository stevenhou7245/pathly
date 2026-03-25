import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { extendStudyRoomDuration } from "@/lib/studyRoom";

export const runtime = "nodejs";

const extendSchema = z.object({
  duration_minutes: z
    .number()
    .int()
    .min(15, "duration_minutes must be >= 15")
    .max(720, "duration_minutes must be <= 720"),
});

type ExtendRoomResponse = {
  success: boolean;
  message?: string;
  room?: {
    id: string;
    status: string;
    duration_minutes: number;
    expires_at: string | null;
  };
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<ExtendRoomResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json<ExtendRoomResponse>(
        { success: false, message: "Room id is required." },
        { status: 400 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json<ExtendRoomResponse>(
        { success: false, message: "Invalid request payload." },
        { status: 400 },
      );
    }

    const parsed = extendSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<ExtendRoomResponse>(
        { success: false, message: parsed.error.issues[0]?.message ?? "Invalid request payload." },
        { status: 400 },
      );
    }

    console.info("[study_room_api] extend_request_received", {
      room_id: id,
      user_id: sessionUser.id,
      duration_minutes: parsed.data.duration_minutes,
    });

    const result = await extendStudyRoomDuration({
      userId: sessionUser.id,
      roomId: id,
      durationMinutes: parsed.data.duration_minutes,
    });

    if (!result.ok) {
      if (result.code === "NOT_FOUND") {
        return NextResponse.json<ExtendRoomResponse>(
          { success: false, message: "Study room not found." },
          { status: 404 },
        );
      }
      if (result.code === "ROOM_CLOSED") {
        return NextResponse.json<ExtendRoomResponse>(
          { success: false, message: "This study room has already been closed." },
          { status: 400 },
        );
      }
      return NextResponse.json<ExtendRoomResponse>(
        { success: false, message: "Only the creator can extend this room." },
        { status: 403 },
      );
    }

    return NextResponse.json<ExtendRoomResponse>({
      success: true,
      message: "Study room extended.",
      room: {
        id: result.room.id,
        status: result.room.status,
        duration_minutes: result.room.duration_minutes,
        expires_at: result.room.expires_at,
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[study_room_api] extend_failed", {
      route: "/api/study-room/[id]/extend",
      reason,
    });
    return NextResponse.json<ExtendRoomResponse>(
      { success: false, message: reason },
      { status: 500 },
    );
  }
}
