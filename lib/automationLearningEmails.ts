import { sha256Hash } from "@/lib/ai/common";
import {
  composeAutomatedLearningEmail,
  type AutomatedEmailContext,
  type AutomatedEmailType,
} from "@/lib/ai/automatedEmailComposer";
import { sendAutomatedLearningEmail } from "@/lib/email";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type GenericRecord = Record<string, unknown>;

export type AutomatedEmailRunParams = {
  userId?: string;
  maxUsers?: number;
  dryRun?: boolean;
};

export type AutomatedEmailRunSummary = {
  processed_users: number;
  selected_candidates: number;
  sent_count: number;
  preview_count: number;
  skipped_count: number;
  failed_count: number;
  items: Array<{
    user_id: string;
    email_type: AutomatedEmailType;
    dry_run: boolean;
    status: "sent" | "preview" | "skipped" | "failed";
    reason?: string;
    subject?: string;
    context_hash: string;
  }>;
};

type UserAutomationSnapshot = {
  user_id: string;
  username: string | null;
  email: string;
  learning_field_id: string | null;
  learning_field_title: string;
  current_level: string | null;
  target_level: string | null;
  journey_path_id: string | null;
  total_steps: number;
  completed_steps: number;
  progress_percent: number;
  has_started_learning: boolean;
  last_activity_at: string | null;
  inactivity_days: number;
  next_suggested_step: string;
  preferred_resource_type: string | null;
  passed_tests_total: number;
  has_first_passed_test: boolean;
  pending_review_session_id: string | null;
  pending_review_created_at: string | null;
  weak_concept: string | null;
};

type Candidate = {
  user: UserAutomationSnapshot;
  emailType: AutomatedEmailType;
  scenarioLabel: string;
  milestoneLabel: string | null;
  contextHash: string;
};

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

function resolveAppUrl() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  return "http://localhost:3000";
}

function logDev(step: string, detail?: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") {
    return;
  }
  if (detail) {
    console.info(`[automation_learning_emails] ${step}`, detail);
    return;
  }
  console.info(`[automation_learning_emails] ${step}`);
}

async function loadTargetUsers(params: { userId?: string; maxUsers: number }) {
  let query = supabaseAdmin
    .from("users")
    .select("id, username, email")
    .order("created_at", { ascending: false })
    .limit(params.maxUsers);

  if (params.userId) {
    query = query.eq("id", params.userId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error("Unable to load users for email automation.");
  }

  return ((data ?? []) as GenericRecord[])
    .map((row) => ({
      id: toStringValue(row.id),
      username: toStringValue(row.username) || null,
      email: toStringValue(row.email),
    }))
    .filter((row) => row.id && row.email);
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
    throw new Error("Unable to load learning field for user.");
  }

  const withStartedAt = await supabaseAdmin
    .from("user_learning_fields")
    .select("id, field_id, current_level, target_level, started_at")
    .eq("user_id", userId)
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (withStartedAt.error) {
    throw new Error("Unable to load learning field for user.");
  }
  return withStartedAt.data as GenericRecord | null;
}

