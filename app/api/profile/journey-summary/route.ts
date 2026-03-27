import { NextResponse } from "next/server";
import { getRecentCompletedCoursesFromRealProgress } from "@/lib/learningProgressAggregation";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";

export const runtime = "nodejs";

type JourneySummaryApiItem = {
  title: string;
  stepNumber: number;
  completedAt: string;
  learningFieldName: string;
};

type JourneySummaryResponse = {
  success: boolean;
  message?: string;
  data?: {
    headline: string;
    items: JourneySummaryApiItem[];
    recentCompletedCourses: JourneySummaryApiItem[];
  };
};

export async function GET() {
  const requestStartedAt = Date.now();
  const marks: Record<string, number> = {};
  let currentUserId = "";
  try {
    marks.auth_start = Date.now();
    const sessionUser = await getAuthenticatedSessionUser();
    marks.auth_end = Date.now();
    if (!sessionUser) {
      const payload: JourneySummaryResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }
    currentUserId = sessionUser.id;
    console.info("[api/profile/journey-summary][GET] start", {
      user_id: sessionUser.id,
    });

    marks.db_start = Date.now();
    const items = await getRecentCompletedCoursesFromRealProgress({
      userId: sessionUser.id,
      days: 7,
      limit: 3,
    });
    marks.db_end = Date.now();
    console.info("[api/profile/journey-summary][GET] query_result", {
      user_id: sessionUser.id,
      items_count: items.length,
    });

    const payload: JourneySummaryResponse = {
      success: true,
      data: {
        headline: "You are building steady momentum this week.",
        items,
        recentCompletedCourses: items,
      },
    };
    console.info("[api/profile/journey-summary][GET] timings", {
      user_id: sessionUser.id,
      total_ms: Date.now() - requestStartedAt,
      auth_ms: (marks.auth_end ?? 0) - (marks.auth_start ?? 0),
      db_ms: (marks.db_end ?? 0) - (marks.db_start ?? 0),
      mapping_ms: Date.now() - (marks.db_end ?? Date.now()),
      items_count: items.length,
    });
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Journey summary load failed:", {
      user_id: currentUserId || null,
      total_ms: Date.now() - requestStartedAt,
      error,
      message,
      stack: error instanceof Error ? error.stack : null,
    });
    const payload: JourneySummaryResponse = {
      success: false,
      message,
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
