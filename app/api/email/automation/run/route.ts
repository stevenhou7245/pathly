import { NextResponse } from "next/server";
import { z } from "zod";
import { runAutomatedLearningEmails } from "@/lib/automationLearningEmails";

export const runtime = "nodejs";

const requestSchema = z.object({
  dry_run: z.boolean().optional(),
  user_id: z.string().uuid("user_id must be a valid UUID.").optional(),
  max_users: z.number().int().min(1).max(200).optional(),
});

function logDev(step: string, detail?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") {
    return;
  }
  if (detail) {
    console.info(`[automation_email_run] ${step}`, detail);
    return;
  }
  console.info(`[automation_email_run] ${step}`);
}

function isAutomationAuthorized(request: Request) {
  const key = process.env.EMAIL_AUTOMATION_KEY?.trim();
  if (key) {
    const incoming = request.headers.get("x-automation-key")?.trim() ?? "";
    return incoming === key;
  }
  return process.env.NODE_ENV !== "production";
}

export async function POST(request: Request) {
  if (!isAutomationAuthorized(request)) {
    return NextResponse.json(
      {
        success: false,
        message: "Unauthorized automation request.",
      },
      { status: 401 },
    );
  }

  try {
    const body = await request.json().catch(() => ({}));
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          message: parsed.error.issues[0]?.message ?? "Invalid request payload.",
        },
        { status: 400 },
      );
    }

    const dryRun = Boolean(parsed.data.dry_run);
    const userId = parsed.data.user_id;
    const maxUsers = parsed.data.max_users;

    logDev("run_start", {
      dry_run: dryRun,
      user_id: userId ?? null,
      max_users: maxUsers ?? null,
    });

    const summary = await runAutomatedLearningEmails({
      dryRun,
      userId,
      maxUsers,
    });

    logDev("run_complete", {
      dry_run: dryRun,
      processed_users: summary.processed_users,
      selected_candidates: summary.selected_candidates,
      sent_count: summary.sent_count,
      preview_count: summary.preview_count,
      skipped_count: summary.skipped_count,
      failed_count: summary.failed_count,
    });

    return NextResponse.json({
      success: true,
      dry_run: dryRun,
      summary,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[automation_email_run] run_failed", { reason });
    return NextResponse.json(
      {
        success: false,
        message: reason || "Unable to run automated learning emails.",
      },
      { status: 500 },
    );
  }
}