async function loadUserSnapshot(params: {
  userId: string;
  username: string | null;
  email: string;
}): Promise<UserAutomationSnapshot> {
  const nowMs = Date.now();
  const userField = await loadLatestUserLearningField(params.userId);
  const learningFieldId = toStringValue(userField?.field_id) || null;
  const currentLevel = toStringValue(userField?.current_level) || null;
  const targetLevel = toStringValue(userField?.target_level) || null;

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

  const journeyPathResult = learningFieldId
    ? await supabaseAdmin
        .from("journey_paths")
        .select("id")
        .eq("user_id", params.userId)
        .eq("learning_field_id", learningFieldId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null, error: null as null };
  if (journeyPathResult.error) {
    throw new Error("Unable to load journey path for user.");
  }
  const journeyPathId = toStringValue((journeyPathResult.data as GenericRecord | null)?.id) || null;

  let progressRows: GenericRecord[] = [];
  let courseOrderRows: GenericRecord[] = [];
  let coursesRows: GenericRecord[] = [];
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
      throw new Error("Unable to load journey progress context.");
    }
    progressRows = (progressResult.data ?? []) as GenericRecord[];
    courseOrderRows = (orderResult.data ?? []) as GenericRecord[];

    const courseIds = Array.from(
      new Set(courseOrderRows.map((row) => toStringValue(row.course_id)).filter(Boolean)),
    );
    if (courseIds.length > 0) {
      const coursesResult = await supabaseAdmin
        .from("courses")
        .select("id, title")
        .in("id", courseIds);
      if (!coursesResult.error) {
        coursesRows = (coursesResult.data ?? []) as GenericRecord[];
      }
    }
  }

  const courseTitleById = new Map(
    coursesRows.map((row) => [toStringValue(row.id), toStringValue(row.title)] as const),
  );
  const progressByCourse = new Map(
    progressRows.map((row) => [toStringValue(row.course_id), row] as const),
  );

  const totalSteps = Math.max(
    progressRows.length,
    courseOrderRows.length,
  );
  const completedSteps = progressRows.filter(
    (row) => toStringValue(row.status).toLowerCase() === "passed",
  ).length;
  const progressPercent =
    totalSteps <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((completedSteps / totalSteps) * 100)));
  const hasStartedLearning = progressRows.length > 0 || Boolean(journeyPathId);

  const lastActivityMsCandidates = progressRows.map((row) =>
    Math.max(
      toDateMs(row.last_activity_at),
      toDateMs(row.completed_at),
      toDateMs(row.passed_at),
      toDateMs(row.started_at),
    ),
  );
  const lastActivityMs = lastActivityMsCandidates.length > 0 ? Math.max(...lastActivityMsCandidates) : 0;
  const inactivityDays =
    lastActivityMs > 0 ? Math.max(0, Math.floor((nowMs - lastActivityMs) / (24 * 60 * 60 * 1000))) : 0;
  const lastActivityAt = lastActivityMs > 0 ? new Date(lastActivityMs).toISOString() : null;

  const firstNextCourse = courseOrderRows.find((row) => {
    const courseId = toStringValue(row.course_id);
    const progressRow = progressByCourse.get(courseId);
    const status = toStringValue(progressRow?.status).toLowerCase();
    return status !== "passed";
  });
  const nextSuggestedStep = firstNextCourse
    ? courseTitleById.get(toStringValue(firstNextCourse.course_id)) || "Continue your next unlocked lesson"
    : "Take your next learning step in Pathly";

  const preferenceResult = await supabaseAdmin
    .from("user_resource_preferences")
    .select("resource_type, weighted_score, confidence")
    .eq("user_id", params.userId)
    .order("weighted_score", { ascending: false })
    .order("confidence", { ascending: false })
    .limit(1)
    .maybeSingle();
  const preferredResourceType =
    !preferenceResult.error && preferenceResult.data
      ? toStringValue((preferenceResult.data as GenericRecord).resource_type) || null
      : null;

  const testsResult = await supabaseAdmin
    .from("ai_user_tests")
    .select("pass_status, graded_at")
    .eq("user_id", params.userId)
    .eq("status", "graded")
    .order("graded_at", { ascending: false })
    .limit(50);
  const testsRows = testsResult.error ? [] : ((testsResult.data ?? []) as GenericRecord[]);
  const passedTestsTotal = testsRows.filter(
    (row) => toStringValue(row.pass_status).toLowerCase() === "passed",
  ).length;

  const reviewResult = await supabaseAdmin
    .from("user_review_sessions")
    .select("id, created_at, weakness_snapshot_json")
    .eq("user_id", params.userId)
    .eq("status", "open")
    .eq("review_required", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const pendingReviewRow = reviewResult.error
    ? null
    : ((reviewResult.data as GenericRecord | null) ?? null);
  const pendingReviewSessionId = toStringValue(pendingReviewRow?.id) || null;
  const pendingReviewCreatedAt = toStringValue(pendingReviewRow?.created_at) || null;
  let weakConcept: string | null = null;
  if (pendingReviewRow && Array.isArray(pendingReviewRow.weakness_snapshot_json)) {
    const firstWeakness = (pendingReviewRow.weakness_snapshot_json as unknown[])[0];
    if (firstWeakness && typeof firstWeakness === "object") {
      weakConcept = toStringValue((firstWeakness as GenericRecord).concept_tag) || null;
    }
  }

  return {
    user_id: params.userId,
    username: params.username,
    email: params.email,
    learning_field_id: learningFieldId,
    learning_field_title: learningFieldTitle,
    current_level: currentLevel,
    target_level: targetLevel,
    journey_path_id: journeyPathId,
    total_steps: totalSteps,
    completed_steps: completedSteps,
    progress_percent: progressPercent,
    has_started_learning: hasStartedLearning,
    last_activity_at: lastActivityAt,
    inactivity_days: inactivityDays,
    next_suggested_step: nextSuggestedStep,
    preferred_resource_type: preferredResourceType,
    passed_tests_total: passedTestsTotal,
    has_first_passed_test: passedTestsTotal > 0,
    pending_review_session_id: pendingReviewSessionId,
    pending_review_created_at: pendingReviewCreatedAt,
    weak_concept: weakConcept,
  };
}

