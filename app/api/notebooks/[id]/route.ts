import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { updateUserNotebook, type UserNotebookRecord } from "@/lib/notebook";

export const runtime = "nodejs";

const notebookPatchSchema = z
  .object({
    topic: z.string().trim().min(1, "topic is required").max(200, "topic is too long").optional(),
    content_md: z.string().max(500_000, "content is too large").optional().nullable(),
  })
  .refine((value) => value.topic !== undefined || value.content_md !== undefined, {
    message: "Provide at least one field to update.",
  });

type NotebookPatchResponse = {
  success: boolean;
  message?: string;
  notebook?: UserNotebookRecord;
};

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<NotebookPatchResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json<NotebookPatchResponse>(
        { success: false, message: "Notebook id is required." },
        { status: 400 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json<NotebookPatchResponse>(
        { success: false, message: "Invalid request payload." },
        { status: 400 },
      );
    }

    const parsed = notebookPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<NotebookPatchResponse>(
        { success: false, message: parsed.error.issues[0]?.message ?? "Invalid request payload." },
        { status: 400 },
      );
    }

    const notebook = await updateUserNotebook({
      userId: sessionUser.id,
      notebookId: id,
      topic: parsed.data.topic,
      contentMd: parsed.data.content_md,
    });

    if (!notebook) {
      return NextResponse.json<NotebookPatchResponse>(
        { success: false, message: "Notebook not found." },
        { status: 404 },
      );
    }

    return NextResponse.json<NotebookPatchResponse>({
      success: true,
      notebook,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[notebook_api] update_failed", {
      route: "/api/notebooks/[id] PATCH",
      reason,
    });
    return NextResponse.json<NotebookPatchResponse>(
      { success: false, message: reason },
      { status: 500 },
    );
  }
}
