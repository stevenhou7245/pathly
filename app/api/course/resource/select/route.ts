import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const selectCourseResourceSchema = z.object({
  course_id: z.string().uuid("course_id must be a valid UUID."),
  resource_option_id: z.string().uuid("resource_option_id must be a valid UUID."),
});

type CourseResourceSelectResponse = {
  success: boolean;
  message?: string;
  selection?: {
    user_id: string;
    course_id: string;
    resource_option_id: string;
    selected_at: string;
  };
};

export async function POST(request: Request) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: CourseResourceSelectResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(payload, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      const payload: CourseResourceSelectResponse = {
        success: false,
        message: "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const parsed = selectCourseResourceSchema.safeParse(body);
    if (!parsed.success) {
      const payload: CourseResourceSelectResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const { course_id, resource_option_id } = parsed.data;
    console.info("[resource_selection] request_received", {
      user_id: sessionUser.id,
      course_id,
      resource_option_id,
    });

    const { data: resourceOptionRow, error: resourceOptionError } = await supabaseAdmin
      .from("course_resource_options")
      .select("id, course_id")
      .eq("id", resource_option_id)
      .eq("course_id", course_id)
      .limit(1)
      .maybeSingle();

    if (resourceOptionError || !resourceOptionRow) {
      console.error("[resource_selection] selected_resource_lookup_failed", {
        user_id: sessionUser.id,
        course_id,
        resource_option_id,
        reason: resourceOptionError?.message ?? "resource_not_found",
        code: (resourceOptionError as unknown as Record<string, unknown> | null)?.code ?? null,
        details:
          (resourceOptionError as unknown as Record<string, unknown> | null)?.details ?? null,
        hint: (resourceOptionError as unknown as Record<string, unknown> | null)?.hint ?? null,
      });
      const payload: CourseResourceSelectResponse = {
        success: false,
        message: "Selected resource not found.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const selectedAt = new Date().toISOString();
    const upsertPayload = {
      user_id: sessionUser.id,
      course_id,
      resource_option_id,
      selected_at: selectedAt,
    };

    const { data: selectionRow, error: upsertError } = await supabaseAdmin
      .from("user_course_resource_selections")
      .upsert(upsertPayload, { onConflict: "user_id,course_id" })
      .select("user_id, course_id, resource_option_id, selected_at")
      .limit(1)
      .maybeSingle();

    if (upsertError || !selectionRow) {
      console.error("[resource_selection] upsert_failed", {
        user_id: sessionUser.id,
        course_id,
        resource_option_id,
        reason: upsertError?.message ?? "unknown_upsert_error",
        code: (upsertError as unknown as Record<string, unknown> | null)?.code ?? null,
        details: (upsertError as unknown as Record<string, unknown> | null)?.details ?? null,
        hint: (upsertError as unknown as Record<string, unknown> | null)?.hint ?? null,
      });
      const payload: CourseResourceSelectResponse = {
        success: false,
        message: "Unable to save selected resource right now.",
      };
      return NextResponse.json(payload, { status: 500 });
    }

    console.info("[resource_selection] upsert_succeeded", {
      user_id: sessionUser.id,
      course_id,
      resource_option_id,
      selected_at: selectedAt,
    });

    const payload: CourseResourceSelectResponse = {
      success: true,
      message: "Resource selection saved.",
      selection: {
        user_id: String((selectionRow as Record<string, unknown>).user_id ?? sessionUser.id),
        course_id: String((selectionRow as Record<string, unknown>).course_id ?? course_id),
        resource_option_id: String(
          (selectionRow as Record<string, unknown>).resource_option_id ?? resource_option_id,
        ),
        selected_at: String((selectionRow as Record<string, unknown>).selected_at ?? selectedAt),
      },
    };
    return NextResponse.json(payload);
  } catch (error) {
    console.error("[resource_selection] request_failed", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
      error,
    });
    const payload: CourseResourceSelectResponse = {
      success: false,
      message: "Unable to save selected resource right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}

