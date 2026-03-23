import { NextResponse } from "next/server";
import { ensureLearningStepsForUserField } from "@/lib/learningSteps";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";

export const runtime = "nodejs";

type GetLearningStepsResponse = {
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
  generation?: {
    source: "ai" | "fallback" | "database";
    generated: boolean;
  };
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ userFieldId: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: GetLearningStepsResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    const { userFieldId } = await context.params;
    if (!userFieldId) {
      const payload: GetLearningStepsResponse = {
        success: false,
        message: "userFieldId is required.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    console.info("[api/learning-steps/:userFieldId][GET] request", {
      user_id: sessionUser.id,
      user_field_id: userFieldId,
    });

    const ensured = await ensureLearningStepsForUserField({
      userId: sessionUser.id,
      userFieldId,
    });

    if (!ensured) {
      const payload: GetLearningStepsResponse = {
        success: false,
        message: "Learning field entry not found.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const payload: GetLearningStepsResponse = {
      success: true,
      learning_steps: ensured.steps,
      total_steps: ensured.totalSteps,
      current_step_index: ensured.currentStepIndex,
      generation: {
        source: ensured.generationSource,
        generated: ensured.generated,
      },
    };
    console.info("[api/learning-steps/:userFieldId][GET] response", {
      user_id: sessionUser.id,
      user_field_id: userFieldId,
      step_count: ensured.steps.length,
      generation_source: ensured.generationSource,
      generated: ensured.generated,
    });
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[api/learning-steps/:userFieldId][GET] failed", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    });

    const payload: GetLearningStepsResponse = {
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "Unable to load or generate learning steps right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
