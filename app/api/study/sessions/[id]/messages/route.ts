import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import {
  createStudySessionMessage,
  getStudySessionForUser,
  getStudySessionMessages,
} from "@/lib/study";

export const runtime = "nodejs";

const sendMessageSchema = z.object({
  body: z
    .string()
    .trim()
    .min(1, "Message body cannot be empty.")
    .max(2000, "Message body must be 2000 characters or fewer."),
});

type StudySessionMessagesResponse = {
  success: boolean;
  message?: string;
  messages?: Array<{
    id: string;
    session_id: string;
    sender_id: string;
    body: string;
    created_at: string | null;
  }>;
  sent_message?: {
    id: string;
    session_id: string;
    sender_id: string;
    body: string;
    created_at: string | null;
  };
};

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<StudySessionMessagesResponse>(
        {
          success: false,
          message: "Unauthorized.",
        },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json<StudySessionMessagesResponse>(
        {
          success: false,
          message: "Session id is required.",
        },
        { status: 400 },
      );
    }

    const sessionAccess = await getStudySessionForUser({
      userId: sessionUser.id,
      sessionId: id,
    });

    if (!sessionAccess) {
      return NextResponse.json<StudySessionMessagesResponse>(
        {
          success: false,
          message: "Study session not found.",
        },
        { status: 404 },
      );
    }

    if (sessionAccess.forbidden) {
      return NextResponse.json<StudySessionMessagesResponse>(
        {
          success: false,
          message: "You are not allowed to access this study session.",
        },
        { status: 403 },
      );
    }

    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get("limit");
    const limit =
      typeof limitParam === "string" && limitParam.trim() ? Number(limitParam) : undefined;

    const messages = await getStudySessionMessages({
      sessionId: id,
      limit,
    });

    return NextResponse.json<StudySessionMessagesResponse>(
      {
        success: true,
        messages,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    return NextResponse.json<StudySessionMessagesResponse>(
      {
        success: false,
        message: "Unable to load study session messages right now.",
      },
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
      return NextResponse.json<StudySessionMessagesResponse>(
        {
          success: false,
          message: "Unauthorized.",
        },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json<StudySessionMessagesResponse>(
        {
          success: false,
          message: "Session id is required.",
        },
        { status: 400 },
      );
    }

    const sessionAccess = await getStudySessionForUser({
      userId: sessionUser.id,
      sessionId: id,
    });

    if (!sessionAccess) {
      return NextResponse.json<StudySessionMessagesResponse>(
        {
          success: false,
          message: "Study session not found.",
        },
        { status: 404 },
      );
    }

    if (sessionAccess.forbidden) {
      return NextResponse.json<StudySessionMessagesResponse>(
        {
          success: false,
          message: "You are not allowed to access this study session.",
        },
        { status: 403 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json<StudySessionMessagesResponse>(
        {
          success: false,
          message: "Invalid request payload.",
        },
        { status: 400 },
      );
    }

    const parsed = sendMessageSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<StudySessionMessagesResponse>(
        {
          success: false,
          message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
        },
        { status: 400 },
      );
    }

    const sentMessage = await createStudySessionMessage({
      sessionId: id,
      senderId: sessionUser.id,
      body: parsed.data.body,
    });

    return NextResponse.json<StudySessionMessagesResponse>(
      {
        success: true,
        message: "Message sent.",
        sent_message: sentMessage,
      },
      { status: 201 },
    );
  } catch {
    return NextResponse.json<StudySessionMessagesResponse>(
      {
        success: false,
        message: "Unable to send study message right now.",
      },
      { status: 500 },
    );
  }
}

