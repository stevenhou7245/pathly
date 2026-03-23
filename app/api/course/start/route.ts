import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { isStartCourseError, startCourseProgress } from "@/lib/journeyProgression";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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
  progress?: {
    id: string;
    status: "locked" | "unlocked" | "in_progress" | "ready_for_test" | "passed";
    selected_resource_id: string | null;
    started_at: string | null;
    last_activity_at: string | null;
  };
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

    console.info("[start_learning] request_received", {
      user_id: sessionUser.id,
      course_id: parsed.data.course_id,
      journey_path_id: parsed.data.journey_path_id,
      selected_resource_id: parsed.data.selected_resource_id,
    });
    // Validate selected resource against source-of-truth options table.
    const { data: selectedOptionRow, error: selectedOptionError } = await supabaseAdmin
      .from("course_resource_options")
      .select("id, course_id, title, resource_type")
      .eq("id", parsed.data.selected_resource_id)
      .eq("course_id", parsed.data.course_id)
      .limit(1)
      .maybeSingle();
    if (selectedOptionError || !selectedOptionRow) {
      console.error("[start_learning] selected_resource_lookup_failed", {
        user_id: sessionUser.id,
        course_id: parsed.data.course_id,
        journey_path_id: parsed.data.journey_path_id,
        selected_resource_id: parsed.data.selected_resource_id,
        reason: selectedOptionError ? selectedOptionError.message : "resource_not_found",
        code:
          (selectedOptionError as unknown as Record<string, unknown> | null)?.code ?? null,
        details:
          (selectedOptionError as unknown as Record<string, unknown> | null)?.details ?? null,
        hint: (selectedOptionError as unknown as Record<string, unknown> | null)?.hint ?? null,
      });
      const payload: StartCourseResponse = {
        success: false,
        message: "Selected resource not found.",
      };
      return NextResponse.json(payload, { status: 400 });
    }
    console.info("[start_learning] selected_resource_lookup_succeeded", {
      user_id: sessionUser.id,
      course_id: parsed.data.course_id,
      journey_path_id: parsed.data.journey_path_id,
      selected_resource_id: parsed.data.selected_resource_id,
      selected_resource_title: (selectedOptionRow as Record<string, unknown>).title ?? null,
    });

    const selectedAt = new Date().toISOString();
    const selectionUpsertPayload = {
      user_id: sessionUser.id,
      course_id: parsed.data.course_id,
      resource_option_id: parsed.data.selected_resource_id,
      selected_at: selectedAt,
    };
    const { error: selectionUpsertError } = await supabaseAdmin
      .from("user_course_resource_selections")
      .upsert(selectionUpsertPayload, { onConflict: "user_id,course_id" });
    if (selectionUpsertError) {
      console.error("[resource_selection] upsert_failed", {
        user_id: sessionUser.id,
        course_id: parsed.data.course_id,
        resource_option_id: parsed.data.selected_resource_id,
        selected_at: selectedAt,
        reason: selectionUpsertError.message,
        code: (selectionUpsertError as unknown as Record<string, unknown>).code ?? null,
        details: (selectionUpsertError as unknown as Record<string, unknown>).details ?? null,
        hint: (selectionUpsertError as unknown as Record<string, unknown>).hint ?? null,
      });
      const payload: StartCourseResponse = {
        success: false,
        message: "Unable to save selected resource right now.",
      };
      return NextResponse.json(payload, { status: 500 });
    }
    console.info("[resource_selection] upsert_succeeded", {
      user_id: sessionUser.id,
      course_id: parsed.data.course_id,
      resource_option_id: parsed.data.selected_resource_id,
      selected_at: selectedAt,
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

    console.info("[start_learning] request_succeeded", {
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
      progress: started.progress,
    };
    return NextResponse.json(payload);
  } catch (error) {
    const failedStep = isStartCourseError(error) ? error.step : currentStep;
    const message = error instanceof Error ? error.message : String(error);

    console.error("[start_learning] request_failed", {
      route_step: currentStep,
      failed_step: failedStep,
      message,
      stack: error instanceof Error ? error.stack : null,
      error,
    });

    if (isStartCourseError(error)) {
      let status = 400;
      let responseMessage = message;

      if (error.step === "fetch_resource_row") {
        responseMessage =
          message === "Selected resource not found."
            ? "Selected resource lookup failed."
            : message;
        status = 400;
      } else if (error.step === "validate_resource_url") {
        responseMessage = "Selected resource is missing a valid URL.";
        status = 400;
      } else if (error.step === "progress_write" || error.step === "start_learning_course_rpc") {
        responseMessage = "Progress write failed.";
        status = 500;
      } else if (message.toLowerCase().includes("legacy")) {
        responseMessage = "Legacy lookup path failure.";
        status = 500;
      }

      const payload: StartCourseResponse = {
        success: false,
        message: responseMessage,
      };
      return NextResponse.json(payload, { status });
    }

    const payload: StartCourseResponse = {
      success: false,
      message: "Unable to start course right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
