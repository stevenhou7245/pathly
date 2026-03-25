import { NextResponse } from "next/server";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { removeStudyRoomResource } from "@/lib/studyRoomWorkspace";

export const runtime = "nodejs";

type DeleteResourceResponse = {
  success: boolean;
  message?: string;
};

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; resourceId: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<DeleteResourceResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const { id, resourceId } = await context.params;
    if (!id || !resourceId) {
      return NextResponse.json<DeleteResourceResponse>(
        { success: false, message: "Room id and resource id are required." },
        { status: 400 },
      );
    }

    const result = await removeStudyRoomResource({
      userId: sessionUser.id,
      roomId: id,
      resourceId,
    });
    if (!result.ok) {
      if (result.code === "NOT_FOUND") {
        return NextResponse.json<DeleteResourceResponse>(
          { success: false, message: "Resource not found." },
          { status: 404 },
        );
      }
      if (result.code === "FORBIDDEN") {
        return NextResponse.json<DeleteResourceResponse>(
          { success: false, message: "Only the room creator or resource owner can remove it." },
          { status: 403 },
        );
      }
      return NextResponse.json<DeleteResourceResponse>(
        { success: false, message: "You are not a participant of this room." },
        { status: 403 },
      );
    }

    return NextResponse.json<DeleteResourceResponse>({
      success: true,
      message: "Resource removed.",
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[study_room_api] resource_delete_failed", {
      route: "/api/study-room/[id]/resources/[resourceId] DELETE",
      reason,
    });
    return NextResponse.json<DeleteResourceResponse>(
      { success: false, message: reason },
      { status: 500 },
    );
  }
}
