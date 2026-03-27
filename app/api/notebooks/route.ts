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
  name: z.string().trim().min(1, "name is required").max(200, "name is too long"),
});

type NotebooksResponse = {
  success: boolean;
  message?: string;
  notebooks?: UserNotebookRecord[];
  notebook?: UserNotebookRecord;
};

export async function GET(request: Request) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<NotebooksResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const url = new URL(request.url);
    const rawLimit = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(300, Math.max(20, rawLimit)) : 120;

    const notebooks = await listUserNotebooks({
      userId: sessionUser.id,
      limit,
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
      name: parsed.data.name,
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
