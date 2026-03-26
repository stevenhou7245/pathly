import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import {
  deleteNotebookEntry,
  updateNotebookEntry,
  type UserNotebookEntryRecord,
} from "@/lib/notebook";

export const runtime = "nodejs";

const updateEntrySchema = z.object({
  topic: z.string().trim().min(1, "topic is required").max(200, "topic is too long"),
  content_md: z.string().max(500_000, "content is too large").optional().nullable(),
});

type NotebookEntryUpdateResponse = {
  success: boolean;
  message?: string;
  entry?: UserNotebookEntryRecord;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ entryId: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<NotebookEntryUpdateResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const { entryId } = await context.params;
    if (!entryId) {
      return NextResponse.json<NotebookEntryUpdateResponse>(
        { success: false, message: "Entry id is required." },
        { status: 400 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json<NotebookEntryUpdateResponse>(
        { success: false, message: "Invalid request payload." },
        { status: 400 },
      );
    }

    const parsed = updateEntrySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<NotebookEntryUpdateResponse>(
        { success: false, message: parsed.error.issues[0]?.message ?? "Invalid request payload." },
        { status: 400 },
      );
    }

    const updated = await updateNotebookEntry({
      userId: sessionUser.id,
      entryId,
      topic: parsed.data.topic,
      contentMd: parsed.data.content_md,
    });
    if (!updated) {
      return NextResponse.json<NotebookEntryUpdateResponse>(
        { success: false, message: "Notebook entry not found." },
        { status: 404 },
      );
    }

    return NextResponse.json<NotebookEntryUpdateResponse>({
      success: true,
      entry: updated,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[notebook_api] entry_update_failed", {
      route: "/api/notebooks/entries/[entryId] PATCH",
      reason,
    });
    return NextResponse.json<NotebookEntryUpdateResponse>(
      { success: false, message: reason },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ entryId: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<NotebookEntryUpdateResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const { entryId } = await context.params;
    if (!entryId) {
      return NextResponse.json<NotebookEntryUpdateResponse>(
        { success: false, message: "Entry id is required." },
        { status: 400 },
      );
    }

    const deleted = await deleteNotebookEntry({
      userId: sessionUser.id,
      entryId,
    });
    if (!deleted) {
      return NextResponse.json<NotebookEntryUpdateResponse>(
        { success: false, message: "Notebook entry not found." },
        { status: 404 },
      );
    }

    return NextResponse.json<NotebookEntryUpdateResponse>({
      success: true,
      message: "Notebook entry deleted.",
      entry: deleted,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[notebook_api] entry_delete_failed", {
      route: "/api/notebooks/entries/[entryId] DELETE",
      reason,
    });
    return NextResponse.json<NotebookEntryUpdateResponse>(
      { success: false, message: reason },
      { status: 500 },
    );
  }
}
