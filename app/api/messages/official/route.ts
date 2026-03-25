import { NextResponse } from "next/server";
import { getOfficialMessagesForUser } from "@/lib/officialMessages";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";

export const runtime = "nodejs";

type OfficialMessagesResponse = {
  success: boolean;
  message?: string;
  current_user_id?: string;
  messages?: Array<{
    id: string;
    title: string;
    body: string;
    created_at: string | null;
    read: boolean;
  }>;
};

export async function GET() {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<OfficialMessagesResponse>(
        {
          success: false,
          message: "Unauthorized.",
        },
        { status: 401 },
      );
    }

    const messages = await getOfficialMessagesForUser(sessionUser.id);
    return NextResponse.json<OfficialMessagesResponse>(
      {
        success: true,
        current_user_id: sessionUser.id,
        messages,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[official_messages] fetch_route_failed", {
      route: "/api/messages/official",
      reason,
    });
    return NextResponse.json<OfficialMessagesResponse>(
      {
        success: false,
        message: reason,
        messages: [],
      },
      { status: 500 },
    );
  }
}

