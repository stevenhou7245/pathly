import { NextResponse } from "next/server";
import {
  buildLearningPathSteps,
  calculateTotalSteps,
  getCompletedStepsCount,
  getPathProgressPercentage,
  normalizeLearningLevel,
  normalizePathState,
} from "@/lib/learningPath";
import { syncLearningStepStatuses } from "@/lib/learningSteps";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  ensureLearningFieldExists,
  getUserLearningFieldById,
  updateUserLearningField,
} from "@/lib/userLearningProgress";

export const runtime = "nodejs";

type CompleteStepResponse = {
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

function buildPathPayload(
  userField: Record<string, unknown>,
  fieldTitle: string,
  fallbackTotalSteps: number,
) {
  const currentLevel = normalizeLearningLevel(userField.current_level);
  const targetLevel = normalizeLearningLevel(userField.target_level);
  const { totalSteps, currentStepIndex } = normalizePathState(
    toNumber(userField.total_steps) || fallbackTotalSteps,
    toNumber(userField.current_step_index) || 1,
  );
  const steps = buildLearningPathSteps(totalSteps, currentStepIndex);
  const completedSteps = getCompletedStepsCount(totalSteps, currentStepIndex);
  const percentageProgress = getPathProgressPercentage(totalSteps, currentStepIndex);

  return {
    id: toStringValue(userField.id),
    field_id: toStringValue(userField.field_id),
    field_title: fieldTitle,
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
  };
}

async function createStepCompletionRecord(params: {
  userId: string;
  userLearningFieldId: string;
  stepNumber: number;
  fieldTitle: string;
}) {
  const completedAt = new Date().toISOString();
  const stepTitle = `${params.fieldTitle} Course ${params.stepNumber} completed`;

  const { error } = await supabaseAdmin
    .from("user_learning_step_completions")
    .upsert(
      {
        user_learning_field_id: params.userLearningFieldId,
        user_id: params.userId,
        step_number: params.stepNumber,
        step_title: stepTitle,
        completed_at: completedAt,
      },
      {
        onConflict: "user_learning_field_id,step_number",
        ignoreDuplicates: true,
      },
    );

  if (error) {
    throw new Error("Failed to record completed step.");
  }
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: CompleteStepResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      const payload: CompleteStepResponse = {
        success: false,
        message: "Learning field id is required.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const userField = await getUserLearningFieldById(sessionUser.id, id);
    if (!userField) {
      const payload: CompleteStepResponse = {
        success: false,
        message: "Learning field entry not found.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const fieldId = toStringValue(userField.field_id);
    const learningField = fieldId ? await ensureLearningFieldExists(fieldId) : null;
    const fieldTitle = getFieldTitle(
      (learningField ?? null) as Record<string, unknown> | null,
    );

    const fallbackTotalSteps = calculateTotalSteps(
      normalizeLearningLevel(userField.current_level),
      normalizeLearningLevel(userField.target_level),
    );
    const normalizedPath = normalizePathState(
      toNumber(userField.total_steps) || fallbackTotalSteps,
      toNumber(userField.current_step_index) || 1,
    );

    const isAlreadyComplete = normalizedPath.currentStepIndex > normalizedPath.totalSteps;
    if (isAlreadyComplete) {
      const payload: CompleteStepResponse = {
        success: true,
        message: "All steps are already completed.",
        path: buildPathPayload(userField, fieldTitle, fallbackTotalSteps),
      };
      return NextResponse.json(payload);
    }

    const nextStepIndex = Math.min(
      normalizedPath.totalSteps + 1,
      normalizedPath.currentStepIndex + 1,
    );

    const updated = await updateUserLearningField({
      userId: sessionUser.id,
      id,
      patch: {
        total_steps: normalizedPath.totalSteps,
        current_step_index: nextStepIndex,
        updated_at: new Date().toISOString(),
      },
    });

    if (!updated) {
      const payload: CompleteStepResponse = {
        success: false,
        message: "Learning field entry not found.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    await createStepCompletionRecord({
      userId: sessionUser.id,
      userLearningFieldId: id,
      stepNumber: normalizedPath.currentStepIndex,
      fieldTitle,
    });

    try {
      await syncLearningStepStatuses({
        userFieldId: id,
        totalSteps: normalizedPath.totalSteps,
        currentStepIndex: nextStepIndex,
      });
    } catch (error) {
      console.warn("[api/user/learning-fields/:id/complete-step][POST] sync_learning_steps_failed", {
        user_id: sessionUser.id,
        user_field_id: id,
        reason: error instanceof Error ? error.message : String(error),
      });
    }

    const payload: CompleteStepResponse = {
      success: true,
      message: "Step completed. Path advanced.",
      path: buildPathPayload(
        updated as Record<string, unknown>,
        fieldTitle,
        fallbackTotalSteps,
      ),
    };
    return NextResponse.json(payload);
  } catch {
    const payload: CompleteStepResponse = {
      success: false,
      message: "Unable to complete step right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
