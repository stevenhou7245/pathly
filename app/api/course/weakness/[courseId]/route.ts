import { NextResponse } from "next/server";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { getTopWeaknessConceptTagsForCourse } from "@/lib/weaknessProfiles";

export const runtime = "nodejs";

type GetCourseWeaknessResponse = {
  success: boolean;
  message?: string;
  weakness_concepts?: Array<string | null>;
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ courseId: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: GetCourseWeaknessResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    const { courseId } = await context.params;
    if (!courseId?.trim()) {
      const payload: GetCourseWeaknessResponse = {
        success: false,
        message: "courseId is required.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const weaknessConcepts = await getTopWeaknessConceptTagsForCourse({
      userId: sessionUser.id,
      courseId: courseId.trim(),
      limit: 3,
    });

    const payload: GetCourseWeaknessResponse = {
      success: true,
      weakness_concepts: weaknessConcepts.length > 0 ? weaknessConcepts : [null],
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const payload: GetCourseWeaknessResponse = {
      success: false,
      message: error instanceof Error ? error.message : "Unable to load weakness concepts.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}

