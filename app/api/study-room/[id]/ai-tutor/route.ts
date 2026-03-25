import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import {
  askStudyRoomAiTutor,
  listStudyRoomAiMessages,
  type StudyRoomAiMessage,
} from "@/lib/studyRoomWorkspace";

export const runtime = "nodejs";

const aiTutorPostSchema = z.object({
  question: z
    .string()
    .trim()
    .min(1, "question is required")
    .max(3000, "question must be 3000 characters or fewer"),
  include_in_notes: z.boolean().optional().default(true),
});

type AiTutorResponse = {
  success: boolean;
  message?: string;
  messages?: StudyRoomAiMessage[];
  user_message?: StudyRoomAiMessage;
  assistant_message?: StudyRoomAiMessage;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<AiTutorResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json<AiTutorResponse>(
        { success: false, message: "Room id is required." },
        { status: 400 },
      );
    }

    const result = await listStudyRoomAiMessages({
      userId: sessionUser.id,
      roomId: id,
    });
    if (!result.ok) {
      if (result.code === "NOT_FOUND") {
        return NextResponse.json<AiTutorResponse>(
          { success: false, message: "Study room not found." },
          { status: 404 },
        );
      }
      return NextResponse.json<AiTutorResponse>(
        { success: false, message: "You are not a participant of this room." },
        { status: 403 },
      );
    }

    return NextResponse.json<AiTutorResponse>(
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
    console.error("[study_room_api] ai_tutor_get_failed", {
      route: "/api/study-room/[id]/ai-tutor GET",
      reason,
    });
    return NextResponse.json<AiTutorResponse>(
      { success: false, message: reason },
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
      return NextResponse.json<AiTutorResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json<AiTutorResponse>(
        { success: false, message: "Room id is required." },
        { status: 400 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json<AiTutorResponse>(
        { success: false, message: "Invalid request payload." },
        { status: 400 },
      );
    }
    const parsed = aiTutorPostSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<AiTutorResponse>(
        {
          success: false,
          message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
        },
        { status: 400 },
      );
    }

    const result = await askStudyRoomAiTutor({
      userId: sessionUser.id,
      roomId: id,
      question: parsed.data.question,
      includeInNotes: parsed.data.include_in_notes,
    });
    if (!result.ok) {
      if (result.code === "NOT_FOUND") {
        return NextResponse.json<AiTutorResponse>(
          { success: false, message: "Study room not found." },
          { status: 404 },
        );
      }
      if (result.code === "ROOM_CLOSED") {
        return NextResponse.json<AiTutorResponse>(
          { success: false, message: "This study room has been closed." },
          { status: 400 },
        );
      }
      return NextResponse.json<AiTutorResponse>(
        { success: false, message: "You are not a participant of this room." },
        { status: 403 },
      );
    }

    return NextResponse.json<AiTutorResponse>(
      {
        success: true,
        user_message: result.user_message,
        assistant_message: result.assistant_message,
      },
      { status: 201 },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[study_room_api] ai_tutor_post_failed", {
      route: "/api/study-room/[id]/ai-tutor POST",
      reason,
    });
    return NextResponse.json<AiTutorResponse>(
      { success: false, message: reason },
      { status: 500 },
    );
  }
}
