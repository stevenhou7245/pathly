import { NextResponse } from "next/server";
import { calculateTotalSteps, normalizeLearningLevel } from "@/lib/learningPath";
import { updateUserLearningFieldSchema } from "@/lib/learningValidation";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import {
  ensureRouteBelongsToField,
  getUserLearningFieldById,
  updateUserLearningField,
} from "@/lib/userLearningProgress";

export const runtime = "nodejs";

type UpdateLearningFieldResponse = {
  success: boolean;
  message?: string;
  learning_field?: Record<string, unknown>;
};

function toStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }

  return 0;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: UpdateLearningFieldResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      const payload: UpdateLearningFieldResponse = {
        success: false,
        message: "Learning field id is required.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      const payload: UpdateLearningFieldResponse = {
        success: false,
        message: "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const parsed = updateUserLearningFieldSchema.safeParse(body);
    if (!parsed.success) {
      const payload: UpdateLearningFieldResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const userField = await getUserLearningFieldById(sessionUser.id, id);
    if (!userField) {
      const payload: UpdateLearningFieldResponse = {
        success: false,
        message: "Learning field entry not found.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const patch: Record<string, unknown> = {};
    const { current_level, target_level, active_route_id, status } = parsed.data;

    if (current_level !== undefined) {
      const normalized = normalizeLearningLevel(current_level);
      if (!normalized) {
        const payload: UpdateLearningFieldResponse = {
          success: false,
          message:
            "Current level must be one of: Beginner, Basic, Intermediate, Advanced, Expert.",
        };
        return NextResponse.json(payload, { status: 400 });
      }
      patch.current_level = normalized;
    }
    if (target_level !== undefined) {
      const normalized = normalizeLearningLevel(target_level);
      if (!normalized) {
        const payload: UpdateLearningFieldResponse = {
          success: false,
          message:
            "Target level must be one of: Beginner, Basic, Intermediate, Advanced, Expert.",
        };
        return NextResponse.json(payload, { status: 400 });
      }
      patch.target_level = normalized;
    }
    if (status !== undefined) {
      patch.status = status;
    }
    if (active_route_id !== undefined) {
      if (active_route_id === null) {
        patch.active_route_id = null;
      } else {
        const fieldId = typeof userField.field_id === "string" ? userField.field_id : "";
        const isRouteValid = await ensureRouteBelongsToField(active_route_id, fieldId);
        if (!isRouteValid) {
          const payload: UpdateLearningFieldResponse = {
            success: false,
            message: "Active route does not belong to this learning field.",
          };
          return NextResponse.json(payload, { status: 400 });
        }
        patch.active_route_id = active_route_id;
      }
    }

    if (patch.current_level !== undefined || patch.target_level !== undefined) {
      const effectiveCurrentLevel =
        typeof patch.current_level === "string"
          ? patch.current_level
          : toStringValue(userField.current_level);
      const effectiveTargetLevel =
        typeof patch.target_level === "string"
          ? patch.target_level
          : toStringValue(userField.target_level);

      const totalSteps = calculateTotalSteps(effectiveCurrentLevel, effectiveTargetLevel);
      const storedCurrentStepIndex = toNumber(userField.current_step_index);
      const normalizedCurrentStepIndex = Math.min(
        totalSteps + 1,
        Math.max(1, storedCurrentStepIndex || 1),
      );

      patch.total_steps = totalSteps;
      patch.current_step_index = normalizedCurrentStepIndex;
    }

    const updated = await updateUserLearningField({
      userId: sessionUser.id,
      id,
      patch,
    });

    if (!updated) {
      const payload: UpdateLearningFieldResponse = {
        success: false,
        message: "Learning field entry not found.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const payload: UpdateLearningFieldResponse = {
      success: true,
      message: "Learning field updated successfully.",
      learning_field: updated,
    };
    return NextResponse.json(payload);
  } catch {
    const payload: UpdateLearningFieldResponse = {
      success: false,
      message: "Unable to update learning field right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
