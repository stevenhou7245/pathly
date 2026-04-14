import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { skipWeaknessConceptTest } from "@/lib/weaknessDrill";

export const runtime = "nodejs";

const skipSchema = z.object({
  course_id: z.string().uuid("course_id must be a valid UUID."),
  concept_tag: z.string().trim().min(1, "concept_tag is required."),
  test_session_id: z.string().uuid("test_session_id must be a valid UUID."),
});

type SkipWeaknessTestResponse = {
  success: boolean;
  message?: string;
  result?: {
    test_session_id: string;
    status: "skipped";
  };
};

export async function POST(request: Request) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: SkipWeaknessTestResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    const rawBody = await request.json().catch(() => null);
    const parsed = skipSchema.safeParse(rawBody);
    if (!parsed.success) {
      const payload: SkipWeaknessTestResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const result = await skipWeaknessConceptTest({
      userId: sessionUser.id,
      courseId: parsed.data.course_id,
      conceptTag: parsed.data.concept_tag,
      testSessionId: parsed.data.test_session_id,
    });

    const payload: SkipWeaknessTestResponse = {
      success: true,
      result,
    };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const payload: SkipWeaknessTestResponse = {
      success: false,
      message: error instanceof Error ? error.message : "Unable to skip concept drill test.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}

