import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { leaveStudyRoom } from "@/lib/studyRoom";

export const runtime = "nodejs";

const leaveRoomSchema = z.object({
  room_id: z.string().trim().min(1, "room_id is required"),
  collection_status: z.enum(["completed", "skipped"]).optional(),
});

type LeaveRoomResponse = {
  success: boolean;
  message?: string;
  left?: boolean;
};

export async function POST(request: Request) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<LeaveRoomResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json<LeaveRoomResponse>(
        { success: false, message: "Invalid request payload." },
        { status: 400 },
      );
    }

    const parsed = leaveRoomSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<LeaveRoomResponse>(
        { success: false, message: parsed.error.issues[0]?.message ?? "Invalid request payload." },
        { status: 400 },
      );
    }

    const result = await leaveStudyRoom({
      userId: sessionUser.id,
      roomId: parsed.data.room_id,
      collectionStatus: parsed.data.collection_status ?? null,
    });

    if (!result.ok) {
      if (result.code === "NOT_FOUND") {
        return NextResponse.json<LeaveRoomResponse>(
          { success: false, message: "Study room not found." },
          { status: 404 },
        );
      }
      if (result.code === "CREATOR_CANNOT_LEAVE") {
        return NextResponse.json<LeaveRoomResponse>(
          { success: false, message: "Room creator cannot leave. Use close room instead." },
          { status: 403 },
        );
      }
      return NextResponse.json<LeaveRoomResponse>({
        success: true,
        left: false,
        message: "No active room membership found.",
      });
    }

    return NextResponse.json<LeaveRoomResponse>({
      success: true,
      left: true,
      message: "Left study room.",
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[study_room_api] leave_failed", {
      route: "/api/study-room/leave",
      reason,
    });
    return NextResponse.json<LeaveRoomResponse>(
      { success: false, message: reason },
      { status: 500 },
    );
  }
}
