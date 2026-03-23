import { NextResponse } from "next/server";
import { isMissingRelationOrColumnError } from "@/lib/ai/common";
import { calculateTotalSteps, normalizeLearningLevel } from "@/lib/learningPath";
import { ensureLearningStepsForUserField } from "@/lib/learningSteps";
import { updateUserLearningFieldSchema } from "@/lib/learningValidation";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
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

type DeleteLearningFieldResponse = {
  success: boolean;
  message?: string;
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

function toErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isMissingTableOrColumnError(error: unknown) {
  const record = (error ?? {}) as Record<string, unknown>;
  const code = toStringValue(record.code);
  return (
    code === "42P01" ||
    code === "42703" ||
    isMissingRelationOrColumnError(error)
  );
}

async function safeDeleteOptionalTable(params: {
  table: string;
  operation: () => PromiseLike<{ error: unknown; count: number | null }>;
  context: Record<string, unknown>;
}) {
  const { error, count } = await params.operation();
  if (error) {
    if (isMissingTableOrColumnError(error)) {
      console.info("[api/user/learning-fields/:id][DELETE] skip_optional_table", {
        table: params.table,
        reason: toErrorMessage(error),
        ...params.context,
      });
      return 0;
    }
    throw error;
  }
  return Number(count ?? 0);
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

    if (patch.current_level !== undefined || patch.target_level !== undefined) {
      try {
        await ensureLearningStepsForUserField({
          userId: sessionUser.id,
          userFieldId: id,
          forceRegenerate: true,
        });
      } catch (error) {
        console.warn("[api/user/learning-fields/:id][PATCH] learning_steps_regeneration_failed", {
          user_id: sessionUser.id,
          user_field_id: id,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return NextResponse.json(payload);
  } catch {
    const payload: UpdateLearningFieldResponse = {
      success: false,
      message: "Unable to update learning field right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: DeleteLearningFieldResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    const { id } = await context.params;
    if (!id) {
      const payload: DeleteLearningFieldResponse = {
        success: false,
        message: "Learning field id is required.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const { data: targetUserField, error: targetUserFieldError } = await supabaseAdmin
      .from("user_learning_fields")
      .select("id, user_id, field_id")
      .eq("id", id)
      .limit(1)
      .maybeSingle();

    if (targetUserFieldError) {
      throw new Error("Failed to load learning field entry.");
    }

    if (!targetUserField) {
      const payload: DeleteLearningFieldResponse = {
        success: false,
        message: "Learning field entry not found.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const ownerUserId = toStringValue((targetUserField as Record<string, unknown>).user_id);
    const fieldId = toStringValue((targetUserField as Record<string, unknown>).field_id);
    if (!ownerUserId || ownerUserId !== sessionUser.id) {
      const payload: DeleteLearningFieldResponse = {
        success: false,
        message: "You do not have permission to delete this learning field.",
      };
      return NextResponse.json(payload, { status: 403 });
    }

    console.info("[api/user/learning-fields/:id][DELETE] start", {
      user_id: sessionUser.id,
      user_field_id: id,
      learning_field_id: fieldId,
    });

    const { data: journeyRows, error: journeyRowsError } = await supabaseAdmin
      .from("journey_paths")
      .select("id")
      .eq("user_id", sessionUser.id)
      .eq("learning_field_id", fieldId);

    if (journeyRowsError) {
      throw new Error("Failed to load user journeys for this learning field.");
    }

    const journeyPathIds = ((journeyRows ?? []) as Array<Record<string, unknown>>)
      .map((row) => toStringValue(row.id))
      .filter(Boolean);

    const { data: courseRows, error: courseRowsError } = await supabaseAdmin
      .from("courses")
      .select("id")
      .eq("learning_field_id", fieldId);

    if (courseRowsError) {
      throw new Error("Failed to load courses for this learning field.");
    }

    const courseIds = ((courseRows ?? []) as Array<Record<string, unknown>>)
      .map((row) => toStringValue(row.id))
      .filter(Boolean);

    if (journeyPathIds.length > 0) {
      console.info("[migration_cleanup] replaced_with_source_of_truth", {
        old_table: "user_learning_journeys",
        new_table: "journey_paths",
        user_id: sessionUser.id,
        user_field_id: id,
      });

      await safeDeleteOptionalTable({
        table: "user_course_resource_selections",
        context: {
          user_id: sessionUser.id,
          user_field_id: id,
          journey_path_count: journeyPathIds.length,
        },
        operation: () =>
          supabaseAdmin
            .from("user_course_resource_selections")
            .delete({ count: "exact" })
            .eq("user_id", sessionUser.id)
            .in("journey_path_id", journeyPathIds),
      });

      await safeDeleteOptionalTable({
        table: "user_review_sessions",
        context: {
          user_id: sessionUser.id,
          user_field_id: id,
          journey_path_count: journeyPathIds.length,
        },
        operation: () =>
          supabaseAdmin
            .from("user_review_sessions")
            .delete({ count: "exact" })
            .eq("user_id", sessionUser.id)
            .in("journey_path_id", journeyPathIds),
      });

      await safeDeleteOptionalTable({
        table: "user_course_progress",
        context: {
          user_id: sessionUser.id,
          user_field_id: id,
          journey_path_count: journeyPathIds.length,
        },
        operation: () =>
          supabaseAdmin
            .from("user_course_progress")
            .delete({ count: "exact" })
            .eq("user_id", sessionUser.id)
            .in("journey_path_id", journeyPathIds),
      });

      await safeDeleteOptionalTable({
        table: "course_test_attempts",
        context: {
          user_id: sessionUser.id,
          user_field_id: id,
          journey_path_count: journeyPathIds.length,
        },
        operation: () =>
          supabaseAdmin
            .from("course_test_attempts")
            .delete({ count: "exact" })
            .eq("user_id", sessionUser.id)
            .in("journey_path_id", journeyPathIds),
      });
    }

    if (courseIds.length > 0) {
      await safeDeleteOptionalTable({
        table: "weakness_profiles",
        context: {
          user_id: sessionUser.id,
          user_field_id: id,
          course_count: courseIds.length,
        },
        operation: () =>
          supabaseAdmin
            .from("weakness_profiles")
            .delete({ count: "exact" })
            .eq("user_id", sessionUser.id)
            .in("course_id", courseIds),
      });

      const { data: aiUserTestRows, error: aiUserTestRowsError } = await supabaseAdmin
        .from("ai_user_tests")
        .select("id")
        .eq("user_id", sessionUser.id)
        .in("course_id", courseIds);
      if (aiUserTestRowsError && !isMissingTableOrColumnError(aiUserTestRowsError)) {
        throw new Error("Failed to load AI test attempts for this learning field.");
      }

      const aiUserTestIds = ((aiUserTestRows ?? []) as Array<Record<string, unknown>>)
        .map((row) => toStringValue(row.id))
        .filter(Boolean);

      if (aiUserTestIds.length > 0) {
        await safeDeleteOptionalTable({
          table: "ai_user_test_answers",
          context: {
            user_id: sessionUser.id,
            user_field_id: id,
            ai_test_count: aiUserTestIds.length,
          },
          operation: () =>
            supabaseAdmin
              .from("ai_user_test_answers")
              .delete({ count: "exact" })
              .in("user_test_id", aiUserTestIds),
        });
      }

      await safeDeleteOptionalTable({
        table: "ai_user_tests",
        context: {
          user_id: sessionUser.id,
          user_field_id: id,
          course_count: courseIds.length,
        },
        operation: () =>
          supabaseAdmin
            .from("ai_user_tests")
            .delete({ count: "exact" })
            .eq("user_id", sessionUser.id)
            .in("course_id", courseIds),
      });
    }

    console.info("[migration_cleanup] replaced_with_source_of_truth", {
      old_table: "user_learning_journeys",
      new_table: "journey_paths",
      user_id: sessionUser.id,
      user_field_id: id,
      learning_field_id: fieldId,
    });

    if (journeyPathIds.length > 0) {
      await safeDeleteOptionalTable({
        table: "journey_paths",
        context: {
          user_id: sessionUser.id,
          user_field_id: id,
          learning_field_id: fieldId,
          journey_path_count: journeyPathIds.length,
        },
        operation: () =>
          supabaseAdmin
            .from("journey_paths")
            .delete({ count: "exact" })
            .eq("user_id", sessionUser.id)
            .in("id", journeyPathIds),
      });
    }

    console.info("[migration_cleanup] replaced_with_source_of_truth", {
      old_tables: ["field_routes", "route_nodes", "user_node_progress"],
      new_tables: ["journey_paths", "journey_path_courses", "user_course_progress"],
      user_id: sessionUser.id,
      user_field_id: id,
      learning_field_id: fieldId,
    });

    const { error: deleteUserFieldError } = await supabaseAdmin
      .from("user_learning_fields")
      .delete()
      .eq("id", id)
      .eq("user_id", sessionUser.id);

    if (deleteUserFieldError) {
      throw new Error("Failed to delete user learning field.");
    }

    console.info("[api/user/learning-fields/:id][DELETE] success", {
      user_id: sessionUser.id,
      user_field_id: id,
      learning_field_id: fieldId,
      journey_path_count: journeyPathIds.length,
      course_count: courseIds.length,
    });

    const payload: DeleteLearningFieldResponse = {
      success: true,
      message: "Learning field deleted successfully.",
    };
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[api/user/learning-fields/:id][DELETE] failed", {
      reason: toErrorMessage(error),
      stack: error instanceof Error ? error.stack : null,
    });
    const payload: DeleteLearningFieldResponse = {
      success: false,
      message: "Unable to delete this learning field right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
