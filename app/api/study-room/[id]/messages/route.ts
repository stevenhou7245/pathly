import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { getStudyRoomMessagesForUser, sendStudyRoomMessage } from "@/lib/studyRoom";

export const runtime = "nodejs";

const sendMessageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Message body cannot be empty.")
    .max(2000, "Message body must be 2000 characters or fewer."),
  type: z.string().trim().max(40, "Message type is too long.").optional(),
});

type StudyRoomMessagesResponse = {
  success: boolean;
  message?: string;
  messages?: Array<{
    id: string;
    room_id: string;
    sender_id: string;
    sender_username?: string | null;
    body: string;
    created_at: string | null;
    type: string;
  }>;
  sent_message?: {
    id: string;
    room_id: string;
    sender_id: string;
    sender_username?: string | null;
    body: string;
    created_at: string | null;
    type: string;
  };
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<StudyRoomMessagesResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json<StudyRoomMessagesResponse>(
        { success: false, message: "Room id is required." },
        { status: 400 },
      );
    }

    const result = await getStudyRoomMessagesForUser({
      userId: sessionUser.id,
      roomId: id,
    });

    if (!result.ok) {
      if (result.code === "NOT_FOUND") {
        return NextResponse.json<StudyRoomMessagesResponse>(
          { success: false, message: "Study room not found." },
          { status: 404 },
        );
      }
      return NextResponse.json<StudyRoomMessagesResponse>(
        { success: false, message: "You are not a participant of this room." },
        { status: 403 },
      );
    }

    return NextResponse.json<StudyRoomMessagesResponse>(
      {
        success: true,
        messages: result.messages,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[study_room_api] messages_get_failed", {
      route: "/api/study-room/[id]/messages GET",
      reason,
    });
    return NextResponse.json<StudyRoomMessagesResponse>(
      { success: false, message: reason, messages: [] },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<StudyRoomMessagesResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json<StudyRoomMessagesResponse>(
        { success: false, message: "Room id is required." },
        { status: 400 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json<StudyRoomMessagesResponse>(
        { success: false, message: "Invalid request payload." },
        { status: 400 },
      );
    }

    const parsed = sendMessageSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<StudyRoomMessagesResponse>(
        { success: false, message: parsed.error.issues[0]?.message ?? "Invalid request payload." },
        { status: 400 },
      );
    }

    console.info("[study_room_messages] send_started", {
      room_id: id,
      sender_id: sessionUser.id,
      type: parsed.data.type ?? "chat",
    });

    const result = await sendStudyRoomMessage({
      userId: sessionUser.id,
      roomId: id,
      body: parsed.data.body,
      type: parsed.data.type ?? "chat",
    });

    if (!result.ok) {
      console.warn("[study_room_messages] send_forbidden_or_invalid", {
        room_id: id,
        sender_id: sessionUser.id,
        code: result.code,
      });
      if (result.code === "NOT_FOUND") {
        return NextResponse.json<StudyRoomMessagesResponse>(
          { success: false, message: "Study room not found." },
          { status: 404 },
        );
      }
      if (result.code === "ROOM_EXPIRED") {
        return NextResponse.json<StudyRoomMessagesResponse>(
          { success: false, message: "This study room has expired and is waiting for creator action." },
          { status: 400 },
        );
      }
      if (result.code === "ROOM_CLOSED") {
        return NextResponse.json<StudyRoomMessagesResponse>(
          { success: false, message: "This study room has been closed." },
          { status: 400 },
        );
      }
      return NextResponse.json<StudyRoomMessagesResponse>(
        { success: false, message: "You are not a participant of this room." },
        { status: 403 },
      );
    }

    console.info("[study_room_messages] send_completed", {
      room_id: id,
      sender_id: sessionUser.id,
      message_id: result.message.id,
      type: result.message.type,
      realtime_mode: "postgres_changes",
    });

    return NextResponse.json<StudyRoomMessagesResponse>(
      {
        success: true,
        message: "Message sent.",
        sent_message: result.message,
      },
      { status: 201 },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[study_room_api] messages_post_failed", {
      route: "/api/study-room/[id]/messages POST",
      reason,
    });
    return NextResponse.json<StudyRoomMessagesResponse>(
      { success: false, message: reason },
      { status: 500 },
    );
  }
}
