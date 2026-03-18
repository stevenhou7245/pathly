import { NextResponse } from "next/server";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { getUserFieldProgress } from "@/lib/userLearningProgress";

export const runtime = "nodejs";

type FieldProgressResponse = {
  success: boolean;
  message?: string;
  progress?: {
    field_id: string;
    field_title: string;
    current_level: string | null;
    target_level: string | null;
    active_route_id: string | null;
    status: string | null;
    started_at: string | null;
    routes: Array<{
      id: string;
      title: string;
      field_id: string;
      nodes: Array<{
        id: string;
        route_id: string;
        title: string;
        type: string | null;
        link: string | null;
        description: string | null;
        order_index: number | null;
      }>;
    }>;
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
      const payload: FieldProgressResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    const { fieldId } = await context.params;
    if (!fieldId) {
      const payload: FieldProgressResponse = {
        success: false,
        message: "Field id is required.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const progress = await getUserFieldProgress(sessionUser.id, fieldId);
    if (!progress) {
      const payload: FieldProgressResponse = {
        success: false,
        message: "Learning field progress not found for this user.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const payload: FieldProgressResponse = {
      success: true,
      progress,
    };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    const payload: FieldProgressResponse = {
      success: false,
      message: "Unable to load progress right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
