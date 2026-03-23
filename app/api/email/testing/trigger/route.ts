import { NextResponse } from "next/server";
import { z } from "zod";
import {
  composeAutomatedLearningEmail,
  type AutomatedEmailContext,
  type AutomatedEmailType,
} from "@/lib/ai/automatedEmailComposer";
import { sendAutomatedLearningEmail, sendWelcomeEmail } from "@/lib/email";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type GenericRecord = Record<string, unknown>;

const requestSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("welcome"),
    to_email: z.string().email("to_email must be a valid email."),
    username: z.string().trim().min(1).max(50).optional(),
  }),
  z.object({
    type: z.literal("ai_reminder"),
    user_id: z.string().uuid("user_id must be a valid UUID."),
    to_email: z.string().email("to_email must be a valid email.").optional(),
    email_type: z
      .enum(["learning_reminder", "comeback_inactivity", "milestone", "review_reminder"])
      .optional(),
    dry_run: z.boolean().optional(),
    inactivity_days_override: z.number().int().min(0).max(90).optional(),
  }),
]);

function toStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toDateMs(value: unknown) {
  if (typeof value !== "string") {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function logDev(step: string, detail?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") {
    return;
  }
  if (detail) {
    console.info(`[email_testing_trigger] ${step}`, detail);
    return;
  }
  console.info(`[email_testing_trigger] ${step}`);
}

function canUseTestingRoute() {
  return process.env.NODE_ENV !== "production";
}

function scenarioLabel(emailType: AutomatedEmailType) {
  if (emailType === "comeback_inactivity") {
    return "Comeback Time";
  }
  if (emailType === "milestone") {
    return "Milestone Reached";
  }
  if (emailType === "review_reminder") {
    return "Review Reminder";
  }
  return "Learning Reminder";
}

function resolveAppUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  return "http://localhost:3000";
}

async function loadLatestUserLearningField(userId: string) {
  const withCreatedAt = await supabaseAdmin
    .from("user_learning_fields")
    .select("field_id, current_level, target_level, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!withCreatedAt.error) {
    return withCreatedAt.data as GenericRecord | null;
  }
  if (!/created_at/i.test(withCreatedAt.error.message)) {
    throw new Error("Unable to load user learning field.");
  }

  const withStartedAt = await supabaseAdmin
    .from("user_learning_fields")
    .select("field_id, current_level, target_level, started_at")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (withStartedAt.error) {
    throw new Error("Unable to load user learning field.");
  }
  return withStartedAt.data as GenericRecord | null;
}

