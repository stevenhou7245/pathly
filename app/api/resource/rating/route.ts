import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const ratingSchema = z.object({
  resource_id: z.string().uuid("resource_id must be a valid UUID."),
  rating: z.number().int().min(1).max(5),
});

type RatingResponse = {
  success: boolean;
  message?: string;
  average_rating?: number;
  rating_count?: number;
  my_rating?: number;
};

function toNumberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

export async function POST(request: Request) {
  let step = "authenticate_user";

  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: RatingResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    step = "read_payload";
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      const payload: RatingResponse = {
        success: false,
        message: "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    step = "validate_payload";
    const parsed = ratingSchema.safeParse(body);
    if (!parsed.success) {
      const payload: RatingResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    step = "validate_resource";
    const { data: resourceRow, error: resourceError } = await supabaseAdmin
      .from("course_resources")
      .select("id")
      .eq("id", parsed.data.resource_id)
      .limit(1)
      .maybeSingle();

    if (resourceError) {
      throw new Error("Failed to validate resource.");
    }

    if (!resourceRow) {
      const payload: RatingResponse = {
        success: false,
        message: "Resource not found.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    step = "upsert_rating";
    const nowIso = new Date().toISOString();
    const { error: upsertError } = await supabaseAdmin
      .from("resource_ratings")
      .upsert(
        {
          resource_id: parsed.data.resource_id,
          user_id: sessionUser.id,
          rating: parsed.data.rating,
          updated_at: nowIso,
          created_at: nowIso,
        },
        {
          onConflict: "resource_id,user_id",
        },
      );

    if (upsertError) {
      throw new Error("Failed to submit rating.");
    }

    step = "recalculate_rating";
    const { data: ratings, error: ratingsError } = await supabaseAdmin
      .from("resource_ratings")
      .select("rating")
      .eq("resource_id", parsed.data.resource_id);

    if (ratingsError) {
      throw new Error("Failed to recalculate rating.");
    }

    step = "compose_response";
    const ratingValues = (ratings ?? []).map((row) => toNumberValue((row as Record<string, unknown>).rating));
    const ratingCount = ratingValues.length;
    const averageRating =
      ratingCount === 0
        ? 0
        : Number((ratingValues.reduce((sum, value) => sum + value, 0) / ratingCount).toFixed(1));

    const payload: RatingResponse = {
      success: true,
      average_rating: averageRating,
      rating_count: ratingCount,
      my_rating: parsed.data.rating,
    };
    return NextResponse.json(payload);
  } catch (error) {
    console.error("Resource rating failed:", {
      step,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
      error,
    });
    const payload: RatingResponse = {
      success: false,
      message: "Unable to submit rating right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
