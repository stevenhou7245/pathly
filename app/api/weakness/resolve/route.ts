import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { resolveWeaknessConcept } from "@/lib/weaknessProfiles";

export const runtime = "nodejs";

const requestSchema = z.object({
  user_id: z.string().uuid(),
  course_id: z.string().uuid(),
  concept_tag: z.string().trim().min(1),
});

type ResolveWeaknessResponse = {
  success: boolean;
  message: string;
  updated_count?: number;
};

export async function POST(request: Request) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: ResolveWeaknessResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    const body = await request.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      const payload: ResolveWeaknessResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    if (parsed.data.user_id !== sessionUser.id) {
      const payload: ResolveWeaknessResponse = {
        success: false,
        message: "Forbidden: user_id mismatch.",
      };
      return NextResponse.json(payload, { status: 403 });
    }

    const resolved = await resolveWeaknessConcept({
      userId: sessionUser.id,
      courseId: parsed.data.course_id,
      conceptTag: parsed.data.concept_tag,
    });

    const payload: ResolveWeaknessResponse = {
      success: resolved.success,
      message: resolved.message,
      updated_count: resolved.updatedCount,
    };

    if (!resolved.success) {
      return NextResponse.json(payload, { status: 409 });
    }

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const payload: ResolveWeaknessResponse = {
      success: false,
      message: error instanceof Error ? error.message : "Unable to resolve weakness right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
