import { NextResponse } from "next/server";
import { markNodeCompletedSchema } from "@/lib/learningValidation";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import {
  getUserFieldProgress,
  markNodeCompletedForUser,
} from "@/lib/userLearningProgress";

export const runtime = "nodejs";

type MarkNodeResponse = {
  success: boolean;
  message?: string;
  result?: {
    node_id: string;
    field_id: string;
    already_completed: boolean;
  };
  progress_summary?: {
    completed_steps_count: number;
    total_steps_count: number;
    percentage_progress: number;
  };
};

export async function POST(request: Request) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: MarkNodeResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      const payload: MarkNodeResponse = {
        success: false,
        message: "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const parsed = markNodeCompletedSchema.safeParse(body);
    if (!parsed.success) {
      const payload: MarkNodeResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const completionResult = await markNodeCompletedForUser(
      sessionUser.id,
      parsed.data.node_id,
    );

    if (!completionResult.ok) {
      if (completionResult.reason === "NODE_NOT_FOUND") {
        const payload: MarkNodeResponse = {
          success: false,
          message: "Node not found.",
        };
        return NextResponse.json(payload, { status: 404 });
      }
      if (completionResult.reason === "ROUTE_NOT_FOUND") {
        const payload: MarkNodeResponse = {
          success: false,
          message: "Route not found for this node.",
        };
        return NextResponse.json(payload, { status: 404 });
      }
      const payload: MarkNodeResponse = {
        success: false,
        message: "This node is not part of any field in your journey.",
      };
      return NextResponse.json(payload, { status: 403 });
    }

    const progress = await getUserFieldProgress(sessionUser.id, completionResult.field_id);

    const payload: MarkNodeResponse = {
      success: true,
      message: completionResult.already_completed
        ? "Node was already completed."
        : "Node marked as completed.",
      result: {
        node_id: completionResult.node_id,
        field_id: completionResult.field_id,
        already_completed: completionResult.already_completed,
      },
      progress_summary: progress?.summary,
    };
    return NextResponse.json(payload);
  } catch {
    const payload: MarkNodeResponse = {
      success: false,
      message: "Unable to mark node progress right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
