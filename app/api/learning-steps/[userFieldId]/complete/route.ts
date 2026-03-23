import { NextResponse } from "next/server";
import {
  completeLearningStepForUserField,
  parseCompleteStepBody,
} from "@/lib/learningSteps";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";

export const runtime = "nodejs";

type CompleteLearningStepResponse = {
  success: boolean;
  message?: string;
  learning_steps?: Array<{
    id: string;
    step_number: number;
    title: string;
    summary: string | null;
    resources: Array<{
      type: "video" | "article" | "tutorial" | "interactive" | "document";
      title: string;
      url: string;
      reason?: string | null;
    }>;
    status: "locked" | "current" | "completed";
    generation_source: "ai" | "fallback" | "database";
    started_at: string | null;
    completed_at: string | null;
  }>;
  total_steps?: number;
  current_step_index?: number;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ userFieldId: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: CompleteLearningStepResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    const { userFieldId } = await context.params;
    if (!userFieldId) {
      const payload: CompleteLearningStepResponse = {
        success: false,
        message: "userFieldId is required.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      const payload: CompleteLearningStepResponse = {
        success: false,
        message: "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const parsed = parseCompleteStepBody(body);
    if (!parsed.success) {
      const payload: CompleteLearningStepResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const completed = await completeLearningStepForUserField({
      userId: sessionUser.id,
      userFieldId,
      stepNumber: parsed.data.step_number,
    });

    const payload: CompleteLearningStepResponse = {
      success: completed.success,
      message: completed.message,
      learning_steps: completed.success ? completed.steps : undefined,
      total_steps: completed.success ? completed.totalSteps : undefined,
      current_step_index: completed.success ? completed.currentStepIndex : undefined,
    };
    return NextResponse.json(payload, {
      status: completed.status,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[api/learning-steps/:userFieldId/complete][POST] failed", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    });
    const payload: CompleteLearningStepResponse = {
      success: false,
      message: "Unable to complete step right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
