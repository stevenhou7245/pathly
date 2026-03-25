import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import {
  listStudyRoomParticipantWorkspaceState,
  updateStudyRoomPresenceState,
} from "@/lib/studyRoomWorkspace";

export const runtime = "nodejs";

const presencePatchSchema = z.object({
  presence_state: z.enum(["online", "idle", "focus", "offline"]).optional(),
  focus_mode: z.boolean().optional(),
});

type PresenceParticipants = Extract<
  Awaited<ReturnType<typeof listStudyRoomParticipantWorkspaceState>>,
  { ok: true }
>["participants"];

type PresenceParticipant = Extract<
  Awaited<ReturnType<typeof updateStudyRoomPresenceState>>,
  { ok: true }
>["participant"];

type PresenceSuccessResponse = {
  success: true;
  participants?: PresenceParticipants;
  participant?: PresenceParticipant;
};

type PresenceErrorResponse = {
  success: false;
  message: string;
};

type PresenceResponse = PresenceSuccessResponse | PresenceErrorResponse;

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<PresenceResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json<PresenceResponse>(
        { success: false, message: "Room id is required." },
        { status: 400 },
      );
    }

    const result = await listStudyRoomParticipantWorkspaceState({
      userId: sessionUser.id,
      roomId: id,
    });
    if (!result.ok) {
      if (result.code === "NOT_FOUND") {
        return NextResponse.json<PresenceResponse>(
          { success: false, message: "Study room not found." },
          { status: 404 },
        );
      }
      return NextResponse.json<PresenceResponse>(
        { success: false, message: "You are not a participant of this room." },
        { status: 403 },
      );
    }
    return NextResponse.json<PresenceResponse>(
      {
        success: true,
        participants: result.participants,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[study_room_api] presence_get_failed", {
      route: "/api/study-room/[id]/presence GET",
      reason,
    });
    return NextResponse.json<PresenceResponse>(
      { success: false, message: reason },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<PresenceResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json<PresenceResponse>(
        { success: false, message: "Room id is required." },
        { status: 400 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json<PresenceResponse>(
        { success: false, message: "Invalid request payload." },
        { status: 400 },
      );
    }

    const parsed = presencePatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<PresenceResponse>(
        {
          success: false,
          message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
        },
        { status: 400 },
      );
    }

    const result = await updateStudyRoomPresenceState({
      userId: sessionUser.id,
      roomId: id,
      presenceState: parsed.data.presence_state,
      focusMode: parsed.data.focus_mode,
    });

    if (!result.ok) {
      if (result.code === "NOT_FOUND") {
        return NextResponse.json<PresenceResponse>(
          { success: false, message: "Study room not found." },
          { status: 404 },
        );
      }
      return NextResponse.json<PresenceResponse>(
        { success: false, message: "You are not a participant of this room." },
        { status: 403 },
      );
    }

    return NextResponse.json<PresenceResponse>({
      success: true,
      participant: result.participant,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[study_room_api] presence_patch_failed", {
      route: "/api/study-room/[id]/presence PATCH",
      reason,
    });
    return NextResponse.json<PresenceResponse>(
      { success: false, message: reason },
      { status: 500 },
    );
  }
}
