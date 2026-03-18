import { NextResponse } from "next/server";
import { getMapDataForField } from "@/lib/learningMap";

export const runtime = "nodejs";

type FieldMapResponse = {
  success: boolean;
  message?: string;
  map?: {
    field: Record<string, unknown>;
    routes: Array<Record<string, unknown>>;
    nodes: Array<Record<string, unknown>>;
    edges: Array<Record<string, unknown>>;
  };
};

export async function GET(
  _request: Request,
  context: { params: Promise<{ fieldId: string }> },
) {
  try {
    const { fieldId } = await context.params;
    if (!fieldId) {
      const payload: FieldMapResponse = {
        success: false,
        message: "Field id is required.",
      };
      return NextResponse.json(payload, { status: 400 });
    }

    const mapData = await getMapDataForField(fieldId);
    if (!mapData) {
      const payload: FieldMapResponse = {
        success: false,
        message: "Learning field not found.",
      };
      return NextResponse.json(payload, { status: 404 });
    }

    const payload: FieldMapResponse = {
      success: true,
      map: mapData,
    };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    const payload: FieldMapResponse = {
      success: false,
      message: "Unable to load map data right now.",
    };
    return NextResponse.json(payload, { status: 500 });
  }
}
