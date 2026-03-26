import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import {
  deleteUserNotebook,
  updateUserNotebook,
  type UserNotebookRecord,
} from "@/lib/notebook";

export const runtime = "nodejs";

const notebookPatchSchema = z
  .object({
    name: z.string().trim().min(1, "name is required").max(200, "name is too long"),
  });

type NotebookRouteResponse = {
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
      return NextResponse.json<NotebookRouteResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json<NotebookRouteResponse>(
        { success: false, message: "Notebook id is required." },
        { status: 400 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json<NotebookRouteResponse>(
        { success: false, message: "Invalid request payload." },
        { status: 400 },
      );
    }

    const parsed = notebookPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<NotebookRouteResponse>(
        { success: false, message: parsed.error.issues[0]?.message ?? "Invalid request payload." },
        { status: 400 },
      );
    }

    const notebook = await updateUserNotebook({
      userId: sessionUser.id,
      notebookId: id,
      name: parsed.data.name,
    });

    if (!notebook) {
      return NextResponse.json<NotebookRouteResponse>(
        { success: false, message: "Notebook not found." },
        { status: 404 },
      );
    }

    return NextResponse.json<NotebookRouteResponse>({
      success: true,
      notebook,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[notebook_api] update_failed", {
      route: "/api/notebooks/[id] PATCH",
      reason,
    });
    return NextResponse.json<NotebookRouteResponse>(
      { success: false, message: reason },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<NotebookRouteResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json<NotebookRouteResponse>(
        { success: false, message: "Notebook id is required." },
        { status: 400 },
      );
    }

    const notebook = await deleteUserNotebook({
      userId: sessionUser.id,
      notebookId: id,
    });
    if (!notebook) {
      return NextResponse.json<NotebookRouteResponse>(
        { success: false, message: "Notebook not found." },
        { status: 404 },
      );
    }

    return NextResponse.json<NotebookRouteResponse>({
      success: true,
      message: "Notebook deleted.",
      notebook,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[notebook_api] delete_failed", {
      route: "/api/notebooks/[id] DELETE",
      reason,
    });
    return NextResponse.json<NotebookRouteResponse>(
      { success: false, message: reason },
      { status: 500 },
    );
  }
}
