import { NextResponse } from "next/server";
import { getRouteDetail } from "@/lib/learningMap";

export const runtime = "nodejs";

type RouteDetailResponse = {
  success: boolean;
  message?: string;
  route_detail?: {
    route: Record<string, unknown>;
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
    average_rating: number;
    rating_count: number;
  };
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ routeId: string }> },
) {
  try {
    const { routeId } = await context.params;
    if (!routeId) {
      const payload: RouteDetailResponse = {
        success: false,
        message: "Route id is required.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const routeDetail = await getRouteDetail(routeId);
    if (!routeDetail) {
      const payload: RouteDetailResponse = {
        success: false,
        message: "Route not found.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const payload: RouteDetailResponse = {
      success: true,
      route_detail: routeDetail,
    };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    const payload: RouteDetailResponse = {
      success: false,
      message: "Unable to load route detail right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