async function hasExistingEvent(params: {
  userId: string;
  emailType: AutomatedEmailType;
  contextHash: string;
  includePreview?: boolean;
}) {
  const statuses = params.includePreview ? ["sent", "preview"] : ["sent"];
  const { data, error } = await supabaseAdmin
    .from("automated_learning_email_events")
    .select("id, status")
    .eq("user_id", params.userId)
    .eq("email_type", params.emailType)
    .eq("context_hash", params.contextHash)
    .in("status", statuses)
    .limit(1)
    .maybeSingle();
  if (error) {
    throw new Error("Unable to check automated email dedupe state.");
  }
  return Boolean(data);
}

async function createAutomationEvent(params: {
  userId: string;
  emailType: AutomatedEmailType;
  contextHash: string;
  status: "sent" | "preview" | "skipped" | "failed";
  subject?: string | null;
  provider?: string | null;
  providerMessageId?: string | null;
  details: Record<string, unknown>;
  errorMessage?: string | null;
}) {
  const nowIso = new Date().toISOString();
  const { error } = await supabaseAdmin.from("automated_learning_email_events").upsert(
    {
      user_id: params.userId,
      email_type: params.emailType,
      context_hash: params.contextHash,
      status: params.status,
      subject: params.subject ?? null,
      provider: params.provider ?? null,
      provider_message_id: params.providerMessageId ?? null,
      details_json: params.details,
      error_message: params.errorMessage ?? null,
      sent_at: params.status === "sent" ? nowIso : null,
      created_at: nowIso,
      updated_at: nowIso,
    },
    {
      onConflict: "user_id,email_type,context_hash",
    },
  );
  if (error) {
    throw new Error("Unable to record automated email event.");
  }
}

async function resolveOrCreateTemplate(params: {
  emailType: AutomatedEmailType;
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
    .select("id, content_json")
    .eq("template_type", params.emailType)
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
      contentJson: ((existing.data as GenericRecord).content_json ?? {}) as Record<string, unknown>,
    };
  }

  const nowIso = new Date().toISOString();
  const created = await supabaseAdmin
    .from("learning_email_templates")
    .insert({
      template_type: params.emailType,
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
      created_at: nowIso,
      updated_at: nowIso,
    })
    .select("id")
    .limit(1)
    .maybeSingle();
  if (created.error || !created.data) {
    throw new Error("Unable to create automated email template.");
  }

  return {
    templateId: toStringValue((created.data as GenericRecord).id),
    reused: false,
    contentJson: params.contentJson,
  };
}

function selectCandidate(user: UserAutomationSnapshot): Candidate | null {
  const inactivityDays = user.inactivity_days;
  const nowBucket = Math.max(0, inactivityDays);

  const milestones: Array<{ key: string; label: string }> = [];
  if (user.completed_steps >= 1) {
    milestones.push({
      key: "first_course_completed",
      label: "Completed your first course",
    });
  }
  if (user.has_first_passed_test) {
    milestones.push({
      key: "first_ai_test_passed",
      label: "Passed your first AI test",
    });
  }
  const threshold = [100, 75, 50, 25].find((value) => user.progress_percent >= value) ?? null;
  if (threshold !== null) {
    milestones.push({
      key: `progress_${threshold}`,
      label: `Reached ${threshold}% progress`,
    });
  }

  if (milestones.length > 0) {
    const topMilestone = milestones[0];
    const contextHash = sha256Hash({
      user_id: user.user_id,
      email_type: "milestone",
      milestone_key: topMilestone.key,
      learning_field_id: user.learning_field_id,
      journey_path_id: user.journey_path_id,
    });
    return {
      user,
      emailType: "milestone",
      scenarioLabel: "Milestone Reached",
      milestoneLabel: topMilestone.label,
      contextHash,
    };
  }

  if (
    user.pending_review_session_id &&
    toDateMs(user.pending_review_created_at) > 0 &&
    inactivityDays >= 2
  ) {
    const contextHash = sha256Hash({
      user_id: user.user_id,
      email_type: "review_reminder",
      review_session_id: user.pending_review_session_id,
      weak_concept: user.weak_concept,
      inactivity_days_bucket: nowBucket,
    });
    return {
      user,
      emailType: "review_reminder",
      scenarioLabel: "Review Reminder",
      milestoneLabel: null,
      contextHash,
    };
  }

  if (user.has_started_learning && inactivityDays >= 5) {
    const contextHash = sha256Hash({
      user_id: user.user_id,
      email_type: "comeback_inactivity",
      inactivity_days_bucket: nowBucket,
      learning_field_id: user.learning_field_id,
      progress_bucket: Math.floor(user.progress_percent / 10) * 10,
    });
    return {
      user,
      emailType: "comeback_inactivity",
      scenarioLabel: "Comeback Time",
      milestoneLabel: null,
      contextHash,
    };
  }

  if (user.has_started_learning && inactivityDays >= 2) {
    const contextHash = sha256Hash({
      user_id: user.user_id,
      email_type: "learning_reminder",
      inactivity_days_bucket: nowBucket,
      learning_field_id: user.learning_field_id,
      progress_bucket: Math.floor(user.progress_percent / 10) * 10,
      preferred_resource_type: user.preferred_resource_type,
    });
    return {
      user,
      emailType: "learning_reminder",
      scenarioLabel: "Learning Reminder",
      milestoneLabel: null,
      contextHash,
    };
  }

  return null;
}

