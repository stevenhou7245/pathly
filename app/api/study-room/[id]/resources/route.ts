import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import {
  addStudyRoomLinkResource,
  listStudyRoomResources,
  type StudyRoomSharedResource,
} from "@/lib/studyRoomWorkspace";

export const runtime = "nodejs";

const resourcePostSchema = z.object({
  source_kind: z.literal("url").optional(),
  resource_type: z
    .enum(["video", "article", "website", "document", "notes", "other"])
    .optional(),
  title: z.string().trim().min(1, "title is required").max(160, "title is too long"),
  url: z.string().trim().min(1, "url is required").max(2000, "url is too long"),
});

type ResourcesResponse = {
  success: boolean;
  message?: string;
  resources?: StudyRoomSharedResource[];
  resource?: StudyRoomSharedResource;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<ResourcesResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json<ResourcesResponse>(
        { success: false, message: "Room id is required." },
        { status: 400 },
      );
    }

    const result = await listStudyRoomResources({
      userId: sessionUser.id,
      roomId: id,
    });
    if (!result.ok) {
      if (result.code === "NOT_FOUND") {
        return NextResponse.json<ResourcesResponse>(
          { success: false, message: "Study room not found." },
          { status: 404 },
        );
      }
      return NextResponse.json<ResourcesResponse>(
        { success: false, message: "You are not a participant of this room." },
        { status: 403 },
      );
    }

    return NextResponse.json<ResourcesResponse>(
      {
        success: true,
        resources: result.resources,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[study_room_api] resources_get_failed", {
      route: "/api/study-room/[id]/resources GET",
      reason,
    });
    return NextResponse.json<ResourcesResponse>(
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
      return NextResponse.json<ResourcesResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json<ResourcesResponse>(
        { success: false, message: "Room id is required." },
        { status: 400 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json<ResourcesResponse>(
        { success: false, message: "Invalid request payload." },
        { status: 400 },
      );
    }

    const parsed = resourcePostSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<ResourcesResponse>(
        {
          success: false,
          message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
        },
        { status: 400 },
      );
    }

    const result = await addStudyRoomLinkResource({
      userId: sessionUser.id,
      roomId: id,
      resourceType: parsed.data.resource_type ?? "website",
      title: parsed.data.title,
      url: parsed.data.url,
    });
    if (!result.ok) {
      if (result.code === "NOT_FOUND") {
        return NextResponse.json<ResourcesResponse>(
          { success: false, message: "Study room not found." },
          { status: 404 },
        );
      }
      if (result.code === "ROOM_CLOSED") {
        return NextResponse.json<ResourcesResponse>(
          { success: false, message: "This study room has already been closed." },
          { status: 400 },
        );
      }
      return NextResponse.json<ResourcesResponse>(
        { success: false, message: "You are not a participant of this room." },
        { status: 403 },
      );
    }

    return NextResponse.json<ResourcesResponse>(
      {
        success: true,
        resource: result.resource,
      },
      { status: 201 },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[study_room_api] resources_post_failed", {
      route: "/api/study-room/[id]/resources POST",
      reason,
    });
    return NextResponse.json<ResourcesResponse>(
      { success: false, message: reason },
      { status: 500 },
    );
  }
}
