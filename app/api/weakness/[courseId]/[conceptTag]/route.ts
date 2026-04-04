import { NextResponse } from "next/server";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { getOrCreateWeaknessConceptDetails } from "@/lib/weaknessDrill";

export const runtime = "nodejs";

type WeaknessConceptDetailsResponse = {
  success: boolean;
  message?: string;
  concept?: {
    course_id: string;
    course_title: string;
    course_description: string | null;
    concept_tag: string;
    concept_title: string;
    concept_explanation: string;
    search_query: string;
    session_id: string | null;
    cached: boolean;
    resources: Array<{
      id: string;
      title: string;
      url: string;
      snippet: string;
      source: string;
      score: number;
    }>;
  };
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ courseId: string; conceptTag: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: WeaknessConceptDetailsResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    const { courseId, conceptTag } = await context.params;
    if (!courseId || !conceptTag) {
      const payload: WeaknessConceptDetailsResponse = {
        success: false,
        message: "courseId and conceptTag are required.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const normalizedConceptTag = (() => {
      try {
        return decodeURIComponent(conceptTag).trim();
      } catch {
        return conceptTag.trim();
      }
    })();

    const concept = await getOrCreateWeaknessConceptDetails({
      userId: sessionUser.id,
      courseId: courseId.trim(),
      conceptTag: normalizedConceptTag,
    });

    const payload: WeaknessConceptDetailsResponse = {
      success: true,
      concept,
    };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const payload: WeaknessConceptDetailsResponse = {
      success: false,
      message: error instanceof Error ? error.message : "Unable to load weakness concept details.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
