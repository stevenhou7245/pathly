import { NextResponse } from "next/server";
import { getInboxUnreadSummary } from "@/lib/inbox";
import { getUserRoleContextForOfficialMessages } from "@/lib/officialMessages";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";

export const runtime = "nodejs";

type MessagesSummaryResponse = {
  success: boolean;
  message?: string;
  current_user_id?: string;
  current_user_role?: string | null;
  accepted_friendship_ids?: string[];
  unread_friend_messages?: number;
  pending_friend_requests?: number;
  unread_system_messages?: number;
  pending_study_invitations?: number;
  total_unread?: number;
};

export async function GET() {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      const payload: MessagesSummaryResponse = {
        success: false,
        message: "Unauthorized.",
      };
      return NextResponse.json(
        payload,
        { status: 401 },
      );
    }

    const [summary, roleContext] = await Promise.all([
      getInboxUnreadSummary(sessionUser.id),
      getUserRoleContextForOfficialMessages(sessionUser.id),
    ]);
    const payload: MessagesSummaryResponse = {
      success: true,
      current_user_id: sessionUser.id,
      current_user_role: roleContext.role,
      ...summary,
    };
    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });
  } catch {
    const payload: MessagesSummaryResponse = {
      success: false,
      message: "Unable to load inbox summary right now.",
    };
    return NextResponse.json(
      payload,
      { status: 500 },
    );
  }
}
