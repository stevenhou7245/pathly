import { NextResponse } from "next/server";
import { getInboxUnreadSummary } from "@/lib/inbox";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";

export const runtime = "nodejs";

export async function GET() {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json(
        {
          message: "Unauthorized.",
        },
        { status: 401 },
      );
    }

    const summary = await getInboxUnreadSummary(sessionUser.id);
    return NextResponse.json(summary, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return NextResponse.json(
      {
        message: "Unable to load inbox summary right now.",
      },
      { status: 500 },
    );
  }
}
