import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createWeaknessConceptDrill, type WeaknessConceptDrillPayload } from "@/lib/ai/weaknessDrill";

export const runtime = "nodejs";

const requestSchema = z.object({
  concept_tag: z.string().trim().min(1, "concept_tag is required."),
  action: z.enum(["open", "improve"]).optional().default("open"),
});

type WeaknessConceptDrillResponse = {
  success: boolean;
  message?: string;
  drill?: WeaknessConceptDrillPayload;
  details?: Record<string, unknown>;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ courseId: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: WeaknessConceptDrillResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    const { courseId } = await context.params;
    if (!courseId?.trim()) {
      const payload: WeaknessConceptDrillResponse = {
        success: false,
        message: "courseId is required.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const body = await request.json();
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      const payload: WeaknessConceptDrillResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }
    console.info("[weakness] drill_route:action_received", {
      course_id: courseId.trim(),
      action: parsed.data.action,
      note: "action is routing-only and never written to weakness_test_sessions.status",
    });

    const { data: courseRow, error: courseError } = await supabaseAdmin
      .from("courses")
      .select("id, title, description")
      .eq("id", courseId.trim())
      .limit(1)
      .maybeSingle();

    if (courseError || !courseRow) {
      const payload: WeaknessConceptDrillResponse = {
        success: false,
        message: "Course not found.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const drill = await createWeaknessConceptDrill({
      userId: sessionUser.id,
      courseId: courseId.trim(),
      conceptTag: parsed.data.concept_tag,
      courseTitle: String((courseRow as Record<string, unknown>).title ?? "Course"),
      courseDescription:
        ((courseRow as Record<string, unknown>).description as string | null | undefined) ?? null,
      generateTest: parsed.data.action === "improve",
    });

    const payload: WeaknessConceptDrillResponse = {
      success: true,
      drill,
    };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const errorRecord = (error ?? {}) as Record<string, unknown>;
    const message =
      (error instanceof Error ? error.message : undefined) ||
      (typeof errorRecord.message === "string" ? errorRecord.message : undefined) ||
      "Unable to prepare weakness concept drill.";
    const payload: WeaknessConceptDrillResponse = {
      success: false,
      message,
      details:
        process.env.NODE_ENV === "development"
          ? {
              code: typeof errorRecord.code === "string" ? errorRecord.code : null,
              hint: typeof errorRecord.hint === "string" ? errorRecord.hint : null,
              raw_error:
                typeof error === "object" && error !== null ? errorRecord : String(error),
            }
          : undefined,
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
