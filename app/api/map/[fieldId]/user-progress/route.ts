import { NextResponse } from "next/server";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import {
  getLearningFieldById,
  getUserMapProgressForField,
} from "@/lib/learningMap";

export const runtime = "nodejs";

type UserFieldProgressResponse = {
  success: boolean;
  message?: string;
  progress?: {
    field_id: string;
    user_learning_field_id: string;
    active_route: {
      id: string;
      field_id: string;
      title: string;
    } | null;
    active_route_id: string | null;
    started_at: string | null;
    status: string | null;
    completed_node_ids: string[];
    summary: {
      completed_steps_count: number;
      total_steps_count: number;
      percentage_progress: number;
    };
  };
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ fieldId: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: UserFieldProgressResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    const { fieldId } = await context.params;
    if (!fieldId) {
      const payload: UserFieldProgressResponse = {
        success: false,
        message: "Field id is required.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const field = await getLearningFieldById(fieldId);
    if (!field) {
      const payload: UserFieldProgressResponse = {
        success: false,
        message: "Learning field not found.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const progress = await getUserMapProgressForField({
      fieldId,
      userId: sessionUser.id,
    });

    if (!progress) {
      const payload: UserFieldProgressResponse = {
        success: false,
        message: "Learning field progress not found for this user.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const payload: UserFieldProgressResponse = {
      success: true,
      progress,
    };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    const payload: UserFieldProgressResponse = {
      success: false,
      message: "Unable to load map progress right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
