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
      return NextResponse.json<TransitionReviewPopupResponse>(
        { success: false, message: "Unauthorized." },
        { status: 401 },
      );
    }
    currentUserId = sessionUser.id;

    const url = new URL(request.url);
    const parsed = popupQuerySchema.safeParse({
      journey_path_id: url.searchParams.get("journey_path_id"),
      from_course_id: url.searchParams.get("from_course_id"),
      to_course_id: url.searchParams.get("to_course_id"),
    });

    if (!parsed.success) {
      return NextResponse.json<TransitionReviewPopupResponse>(
        { success: false, message: parsed.error.issues[0]?.message ?? "Invalid request query." },
        { status: 400 },
      );
    }

    normalizedJourneyPathId = parsed.data.journey_path_id;
    normalizedFromCourseId = parsed.data.from_course_id;
    normalizedToCourseId = parsed.data.to_course_id;

    // 1️⃣ 验证 journey_path_id 是否存在
    const { data: journeyRow, error: journeyError } = await supabaseAdmin
      .from("journey_paths")
      .select("id")
      .eq("id", normalizedJourneyPathId)
      .limit(1)
      .maybeSingle();

    if (journeyError) throw journeyError;
    if (!journeyRow) {
      return NextResponse.json<TransitionReviewPopupResponse>(
        { success: false, message: "Journey path not found." },
        { status: 404 },
      );
    }

    // 2️⃣ 查询 journey_path_courses 确认 from_course_id 与 to_course_id 存在
    const { data: pathCourses, error: pathCoursesError } = await supabaseAdmin
      .from("journey_path_courses")
      .select("course_id, step_number")
      .eq("journey_path_id", normalizedJourneyPathId)
      .in("course_id", [normalizedFromCourseId, normalizedToCourseId]);

    if (pathCoursesError) throw pathCoursesError;
    if (!pathCourses || pathCourses.length < 2) {
      return NextResponse.json<TransitionReviewPopupResponse>(
        { success: false, message: "Selected lessons are not part of this journey." },
        { status: 404 },
      );
    }

    const fromCourseRow = pathCourses.find((row) => normalizeUuid(row.course_id) === normalizedFromCourseId);
    const toCourseRow = pathCourses.find((row) => normalizeUuid(row.course_id) === normalizedToCourseId);

    if (!fromCourseRow || !toCourseRow) {
      return NextResponse.json<TransitionReviewPopupResponse>(
        { success: false, message: "Selected lessons are not part of this journey." },
        { status: 404 },
      );
    }

    const fromStepNumber = Math.max(1, toNumberValue(fromCourseRow.step_number));
    const toStepNumber = Math.max(1, toNumberValue(toCourseRow.step_number));

    // 3️⃣ 获取课程标题
    const { data: coursesRows, error: coursesError } = await supabaseAdmin
      .from("courses")
      .select("id, title")
      .in("id", [normalizedFromCourseId, normalizedToCourseId]);

    if (coursesError) throw coursesError;

    const popup = await getOrCreateTransitionReviewPopup({
      userId: sessionUser.id,
      journeyPathId: normalizedJourneyPathId,
      fromCourseId: normalizedFromCourseId,
      toCourseId: normalizedToCourseId,
    });

    return NextResponse.json<TransitionReviewPopupResponse>(
      {
        success: true,
        message: "Journey path ready for review",
        data: {
          journey_path_id: normalizedJourneyPathId,
          from_course_id: normalizedFromCourseId,
          to_course_id: normalizedToCourseId,
          from_step_number: fromStepNumber,
          to_step_number: toStepNumber,
        },
        popup,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[api/course/transition-review/popup][GET] failed", {
      user_id: currentUserId,
      journey_path_id: normalizedJourneyPathId,
      from_course_id: normalizedFromCourseId,
      to_course_id: normalizedToCourseId,
      reason: message,
    });
    return NextResponse.json<TransitionReviewPopupResponse>(
      { success: false, message: "Unable to load transition review right now." },
      { status: 500 },
    );
  }
}