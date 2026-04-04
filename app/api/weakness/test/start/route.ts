import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { getOrCreateWeaknessConceptTestSession } from "@/lib/weaknessDrill";

export const runtime = "nodejs";

const startSchema = z.object({
  course_id: z.string().uuid("course_id must be a valid UUID."),
  concept_tag: z.string().trim().min(1, "concept_tag is required."),
});

type StartWeaknessTestResponse = {
  success: boolean;
  message?: string;
  test?: {
    test_session_id: string;
    course_id: string;
    concept_tag: string;
    concept_title: string;
    total_score: number;
    cached: boolean;
    questions: Array<{
      id: string;
      question_order: number;
      question_type: "multiple_choice" | "fill_blank" | "short_answer";
      question_text: string;
      options: string[];
      score: number;
    }>;
  };
};

export async function POST(request: Request) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: StartWeaknessTestResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    const rawBody = await request.json().catch(() => null);
    const parsed = startSchema.safeParse(rawBody);
    if (!parsed.success) {
      const payload: StartWeaknessTestResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const test = await getOrCreateWeaknessConceptTestSession({
      userId: sessionUser.id,
      courseId: parsed.data.course_id,
      conceptTag: parsed.data.concept_tag,
    });

    const payload: StartWeaknessTestResponse = {
      success: true,
      test,
    };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const payload: StartWeaknessTestResponse = {
      success: false,
      message: error instanceof Error ? error.message : "Unable to prepare concept drill test.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
