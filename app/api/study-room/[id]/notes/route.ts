import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import {
  deleteStudyRoomNoteEntry,
  getStudyRoomNotes,
  saveStudyRoomNotes,
  type StudyRoomNoteEntryRecord,
  type StudyRoomNoteRecord,
} from "@/lib/studyRoomWorkspace";

export const runtime = "nodejs";

const notesPutSchema = z.object({
  content: z.string().max(100_000, "content is too large"),
  entry_id: z.string().uuid("entry_id must be a valid uuid").optional().nullable(),
});

type NotesResponse = {
  success: boolean;
  message?: string;
  note?: StudyRoomNoteRecord;
  entries?: StudyRoomNoteEntryRecord[];
  my_entry?: StudyRoomNoteEntryRecord | null;
  saved_entry?: StudyRoomNoteEntryRecord;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<NotesResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json<NotesResponse>(
        { success: false, message: "Room id is required." },
        { status: 400 },
      );
    }

    const result = await getStudyRoomNotes({
      userId: sessionUser.id,
      roomId: id,
    });

    if (!result.ok) {
      if (result.code === "NOT_FOUND") {
        return NextResponse.json<NotesResponse>(
          { success: false, message: "Study room not found." },
          { status: 404 },
        );
      }
      return NextResponse.json<NotesResponse>(
        { success: false, message: "You are not a participant of this room." },
        { status: 403 },
      );
    }

    return NextResponse.json<NotesResponse>(
      {
        success: true,
        note: result.note,
        entries: result.entries,
        my_entry: result.my_entry,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[study_room_api] notes_get_failed", {
      route: "/api/study-room/[id]/notes GET",
      reason,
    });
    return NextResponse.json<NotesResponse>(
      { success: false, message: reason },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<NotesResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json<NotesResponse>(
        { success: false, message: "Room id is required." },
        { status: 400 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json<NotesResponse>(
        { success: false, message: "Invalid request payload." },
        { status: 400 },
      );
    }
    const parsed = notesPutSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<NotesResponse>(
        {
          success: false,
          message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
        },
        { status: 400 },
      );
    }

    const result = await saveStudyRoomNotes({
      userId: sessionUser.id,
      roomId: id,
      content: parsed.data.content,
      entryId: parsed.data.entry_id ?? null,
    });
    if (!result.ok) {
      if (result.code === "NOT_FOUND") {
        return NextResponse.json<NotesResponse>(
          { success: false, message: "Study room not found." },
          { status: 404 },
        );
      }
      return NextResponse.json<NotesResponse>(
        { success: false, message: "You are not a participant of this room." },
        { status: 403 },
      );
    }

    return NextResponse.json<NotesResponse>({
      success: true,
      note: result.note,
      entries: result.entries,
      my_entry: result.my_entry,
      saved_entry: result.saved_entry,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[study_room_api] notes_put_failed", {
      route: "/api/study-room/[id]/notes PUT",
      reason,
    });
    return NextResponse.json<NotesResponse>(
      { success: false, message: reason },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<NotesResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json<NotesResponse>(
        { success: false, message: "Room id is required." },
        { status: 400 },
      );
    }

    const url = new URL(request.url);
    const entryId = url.searchParams.get("entry_id")?.trim() ?? "";
    if (!entryId) {
      return NextResponse.json<NotesResponse>(
        { success: false, message: "entry_id is required." },
        { status: 400 },
      );
    }
    const entryParse = z.string().uuid("entry_id must be a valid uuid").safeParse(entryId);
    if (!entryParse.success) {
      return NextResponse.json<NotesResponse>(
        { success: false, message: entryParse.error.issues[0]?.message ?? "Invalid entry_id." },
        { status: 400 },
      );
    }

    const result = await deleteStudyRoomNoteEntry({
      userId: sessionUser.id,
      roomId: id,
      entryId,
    });

    if (!result.ok) {
      if (result.code === "NOTE_ENTRY_NOT_FOUND") {
        return NextResponse.json<NotesResponse>(
          { success: false, message: "Note entry not found." },
          { status: 404 },
        );
      }
      if (result.code === "NOT_FOUND") {
        return NextResponse.json<NotesResponse>(
          { success: false, message: "Study room not found." },
          { status: 404 },
        );
      }
      if (result.code === "FORBIDDEN") {
        return NextResponse.json<NotesResponse>(
          { success: false, message: "You can only delete your own note entries." },
          { status: 403 },
        );
      }
      return NextResponse.json<NotesResponse>(
        { success: false, message: "You are not a participant of this room." },
        { status: 403 },
      );
    }

    return NextResponse.json<NotesResponse>({
      success: true,
      note: result.note,
      entries: result.entries,
      my_entry: result.my_entry,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[study_room_api] notes_delete_failed", {
      route: "/api/study-room/[id]/notes DELETE",
      reason,
    });
    return NextResponse.json<NotesResponse>(
      { success: false, message: reason },
      { status: 500 },
    );
  }
}