async function buildAutomatedEmailContext(params: {
  userId: string;
  emailType: AutomatedEmailType;
  inactivityDaysOverride?: number;
}): Promise<{
  context: AutomatedEmailContext;
  userEmail: string;
}> {
  const userResult = await supabaseAdmin
    .from("users")
    .select("id, username, email")
    .eq("id", params.userId)
    .limit(1)
    .maybeSingle();
  if (userResult.error) {
    throw new Error("Unable to load user profile.");
  }
  if (!userResult.data) {
    throw new Error("User not found.");
  }
  const userRow = userResult.data as GenericRecord;
  const userEmail = toStringValue(userRow.email);
  if (!userEmail) {
    throw new Error("User email is missing.");
  }

  const userField = await loadLatestUserLearningField(params.userId);
  const learningFieldId = toStringValue(userField?.field_id) || null;
  let learningFieldTitle = "your learning path";
  if (learningFieldId) {
    const fieldResult = await supabaseAdmin
      .from("learning_fields")
      .select("title")
      .eq("id", learningFieldId)
      .limit(1)
      .maybeSingle();
    if (!fieldResult.error && fieldResult.data) {
      learningFieldTitle = toStringValue((fieldResult.data as GenericRecord).title) || learningFieldTitle;
    }
  }

  const journeyResult = learningFieldId
    ? await supabaseAdmin
        .from("journey_paths")
        .select("id")
        .eq("user_id", params.userId)
        .eq("learning_field_id", learningFieldId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null, error: null as null };
  if (journeyResult.error) {
    throw new Error("Unable to load journey path.");
  }
  const journeyPathId = toStringValue((journeyResult.data as GenericRecord | null)?.id) || null;

  let progressRows: GenericRecord[] = [];
  let nextSuggestedStep = "Continue your next lesson in Pathly";
  if (journeyPathId) {
    const [progressResult, orderResult] = await Promise.all([
      supabaseAdmin
        .from("user_course_progress")
        .select("course_id, status, started_at, completed_at, passed_at, last_activity_at")
        .eq("user_id", params.userId)
        .eq("journey_path_id", journeyPathId),
      supabaseAdmin
        .from("journey_path_courses")
        .select("course_id, step_number")
        .eq("journey_path_id", journeyPathId)
        .order("step_number", { ascending: true }),
    ]);
    if (progressResult.error || orderResult.error) {
      throw new Error("Unable to load journey progress.");
    }
    progressRows = (progressResult.data ?? []) as GenericRecord[];
    const courseOrderRows = (orderResult.data ?? []) as GenericRecord[];
    const courseIds = Array.from(
      new Set(courseOrderRows.map((row) => toStringValue(row.course_id)).filter(Boolean)),
    );
    let courseTitleById = new Map<string, string>();
    if (courseIds.length > 0) {
      const coursesResult = await supabaseAdmin.from("courses").select("id, title").in("id", courseIds);
      if (!coursesResult.error) {
        courseTitleById = new Map(
          ((coursesResult.data ?? []) as GenericRecord[]).map((row) => [
            toStringValue(row.id),
            toStringValue(row.title),
          ]),
        );
      }
    }
    const progressByCourse = new Map(
      progressRows.map((row) => [toStringValue(row.course_id), toStringValue(row.status).toLowerCase()] as const),
    );
    const nextCourse = courseOrderRows.find((row) => {
      const courseId = toStringValue(row.course_id);
      return progressByCourse.get(courseId) !== "passed";
    });
    if (nextCourse) {
      nextSuggestedStep =
        courseTitleById.get(toStringValue(nextCourse.course_id)) || "Continue your next unlocked lesson";
    }
  }

  const totalSteps = Math.max(0, progressRows.length);
  const completedSteps = progressRows.filter(
    (row) => toStringValue(row.status).toLowerCase() === "passed",
  ).length;
  const progressPercent =
    totalSteps <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((completedSteps / totalSteps) * 100)));

  const lastActivityMs = progressRows.length
    ? Math.max(
        ...progressRows.map((row) =>
          Math.max(
            toDateMs(row.last_activity_at),
            toDateMs(row.completed_at),
            toDateMs(row.passed_at),
            toDateMs(row.started_at),
          ),
        ),
      )
    : 0;
  const inactivityDays =
    typeof params.inactivityDaysOverride === "number"
      ? params.inactivityDaysOverride
      : lastActivityMs > 0
        ? Math.max(0, Math.floor((Date.now() - lastActivityMs) / (24 * 60 * 60 * 1000)))
        : 2;

  const preferenceResult = await supabaseAdmin
    .from("user_resource_preferences")
    .select("resource_type")
    .eq("user_id", params.userId)
    .order("weighted_score", { ascending: false })
    .limit(1)
    .maybeSingle();
  const preferredResourceType =
    !preferenceResult.error && preferenceResult.data
      ? toStringValue((preferenceResult.data as GenericRecord).resource_type) || null
      : null;

  const reviewResult = await supabaseAdmin
    .from("user_review_sessions")
    .select("weakness_snapshot_json")
    .eq("user_id", params.userId)
    .eq("status", "open")
    .eq("review_required", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let weakConcept: string | null = null;
  const reviewRow = !reviewResult.error ? (reviewResult.data as GenericRecord | null) : null;
  if (reviewRow && Array.isArray(reviewRow.weakness_snapshot_json)) {
    const firstWeakness = (reviewRow.weakness_snapshot_json as unknown[])[0];
    if (firstWeakness && typeof firstWeakness === "object") {
      weakConcept = toStringValue((firstWeakness as GenericRecord).concept_tag) || null;
    }
  }

  const milestoneLabel =
    params.emailType === "milestone" && progressPercent >= 25 ? `Reached ${progressPercent}% progress` : null;

  return {
    context: {
      user_id: params.userId,
      username: toStringValue(userRow.username) || null,
      email_type: params.emailType,
      learning_field_title: learningFieldTitle,
      current_progress_percent: progressPercent,
      next_suggested_step: nextSuggestedStep,
      preferred_resource_type: preferredResourceType,
      inactivity_days: inactivityDays,
      milestone_label: milestoneLabel,
      weak_concept: weakConcept,
    },
    userEmail,
  };
}

export async function POST(request: Request) {
  if (!canUseTestingRoute()) {
    return NextResponse.json(
      {
        success: false,
        message: "Test-email endpoint is available only in non-production environments.",
      },
      { status: 401 },
    );
  }

  try {
    const body = await request.json();
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

    const payload = parsed.data;
    logDev("request_received", {
      type: payload.type,
    });

    if (payload.type === "welcome") {
      const result = await sendWelcomeEmail({
        toEmail: payload.to_email,
        username: payload.username ?? null,
      });
      return NextResponse.json({
        success: true,
        type: payload.type,
        to_email: payload.to_email,
        mode: result.mode,
      });
    }

    const emailType = payload.email_type ?? "learning_reminder";
    const contextData = await buildAutomatedEmailContext({
      userId: payload.user_id,
      emailType,
      inactivityDaysOverride: payload.inactivity_days_override,
    });
    const composed = await composeAutomatedLearningEmail(contextData.context);
    const toEmail = payload.to_email || contextData.userEmail;
    const ctaUrl = `${resolveAppUrl()}/dashboard`;

    if (payload.dry_run) {
      return NextResponse.json({
        success: true,
        type: payload.type,
        dry_run: true,
        to_email: toEmail,
        email_type: emailType,
        preview: {
          subject: composed.subject,
          greeting: composed.greeting,
          encouragement: composed.encouragement,
          next_step: composed.next_step,
          preheader: composed.preheader,
          cta_label: composed.cta_label,
          cta_url: ctaUrl,
        },
        provenance: composed.provenance,
      });
    }

    const sendResult = await sendAutomatedLearningEmail({
      toEmail,
      subject: composed.subject,
      preheader: composed.preheader,
      greeting: composed.greeting,
      encouragement: composed.encouragement,
      nextStep: composed.next_step,
      ctaLabel: composed.cta_label,
      ctaUrl,
      scenarioLabel: scenarioLabel(emailType),
      tags: ["testing", "automation", emailType],
    });

    return NextResponse.json({
      success: true,
      type: payload.type,
      dry_run: false,
      to_email: toEmail,
      email_type: emailType,
      mode: sendResult.mode,
      provider_message_id:
        sendResult.mode === "email" ? sendResult.providerMessageId : null,
      subject: composed.subject,
      provenance: composed.provenance,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error("[email_testing_trigger] unexpected_error", { reason });
    return NextResponse.json(
      {
        success: false,
        message: reason || "Unable to trigger test email.",
      },
      { status: 500 },
    );
  }
}
