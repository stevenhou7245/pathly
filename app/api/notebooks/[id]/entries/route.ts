import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import {
  createNotebookEntry,
  listNotebookEntries,
  type UserNotebookEntryRecord,
  type UserNotebookRecord,
} from "@/lib/notebook";

export const runtime = "nodejs";

const createEntrySchema = z.object({
  topic: z.string().trim().min(1, "topic is required").max(200, "topic is too long"),
  content_md: z.string().max(500_000, "content is too large").optional().nullable(),
  source_type: z
    .enum(["manual", "study_room_selection"])
    .optional(),
  source_room_id: z.string().uuid("source_room_id must be a valid uuid").optional().nullable(),
});

type NotebookEntriesResponse = {
  success: boolean;
  message?: string;
  notebook?: UserNotebookRecord;
  entries?: UserNotebookEntryRecord[];
  entry?: UserNotebookEntryRecord;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<NotebookEntriesResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json<NotebookEntriesResponse>(
        { success: false, message: "Notebook id is required." },
        { status: 400 },
      );
    }

    const result = await listNotebookEntries({
      userId: sessionUser.id,
      notebookId: id,
    });
    if (!result.ok) {
      return NextResponse.json<NotebookEntriesResponse>(
        { success: false, message: "Notebook not found." },
        { status: 404 },
      );
    }

    return NextResponse.json<NotebookEntriesResponse>(
      {
        success: true,
        notebook: result.notebook,
        entries: result.entries,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[notebook_api] entries_list_failed", {
      route: "/api/notebooks/[id]/entries GET",
      reason,
    });
    return NextResponse.json<NotebookEntriesResponse>(
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
      return NextResponse.json<NotebookEntriesResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json<NotebookEntriesResponse>(
        { success: false, message: "Notebook id is required." },
        { status: 400 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json<NotebookEntriesResponse>(
        { success: false, message: "Invalid request payload." },
        { status: 400 },
      );
    }

    const parsed = createEntrySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<NotebookEntriesResponse>(
        { success: false, message: parsed.error.issues[0]?.message ?? "Invalid request payload." },
        { status: 400 },
      );
    }

    const result = await createNotebookEntry({
      userId: sessionUser.id,
      notebookId: id,
      topic: parsed.data.topic,
      contentMd: parsed.data.content_md ?? null,
      sourceType: parsed.data.source_type ?? "manual",
      sourceRoomId: parsed.data.source_room_id ?? null,
    });

    if (!result.ok) {
      return NextResponse.json<NotebookEntriesResponse>(
        { success: false, message: "Notebook not found." },
        { status: 404 },
      );
    }

    return NextResponse.json<NotebookEntriesResponse>(
      {
        success: true,
        notebook: result.notebook,
        entry: result.entry,
      },
      { status: 201 },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[notebook_api] entry_create_failed", {
      route: "/api/notebooks/[id]/entries POST",
      reason,
    });
    return NextResponse.json<NotebookEntriesResponse>(
      { success: false, message: reason },
      { status: 500 },
    );
  }
}
