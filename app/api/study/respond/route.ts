import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { respondToStudyInvitation } from "@/lib/study";

export const runtime = "nodejs";

const respondSchema = z.object({
  invitation_id: z.string().trim().min(1, "Invitation id is required."),
  action: z.enum(["accepted", "declined"], {
    message: "Action must be accepted or declined.",
  }),
});

type RespondStudyInviteResponse = {
  success: boolean;
  message?: string;
  invitation_id?: string;
  session?: {
    id: string;
    invitation_id: string | null;
    user_a_id: string;
    user_b_id: string;
    learning_field_id: string | null;
    status: string;
    created_at: string | null;
    ended_at?: string | null;
  } | null;
};

export async function POST(request: Request) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<RespondStudyInviteResponse>(
        {
          success: false,
          message: "Unauthorized.",
        },
        { status: 401 },
      );
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json<RespondStudyInviteResponse>(
        {
          success: false,
          message: "Invalid request payload.",
        },
        { status: 400 },
      );
    }

    const parsed = respondSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<RespondStudyInviteResponse>(
        {
          success: false,
          message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
        },
        { status: 400 },
      );
    }

    const result = await respondToStudyInvitation({
      userId: sessionUser.id,
      invitationId: parsed.data.invitation_id,
      action: parsed.data.action,
    });

    if (!result.ok) {
      if (result.code === "NOT_FOUND") {
        return NextResponse.json<RespondStudyInviteResponse>(
          {
            success: false,
            message: "Study invitation not found.",
          },
          { status: 404 },
        );
      }

      if (result.code === "FORBIDDEN") {
        return NextResponse.json<RespondStudyInviteResponse>(
          {
            success: false,
            message: "You are not allowed to respond to this invitation.",
          },
          { status: 403 },
        );
      }

      return NextResponse.json<RespondStudyInviteResponse>(
        {
          success: false,
          message: "This invitation has already been responded to.",
        },
        { status: 400 },
      );
    }

    return NextResponse.json<RespondStudyInviteResponse>({
      success: true,
      message:
        parsed.data.action === "accepted"
          ? "Study invitation accepted."
          : "Study invitation declined.",
      invitation_id: result.invitation_id,
      session: result.session,
    });
  } catch {
    return NextResponse.json<RespondStudyInviteResponse>(
      {
        success: false,
        message: "Unable to respond to study invitation right now.",
      },
      { status: 500 },
    );
  }
}
