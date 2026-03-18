import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedSessionUser } from "@/lib/sessionAuth";
import { createStudyInvitation } from "@/lib/study";

export const runtime = "nodejs";

const inviteSchema = z.object({
  receiver_user_id: z.string().trim().min(1, "Receiver user id is required."),
  learning_field_id: z.string().trim().min(1).optional(),
});

type InviteStudyResponse = {
  success: boolean;
  message?: string;
  invitation_id?: string;
};

export async function POST(request: Request) {
  try {
    const sessionUser = await getAuthenticatedSessionUser();
    if (!sessionUser) {
      return NextResponse.json<InviteStudyResponse>(
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
      return NextResponse.json<InviteStudyResponse>(
        {
          success: false,
          message: "Invalid request payload.",
        },
        { status: 400 },
      );
    }

    const parsed = inviteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json<InviteStudyResponse>(
        {
          success: false,
          message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
        },
        { status: 400 },
      );
    }

    const receiverUserId = parsed.data.receiver_user_id;
    if (receiverUserId === sessionUser.id) {
      return NextResponse.json<InviteStudyResponse>(
        {
          success: false,
          message: "You cannot invite yourself.",
        },
        { status: 400 },
      );
    }

    const result = await createStudyInvitation({
      senderId: sessionUser.id,
      receiverId: receiverUserId,
      learningFieldId: parsed.data.learning_field_id ?? null,
    });

    if (!result.ok) {
      if (result.code === "NOT_FRIENDS") {
        return NextResponse.json<InviteStudyResponse>(
          {
            success: false,
            message: "Study invitations are only available for accepted friends.",
          },
          { status: 403 },
        );
      }

      return NextResponse.json<InviteStudyResponse>(
        {
          success: false,
          message: "Your friend is offline right now.",
        },
        { status: 400 },
      );
    }

    return NextResponse.json<InviteStudyResponse>({
      success: true,
      message: result.already_pending
        ? "A pending invitation already exists."
        : "Study invitation sent.",
      invitation_id: result.invitation_id,
    });
  } catch {
    return NextResponse.json<InviteStudyResponse>(
      {
        success: false,
        message: "Unable to send study invitation right now.",
      },
      { status: 500 },
    );
  }
}

