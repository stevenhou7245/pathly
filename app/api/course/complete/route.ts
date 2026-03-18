import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";

export const runtime = "nodejs";

const completeCourseSchema = z.object({
  course_id: z.string().uuid("course_id must be a valid UUID."),
  journey_path_id: z.string().uuid("journey_path_id must be a valid UUID."),
});

type CompleteCourseResponse = {
  success: boolean;
  message?: string;
  journey?: {
    journey_path_id: string;
    total_steps: number;
    current_step: number;
    learning_field_id: string;
    nodes: Array<{
      step_number: number;
      course_id: string;
      title: string;
      status: "locked" | "unlocked" | "in_progress" | "ready_for_test" | "passed";
      passed_score: number | null;
    }>;
  };
};

export async function POST(request: Request) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: CompleteCourseResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      const payload: CompleteCourseResponse = {
        success: false,
        message: "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const parsed = completeCourseSchema.safeParse(body);
    if (!parsed.success) {
      const payload: CompleteCourseResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const payload: CompleteCourseResponse = {
      success: false,
      message: "Use AI test to pass this course.",
    };
    return NextResponse.json(payload, { status: 400 });
  } catch (error) {
    console.error("Course completion failed:", error);
    const payload: CompleteCourseResponse = {
      success: false,
      message: "Unable to complete course right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
