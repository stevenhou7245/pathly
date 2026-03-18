import { NextResponse } from "next/server";
import { z } from "zod";
import { prepareCourseTest } from "@/lib/journeyProgression";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";

export const runtime = "nodejs";

const prepareTestSchema = z.object({
  course_id: z.string().uuid("course_id must be a valid UUID."),
  journey_path_id: z.string().uuid("journey_path_id must be a valid UUID."),
  selected_resource_id: z
    .string()
    .uuid("selected_resource_id must be a valid UUID.")
    .optional(),
});

type PrepareCourseTestResponse = {
  success: boolean;
  message?: string;
  test?: {
    course_id: string;
    journey_path_id: string;
    user_test_id: string;
    test_attempt_id: string;
    status: "locked" | "unlocked" | "in_progress" | "ready_for_test" | "passed";
    required_score: number;
    questions: Array<{
      id: string;
      question_order: number;
      question_text: string;
      prompt: string;
      question_type: "single_choice" | "fill_blank" | "essay";
      options: string[];
      score: number;
    }>;
  };
};

export async function POST(request: Request) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: PrepareCourseTestResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      const payload: PrepareCourseTestResponse = {
        success: false,
        message: "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const parsed = prepareTestSchema.safeParse(body);
    if (!parsed.success) {
      const payload: PrepareCourseTestResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const test = await prepareCourseTest({
      userId: sessionUser.id,
      journeyPathId: parsed.data.journey_path_id,
      courseId: parsed.data.course_id,
      selectedResourceId: parsed.data.selected_resource_id,
    });

    const payload: PrepareCourseTestResponse = {
      success: true,
      test,
    };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to prepare test right now.";
    const clientErrorMessages = new Set([
      "User not found.",
      "Course not found.",
      "Please complete previous courses",
      "Start learning before taking the AI test.",
      "Selected resource not found.",
      "No ready AI test template found for this course.",
      "No AI test questions found for this template.",
    ]);
    const status = clientErrorMessages.has(message) ? 400 : 500;
    const payload: PrepareCourseTestResponse = {
      success: false,
      message: status === 500 ? "Unable to prepare test right now." : message,
    };
    return NextResponse.json(payload, { status });
  }
}
