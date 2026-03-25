import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import {
  addStudyRoomFileResource,
  type StudyRoomSharedResource,
} from "@/lib/studyRoomWorkspace";

export const runtime = "nodejs";

const uploadFieldsSchema = z.object({
  title: z.string().trim().min(1, "title is required").max(160, "title is too long"),
  resource_type: z
    .enum(["video", "article", "website", "document", "notes", "other"])
    .optional(),
});

type UploadResourceResponse = {
  success: boolean;
  message?: string;
  resource?: StudyRoomSharedResource;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<UploadResourceResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json<UploadResourceResponse>(
        { success: false, message: "Room id is required." },
        { status: 400 },
      );
    }

    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json<UploadResourceResponse>(
        { success: false, message: "Invalid multipart form payload." },
        { status: 400 },
      );
    }

    const parsedFields = uploadFieldsSchema.safeParse({
      title: formData.get("title"),
      resource_type: formData.get("resource_type") ?? undefined,
    });
    if (!parsedFields.success) {
      return NextResponse.json<UploadResourceResponse>(
        {
          success: false,
          message: parsedFields.error.issues[0]?.message ?? "Invalid upload payload.",
        },
        { status: 400 },
      );
    }

    const fileValue = formData.get("file");
    if (!(fileValue instanceof File)) {
      return NextResponse.json<UploadResourceResponse>(
        { success: false, message: "file is required." },
        { status: 400 },
      );
    }

    const result = await addStudyRoomFileResource({
      userId: sessionUser.id,
      roomId: id,
      resourceType: parsedFields.data.resource_type ?? "document",
      title: parsedFields.data.title,
      file: fileValue,
    });

    if (!result.ok) {
      if (result.code === "NOT_FOUND") {
        return NextResponse.json<UploadResourceResponse>(
          { success: false, message: "Study room not found." },
          { status: 404 },
        );
      }
      if (result.code === "ROOM_CLOSED") {
        return NextResponse.json<UploadResourceResponse>(
          { success: false, message: "This study room has already been closed." },
          { status: 400 },
        );
      }
      return NextResponse.json<UploadResourceResponse>(
        { success: false, message: "You are not a participant of this room." },
        { status: 403 },
      );
    }

    return NextResponse.json<UploadResourceResponse>(
      {
        success: true,
        resource: result.resource,
      },
      { status: 201 },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[study_room_api] resource_upload_failed", {
      route: "/api/study-room/[id]/resources/upload POST",
      reason,
    });
    return NextResponse.json<UploadResourceResponse>(
      { success: false, message: reason },
      { status: 500 },
    );
  }
}
