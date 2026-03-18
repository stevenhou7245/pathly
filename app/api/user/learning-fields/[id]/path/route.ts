import { NextResponse } from "next/server";
import {
  buildLearningPathSteps,
  calculateTotalSteps,
  getCompletedStepsCount,
  getPathProgressPercentage,
  normalizeLearningLevel,
  normalizePathState,
} from "@/lib/learningPath";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import {
  ensureLearningFieldExists,
  getUserLearningFieldById,
} from "@/lib/userLearningProgress";

export const runtime = "nodejs";

type FieldPathResponse = {
  success: boolean;
  message?: string;
  path?: {
    id: string;
    field_id: string;
    field_title: string;
    current_level: string | null;
    target_level: string | null;
    total_steps: number;
    current_step_index: number;
    steps: Array<{
      index: number;
      status: "completed" | "current" | "locked";
    }>;
    summary: {
      completed_steps_count: number;
      total_steps_count: number;
      percentage_progress: number;
    };
  };
};

function toStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function getFieldTitle(field: Record<string, unknown> | null) {
  if (!field) {
    return "Untitled Field";
  }

  const title = toStringValue(field.title);
  if (title) {
    return title;
  }

  const name = toStringValue(field.name);
  if (name) {
    return name;
  }

  return "Untitled Field";
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: FieldPathResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      const payload: FieldPathResponse = {
        success: false,
        message: "Learning field id is required.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const userField = await getUserLearningFieldById(sessionUser.id, id);
    if (!userField) {
      const payload: FieldPathResponse = {
        success: false,
        message: "Learning field entry not found.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const fieldId = toStringValue(userField.field_id);
    const learningField = fieldId ? await ensureLearningFieldExists(fieldId) : null;
    const currentLevel = normalizeLearningLevel(userField.current_level);
    const targetLevel = normalizeLearningLevel(userField.target_level);

    const fallbackTotalSteps = calculateTotalSteps(currentLevel, targetLevel);
    const { totalSteps, currentStepIndex } = normalizePathState(
      toNumber(userField.total_steps) || fallbackTotalSteps,
      toNumber(userField.current_step_index) || 1,
    );

    const steps = buildLearningPathSteps(totalSteps, currentStepIndex);
    const completedSteps = getCompletedStepsCount(totalSteps, currentStepIndex);
    const percentageProgress = getPathProgressPercentage(totalSteps, currentStepIndex);

    const payload: FieldPathResponse = {
      success: true,
      path: {
        id: toStringValue(userField.id),
        field_id: fieldId,
        field_title: getFieldTitle((learningField ?? null) as Record<string, unknown> | null),
        current_level: currentLevel,
        target_level: targetLevel,
        total_steps: totalSteps,
        current_step_index: currentStepIndex,
        steps,
        summary: {
          completed_steps_count: completedSteps,
          total_steps_count: totalSteps,
          percentage_progress: percentageProgress,
        },
      },
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    const payload: FieldPathResponse = {
      success: false,
      message: "Unable to load learning path right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