function toAutomationContext(candidate: Candidate): AutomatedEmailContext {
  return {
    user_id: candidate.user.user_id,
    username: candidate.user.username,
    email_type: candidate.emailType,
    learning_field_title: candidate.user.learning_field_title,
    current_progress_percent: candidate.user.progress_percent,
    next_suggested_step: candidate.user.next_suggested_step,
    preferred_resource_type: candidate.user.preferred_resource_type,
    inactivity_days: candidate.user.inactivity_days,
    milestone_label: candidate.milestoneLabel,
    weak_concept: candidate.user.weak_concept,
  };
}

function deriveCtaUrl(candidate: Candidate) {
  const base = resolveAppUrl();
  if (candidate.emailType === "review_reminder") {
    return `${base}/dashboard`;
  }
  return `${base}/dashboard`;
}

export async function runAutomatedLearningEmails(
  params: AutomatedEmailRunParams,
): Promise<AutomatedEmailRunSummary> {
  const dryRun = Boolean(params.dryRun);
  const maxUsers = Math.max(1, Math.min(200, params.maxUsers ?? 50));
  const users = await loadTargetUsers({
    userId: params.userId,
    maxUsers,
  });

  const summary: AutomatedEmailRunSummary = {
    processed_users: 0,
    selected_candidates: 0,
    sent_count: 0,
    preview_count: 0,
    skipped_count: 0,
    failed_count: 0,
    items: [],
  };

  for (const user of users) {
    summary.processed_users += 1;
    let activeEmailType: AutomatedEmailType | null = null;
    let activeContextHash: string | null = null;
    try {
      const snapshot = await loadUserSnapshot({
        userId: user.id,
        username: user.username,
        email: user.email,
      });
      const candidate = selectCandidate(snapshot);
      if (!candidate) {
        summary.skipped_count += 1;
        summary.items.push({
          user_id: user.id,
          email_type: "learning_reminder",
          dry_run: dryRun,
          status: "skipped",
          reason: "no_trigger",
          context_hash: sha256Hash({ user_id: user.id, no_trigger: true }),
        });
        continue;
      }

      activeEmailType = candidate.emailType;
      activeContextHash = candidate.contextHash;
      summary.selected_candidates += 1;
      const alreadySent = await hasExistingEvent({
        userId: user.id,
        emailType: candidate.emailType,
        contextHash: candidate.contextHash,
        includePreview: dryRun,
      });
      if (alreadySent) {
        summary.skipped_count += 1;
        summary.items.push({
          user_id: user.id,
          email_type: candidate.emailType,
          dry_run: dryRun,
          status: "skipped",
          reason: "duplicate_context",
          context_hash: candidate.contextHash,
        });
        continue;
      }

      const composed = await composeAutomatedLearningEmail(
        toAutomationContext(candidate),
      );

      const template = await resolveOrCreateTemplate({
        emailType: candidate.emailType,
        learningFieldId: candidate.user.learning_field_id,
        levelBand: candidate.user.current_level,
        sourceHash: composed.source_hash,
        promptInputJson: composed.prompt_input_json,
        contentJson: {
          subject: composed.subject,
          greeting: composed.greeting,
          encouragement: composed.encouragement,
          next_step: composed.next_step,
          preheader: composed.preheader,
          cta_label: composed.cta_label,
        },
        aiProvider: composed.provenance.provider,
        aiModel: composed.provenance.model,
        aiPromptVersion: composed.provenance.prompt_version,
        aiGeneratedAt: composed.provenance.generated_at,
      });
      logDev("template_resolution", {
        user_id: candidate.user.user_id,
        email_type: candidate.emailType,
        template_id: template.templateId,
        reused: template.reused,
      });

      const ctaUrl = deriveCtaUrl(candidate);
      if (dryRun) {
        const nowIso = new Date().toISOString();
        await supabaseAdmin.from("user_learning_email_sends").insert({
          user_id: candidate.user.user_id,
          template_id: template.templateId,
          template_type: candidate.emailType,
          subject: composed.subject,
          status: "preview",
          provider: "development",
          provider_message_id: null,
          source_hash: candidate.contextHash,
          dispatch_context_json: {
            email_type: candidate.emailType,
            learning_field_id: candidate.user.learning_field_id,
            learning_field_title: candidate.user.learning_field_title,
            inactivity_days: candidate.user.inactivity_days,
            progress_percent: candidate.user.progress_percent,
            milestone_label: candidate.milestoneLabel,
            weak_concept: candidate.user.weak_concept,
            template_reused: template.reused,
            dry_run: true,
          },
          sent_at: null,
          created_at: nowIso,
          updated_at: nowIso,
        });
        await createAutomationEvent({
          userId: candidate.user.user_id,
          emailType: candidate.emailType,
          contextHash: candidate.contextHash,
          status: "preview",
          subject: composed.subject,
          provider: "development",
          details: {
            template_id: template.templateId,
            template_reused: template.reused,
            cta_url: ctaUrl,
          },
        });
        summary.preview_count += 1;
        summary.items.push({
          user_id: candidate.user.user_id,
          email_type: candidate.emailType,
          dry_run: true,
          status: "preview",
          subject: composed.subject,
          context_hash: candidate.contextHash,
        });
        continue;
      }

      const sendResult = await sendAutomatedLearningEmail({
        toEmail: candidate.user.email,
        subject: composed.subject,
        preheader: composed.preheader,
        greeting: composed.greeting,
        encouragement: composed.encouragement,
        nextStep: composed.next_step,
        ctaLabel: composed.cta_label,
        ctaUrl,
        scenarioLabel: candidate.scenarioLabel,
        tags: ["automation", candidate.emailType],
      });

      const nowIso = new Date().toISOString();
      await supabaseAdmin.from("user_learning_email_sends").insert({
        user_id: candidate.user.user_id,
        template_id: template.templateId,
        template_type: candidate.emailType,
        subject: composed.subject,
        status: "sent",
        provider: sendResult.mode === "email" ? "brevo" : "development",
        provider_message_id:
          sendResult.mode === "email" ? sendResult.providerMessageId : null,
        source_hash: candidate.contextHash,
        dispatch_context_json: {
          email_type: candidate.emailType,
          learning_field_id: candidate.user.learning_field_id,
          learning_field_title: candidate.user.learning_field_title,
          inactivity_days: candidate.user.inactivity_days,
          progress_percent: candidate.user.progress_percent,
          milestone_label: candidate.milestoneLabel,
          weak_concept: candidate.user.weak_concept,
          template_reused: template.reused,
          dry_run: false,
        },
        sent_at: nowIso,
        created_at: nowIso,
        updated_at: nowIso,
      });
      await createAutomationEvent({
        userId: candidate.user.user_id,
        emailType: candidate.emailType,
        contextHash: candidate.contextHash,
        status: "sent",
        subject: composed.subject,
        provider: sendResult.mode === "email" ? "brevo" : "development",
        providerMessageId:
          sendResult.mode === "email" ? sendResult.providerMessageId : null,
        details: {
          template_id: template.templateId,
          template_reused: template.reused,
          cta_url: ctaUrl,
        },
      });

      summary.sent_count += 1;
      summary.items.push({
        user_id: candidate.user.user_id,
        email_type: candidate.emailType,
        dry_run: false,
        status: "sent",
        subject: composed.subject,
        context_hash: candidate.contextHash,
      });
      logDev("send_success", {
        user_id: candidate.user.user_id,
        email_type: candidate.emailType,
        template_reused: template.reused,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      summary.failed_count += 1;
      const fallbackHash =
        activeContextHash || sha256Hash({ user_id: user.id, failed_reason: reason });
      const fallbackType = activeEmailType || "learning_reminder";
      summary.items.push({
        user_id: user.id,
        email_type: fallbackType,
        dry_run: dryRun,
        status: "failed",
        reason,
        context_hash: fallbackHash,
      });
      logDev("send_failed", {
        user_id: user.id,
        reason,
      });
      try {
        await createAutomationEvent({
          userId: user.id,
          emailType: fallbackType,
          contextHash: fallbackHash,
          status: "failed",
          details: {
            reason,
          },
          errorMessage: reason,
        });
      } catch {
        // Ignore secondary logging failures.
      }
    }
  }

  return summary;
}
