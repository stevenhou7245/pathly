import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { isStartCourseError, startCourseProgress } from "@/lib/journeyProgression";

export const runtime = "nodejs";

const startCourseSchema = z.object({
  course_id: z.string().uuid("course_id must be a valid UUID."),
  journey_path_id: z.string().uuid("journey_path_id must be a valid UUID."),
  selected_resource_id: z.string().uuid("selected_resource_id must be a valid UUID."),
});

type StartCourseResponse = {
  success: boolean;
  message?: string;
  resource_url?: string;
};

export async function POST(request: Request) {
  let currentStep = "authenticate_user";

  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: StartCourseResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    currentStep = "read_payload";
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      const payload: StartCourseResponse = {
        success: false,
        message: "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    currentStep = "validate_payload";
    const parsed = startCourseSchema.safeParse(body);
    if (!parsed.success) {
      const payload: StartCourseResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    console.info("[api/course/start] payload", {
      user_id: sessionUser.id,
      course_id: parsed.data.course_id,
      journey_path_id: parsed.data.journey_path_id,
      selected_resource_id: parsed.data.selected_resource_id,
    });

    currentStep = "start_course_progress";
    const started = await startCourseProgress({
      userId: sessionUser.id,
      courseId: parsed.data.course_id,
      journeyPathId: parsed.data.journey_path_id,
      selectedResourceId: parsed.data.selected_resource_id,
    });

    if (!started.ok) {
      const payload: StartCourseResponse = {
        success: false,
        message: started.message,
      };
      return NextResponse.json(payload, { status: 403 });
    }

    console.info("[api/course/start] success", {
      user_id: sessionUser.id,
      course_id: parsed.data.course_id,
      journey_path_id: parsed.data.journey_path_id,
      selected_resource_id: parsed.data.selected_resource_id,
      resource_url: started.resource_url,
    });

    const payload: StartCourseResponse = {
      success: true,
      message: "Course started.",
      resource_url: started.resource_url,
    };
    return NextResponse.json(payload);
  } catch (error) {
    const failedStep = isStartCourseError(error) ? error.step : currentStep;
    const message = error instanceof Error ? error.message : String(error);

    console.error("[api/course/start] failed", {
      route_step: currentStep,
      failed_step: failedStep,
      message,
      stack: error instanceof Error ? error.stack : null,
      error,
    });

    if (
      isStartCourseError(error) &&
      (message === "Selected resource not found." ||
        message === "Selected resource URL is missing." ||
        message === "Failed to load selected resource.")
    ) {
      const payload: StartCourseResponse = {
        success: false,
        message,
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const payload: StartCourseResponse = {
      success: false,
      message: "Unable to start course right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
