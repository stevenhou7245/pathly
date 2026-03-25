import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { joinStudyRoom } from "@/lib/studyRoom";

export const runtime = "nodejs";

const joinRoomSchema = z.object({
  room_id: z.string().trim().min(1, "room_id is required"),
  password: z.string().trim().min(1, "password is required"),
});

type JoinRoomResponse = {
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
  };
  already_joined?: boolean;
};

export async function POST(request: Request) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<JoinRoomResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json<JoinRoomResponse>(
        { success: false, message: "Invalid request payload." },
        { status: 400 },
      );
    }

    const parsed = joinRoomSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<JoinRoomResponse>(
        { success: false, message: parsed.error.issues[0]?.message ?? "Invalid request payload." },
        { status: 400 },
      );
    }

    const result = await joinStudyRoom({
      userId: sessionUser.id,
      roomId: parsed.data.room_id,
      password: parsed.data.password,
    });

    if (!result.ok) {
      if (result.code === "NOT_FOUND") {
        return NextResponse.json<JoinRoomResponse>(
          { success: false, message: "Study room not found." },
          { status: 404 },
        );
      }
      if (result.code === "INVALID_PASSWORD") {
        return NextResponse.json<JoinRoomResponse>(
          { success: false, message: "Invalid room password." },
          { status: 400 },
        );
      }
      if (result.code === "ROOM_FULL") {
        return NextResponse.json<JoinRoomResponse>(
          { success: false, message: "Study room is full." },
          { status: 409 },
        );
      }
      return NextResponse.json<JoinRoomResponse>(
        { success: false, message: "This study room has already been closed." },
        { status: 400 },
      );
    }

    return NextResponse.json<JoinRoomResponse>({
      success: true,
      message: result.already_joined ? "Already in this room." : "Joined study room.",
      already_joined: result.already_joined,
      room: {
        id: result.room.id,
        creator_id: result.room.creator_id,
        name: result.room.name,
        style: result.room.style,
        max_participants: result.room.max_participants,
        duration_minutes: result.room.duration_minutes,
        status: result.room.status,
        created_at: result.room.created_at,
        expires_at: result.room.expires_at,
        ended_at: result.room.ended_at,
      },
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[study_room_api] join_failed", {
      route: "/api/study-room/join",
      reason,
    });
    return NextResponse.json<JoinRoomResponse>(
      { success: false, message: reason },
      { status: 500 },
    );
  }
}
