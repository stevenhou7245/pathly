import { NextResponse } from "next/server";
import { z } from "zod";
import { prepareCourseTest } from "@/lib/journeyProgression";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";

export const runtime = "nodejs";

const prepareTestSchema = z.object({
  course_id: z.string().uuid("course_id must be a valid UUID."),
  journey_path_id: z.string().uuid("journey_path_id must be a valid UUID.").optional(),
  selected_resource_option_id: z
    .string()
    .uuid("selected_resource_option_id must be a valid UUID.")
    .optional(),
  selected_resource_id: z
    .string()
    .uuid("selected_resource_id must be a valid UUID.")
    .optional(),
});

type PrepareCourseTestResponse = {
  success: boolean;
  error?: string;
  message?: string;
  details?: unknown;
  test?: {
    course_id: string;
    journey_path_id: string;
    user_test_id: string;
    test_attempt_id: string;
    template_id: string;
    total_questions: number;
    objective_questions: number;
    short_answer_questions: number;
    total_score: number;
    title: string;
    difficulty_band: "beginner" | "basic" | "intermediate" | "advanced" | "expert";
    test_template: {
      course_id: string;
      course_title: string;
      difficulty_band: "beginner" | "basic" | "intermediate" | "advanced" | "expert";
      resource_context: {
        selected_resource_option_id: string | null;
        selected_resource_title: string | null;
        selected_resource_type: string | null;
        selected_resource_provider: string | null;
        selected_resource_url: string | null;
        selected_resource_summary: string | null;
      };
      metadata: {
        generated_at: string;
        attempt_number: number;
        variant_no: number;
        prompt_version: string;
        requirements_met: {
          include_concept_and_skill_tags: boolean;
          vary_from_previous_attempts: boolean;
        };
        ai_provider: string | null;
        ai_model: string | null;
        fallback_used: boolean;
        reused_existing: boolean;
        total_questions: number;
        objective_questions: number;
        short_answer_questions: number;
        total_score: number;
      };
      questions: Array<{
        id: string;
        question_order: number;
        question_text: string;
        question_type: "multiple_choice" | "fill_blank" | "short_answer";
        options: string[];
        score: number;
      }>;
    };
    status: "locked" | "unlocked" | "in_progress" | "ready_for_test" | "passed";
    required_score: number;
    questions: Array<{
      id: string;
      question_order: number;
      question_text: string;
      prompt: string;
      question_type: "multiple_choice" | "fill_blank" | "short_answer";
      options: string[];
      score: number;
    }>;
  };
};

function getClientErrorCategory(message: string) {
  if (message.includes("must be a valid UUID") || message.includes("Invalid request payload")) {
    return "request_validation";
  }
  if (message === "User not found." || message === "Course not found.") {
    return "db_lookup_failure";
  }
  if (message === "Selected resource not found.") {
    return "resource_lookup_failure";
  }
  if (
    message === "AI test template payload missing test_template." ||
    message === "AI test template payload missing questions array."
  ) {
    return "schema_validation_failure";
  }
  if (message.startsWith("Invalid AI test composition:")) {
    return "schema_validation_failure";
  }
  if (message.startsWith("AI test template generation failed:")) {
    return "generation_failure";
  }
  if (message.startsWith("No ready AI test template found for this course.")) {
    return "template_resolution_failure";
  }
  if (message === "No AI test questions found for this template.") {
    return "required_field_mismatch";
  }
  if (message === "Failed to insert AI test questions") {
    return "db_insert_failure";
  }
  if (message === "Please complete previous courses" || message === "Start learning before taking the AI test.") {
    return "business_rule";
  }
  return "unknown";
}

function toStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function extractPipelineErrorContext(error: unknown) {
  const record = (error ?? {}) as Record<string, unknown>;
  const details =
    record.details && typeof record.details === "object"
      ? (record.details as Record<string, unknown>)
      : null;
  const cause = (record.cause ?? null) as unknown;
  const causeRecord = (cause ?? {}) as Record<string, unknown>;

  return {
    step: toStringValue(record.step) || null,
    code: toStringValue(record.code) || null,
    details,
    name: toStringValue(record.name) || null,
    cause_message:
      toStringValue(causeRecord.message) || toStringValue(record.cause) || null,
    stack: error instanceof Error ? error.stack : null,
  };
}

export async function POST(request: Request) {
  console.info("[ai_test_start] request_received", {
    method: request.method,
    path: "/api/course/test/start",
  });
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
      console.info("[ai_test_start] request_body", body as Record<string, unknown>);
    } catch {
      console.error("[ai_test_start] validation_failed", {
        reason: "Invalid JSON body",
      });
      const payload: PrepareCourseTestResponse = {
        success: false,
        error: "Invalid request payload.",
        message: "Invalid request payload.",
        details: {
          category: "request_validation",
          reason: "Invalid JSON body",
        },
      };
      return NextResponse.json(payload, { status: 400 });
    }

    console.info("[ai_test_start] validation_started");
    const parsed = prepareTestSchema.safeParse(body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const validationError = issue?.message ?? "Invalid request payload.";
      console.error("[ai_test_start] validation_failed", {
        issues: parsed.error.issues.map((item) => ({
          path: item.path.join("."),
          message: item.message,
        })),
      });
      const payload: PrepareCourseTestResponse = {
        success: false,
        error: validationError,
        message: validationError,
        details: {
          category: "request_validation",
          issues: parsed.error.issues.map((item) => ({
            path: item.path.join("."),
            message: item.message,
          })),
        },
      };
      return NextResponse.json(payload, { status: 400 });
    }
    console.info("[ai_test_start] validation_succeeded", {
      course_id: parsed.data.course_id,
      journey_path_id: parsed.data.journey_path_id ?? null,
      selected_resource_option_id: parsed.data.selected_resource_option_id ?? null,
      selected_resource_id: parsed.data.selected_resource_id ?? null,
      selected_resource_payload_used_as_source_of_truth: false,
    });

    const test = await prepareCourseTest({
      userId: sessionUser.id,
      journeyPathId: parsed.data.journey_path_id,
      courseId: parsed.data.course_id,
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
    const context = extractPipelineErrorContext(error);
    const clientErrorMessages = new Set([
      "User not found.",
      "Course not found.",
      "Please complete previous courses",
      "Start learning before taking the AI test.",
      "Selected resource not found.",
      "No ready AI test template found for this course.",
      "No AI test questions found for this template.",
      "AI test template payload missing test_template.",
      "AI test template payload missing questions array.",
      "Failed to insert AI test questions",
    ]);
    const isClientError =
      clientErrorMessages.has(message) ||
      message.startsWith("No ready AI test template found for this course.") ||
      message.startsWith("AI test template generation failed:") ||
      message.startsWith("Invalid AI test composition:");

    const status = isClientError ? 400 : 500;
    const category = getClientErrorCategory(message);
    const logLabel = status === 400 ? "[ai_test_start] request_rejected" : "[ai_test_start] request_failed";
    console.error(logLabel, {
      category,
      reason: message,
      step: context.step,
      code: context.code,
      error_name: context.name,
      pipeline_details: context.details,
      cause_message: context.cause_message,
      stack: context.stack,
    });

    const payload: PrepareCourseTestResponse = {
      success: false,
      error: message,
      message,
      details: {
        category,
        step: context.step,
        code: context.code,
        pipeline_details: context.details,
        cause_message: context.cause_message,
      },
    };
    return NextResponse.json(payload, { status });
  }
}
