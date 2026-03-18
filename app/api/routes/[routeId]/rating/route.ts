import { NextResponse } from "next/server";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import {
  getCurrentUserRouteRating,
  getRouteById,
  getRouteRatingSummary,
} from "@/lib/learningMap";

export const runtime = "nodejs";

type RouteRatingSummaryResponse = {
  success: boolean;
  message?: string;
  route_id?: string;
  average_rating?: number;
  rating_count?: number;
  current_user_rating?: {
    id: string;
    route_id: string;
    user_id: string;
    rating: number;
    review: string | null;
    created_at: string | null;
  } | null;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ routeId: string }> },
) {
  try {
    const { routeId } = await context.params;
    if (!routeId) {
      const payload: RouteRatingSummaryResponse = {
        success: false,
        message: "Route id is required.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const route = await getRouteById(routeId);
    if (!route) {
      const payload: RouteRatingSummaryResponse = {
        success: false,
        message: "Route not found.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const sessionUser = await getAuthenticatedSessionUser();
    const [summary, currentUserRating] = await Promise.all([
      getRouteRatingSummary(routeId),
      sessionUser
        ? getCurrentUserRouteRating({
            routeId,
            userId: sessionUser.id,
          })
        : Promise.resolve(null),
    ]);

    const payload: RouteRatingSummaryResponse = {
      success: true,
      route_id: routeId,
      average_rating: summary.average_rating,
      rating_count: summary.rating_count,
      current_user_rating: currentUserRating,
    };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    const payload: RouteRatingSummaryResponse = {
      success: false,
      message: "Unable to load route rating right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
