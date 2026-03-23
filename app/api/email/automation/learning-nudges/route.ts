import { NextResponse } from "next/server";
import { z } from "zod";
import { composeLearningNudgeEmail } from "@/lib/ai/learningEmailComposer";
import { sendLearningNudgeEmail } from "@/lib/email";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const requestSchema = z.object({
  user_id: z.string().uuid("user_id must be a valid UUID."),
  dry_run: z.boolean().optional(),
});

type GenericRecord = Record<string, unknown>;

function toStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function resolveAppUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  return "http://localhost:3000";
}

function canExecuteAutomation(request: Request) {
  const key = process.env.EMAIL_AUTOMATION_KEY?.trim();
  if (!key) {
    return process.env.NODE_ENV !== "production";
  }
  const incoming = request.headers.get("x-automation-key")?.trim() ?? "";
  return incoming === key;
}

async function loadLatestUserLearningField(userId: string) {
  const withCreatedAt = await supabaseAdmin
    .from("user_learning_fields")
    .select("id, field_id, current_level, target_level, created_at")
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
    .select("id, field_id, current_level, target_level, started_at")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (withStartedAt.error) {
    throw new Error("Unable to load user learning field.");
  }
  return withStartedAt.data as GenericRecord | null;
}

async function resolveOrCreateTemplate(params: {
  learningFieldId: string | null;
  levelBand: string | null;
  sourceHash: string;
  promptInputJson: Record<string, unknown>;
  contentJson: Record<string, unknown>;
  aiProvider: string;
  aiModel: string;
  aiPromptVersion: string;
  aiGeneratedAt: string;
}) {
  let existingQuery = supabaseAdmin
    .from("learning_email_templates")
    .select("id")
    .eq("template_type", "learning_nudge")
    .eq("source_hash", params.sourceHash);
  existingQuery = params.learningFieldId
    ? existingQuery.eq("learning_field_id", params.learningFieldId)
    : existingQuery.is("learning_field_id", null);
  existingQuery = params.levelBand
    ? existingQuery.eq("level_band", params.levelBand)
    : existingQuery.is("level_band", null);

  const existing = await existingQuery.limit(1).maybeSingle();

  if (!existing.error && existing.data) {
    return {
      templateId: toStringValue((existing.data as GenericRecord).id),
      reused: true,
    };
  }

  const created = await supabaseAdmin
    .from("learning_email_templates")
    .insert({
      template_type: "learning_nudge",
      learning_field_id: params.learningFieldId,
      level_band: params.levelBand,
      template_version: 1,
      source_hash: params.sourceHash,
      prompt_input_json: params.promptInputJson,
      content_json: params.contentJson,
      ai_provider: params.aiProvider,
      ai_model: params.aiModel,
      ai_prompt_version: params.aiPromptVersion,
      ai_generated_at: params.aiGeneratedAt,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .limit(1)
    .maybeSingle();

  if (created.error || !created.data) {
    throw new Error("Unable to create learning email template.");
  }

  return {
    templateId: toStringValue((created.data as GenericRecord).id),
    reused: false,
  };
}

export async function POST(request: Request) {
  if (!canExecuteAutomation(request)) {
    return NextResponse.json(
      {
        success: false,
        message: "Unauthorized automation request.",
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

    const userId = parsed.data.user_id;
    const dryRun = Boolean(parsed.data.dry_run);

    const userResult = await supabaseAdmin
      .from("users")
      .select("id, username, email")
      .eq("id", userId)
      .limit(1)
      .maybeSingle();
    if (userResult.error) {
      throw new Error("Unable to load user.");
    }
    if (!userResult.data) {
      return NextResponse.json(
        {
          success: false,
          message: "User not found.",
        },
        { status: 404 },
      );
    }
    const user = userResult.data as GenericRecord;
    const toEmail = toStringValue(user.email);
    if (!toEmail) {
      return NextResponse.json(
        {
          success: false,
          message: "User email is missing.",
        },
        { status: 400 },
      );
    }

    const learningFieldRow = await loadLatestUserLearningField(userId);
    const learningFieldId = toStringValue(learningFieldRow?.field_id) || null;
    const currentLevel = toStringValue(learningFieldRow?.current_level) || null;
    const targetLevel = toStringValue(learningFieldRow?.target_level) || null;

    let learningFieldTitle = "your learning path";
    if (learningFieldId) {
      const fieldResult = await supabaseAdmin
        .from("learning_fields")
        .select("title")
        .eq("id", learningFieldId)
        .limit(1)
        .maybeSingle();
      if (!fieldResult.error && fieldResult.data) {
        learningFieldTitle =
          toStringValue((fieldResult.data as GenericRecord).title) || learningFieldTitle;
      }
    }

    const latestJourneyResult = learningFieldId
      ? await supabaseAdmin
          .from("journey_paths")
          .select("id")
          .eq("user_id", userId)
          .eq("learning_field_id", learningFieldId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null, error: null as null };
    if (latestJourneyResult.error) {
      throw new Error("Unable to load journey context.");
    }
    const journeyPathId = toStringValue((latestJourneyResult.data as GenericRecord | null)?.id);

    let totalSteps = 0;
    let completedSteps = 0;
    if (journeyPathId) {
      const [allStepsResult, passedStepsResult] = await Promise.all([
        supabaseAdmin
          .from("user_course_progress")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("journey_path_id", journeyPathId),
        supabaseAdmin
          .from("user_course_progress")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .eq("journey_path_id", journeyPathId)
          .eq("status", "passed"),
      ]);
      if (allStepsResult.error || passedStepsResult.error) {
        throw new Error("Unable to load user progress context.");
      }
      totalSteps = Math.max(0, Number(allStepsResult.count ?? 0));
      completedSteps = Math.max(0, Number(passedStepsResult.count ?? 0));
    }
    const progressPercent =
      totalSteps <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((completedSteps / totalSteps) * 100)));

    const recentTestsResult = await supabaseAdmin
      .from("ai_user_tests")
      .select("pass_status, graded_at")
      .eq("user_id", userId)
      .eq("status", "graded")
      .order("graded_at", { ascending: false })
      .limit(20);
    const recentTests = recentTestsResult.error
      ? []
      : ((recentTestsResult.data ?? []) as GenericRecord[]);
    const fourteenDaysAgoMs = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const recentWindow = recentTests.filter((row) => {
      const gradedAtMs = Date.parse(toStringValue(row.graded_at));
      return Number.isFinite(gradedAtMs) && gradedAtMs >= fourteenDaysAgoMs;
    });
    const passedTestsRecent = recentWindow.filter(
      (row) => toStringValue(row.pass_status).toLowerCase() === "passed",
    ).length;
    const failedTestsRecent = recentWindow.filter(
      (row) => toStringValue(row.pass_status).toLowerCase() !== "passed",
    ).length;

    const composition = await composeLearningNudgeEmail({
      user_id: userId,
      username: toStringValue(user.username) || null,
      email: toEmail,
      learning_field_id: learningFieldId,
      learning_field_title: learningFieldTitle,
      current_level: currentLevel,
      target_level: targetLevel,
      total_steps: totalSteps,
      completed_steps: completedSteps,
      progress_percent: progressPercent,
      passed_tests_recent: passedTestsRecent,
      failed_tests_recent: failedTestsRecent,
    });

    const templateResolution = await resolveOrCreateTemplate({
      learningFieldId,
      levelBand: currentLevel,
      sourceHash: composition.source_hash,
      promptInputJson: composition.prompt_input_json,
      contentJson: {
        subject: composition.subject,
        preheader: composition.preheader,
        headline: composition.headline,
        intro: composition.intro,
        action_items: composition.action_items,
        cta_label: composition.cta_label,
      },
      aiProvider: composition.provenance.provider,
      aiModel: composition.provenance.model,
      aiPromptVersion: composition.provenance.prompt_version,
      aiGeneratedAt: composition.provenance.generated_at,
    });

    const appUrl = resolveAppUrl();
    const ctaUrl = `${appUrl}/dashboard`;

    if (dryRun) {
      await supabaseAdmin.from("user_learning_email_sends").insert({
        user_id: userId,
        template_id: templateResolution.templateId || null,
        template_type: "learning_nudge",
        subject: composition.subject,
        status: "preview",
        provider: "development",
        provider_message_id: null,
        source_hash: composition.source_hash,
        dispatch_context_json: {
          learning_field_id: learningFieldId,
          learning_field_title: learningFieldTitle,
          current_level: currentLevel,
          target_level: targetLevel,
          total_steps: totalSteps,
          completed_steps: completedSteps,
          progress_percent: progressPercent,
          dry_run: true,
        },
        sent_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      return NextResponse.json({
        success: true,
        dry_run: true,
        template_reused: templateResolution.reused,
        template_id: templateResolution.templateId,
        email_preview: {
          to_email: toEmail,
          subject: composition.subject,
          preheader: composition.preheader,
          headline: composition.headline,
          intro: composition.intro,
          action_items: composition.action_items,
          cta_label: composition.cta_label,
          cta_url: ctaUrl,
        },
        provenance: composition.provenance,
      });
    }

    let sendResult;
    try {
      sendResult = await sendLearningNudgeEmail({
        toEmail,
        username: toStringValue(user.username) || null,
        subject: composition.subject,
        preheader: composition.preheader,
        headline: composition.headline,
        intro: composition.intro,
        actionItems: composition.action_items,
        ctaLabel: composition.cta_label,
        ctaUrl,
      });
    } catch (sendError) {
      await supabaseAdmin.from("user_learning_email_sends").insert({
        user_id: userId,
        template_id: templateResolution.templateId || null,
        template_type: "learning_nudge",
        subject: composition.subject,
        status: "failed",
        provider: "brevo",
        provider_message_id: null,
        source_hash: composition.source_hash,
        dispatch_context_json: {
          learning_field_id: learningFieldId,
          learning_field_title: learningFieldTitle,
          current_level: currentLevel,
          target_level: targetLevel,
          total_steps: totalSteps,
          completed_steps: completedSteps,
          progress_percent: progressPercent,
          dry_run: false,
        },
        error_message: sendError instanceof Error ? sendError.message : String(sendError),
        sent_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      throw sendError;
    }

    await supabaseAdmin.from("user_learning_email_sends").insert({
      user_id: userId,
      template_id: templateResolution.templateId || null,
      template_type: "learning_nudge",
      subject: composition.subject,
      status: "sent",
      provider: sendResult.mode === "email" ? "brevo" : "development",
      provider_message_id: sendResult.mode === "email" ? sendResult.providerMessageId : null,
      source_hash: composition.source_hash,
      dispatch_context_json: {
        learning_field_id: learningFieldId,
        learning_field_title: learningFieldTitle,
        current_level: currentLevel,
        target_level: targetLevel,
        total_steps: totalSteps,
        completed_steps: completedSteps,
        progress_percent: progressPercent,
        dry_run: false,
      },
      sent_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    return NextResponse.json({
      success: true,
      dry_run: false,
      template_reused: templateResolution.reused,
      template_id: templateResolution.templateId,
      mode: sendResult.mode,
      provider_message_id:
        sendResult.mode === "email" ? sendResult.providerMessageId : null,
      subject: composition.subject,
      provenance: composition.provenance,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Unable to execute learning email automation.",
      },
      { status: 500 },
    );
  }
}
