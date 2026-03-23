import { NextResponse } from "next/server";
import { getOrGenerateCourseByTopic } from "@/lib/courseRetrieval/service";
import { getCourseRequestSchema, type GetCourseResponse } from "@/lib/courseRetrieval/types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    // 1) Parse and validate request input.
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      const payload: GetCourseResponse = {
        success: false,
        message: "Invalid request payload.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const parsed = getCourseRequestSchema.safeParse(body);
    if (!parsed.success) {
      const payload: GetCourseResponse = {
        success: false,
        message: parsed.error.issues[0]?.message ?? "Topic is required.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    // 2) DB-first retrieval, then AI-generation fallback.
    const result = await getOrGenerateCourseByTopic(parsed.data.topic);
    const payload: GetCourseResponse = {
      success: true,
      source: result.source,
      data: result.data,
    };
    return NextResponse.json(payload, {
      status: 200,
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    // 3) Graceful failure response for runtime/db/AI issues.
    console.error("[api/get-course][POST] failed", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    });
    const payload: GetCourseResponse = {
      success: false,
      message: "Unable to retrieve or generate course right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
