import { NextResponse } from "next/server";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import {
  getRouteById,
  getRouteRatingSummary,
  submitOrUpdateRouteRating,
} from "@/lib/learningMap";
import { submitRouteRatingSchema } from "@/lib/routeRatingsValidation";

export const runtime = "nodejs";

type SubmitRouteRatingResponse = {
  success: boolean;
  message?: string;
  rating?: {
    id: string;
    route_id: string;
    user_id: string;
    rating: number;
    review: string | null;
    created_at: string | null;
  };
  average_rating?: number;
  rating_count?: number;
};

export async function POST(request: Request) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: SubmitRouteRatingResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      const payload: SubmitRouteRatingResponse = {
        success: false,
        message: "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const parsed = submitRouteRatingSchema.safeParse(body);
    if (!parsed.success) {
      const payload: SubmitRouteRatingResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const { route_id, rating, review } = parsed.data;
    const route = await getRouteById(route_id);
    if (!route) {
      const payload: SubmitRouteRatingResponse = {
        success: false,
        message: "Route not found.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const submitResult = await submitOrUpdateRouteRating({
      routeId: route_id,
      userId: sessionUser.id,
      rating,
      review,
    });

    const summary = await getRouteRatingSummary(route_id);

    const payload: SubmitRouteRatingResponse = {
      success: true,
      message: submitResult.created ? "Route rating submitted." : "Route rating updated.",
      rating: submitResult.rating,
      average_rating: summary.average_rating,
      rating_count: summary.rating_count,
    };
    return NextResponse.json(payload, { status: submitResult.created ? 201 : 200 });
  } catch {
    const payload: SubmitRouteRatingResponse = {
      success: false,
      message: "Unable to submit route rating right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
