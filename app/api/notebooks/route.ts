import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import {
  createUserNotebook,
  listUserNotebooks,
  type UserNotebookRecord,
} from "@/lib/notebook";

export const runtime = "nodejs";

const notebookCreateSchema = z.object({
  topic: z.string().trim().min(1, "topic is required").max(200, "topic is too long"),
  content_md: z.string().max(500_000, "content is too large").optional().nullable(),
  source_type: z
    .enum(["manual", "study_room_exit_save", "study_room_manual_save"])
    .optional(),
  source_room_id: z.string().uuid("source_room_id must be a valid uuid").optional().nullable(),
});

type NotebooksResponse = {
  success: boolean;
  message?: string;
  notebooks?: UserNotebookRecord[];
  notebook?: UserNotebookRecord;
};

export async function GET() {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<NotebooksResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const notebooks = await listUserNotebooks({
      userId: sessionUser.id,
    });
    return NextResponse.json<NotebooksResponse>(
      {
        success: true,
        notebooks,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[notebook_api] list_failed", {
      route: "/api/notebooks GET",
      reason,
    });
    return NextResponse.json<NotebooksResponse>(
      { success: false, message: reason },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<NotebooksResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json<NotebooksResponse>(
        { success: false, message: "Invalid request payload." },
        { status: 400 },
      );
    }

    const parsed = notebookCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<NotebooksResponse>(
        { success: false, message: parsed.error.issues[0]?.message ?? "Invalid request payload." },
        { status: 400 },
      );
    }

    const notebook = await createUserNotebook({
      userId: sessionUser.id,
      topic: parsed.data.topic,
      contentMd: parsed.data.content_md ?? null,
      sourceType: parsed.data.source_type ?? "manual",
      sourceRoomId: parsed.data.source_room_id ?? null,
    });

    return NextResponse.json<NotebooksResponse>(
      {
        success: true,
        notebook,
      },
      { status: 201 },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[notebook_api] create_failed", {
      route: "/api/notebooks POST",
      reason,
    });
    return NextResponse.json<NotebooksResponse>(
      { success: false, message: reason },
      { status: 500 },
    );
  }
}
