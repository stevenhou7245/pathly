import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { createStudyRoom } from "@/lib/studyRoom";

export const runtime = "nodejs";

const createRoomSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(120, "name is too long"),
  style: z.string().trim().min(1, "style is required").max(40, "style is too long"),
  duration_minutes: z
    .number()
    .int()
    .min(15, "duration_minutes must be >= 15")
    .max(720, "duration_minutes must be <= 720"),
  password: z.string().trim().min(1, "password is required").max(120, "password is too long"),
  max_participants: z
    .number()
    .int()
    .min(2, "max_participants must be >= 2")
    .max(50, "max_participants must be <= 50")
    .optional(),
});

type CreateRoomResponse = {
  success: boolean;
  message?: string;
  room?: {
    id: string;
    name: string;
    style: string;
    max_participants: number;
    duration_minutes: number;
    status: string;
    created_at: string | null;
    expires_at: string | null;
  };
  room_id?: string;
  password?: string;
};

export async function POST(request: Request) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<CreateRoomResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json<CreateRoomResponse>(
        { success: false, message: "Invalid request payload." },
        { status: 400 },
      );
    }

    const parsed = createRoomSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<CreateRoomResponse>(
        {
          success: false,
          message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
        },
        { status: 400 },
      );
    }

    const room = await createStudyRoom({
      creatorId: sessionUser.id,
      name: parsed.data.name,
      style: parsed.data.style,
      durationMinutes: parsed.data.duration_minutes,
      password: parsed.data.password,
      maxParticipants: parsed.data.max_participants,
    });

    return NextResponse.json<CreateRoomResponse>(
      {
        success: true,
        message: "Study room created.",
        room_id: room.id,
        password: room.password,
        room: {
          id: room.id,
          name: room.name,
          style: room.style,
          max_participants: room.max_participants,
          duration_minutes: room.duration_minutes,
          status: room.status,
          created_at: room.created_at,
          expires_at: room.expires_at,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[study_room_api] create_failed", {
      route: "/api/study-room/create",
      reason,
    });
    return NextResponse.json<CreateRoomResponse>(
      {
        success: false,
        message: reason,
      },
      { status: 500 },
    );
  }
}
