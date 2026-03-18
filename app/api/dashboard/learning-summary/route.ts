import { NextResponse } from "next/server";
import {
  dashboardSummaryQuerySchema,
  DashboardLearningSummaryError,
  getDashboardLearningSummary,
} from "@/lib/dashboardLearningSummary";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";

export const runtime = "nodejs";

type LearningSummaryResponse = {
  success: boolean;
  message?: string;
  field?: {
    id: string;
    title: string;
    level: string | null;
    destination: string | null;
    user_learning_field_id: string | null;
  };
  journey?: {
    journey_path_id: string;
    total_steps: number;
    completed_steps: number;
    current_step: number;
    progress_percent: number;
  };
  folder_summary?: {
    completed_milestones: number;
    total_milestones: number;
  };
};

export async function GET(request: Request) {
  let requestFieldId = "";
  const requestStartedAt = Date.now();
  const marks: Record<string, number> = {};
  try {
    marks.auth_start = Date.now();
    const sessionUser = await getAuthenticatedSessionUser();
    marks.auth_end = Date.now();
    if (!sessionUser) {
      const payload: LearningSummaryResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    const url = new URL(request.url);
    const parsed = dashboardSummaryQuerySchema.safeParse({
      field_id: url.searchParams.get("field_id")?.trim() ?? "",
    });

    if (!parsed.success) {
      const payload: LearningSummaryResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "field_id is required.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    requestFieldId = parsed.data.field_id;
    console.info("[api/dashboard/learning-summary] request", {
      user_id: sessionUser.id,
      field_id: requestFieldId,
    });

    marks.summary_start = Date.now();
    const summary = await getDashboardLearningSummary({
      userId: sessionUser.id,
      fieldId: parsed.data.field_id,
    });
    marks.summary_end = Date.now();

    console.info("[api/dashboard/learning-summary] response", {
      user_id: sessionUser.id,
      field_id: requestFieldId,
      journey_path_id: summary.journey.journey_path_id,
      total_steps: summary.journey.total_steps,
      completed_steps: summary.journey.completed_steps,
      progress_percent: summary.journey.progress_percent,
    });

    const payload: LearningSummaryResponse = {
      success: true,
      field: summary.field,
      journey: summary.journey,
      folder_summary: summary.folder_summary,
    };
    console.info("[api/dashboard/learning-summary] timings", {
      user_id: sessionUser.id,
      field_id: requestFieldId,
      total_ms: Date.now() - requestStartedAt,
      auth_ms: (marks.auth_end ?? 0) - (marks.auth_start ?? 0),
      summary_service_ms: (marks.summary_end ?? 0) - (marks.summary_start ?? 0),
      mapping_ms: Date.now() - (marks.summary_end ?? Date.now()),
    });
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (error instanceof DashboardLearningSummaryError) {
      console.error("[api/dashboard/learning-summary] handled_error", {
        field_id: requestFieldId,
        total_ms: Date.now() - requestStartedAt,
        message: error.message,
        status: error.status,
        stack: error.stack,
      });
      const payload: LearningSummaryResponse = {
        success: false,
        message: error.message,
      };
      return NextResponse.json(payload, { status: error.status });
    }

    console.error("[api/dashboard/learning-summary] unexpected_error", {
      field_id: requestFieldId,
      total_ms: Date.now() - requestStartedAt,
      error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    });
    const payload: LearningSummaryResponse = {
      success: false,
      message: "Unable to load learning summary right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
