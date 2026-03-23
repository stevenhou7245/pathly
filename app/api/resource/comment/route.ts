import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const commentSchema = z.object({
  resource_id: z.string().uuid("resource_id must be a valid UUID."),
  comment_text: z.string().trim().min(1, "Comment cannot be empty.").max(1000, "Comment is too long."),
});

type CommentResponse = {
  success: boolean;
  message?: string;
  comment?: {
    id: string;
    resource_id: string;
    comment_text: string;
    created_at: string;
    username: string | null;
  };
};

function toStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

export async function POST(request: Request) {
  let step = "authenticate_user";

  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: CommentResponse = {
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
      const payload: CommentResponse = {
        success: false,
        message: "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    step = "validate_payload";
    const parsed = commentSchema.safeParse(body);
    if (!parsed.success) {
      const payload: CommentResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    step = "validate_resource";
    console.info("[resource_feedback] comment_submit_started", {
      user_id: sessionUser.id,
      resource_option_id: parsed.data.resource_id,
      key_mode: "resource_option_id",
    });
    const { data: resourceRow, error: resourceError } = await supabaseAdmin
      .from("course_resource_options")
      .select("id")
      .eq("id", parsed.data.resource_id)
      .limit(1)
      .maybeSingle();

    if (resourceError) {
      throw new Error("Failed to validate resource.");
    }

    if (!resourceRow) {
      const payload: CommentResponse = {
        success: false,
        message: "Resource not found.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    console.info("[resource_read] source_table_used", {
      table: "course_resource_options",
      resource_id: parsed.data.resource_id,
    });
    console.info("[resource_feedback] key_mode", {
      key_mode: "resource_option_id",
      resource_option_id: parsed.data.resource_id,
    });

    step = "create_comment";
    const nowIso = new Date().toISOString();
    const { data: created, error: createError } = await supabaseAdmin
      .from("resource_comments")
      .insert({
        resource_option_id: parsed.data.resource_id,
        resource_id: parsed.data.resource_id,
        user_id: sessionUser.id,
        comment_text: parsed.data.comment_text,
        is_deleted: false,
        created_at: nowIso,
        updated_at: nowIso,
      })
      .select("*")
      .limit(1)
      .maybeSingle();

    if (createError || !created) {
      throw new Error("Failed to create comment.");
    }

    step = "compose_response";
    const payload: CommentResponse = {
      success: true,
      comment: {
        id: toStringValue((created as Record<string, unknown>).id),
        resource_id:
          toStringValue((created as Record<string, unknown>).resource_option_id) ||
          toStringValue((created as Record<string, unknown>).resource_id),
        comment_text: toStringValue((created as Record<string, unknown>).comment_text),
        created_at: toStringValue((created as Record<string, unknown>).created_at),
        username: sessionUser.username,
      },
    };
    console.info("[resource_feedback] comment_submit_succeeded", {
      user_id: sessionUser.id,
      resource_option_id: parsed.data.resource_id,
      key_mode: "resource_option_id",
      comment_id: payload.comment?.id ?? null,
    });
    return NextResponse.json(payload, { status: 201 });
  } catch (error) {
    console.error("Resource comment failed:", {
      step,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
      error,
    });
    const payload: CommentResponse = {
      success: false,
      message: "Unable to submit comment right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
