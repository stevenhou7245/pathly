import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import {
  listStudyRoomParticipantWorkspaceState,
  updateStudyRoomGoal,
} from "@/lib/studyRoomWorkspace";

export const runtime = "nodejs";

const goalsPatchSchema = z.object({
  goal_text: z.string().max(300, "goal_text must be 300 characters or fewer").nullable().optional(),
  goal_status: z.enum(["not_started", "in_progress", "completed"]),
});

type GoalsResponse = {
  success: boolean;
  message?: string;
  participants?: Awaited<ReturnType<typeof listStudyRoomParticipantWorkspaceState>> extends {
    ok: true;
    participants: infer T;
  }
    ? T
    : never;
  participant?: Awaited<ReturnType<typeof updateStudyRoomGoal>> extends {
    ok: true;
    participant: infer T;
  }
    ? T
    : never;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<GoalsResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json<GoalsResponse>(
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
        return NextResponse.json<GoalsResponse>(
          { success: false, message: "Study room not found." },
          { status: 404 },
        );
      }
      return NextResponse.json<GoalsResponse>(
        { success: false, message: "You are not a participant of this room." },
        { status: 403 },
      );
    }

    return NextResponse.json<GoalsResponse>(
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
    console.error("[study_room_api] goals_get_failed", {
      route: "/api/study-room/[id]/goals GET",
      reason,
    });
    return NextResponse.json<GoalsResponse>(
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
      return NextResponse.json<GoalsResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json<GoalsResponse>(
        { success: false, message: "Room id is required." },
        { status: 400 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json<GoalsResponse>(
        { success: false, message: "Invalid request payload." },
        { status: 400 },
      );
    }

    const parsed = goalsPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<GoalsResponse>(
        {
          success: false,
          message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
        },
        { status: 400 },
      );
    }

    const result = await updateStudyRoomGoal({
      userId: sessionUser.id,
      roomId: id,
      goalText: parsed.data.goal_text ?? null,
      goalStatus: parsed.data.goal_status,
    });
    if (!result.ok) {
      if (result.code === "NOT_FOUND") {
        return NextResponse.json<GoalsResponse>(
          { success: false, message: "Study room not found." },
          { status: 404 },
        );
      }
      return NextResponse.json<GoalsResponse>(
        { success: false, message: "You are not a participant of this room." },
        { status: 403 },
      );
    }

    return NextResponse.json<GoalsResponse>({
      success: true,
      participant: result.participant,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[study_room_api] goals_patch_failed", {
      route: "/api/study-room/[id]/goals PATCH",
      reason,
    });
    return NextResponse.json<GoalsResponse>(
      { success: false, message: reason },
      { status: 500 },
    );
  }
}
