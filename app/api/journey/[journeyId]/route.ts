import { NextResponse } from "next/server";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { getJourneyById } from "@/lib/journeyProgression";

export const runtime = "nodejs";

type GetJourneyResponse = {
  success: boolean;
  message?: string;
  journey?: {
    journey_path_id: string;
    starting_point: string;
    destination: string;
    total_steps: number;
    current_step: number;
    learning_field_id: string;
    steps: Array<{
      step_number: number;
      course_id: string | null;
      title: string;
      description: string | null;
      objective: string | null;
      difficulty: string | null;
      skill_tags: string[];
      concept_tags: string[];
    }>;
    nodes: Array<{
      step_number: number;
      course_id: string;
      title: string;
      status: "locked" | "unlocked" | "in_progress" | "ready_for_test" | "passed";
      passed_score: number | null;
    }>;
  };
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ journeyId: string }> },
) {
  const requestStartedAt = Date.now();
  const marks: Record<string, number> = {};
  try {
    marks.auth_start = Date.now();
    const sessionUser = await getAuthenticatedSessionUser();
    marks.auth_end = Date.now();
    if (!sessionUser) {
      const payload: GetJourneyResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    marks.params_start = Date.now();
    const { journeyId } = await context.params;
    marks.params_end = Date.now();
    if (!journeyId) {
      const payload: GetJourneyResponse = {
        success: false,
        message: "journeyId is required.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    marks.db_start = Date.now();
    const journey = await getJourneyById({
      userId: sessionUser.id,
      journeyPathId: journeyId,
    });
    marks.db_end = Date.now();

    const payload: GetJourneyResponse = {
      success: true,
      journey,
    };
    console.info("[api/journey/:id][GET] timings", {
      user_id: sessionUser.id,
      journey_id: journeyId,
      total_ms: Date.now() - requestStartedAt,
      auth_ms: (marks.auth_end ?? 0) - (marks.auth_start ?? 0),
      params_ms: (marks.params_end ?? 0) - (marks.params_start ?? 0),
      db_ms: (marks.db_end ?? 0) - (marks.db_start ?? 0),
      mapping_ms: Date.now() - (marks.db_end ?? Date.now()),
    });
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[api/journey/:id][GET] failed", {
      total_ms: Date.now() - requestStartedAt,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    });
    const payload: GetJourneyResponse = {
      success: false,
      message: "Unable to load journey right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
