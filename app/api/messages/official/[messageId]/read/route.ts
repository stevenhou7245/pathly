import { NextResponse } from "next/server";
import { markOfficialMessageRead } from "@/lib/officialMessages";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";

export const runtime = "nodejs";

type MarkOfficialMessageReadResponse = {
  success: boolean;
  message?: string;
  message_id?: string;
};

export async function PATCH(
  _request: Request,
  context: { params: Promise<{ messageId: string }> },
) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<MarkOfficialMessageReadResponse>(
        {
          success: false,
          message: "Unauthorized.",
        },
        { status: 401 },
      );
    }

    const { messageId } = await context.params;
    if (!messageId?.trim()) {
      return NextResponse.json<MarkOfficialMessageReadResponse>(
        {
          success: false,
          message: "messageId is required.",
        },
        { status: 400 },
      );
    }

    const result = await markOfficialMessageRead({
      userId: sessionUser.id,
      messageId: messageId.trim(),
    });

    if (!result.ok) {
      if (result.code === "NOT_FOUND") {
        return NextResponse.json<MarkOfficialMessageReadResponse>(
          {
            success: false,
            message: "Official message not found.",
          },
          { status: 404 },
        );
      }
      return NextResponse.json<MarkOfficialMessageReadResponse>(
        {
          success: false,
          message: "You are not allowed to read this official message.",
        },
        { status: 403 },
      );
    }

    return NextResponse.json<MarkOfficialMessageReadResponse>({
      success: true,
      message: result.already_read
        ? "Official message already marked as read."
        : "Official message marked as read.",
      message_id: result.message_id,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[official_messages] mark_read_route_failed", {
      route: "/api/messages/official/[messageId]/read",
      reason,
    });
    return NextResponse.json<MarkOfficialMessageReadResponse>(
      {
        success: false,
        message: reason,
      },
      { status: 500 },
    );
  }
}

