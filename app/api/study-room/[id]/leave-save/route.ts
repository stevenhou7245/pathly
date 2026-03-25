import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import {
  listUserNotebooks,
  loadStudyRoomSavableContent,
  saveStudyRoomContentToNotebookEntry,
  type StudyRoomSavableContent,
  type UserNotebookEntryRecord,
  type UserNotebookRecord,
} from "@/lib/notebook";

export const runtime = "nodejs";

const leaveSavePostSchema = z.object({
  notebook_id: z.string().uuid("notebook_id must be a valid uuid"),
  entry_topic: z.string().trim().min(1, "entry_topic is required").max(200, "entry_topic is too long"),
  selected_item_ids: z.array(z.string().trim().min(1)).max(500, "Too many selected items"),
});

type LeaveSaveResponse = {
  success: boolean;
  message?: string;
  content?: StudyRoomSavableContent;
  notebooks?: UserNotebookRecord[];
  notebook?: UserNotebookRecord;
  entry?: UserNotebookEntryRecord;
  selected_summary?: {
    notes_count: number;
    resources_count: number;
    ai_exchanges_count: number;
  };
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<LeaveSaveResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json<LeaveSaveResponse>(
        { success: false, message: "Room id is required." },
        { status: 400 },
      );
    }

    const [loaded, notebooks] = await Promise.all([
      loadStudyRoomSavableContent({
        userId: sessionUser.id,
        roomId: id,
      }),
      listUserNotebooks({
        userId: sessionUser.id,
      }),
    ]);
    if (!loaded.ok) {
      if (loaded.code === "NOT_FOUND") {
        return NextResponse.json<LeaveSaveResponse>(
          { success: false, message: "Study room not found." },
          { status: 404 },
        );
      }
      return NextResponse.json<LeaveSaveResponse>(
        { success: false, message: "You are not a participant of this room." },
        { status: 403 },
      );
    }

    return NextResponse.json<LeaveSaveResponse>(
      {
        success: true,
        content: loaded.content,
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
    console.error("[study_room_api] leave_save_get_failed", {
      route: "/api/study-room/[id]/leave-save GET",
      reason,
    });
    return NextResponse.json<LeaveSaveResponse>(
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
      return NextResponse.json<LeaveSaveResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json<LeaveSaveResponse>(
        { success: false, message: "Room id is required." },
        { status: 400 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json<LeaveSaveResponse>(
        { success: false, message: "Invalid request payload." },
        { status: 400 },
      );
    }

    const parsed = leaveSavePostSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<LeaveSaveResponse>(
        { success: false, message: parsed.error.issues[0]?.message ?? "Invalid request payload." },
        { status: 400 },
      );
    }

    const saved = await saveStudyRoomContentToNotebookEntry({
      userId: sessionUser.id,
      roomId: id,
      notebookId: parsed.data.notebook_id,
      entryTopic: parsed.data.entry_topic,
      selectedItemIds: parsed.data.selected_item_ids,
    });
    if (!saved.ok) {
      if (saved.code === "NOT_FOUND") {
        return NextResponse.json<LeaveSaveResponse>(
          { success: false, message: "Study room not found." },
          { status: 404 },
        );
      }
      return NextResponse.json<LeaveSaveResponse>(
        {
          success: false,
          message:
            saved.code === "NOTEBOOK_NOT_FOUND"
              ? "Selected notebook not found."
              : "You are not a participant of this room.",
        },
        { status: saved.code === "NOTEBOOK_NOT_FOUND" ? 404 : 403 },
      );
    }

    return NextResponse.json<LeaveSaveResponse>(
      {
        success: true,
        notebook: saved.notebook,
        entry: saved.entry,
        selected_summary: saved.selected_summary,
      },
      { status: 201 },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[study_room_api] leave_save_post_failed", {
      route: "/api/study-room/[id]/leave-save POST",
      reason,
    });
    return NextResponse.json<LeaveSaveResponse>(
      { success: false, message: reason },
      { status: 500 },
    );
  }
}
