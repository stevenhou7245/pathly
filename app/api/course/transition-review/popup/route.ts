import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getOrCreateTransitionReviewPopup } from "@/lib/transitionReview";

export const runtime = "nodejs";

type GenericRecord = Record<string, unknown>;

function toStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toNumberValue(value: unknown) {
  const normalized = typeof value === "number" ? value : Number(value);
  return Number.isFinite(normalized) ? normalized : 0;
}

function normalizeUuid(value: unknown) {
  return toStringValue(value).trim().toLowerCase();
}

function normalizeTitle(value: unknown) {
  return toStringValue(value).trim().toLowerCase().replace(/\s+/g, " ");
}

function resolveProgressStepNumber(row: GenericRecord | null) {
  if (!row) {
    return null;
  }
  const candidateKeys = ["step_number", "course_step_number", "assigned_step_number"] as const;
  for (const key of candidateKeys) {
    const parsed = Math.floor(toNumberValue(row[key]));
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

const uuidQueryParamSchema = (fieldName: string) =>
  z.preprocess(
    (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
    z.string().uuid(`${fieldName} must be a valid UUID.`),
  );

const popupQuerySchema = z.object({
  journey_path_id: uuidQueryParamSchema("journey_path_id"),
  from_course_id: uuidQueryParamSchema("from_course_id"),
  to_course_id: uuidQueryParamSchema("to_course_id"),
});

type TransitionReviewPopupResponse = {
  success: boolean;
  message?: string;
  pending_generation?: boolean;
  data?: {
    journey_path_id: string;
    from_course_id: string;
    to_course_id: string;
    from_step_number: number;
    to_step_number: number;
  };
  popup?: {
    should_show: boolean;
    review_id: string | null;
    from_course_id: string | null;
    to_course_id: string | null;
    instructions: string;
    questions: Array<{
      question_index: number;
      question_type: "single_choice" | "fill_blank" | "short_answer";
      question_text: string;
      options: string[];
      correct_answer: string;
      explanation: string;
    }>;
  };
};

export async function GET(request: Request) {
  let currentUserId = "";
  let normalizedJourneyPathId = "";
  let normalizedFromCourseId = "";
  let normalizedToCourseId = "";
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: TransitionReviewPopupResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }
    currentUserId = sessionUser.id;

    const url = new URL(request.url);
    const parsed = popupQuerySchema.safeParse({
      journey_path_id: url.searchParams.get("journey_path_id")?.trim(),
      from_course_id: url.searchParams.get("from_course_id")?.trim(),
      to_course_id: url.searchParams.get("to_course_id")?.trim(),
    });
    console.info("[api/course/transition-review/popup][GET] incoming_query_params", {
      user_id: sessionUser.id,
      journey_path_id_raw: url.searchParams.get("journey_path_id"),
      from_course_id_raw: url.searchParams.get("from_course_id"),
      to_course_id_raw: url.searchParams.get("to_course_id"),
      parse_success: parsed.success,
    });
    if (!parsed.success) {
      const payload: TransitionReviewPopupResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request query.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    normalizedJourneyPathId = parsed.data.journey_path_id;
    normalizedFromCourseId = parsed.data.from_course_id;
    normalizedToCourseId = parsed.data.to_course_id;

    const { data: learningFieldRow, error: learningFieldError } = await supabaseAdmin
      .from("user_learning_fields")
      .select("id, user_id, current_step_index")
      .eq("user_id", sessionUser.id)
      .eq("id", normalizedJourneyPathId)
      .limit(1)
      .maybeSingle();

    console.info("[api/course/transition-review/popup][GET] user_learning_fields_query_result", {
      user_id: sessionUser.id,
      journey_path_id: normalizedJourneyPathId,
      found: Boolean(learningFieldRow),
      error_message: learningFieldError?.message ?? null,
    });

    if (learningFieldError) {
      throw learningFieldError;
    }

    if (!learningFieldRow) {
      const payload: TransitionReviewPopupResponse = {
        success: false,
        message: "Journey path not found for this user.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const effectiveJourneyPathId = normalizeUuid((learningFieldRow as GenericRecord).id);

    const { data: progressRows, error: progressError } = await supabaseAdmin
      .from("user_course_progress")
      .select("*")
      .eq("user_id", sessionUser.id)
      .in("course_id", [normalizedFromCourseId, normalizedToCourseId]);

    const typedProgressRows = (progressRows ?? []) as GenericRecord[];

    console.info("[api/course/transition-review/popup][GET] user_course_progress_query_result", {
      user_id: sessionUser.id,
      journey_path_id: effectiveJourneyPathId,
      row_count: typedProgressRows.length,
      sample_rows: typedProgressRows
        .slice(0, 5)
        .map((row) => ({
          course_id: normalizeUuid(row.course_id),
          status: toStringValue(row.status).toLowerCase(),
          journey_path_id: normalizeUuid(row.journey_path_id),
        })),
      error_message: progressError?.message ?? null,
    });

    if (progressError) {
      throw progressError;
    }

    const fromCourseRow =
      typedProgressRows.find(
        (row) => normalizeUuid(row.course_id) === normalizedFromCourseId,
      ) ?? null;
    const toCourseRow =
      typedProgressRows.find(
        (row) => normalizeUuid(row.course_id) === normalizedToCourseId,
      ) ?? null;

    if (!fromCourseRow || !toCourseRow) {
      const missingParts: string[] = [];
      if (!fromCourseRow) {
        missingParts.push(`from_course_id=${normalizedFromCourseId}`);
      }
      if (!toCourseRow) {
        missingParts.push(`to_course_id=${normalizedToCourseId}`);
      }
      const payload: TransitionReviewPopupResponse = {
        success: false,
        message:
          `Journey path or courses not found: ${missingParts.join(", ")} ` +
          `not found in user_course_progress for user_id=${sessionUser.id}.`,
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const { data: coursesRows, error: coursesError } = await supabaseAdmin
      .from("courses")
      .select("id, title")
      .in("id", [normalizedFromCourseId, normalizedToCourseId]);
    if (coursesError) {
      throw coursesError;
    }
    const typedCoursesRows = (coursesRows ?? []) as GenericRecord[];
    const fromCourseTitle =
      toStringValue(
        typedCoursesRows.find((row) => normalizeUuid(row.id) === normalizedFromCourseId)?.title,
      ).trim() || "";
    const toCourseTitle =
      toStringValue(
        typedCoursesRows.find((row) => normalizeUuid(row.id) === normalizedToCourseId)?.title,
      ).trim() || "";

    let completionRows: GenericRecord[] = [];
    const completionTitles = [fromCourseTitle, toCourseTitle].filter(Boolean);
    if (completionTitles.length > 0) {
      const { data: completions, error: completionError } = await supabaseAdmin
        .from("user_learning_step_completions")
        .select("step_number, step_title")
        .eq("user_id", sessionUser.id)
        .eq("user_learning_field_id", effectiveJourneyPathId)
        .in("step_title", completionTitles);
      if (completionError) {
        throw completionError;
      }
      completionRows = (completions ?? []) as GenericRecord[];
    }

    console.info("[api/course/transition-review/popup][GET] user_learning_step_completions_query_result", {
      user_id: sessionUser.id,
      user_learning_field_id: effectiveJourneyPathId,
      row_count: completionRows.length,
    });

    const fromCompletionRow =
      completionRows.find(
        (row) => normalizeTitle(row.step_title) === normalizeTitle(fromCourseTitle),
      ) ?? null;
    const toCompletionRow =
      completionRows.find(
        (row) => normalizeTitle(row.step_title) === normalizeTitle(toCourseTitle),
      ) ?? null;

    let fromStepNumber =
      Math.max(0, Math.floor(toNumberValue(fromCompletionRow?.step_number ?? 0))) ||
      resolveProgressStepNumber(fromCourseRow) ||
      null;
    let toStepNumber =
      Math.max(0, Math.floor(toNumberValue(toCompletionRow?.step_number ?? 0))) ||
      resolveProgressStepNumber(toCourseRow) ||
      null;

    const currentStepIndex = Math.max(
      1,
      Math.floor(toNumberValue((learningFieldRow as GenericRecord).current_step_index) || 1),
    );
    if (fromStepNumber == null && toStepNumber == null) {
      fromStepNumber = Math.max(1, currentStepIndex - 1);
      toStepNumber = fromStepNumber + 1;
    } else if (fromStepNumber == null && toStepNumber != null) {
      fromStepNumber = Math.max(1, toStepNumber - 1);
    } else if (fromStepNumber != null && toStepNumber == null) {
      toStepNumber = fromStepNumber + 1;
    }

    const popup = await getOrCreateTransitionReviewPopup({
      userId: sessionUser.id,
      journeyPathId: effectiveJourneyPathId,
      fromCourseId: normalizedFromCourseId,
      toCourseId: normalizedToCourseId,
    });

    const payload: TransitionReviewPopupResponse = {
      success: true,
      message: "Journey path ready for review",
      data: {
        journey_path_id: effectiveJourneyPathId,
        from_course_id: normalizedFromCourseId,
        to_course_id: normalizedToCourseId,
        from_step_number: Math.max(1, fromStepNumber ?? 1),
        to_step_number: Math.max(1, toStepNumber ?? 2),
      },
      popup,
    };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const clientErrorMessages = new Set([
      "Journey path not found.",
      "Selected lessons are not part of this journey.",
      "Transition review is only available for adjacent lessons.",
      "Please complete the previous lesson first.",
      "Please complete previous lessons before opening this lesson.",
      "Previous lesson not found.",
      "Next lesson not found.",
    ]);
    const status = message.includes("not found")
      ? 404
      : clientErrorMessages.has(message)
      ? 400
      : 500;
    console.error("[api/course/transition-review/popup][GET] failed", {
      user_id: currentUserId || null,
      journey_path_id: normalizedJourneyPathId || null,
      from_course_id: normalizedFromCourseId || null,
      to_course_id: normalizedToCourseId || null,
      reason: message,
    });
    const payload: TransitionReviewPopupResponse = {
      success: false,
      message:
        status === 500
          ? "Unable to load transition review right now."
          : status === 404
          ? `Journey path or courses not found: ${message}`
          : message,
    };
    return NextResponse.json(payload, { status });
  }
}
