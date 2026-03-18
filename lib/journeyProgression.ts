import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  calculateTotalSteps,
  type LearningLevel,
  normalizeLearningLevel,
} from "@/lib/learningPath";
import {
  normalizeCourseDifficulty,
  normalizeCourseDifficultyForWrite,
  type CourseDifficultyLevel,
} from "@/lib/courseDifficulty";
import {
  instantiateUserLearningJourney,
  resolveOrCreateJourneyTemplate,
} from "@/lib/ai/journeyPlanner";
import {
  ensureCourseResourceOptions,
  markUserResourceCompletionAndSuccess,
  recordUserResourceSelection,
  resolveResourceOptionIdFromLegacyResource,
  sortResourceOptionsByPreference,
} from "@/lib/ai/resources";
import { loadUserResourcePreferenceProfile } from "@/lib/ai/preferences";
import { resolveAiTestTemplateForAttempt } from "@/lib/ai/tests";
import { analyzeWeaknessAndPrepareReview, getPendingReviewPopup } from "@/lib/ai/review";

export type CourseNodeStatus =
  | "locked"
  | "unlocked"
  | "in_progress"
  | "ready_for_test"
  | "passed";

type GenericRecord = Record<string, unknown>;

export type JourneyNode = {
  step_number: number;
  course_id: string;
  title: string;
  status: CourseNodeStatus;
  passed_score: number | null;
};

export type JourneyPayload = {
  journey_path_id: string;
  total_steps: number;
  current_step: number;
  learning_field_id: string;
  nodes: JourneyNode[];
};

export type CourseResourcePayload = {
  id: string;
  resource_option_id: string | null;
  title: string;
  resource_type: string;
  provider_name: string;
  url: string;
  description: string | null;
  average_rating: number;
  comment_count: number;
  my_rating: number | null;
  comment_previews: Array<{
    id: string;
    comment_text: string;
    created_at: string;
    username: string | null;
  }>;
};

export type CourseDetailsPayload = {
  id: string;
  journey_path_id: string;
  title: string;
  description: string | null;
  estimated_minutes: number | null;
  difficulty_level: CourseDifficultyLevel | null;
  skill_tags: string[];
  status: CourseNodeStatus;
  last_test_score: number | null;
  best_test_score: number | null;
  attempt_count: number;
  passed_at: string | null;
  last_activity_at: string | null;
  ready_for_test_at: string | null;
  current_test_attempt_id: string | null;
  required_test_score: number;
  can_take_test: boolean;
  review_popup: {
    should_show: boolean;
    review_session_id: string | null;
    score_at_trigger: number | null;
    question_count: number;
  };
  user_resource_preferences: Array<{
    resource_type: string;
    weighted_score: number;
    confidence: number;
  }>;
  resources: CourseResourcePayload[];
};

export class CourseDetailsError extends Error {
  step: string;
  details?: Record<string, unknown>;
  cause?: unknown;

  constructor(params: {
    message: string;
    step: string;
    details?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(params.message);
    this.name = "CourseDetailsError";
    this.step = params.step;
    this.details = params.details;
    this.cause = params.cause;
  }
}

export class JourneyGenerationError extends Error {
  status: number;
  code: string;
  step: string;
  details?: Record<string, unknown>;
  cause?: unknown;

  constructor(params: {
    message: string;
    step: string;
    code: string;
    status?: number;
    details?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(params.message);
    this.name = "JourneyGenerationError";
    this.status = params.status ?? 500;
    this.code = params.code;
    this.step = params.step;
    this.details = params.details;
    this.cause = params.cause;
  }
}

export function isJourneyGenerationError(error: unknown): error is JourneyGenerationError {
  return error instanceof JourneyGenerationError;
}

export function isCourseDetailsError(error: unknown): error is CourseDetailsError {
  return error instanceof CourseDetailsError;
}

export class StartCourseError extends Error {
  step: string;
  details?: Record<string, unknown>;
  cause?: unknown;

  constructor(params: {
    message: string;
    step: string;
    details?: Record<string, unknown>;
    cause?: unknown;
  }) {
    super(params.message);
    this.name = "StartCourseError";
    this.step = params.step;
    this.details = params.details;
    this.cause = params.cause;
  }
}

export function isStartCourseError(error: unknown): error is StartCourseError {
  return error instanceof StartCourseError;
}

function createJourneyError(params: {
  step: string;
  message: string;
  code: string;
  status?: number;
  details?: Record<string, unknown>;
  cause?: unknown;
}) {
  return new JourneyGenerationError(params);
}

function createCourseDetailsError(params: {
  step: string;
  message: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}) {
  return new CourseDetailsError(params);
}

function createStartCourseError(params: {
  step: string;
  message: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}) {
  return new StartCourseError(params);
}

function logJourneyStep(step: string, detail?: Record<string, unknown>) {
  if (detail) {
    console.info(`[journey] ${step}`, detail);
    return;
  }
  console.info(`[journey] ${step}`);
}

function logCourseDetailsStep(step: string, detail?: Record<string, unknown>) {
  if (detail) {
    console.info(`[course_details] ${step}`, detail);
    return;
  }
  console.info(`[course_details] ${step}`);
}

function logStartCourseStep(step: string, detail?: Record<string, unknown>) {
  if (detail) {
    console.info(`[start_course] ${step}`, detail);
    return;
  }
  console.info(`[start_course] ${step}`);
}

function toErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String((error as { message?: unknown })?.message ?? error);
}

function isMissingColumnError(error: unknown, table: string, column: string) {
  const message = toErrorMessage(error).toLowerCase();
  return (
    message.includes(`column ${table}.${column} does not exist`) ||
    message.includes(`column ${column} does not exist`)
  );
}

function isMissingFunctionError(error: unknown, functionName: string) {
  const message = toErrorMessage(error).toLowerCase();
  return message.includes("function") && message.includes(functionName.toLowerCase()) && message.includes("does not exist");
}

function mapSupabaseError(step: string, error: unknown, fallbackMessage: string) {
  const message = String((error as { message?: unknown })?.message ?? "");
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes("does not exist")) {
    const isTableMissing = lowerMessage.includes("relation");
    return createJourneyError({
      step,
      code: isTableMissing ? "SCHEMA_TABLE_MISSING" : "SCHEMA_COLUMN_MISMATCH",
      message: message || fallbackMessage,
      details: { supabase_message: message },
      cause: error,
    });
  }

  if (
    lowerMessage.includes("permission denied") ||
    lowerMessage.includes("rls") ||
    lowerMessage.includes("not allowed")
  ) {
    return createJourneyError({
      step,
      code: "PERMISSION_DENIED",
      status: 403,
      message: message || fallbackMessage,
      details: { supabase_message: message },
      cause: error,
    });
  }

  return createJourneyError({
    step,
    code: "SUPABASE_QUERY_FAILED",
    message: message || fallbackMessage,
    details: { supabase_message: message },
    cause: error,
  });
}

function toStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function toNumberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function normalizeStatus(value: unknown): CourseNodeStatus {
  if (
    value === "locked" ||
    value === "unlocked" ||
    value === "in_progress" ||
    value === "ready_for_test" ||
    value === "passed"
  ) {
    return value;
  }

  if (value === "completed") {
    return "passed";
  }

  return "locked";
}

function getFieldTitle(field: GenericRecord | null) {
  const title = toStringValue(field?.title);
  if (title) {
    return title;
  }

  const name = toStringValue(field?.name);
  if (name) {
    return name;
  }

  return "Learning";
}

function getCourseTitle(course: GenericRecord | null, fallback = "Untitled Course") {
  const title = toStringValue(course?.title);
  if (title) {
    return title;
  }

  return fallback;
}

export async function validateJourneySchema() {
  const checks: Array<{
    table: string;
    columns: string;
  }> = [
    { table: "learning_fields", columns: "id, title" },
    {
      table: "courses",
      columns:
        "id, learning_field_id, title, slug, description, estimated_minutes, difficulty_level, created_at",
    },
    {
      table: "journey_paths",
      columns: "id, user_id, learning_field_id, starting_point, destination, total_steps, created_at",
    },
    {
      table: "journey_path_courses",
      columns: "id, journey_path_id, course_id, step_number, is_required, created_at",
    },
    {
      table: "user_course_progress",
      columns:
        "id, user_id, journey_path_id, course_id, status, selected_resource_id, started_at, completed_at, last_test_score, best_test_score, passed_at, attempt_count, last_activity_at, ready_for_test_at, current_test_attempt_id",
    },
    {
      table: "course_test_attempts",
      columns:
        "id, user_id, journey_path_id, course_id, selected_resource_id, score, passed, attempt_number, started_at, submitted_at, feedback_summary, created_at",
    },
    {
      table: "course_test_questions",
      columns:
        "id, test_attempt_id, question_order, question_text, question_type, options_json, correct_answer_json, user_answer_json, points, earned_points, explanation",
    },
    {
      table: "resource_content_summaries",
      columns: "id, resource_id, summary, key_points, generated_at",
    },
  ];

  for (const check of checks) {
    const { error } = await supabaseAdmin.from(check.table).select(check.columns).limit(1);
    if (error) {
      throw mapSupabaseError(
        "schema_validation",
        error,
        `Journey schema validation failed for table ${check.table}.`,
      );
    }
  }
}

async function getLearningFieldById(learningFieldId: string) {
  const { data, error } = await supabaseAdmin
    .from("learning_fields")
    .select("*")
    .eq("id", learningFieldId)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError("read_learning_field", error, "Failed to load learning field.");
  }

  return (data as GenericRecord | null) ?? null;
}

async function ensureCoursesForField(params: {
  learningFieldId: string;
  totalSteps: number;
  fieldTitle: string;
  plannedSteps?: Array<{
    step_number: number;
    step_title: string;
    step_description: string;
    learning_objective: string;
    difficulty_level: string;
  }>;
}) {
  const { data: existingCourses, error: existingCoursesError } = await supabaseAdmin
    .from("courses")
    .select("*")
    .eq("learning_field_id", params.learningFieldId)
    .order("created_at", { ascending: true });

  if (existingCoursesError) {
    throw mapSupabaseError("query_courses", existingCoursesError, "Failed to load courses.");
  }

  const normalizedCourses = ((existingCourses ?? []) as GenericRecord[]).filter(
    (row) => toStringValue(row.id) && toStringValue(row.learning_field_id),
  );

  if (normalizedCourses.length >= params.totalSteps) {
    return normalizedCourses.slice(0, params.totalSteps);
  }

  const missingCount = params.totalSteps - normalizedCourses.length;
  const nowIso = new Date().toISOString();
  const insertRows: Record<string, unknown>[] = [];

  for (let i = 0; i < missingCount; i += 1) {
    const stepNumber = normalizedCourses.length + i + 1;
    const plannedStep =
      params.plannedSteps?.find((item) => item.step_number === stepNumber) ?? null;
    const title = plannedStep?.step_title?.trim() || `${params.fieldTitle} Course ${stepNumber}`;
    const description =
      plannedStep?.step_description?.trim() || `Practice step ${stepNumber} in ${params.fieldTitle}.`;
    const objective = plannedStep?.learning_objective?.trim();
    const mergedDescription = objective ? `${description} Objective: ${objective}` : description;
    insertRows.push({
      learning_field_id: params.learningFieldId,
      title,
      slug: slugify(`${params.fieldTitle}-${stepNumber}`) || `course-${Date.now()}-${stepNumber}`,
      description: mergedDescription,
      estimated_minutes: 30,
      difficulty_level: normalizeCourseDifficultyForWrite(
        plannedStep?.difficulty_level || "intermediate",
      ),
      created_at: nowIso,
    });
  }

  if (insertRows.length > 0) {
    const { error: insertError } = await supabaseAdmin.from("courses").insert(insertRows);
    if (insertError) {
      throw mapSupabaseError("insert_courses", insertError, "Failed to create missing courses.");
    }
  }

  const { data: refreshedCourses, error: refreshedCoursesError } = await supabaseAdmin
    .from("courses")
    .select("*")
    .eq("learning_field_id", params.learningFieldId)
    .order("created_at", { ascending: true })
    .limit(params.totalSteps);

  if (refreshedCoursesError) {
    throw mapSupabaseError("reload_courses", refreshedCoursesError, "Failed to reload courses.");
  }

  const refreshed = (refreshedCourses ?? []) as GenericRecord[];
  if (params.plannedSteps && params.plannedSteps.length > 0) {
    for (let i = 0; i < refreshed.length; i += 1) {
      const course = refreshed[i];
      const step = params.plannedSteps.find((item) => item.step_number === i + 1);
      if (!step) {
        continue;
      }

      const existingTitle = toStringValue(course.title).trim();
      const shouldRetitle =
        !existingTitle ||
        /course\s+\d+$/i.test(existingTitle) ||
        existingTitle.toLowerCase() === `${params.fieldTitle.toLowerCase()} course ${i + 1}`;

      if (!shouldRetitle) {
        continue;
      }

      const { error: updateError } = await supabaseAdmin
        .from("courses")
        .update({
          title: step.step_title,
          description: step.step_description,
          difficulty_level: normalizeCourseDifficultyForWrite(step.difficulty_level),
        })
        .eq("id", toStringValue(course.id));
      if (updateError) {
        console.warn("[journey] align_course_with_template_failed", {
          course_id: toStringValue(course.id),
          step_number: step.step_number,
          reason: toErrorMessage(updateError),
        });
      }
    }
  }

  const { data: finalCourses, error: finalCoursesError } = await supabaseAdmin
    .from("courses")
    .select("*")
    .eq("learning_field_id", params.learningFieldId)
    .order("created_at", { ascending: true })
    .limit(params.totalSteps);

  if (finalCoursesError) {
    throw mapSupabaseError("reload_courses_final", finalCoursesError, "Failed to reload courses.");
  }

  return (finalCourses ?? []) as GenericRecord[];
}

async function findJourneyPath(params: {
  userId: string;
  learningFieldId: string;
  startingPoint: string;
  destination: string;
}) {
  const { data, error } = await supabaseAdmin
    .from("journey_paths")
    .select("*")
    .eq("user_id", params.userId)
    .eq("learning_field_id", params.learningFieldId)
    .eq("starting_point", params.startingPoint)
    .eq("destination", params.destination)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw mapSupabaseError("query_journey_path", error, "Failed to load journey paths.");
  }

  return (data as GenericRecord | null) ?? null;
}

async function ensureJourneyPathCourses(params: {
  journeyPathId: string;
  courses: GenericRecord[];
}) {
  const { data: existingRows, error: existingRowsError } = await supabaseAdmin
    .from("journey_path_courses")
    .select("*")
    .eq("journey_path_id", params.journeyPathId)
    .order("step_number", { ascending: true });

  if (existingRowsError) {
    throw mapSupabaseError(
      "query_journey_path_courses",
      existingRowsError,
      "Failed to load journey path courses.",
    );
  }

  const existing = (existingRows ?? []) as GenericRecord[];
  if (existing.length >= params.courses.length) {
    return existing;
  }

  const existingCourseIds = new Set(existing.map((row) => toStringValue(row.course_id)));
  const insertRows: Record<string, unknown>[] = [];

  params.courses.forEach((course, index) => {
    const courseId = toStringValue(course.id);
    if (!courseId || existingCourseIds.has(courseId)) {
      return;
    }

    insertRows.push({
      journey_path_id: params.journeyPathId,
      course_id: courseId,
      step_number: index + 1,
      is_required: true,
      created_at: new Date().toISOString(),
    });
  });

  if (insertRows.length > 0) {
    const { error: insertError } = await supabaseAdmin.from("journey_path_courses").insert(insertRows);
    if (insertError) {
      throw mapSupabaseError(
        "insert_journey_path_courses",
        insertError,
        "Failed to create journey path courses.",
      );
    }
  }

  const { data: refreshedRows, error: refreshedRowsError } = await supabaseAdmin
    .from("journey_path_courses")
    .select("*")
    .eq("journey_path_id", params.journeyPathId)
    .order("step_number", { ascending: true });

  if (refreshedRowsError) {
    throw mapSupabaseError(
      "reload_journey_path_courses",
      refreshedRowsError,
      "Failed to reload journey path courses.",
    );
  }

  return (refreshedRows ?? []) as GenericRecord[];
}

async function ensureUserCourseProgress(params: {
  userId: string;
  journeyPathId: string;
  pathCourses: GenericRecord[];
}) {
  const { error: rpcError } = await supabaseAdmin.rpc("initialize_journey_progress", {
    p_user_id: params.userId,
    p_journey_path_id: params.journeyPathId,
  });

  if (!rpcError) {
    return;
  }

  if (!isMissingFunctionError(rpcError, "initialize_journey_progress")) {
    throw mapSupabaseError(
      "initialize_journey_progress",
      rpcError,
      "Failed to initialize journey progress.",
    );
  }

  const { data: existingRows, error: existingRowsError } = await supabaseAdmin
    .from("user_course_progress")
    .select("*")
    .eq("user_id", params.userId)
    .eq("journey_path_id", params.journeyPathId);

  if (existingRowsError) {
    throw mapSupabaseError(
      "query_user_course_progress",
      existingRowsError,
      "Failed to load course progress.",
    );
  }

  const existing = (existingRows ?? []) as GenericRecord[];
  const progressByCourseId = new Map(
    existing.map((row) => [toStringValue(row.course_id), row]),
  );

  const insertRows: Record<string, unknown>[] = [];
  params.pathCourses.forEach((pathCourse, index) => {
    const courseId = toStringValue(pathCourse.course_id);
    if (!courseId || progressByCourseId.has(courseId)) {
      return;
    }

    insertRows.push({
      user_id: params.userId,
      journey_path_id: params.journeyPathId,
      course_id: courseId,
      status: index === 0 ? "unlocked" : "locked",
    });
  });

  if (insertRows.length > 0) {
    const { error: insertError } = await supabaseAdmin.from("user_course_progress").insert(insertRows);
    if (insertError) {
      throw mapSupabaseError(
        "insert_user_course_progress",
        insertError,
        "Failed to initialize course progress.",
      );
    }
  }
}

export async function generateOrGetJourney(params: {
  userId: string;
  learningFieldId: string;
  startingPoint: string;
  destination: string;
  desiredTotalSteps?: number | null;
}) {
  logJourneyStep("generate:start", {
    user_id: params.userId,
    learning_field_id: params.learningFieldId,
  });

  if (!params.startingPoint.trim()) {
    throw createJourneyError({
      step: "read_starting_point",
      code: "MISSING_STARTING_POINT",
      status: 400,
      message: "starting_point is required.",
    });
  }

  if (!params.destination.trim()) {
    throw createJourneyError({
      step: "read_destination",
      code: "MISSING_DESTINATION",
      status: 400,
      message: "destination is required.",
    });
  }

  logJourneyStep("read_user_selection", {
    starting_point: params.startingPoint,
    destination: params.destination,
  });

  logJourneyStep("read_learning_field:before", {
    learning_field_id: params.learningFieldId,
  });
  const learningField = await getLearningFieldById(params.learningFieldId);
  if (!learningField) {
    throw createJourneyError({
      step: "read_learning_field",
      code: "MISSING_LEARNING_FIELD",
      status: 404,
      message: "Learning field not found.",
      details: {
        learning_field_id: params.learningFieldId,
      },
    });
  }
  logJourneyStep("read_learning_field:after", {
    learning_field_id: params.learningFieldId,
    title: getFieldTitle(learningField),
  });

  const normalizedCurrentLevel = normalizeLearningLevel(params.startingPoint) as LearningLevel | null;
  const normalizedTargetLevel = normalizeLearningLevel(params.destination) as LearningLevel | null;
  const fallbackTotalSteps = calculateTotalSteps(
    normalizedCurrentLevel ?? params.startingPoint,
    normalizedTargetLevel ?? params.destination,
  );
  const fieldTitle = getFieldTitle(learningField);
  const preferenceProfile = await loadUserResourcePreferenceProfile(params.userId);
  const journeyTemplate = await resolveOrCreateJourneyTemplate({
    userId: params.userId,
    learningFieldId: params.learningFieldId,
    fieldTitle,
    startLevel: normalizedCurrentLevel ?? params.startingPoint,
    targetLevel: normalizedTargetLevel ?? params.destination,
    desiredTotalSteps: params.desiredTotalSteps ?? null,
    userPreferenceProfile: preferenceProfile,
  });
  const totalSteps = Math.max(
    1,
    journeyTemplate.total_steps ||
      (params.desiredTotalSteps && Number.isFinite(params.desiredTotalSteps)
        ? Math.floor(params.desiredTotalSteps)
        : fallbackTotalSteps),
  );
  logJourneyStep("build_ordered_journey_steps:total_steps", {
    total_steps: totalSteps,
    normalized_current_level: normalizedCurrentLevel ?? null,
    normalized_target_level: normalizedTargetLevel ?? null,
    template_id: journeyTemplate.template_id,
    template_reused: journeyTemplate.reused_existing,
  });

  logJourneyStep("query_courses:before", {
    learning_field_id: params.learningFieldId,
    total_steps: totalSteps,
  });
  const courseRows = await ensureCoursesForField({
    learningFieldId: params.learningFieldId,
    totalSteps,
    fieldTitle,
    plannedSteps: journeyTemplate.steps,
  });
  logJourneyStep("query_courses:after", {
    courses_count: courseRows.length,
  });

  if (courseRows.length === 0) {
    throw createJourneyError({
      step: "query_courses",
      code: "MISSING_COURSE_DATA",
      status: 409,
      message: "No courses are available for this learning field.",
      details: {
        learning_field_id: params.learningFieldId,
      },
    });
  }

  logJourneyStep("query_journey_mapping:before", {
    user_id: params.userId,
    learning_field_id: params.learningFieldId,
  });
  let journeyPath = await findJourneyPath(params);
  logJourneyStep("query_journey_mapping:after", {
    user_id: params.userId,
    learning_field_id: params.learningFieldId,
    found_existing_journey: Boolean(journeyPath),
    existing_journey_path_id: toStringValue(journeyPath?.id) || null,
  });

  if (!journeyPath) {
    logJourneyStep("initialization_started", {
      user_id: params.userId,
      learning_field_id: params.learningFieldId,
      reason: "missing_journey_mapping",
    });
    const { data: createdJourney, error: createdJourneyError } = await supabaseAdmin
      .from("journey_paths")
      .insert({
        user_id: params.userId,
        learning_field_id: params.learningFieldId,
        starting_point: params.startingPoint,
        destination: params.destination,
        total_steps: totalSteps,
        created_at: new Date().toISOString(),
      })
      .select("*")
      .limit(1)
      .maybeSingle();

    if (createdJourneyError || !createdJourney) {
      throw mapSupabaseError(
        "insert_journey_path",
        createdJourneyError,
        "Failed to create journey path.",
      );
    }

    journeyPath = createdJourney as GenericRecord;
    logJourneyStep("insert_journey_path:after", {
      user_id: params.userId,
      journey_path_id: toStringValue(journeyPath.id),
    });
  } else {
    logJourneyStep("initialization_existing_journey_reused", {
      user_id: params.userId,
      learning_field_id: params.learningFieldId,
      journey_path_id: toStringValue(journeyPath.id),
    });
  }

  const journeyPathId = toStringValue(journeyPath.id);
  logJourneyStep("build_journey_sequence:before", {
    journey_path_id: journeyPathId,
  });
  const pathCourses = await ensureJourneyPathCourses({
    journeyPathId,
    courses: courseRows,
  });
  await ensureUserCourseProgress({
    userId: params.userId,
    journeyPathId,
    pathCourses,
  });
  logJourneyStep("build_journey_sequence:after", {
    path_courses_count: pathCourses.length,
  });

  const journeyPayload = await getJourneyById({
    userId: params.userId,
    journeyPathId,
  });
  await instantiateUserLearningJourney({
    userId: params.userId,
    journeyPathId,
    learningFieldId: params.learningFieldId,
    startLevel: normalizedCurrentLevel ?? params.startingPoint,
    targetLevel: normalizedTargetLevel ?? params.destination,
    totalSteps: journeyPayload.total_steps,
    currentStep: journeyPayload.current_step,
    template: journeyTemplate,
  });
  logJourneyStep("generate:return", {
    user_id: params.userId,
    journey_path_id: journeyPayload.journey_path_id,
    total_steps: journeyPayload.total_steps,
    current_step: journeyPayload.current_step,
  });

  return journeyPayload;
}

export async function getJourneyById(params: {
  userId: string;
  journeyPathId: string;
}): Promise<JourneyPayload> {
  const { data: journeyPath, error: journeyPathError } = await supabaseAdmin
    .from("journey_paths")
    .select("*")
    .eq("id", params.journeyPathId)
    .eq("user_id", params.userId)
    .limit(1)
    .maybeSingle();

  if (journeyPathError) {
    throw mapSupabaseError("read_journey_path", journeyPathError, "Failed to load journey path.");
  }

  if (!journeyPath) {
    throw createJourneyError({
      step: "read_journey_path",
      code: "MISSING_JOURNEY_PATH",
      status: 404,
      message: "Journey path not found.",
      details: {
        journey_path_id: params.journeyPathId,
      },
    });
  }

  const { data: pathCoursesRows, error: pathCoursesError } = await supabaseAdmin
    .from("journey_path_courses")
    .select("*")
    .eq("journey_path_id", params.journeyPathId)
    .order("step_number", { ascending: true });

  if (pathCoursesError) {
    throw mapSupabaseError(
      "read_journey_path_courses",
      pathCoursesError,
      "Failed to load journey path courses.",
    );
  }

  const pathCourses = (pathCoursesRows ?? []) as GenericRecord[];
  await ensureUserCourseProgress({
    userId: params.userId,
    journeyPathId: params.journeyPathId,
    pathCourses,
  });

  const courseIds = pathCourses
    .map((row) => toStringValue(row.course_id))
    .filter(Boolean);

  let courseById = new Map<string, GenericRecord>();
  if (courseIds.length > 0) {
    const { data: courseRows, error: courseRowsError } = await supabaseAdmin
      .from("courses")
      .select("*")
      .in("id", courseIds);

    if (courseRowsError) {
      throw mapSupabaseError("read_courses", courseRowsError, "Failed to load courses.");
    }

    courseById = new Map(
      ((courseRows ?? []) as GenericRecord[]).map((row) => [toStringValue(row.id), row]),
    );
  }

  const { data: progressRows, error: progressRowsError } = await supabaseAdmin
    .from("user_course_progress")
    .select("*")
    .eq("user_id", params.userId)
    .eq("journey_path_id", params.journeyPathId);

  if (progressRowsError) {
    throw mapSupabaseError(
      "read_user_course_progress",
      progressRowsError,
      "Failed to load course progress.",
    );
  }

  const progressByCourseId = new Map(
    ((progressRows ?? []) as GenericRecord[]).map((row) => [toStringValue(row.course_id), row]),
  );

  const bestScoreByCourseId = new Map<string, number>();
  if (courseIds.length > 0) {
    const { data: aiTestRows, error: aiTestRowsError } = await supabaseAdmin
      .from("ai_user_tests")
      .select("course_id, earned_score")
      .eq("user_id", params.userId)
      .eq("status", "graded")
      .in("course_id", courseIds);

    if (aiTestRowsError) {
      console.warn("[journey] read_ai_test_scores_failed", {
        user_id: params.userId,
        journey_path_id: params.journeyPathId,
        reason: toErrorMessage(aiTestRowsError),
      });
    } else {
      for (const row of (aiTestRows ?? []) as GenericRecord[]) {
        const courseId = toStringValue(row.course_id);
        if (!courseId) {
          continue;
        }
        const score = Math.max(0, Math.floor(toNumberValue(row.earned_score)));
        const existing = bestScoreByCourseId.get(courseId) ?? 0;
        if (score > existing) {
          bestScoreByCourseId.set(courseId, score);
        }
      }
    }
  }

  const nodes: JourneyNode[] = pathCourses.map((pathCourse, index) => {
    const courseId = toStringValue(pathCourse.course_id);
    const progress = progressByCourseId.get(courseId);
    const status = normalizeStatus(progress?.status ?? (index === 0 ? "unlocked" : "locked"));
    const bestTestScoreValue = Math.max(
      toNumberValue(progress?.best_test_score),
      bestScoreByCourseId.get(courseId) ?? 0,
    );

    return {
      step_number: Math.max(1, Math.floor(toNumberValue(pathCourse.step_number) || index + 1)),
      course_id: courseId,
      title: getCourseTitle(courseById.get(courseId) ?? null, `Course ${index + 1}`),
      status,
      passed_score: bestTestScoreValue > 0 ? bestTestScoreValue : null,
    };
  });

  let currentStep = 1;
  const currentNode = nodes.find(
    (node) =>
      node.status === "in_progress" ||
      node.status === "unlocked" ||
      node.status === "ready_for_test",
  );
  if (currentNode) {
    currentStep = currentNode.step_number;
  } else if (nodes.length > 0 && nodes.every((node) => node.status === "passed")) {
    currentStep = nodes.length;
  }

  return {
    journey_path_id: toStringValue(journeyPath.id),
    total_steps: nodes.length,
    current_step: currentStep,
    learning_field_id: toStringValue(journeyPath.learning_field_id),
    nodes,
  };
}

async function ensureThreeResources(params: {
  userId: string;
  journeyPathId: string;
  learningFieldTitle: string;
  courseId: string;
  courseTitle: string;
}) {
  let step = "fetch_course_resources";

  try {
    const preferenceProfile = await loadUserResourcePreferenceProfile(params.userId);
    await ensureCourseResourceOptions({
      userId: params.userId,
      courseId: params.courseId,
      courseTitle: params.courseTitle,
      learningFieldTitle: params.learningFieldTitle,
      preferenceProfile,
    });

    logCourseDetailsStep("fetch_course_resources:before", {
      course_id: params.courseId,
      with_is_active_filter: true,
    });

    let resourceRows: GenericRecord[] = [];
    let hasIsActiveColumn = true;
    const { data: existingResources, error: existingResourcesError } = await supabaseAdmin
      .from("course_resources")
      .select("*")
      .eq("course_id", params.courseId)
      .eq("is_active", true)
      .order("display_order", { ascending: true });

    if (existingResourcesError) {
      if (isMissingColumnError(existingResourcesError, "course_resources", "is_active")) {
        hasIsActiveColumn = false;
        logCourseDetailsStep("fetch_course_resources:retry_without_is_active", {
          course_id: params.courseId,
          reason: toErrorMessage(existingResourcesError),
        });

        const { data: fallbackResources, error: fallbackResourcesError } = await supabaseAdmin
          .from("course_resources")
          .select("*")
          .eq("course_id", params.courseId)
          .order("display_order", { ascending: true });

        if (fallbackResourcesError) {
          throw createCourseDetailsError({
            step,
            message: "Failed to load course resources.",
            details: {
              reason: toErrorMessage(fallbackResourcesError),
              course_id: params.courseId,
            },
            cause: fallbackResourcesError,
          });
        }

        resourceRows = (fallbackResources ?? []) as GenericRecord[];
      } else {
        throw createCourseDetailsError({
          step,
          message: "Failed to load course resources.",
          details: {
            reason: toErrorMessage(existingResourcesError),
            course_id: params.courseId,
          },
          cause: existingResourcesError,
        });
      }
    } else {
      resourceRows = (existingResources ?? []) as GenericRecord[];
    }

    logCourseDetailsStep("fetch_course_resources:after", {
      course_id: params.courseId,
      count: resourceRows.length,
      used_is_active_filter: hasIsActiveColumn,
    });

    const normalized = resourceRows;
    if (normalized.length >= 3) {
      return normalized.slice(0, 3);
    }

    const templates = await ensureCourseResourceOptions({
      userId: params.userId,
      courseId: params.courseId,
      courseTitle: params.courseTitle,
      learningFieldTitle: params.learningFieldTitle,
      preferenceProfile,
    });
    logCourseDetailsStep("insert_default_course_resources:after", {
      course_id: params.courseId,
      rows: templates.options.length,
    });

    step = "reload_course_resources";
    logCourseDetailsStep("reload_course_resources:before", {
      course_id: params.courseId,
      with_is_active_filter: hasIsActiveColumn,
    });

    let refreshedResources: GenericRecord[] = [];
    if (hasIsActiveColumn) {
      const { data, error } = await supabaseAdmin
        .from("course_resources")
        .select("*")
        .eq("course_id", params.courseId)
        .eq("is_active", true)
        .order("display_order", { ascending: true })
        .limit(3);

      if (error) {
        throw createCourseDetailsError({
          step,
          message: "Failed to reload resources.",
          details: {
            reason: toErrorMessage(error),
            course_id: params.courseId,
          },
          cause: error,
        });
      }

      refreshedResources = (data ?? []) as GenericRecord[];
    } else {
      const { data, error } = await supabaseAdmin
        .from("course_resources")
        .select("*")
        .eq("course_id", params.courseId)
        .order("display_order", { ascending: true })
        .limit(3);

      if (error) {
        throw createCourseDetailsError({
          step,
          message: "Failed to reload resources.",
          details: {
            reason: toErrorMessage(error),
            course_id: params.courseId,
          },
          cause: error,
        });
      }

      refreshedResources = (data ?? []) as GenericRecord[];
    }

    const options = templates.options;
    const optionByOrder = new Map<number, string>();
    options.forEach((option) => {
      optionByOrder.set(option.option_no, option.id);
    });
    refreshedResources.forEach((row) => {
      const displayOrder = Math.max(1, Math.floor(toNumberValue(row.display_order) || 1));
      if (optionByOrder.has(displayOrder)) {
        row.resource_option_id = optionByOrder.get(displayOrder) ?? null;
      }
    });

    const sorted = sortResourceOptionsByPreference(
      refreshedResources.map((row, index) => ({
        id: toStringValue(row.id),
        course_id: params.courseId,
        option_no: Math.max(1, Math.floor(toNumberValue(row.display_order) || index + 1)),
        title: toStringValue(row.title) || `Resource ${index + 1}`,
        resource_type: (toStringValue(row.resource_type) || "tutorial") as
          | "video"
          | "article"
          | "tutorial"
          | "document"
          | "interactive",
        provider_name: toStringValue(row.provider_name) || "Pathly",
        url: toStringValue(row.url),
        description: toNullableString(row.description),
      })),
      preferenceProfile,
    );
    const rankById = new Map<string, number>();
    sorted.forEach((item, index) => {
      rankById.set(item.id, index + 1);
    });
    refreshedResources.sort((a, b) => {
      const rankA = rankById.get(toStringValue(a.id)) ?? 999;
      const rankB = rankById.get(toStringValue(b.id)) ?? 999;
      if (rankA !== rankB) {
        return rankA - rankB;
      }
      return (
        Math.max(1, Math.floor(toNumberValue(a.display_order) || 1)) -
        Math.max(1, Math.floor(toNumberValue(b.display_order) || 1))
      );
    });

    logCourseDetailsStep("reload_course_resources:after", {
      course_id: params.courseId,
      count: refreshedResources.length,
    });

    return refreshedResources;
  } catch (error) {
    const normalizedError = isCourseDetailsError(error)
      ? error
      : createCourseDetailsError({
          step,
          message: "Failed to prepare course resources.",
          details: {
            reason: toErrorMessage(error),
            course_id: params.courseId,
          },
          cause: error,
        });

    console.error("[course_details] ensureThreeResources:failed", {
      step: normalizedError.step,
      message: normalizedError.message,
      details: normalizedError.details,
      stack: normalizedError.stack,
      cause_message: toErrorMessage(error),
    });

    throw normalizedError;
  }
}

export async function getCourseDetails(params: {
  userId: string;
  journeyPathId: string;
  courseId: string;
}): Promise<CourseDetailsPayload> {
  let step = "fetch_course_row";

  try {
    logCourseDetailsStep("fetch_course_row:before", {
      course_id: params.courseId,
      user_id: params.userId,
      journey_path_id: params.journeyPathId,
    });

    const { data: courseRow, error: courseRowError } = await supabaseAdmin
      .from("courses")
      .select("*")
      .eq("id", params.courseId)
      .limit(1)
      .maybeSingle();

    if (courseRowError) {
      throw createCourseDetailsError({
        step,
        message: "Failed to load course.",
        details: {
          reason: toErrorMessage(courseRowError),
          course_id: params.courseId,
        },
        cause: courseRowError,
      });
    }

    if (!courseRow) {
      throw createCourseDetailsError({
        step,
        message: "Course not found.",
        details: {
          course_id: params.courseId,
        },
      });
    }

    logCourseDetailsStep("fetch_course_row:after", {
      course_id: params.courseId,
      title: getCourseTitle(courseRow as GenericRecord),
    });

    const courseLearningFieldId = toStringValue((courseRow as GenericRecord).learning_field_id);
    let learningFieldTitle = "Learning";
    if (courseLearningFieldId) {
      const { data: learningFieldRow } = await supabaseAdmin
        .from("learning_fields")
        .select("id, title, name")
        .eq("id", courseLearningFieldId)
        .limit(1)
        .maybeSingle();
      learningFieldTitle = getFieldTitle((learningFieldRow as GenericRecord | null) ?? null);
    }

    step = "fetch_course_progress";
    logCourseDetailsStep("fetch_course_progress:before", {
      user_id: params.userId,
      journey_path_id: params.journeyPathId,
      course_id: params.courseId,
    });
    const progressRow = await ensureProgressRowForCourse({
      userId: params.userId,
      journeyPathId: params.journeyPathId,
      courseId: params.courseId,
    });
    logCourseDetailsStep("fetch_course_progress:after", {
      status: normalizeStatus(progressRow?.status ?? "locked"),
      has_progress_row: Boolean(progressRow),
    });

    step = "fetch_course_resources";
    const resources = await ensureThreeResources({
      userId: params.userId,
      journeyPathId: params.journeyPathId,
      learningFieldTitle,
      courseId: params.courseId,
      courseTitle: getCourseTitle(courseRow as GenericRecord),
    });
    const resourceIds = resources.map((resource) => toStringValue(resource.id)).filter(Boolean);

    logCourseDetailsStep("fetch_course_resources:after", {
      course_id: params.courseId,
      resource_count: resources.length,
      resource_ids_count: resourceIds.length,
    });

    step = "fetch_resource_ratings";
    logCourseDetailsStep("fetch_resource_ratings:before", {
      resource_ids_count: resourceIds.length,
    });
    let ratingRows: GenericRecord[] = [];
    if (resourceIds.length > 0) {
      const { data, error: ratingRowsError } = await supabaseAdmin
        .from("resource_ratings")
        .select("*")
        .in("resource_id", resourceIds);

      if (ratingRowsError) {
        throw createCourseDetailsError({
          step,
          message: "Failed to load resource ratings.",
          details: {
            reason: toErrorMessage(ratingRowsError),
            resource_ids_count: resourceIds.length,
          },
          cause: ratingRowsError,
        });
      }

      ratingRows = (data ?? []) as GenericRecord[];
    }
    logCourseDetailsStep("fetch_resource_ratings:after", {
      rating_count: ratingRows.length,
    });

    step = "fetch_resource_comments";
    logCourseDetailsStep("fetch_resource_comments:before", {
      resource_ids_count: resourceIds.length,
    });
    let commentRows: GenericRecord[] = [];
    if (resourceIds.length > 0) {
      const { data, error: loadedCommentsError } = await supabaseAdmin
        .from("resource_comments")
        .select("*")
        .in("resource_id", resourceIds)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false });

      if (loadedCommentsError) {
        throw createCourseDetailsError({
          step,
          message: "Failed to load resource comments.",
          details: {
            reason: toErrorMessage(loadedCommentsError),
            resource_ids_count: resourceIds.length,
          },
          cause: loadedCommentsError,
        });
      }

      commentRows = (data ?? []) as GenericRecord[];
    }
    logCourseDetailsStep("fetch_resource_comments:after", {
      comment_count: commentRows.length,
    });

    const comments = commentRows;
    const commentUserIds = Array.from(
      new Set(comments.map((comment) => toStringValue(comment.user_id)).filter(Boolean)),
    );

    let usernameById = new Map<string, string>();
    if (commentUserIds.length > 0) {
      const { data: userRows, error: userRowsError } = await supabaseAdmin
        .from("users")
        .select("id, username")
        .in("id", commentUserIds);

      if (!userRowsError) {
        usernameById = new Map(
          ((userRows ?? []) as GenericRecord[]).map((row) => [
            toStringValue(row.id),
            toStringValue(row.username),
          ]),
        );
      }
    }

    step = "compose_course_response_payload";
    logCourseDetailsStep("compose_course_response_payload:before", {
      resource_count: resources.length,
      rating_count: ratingRows.length,
      comment_count: comments.length,
    });

    const ratingsByResourceId = new Map<string, GenericRecord[]>();
    ratingRows.forEach((rating) => {
      const resourceId = toStringValue(rating.resource_id);
      if (!ratingsByResourceId.has(resourceId)) {
        ratingsByResourceId.set(resourceId, []);
      }
      ratingsByResourceId.get(resourceId)?.push(rating);
    });

    const commentsByResourceId = new Map<string, GenericRecord[]>();
    comments.forEach((comment) => {
      const resourceId = toStringValue(comment.resource_id);
      if (!commentsByResourceId.has(resourceId)) {
        commentsByResourceId.set(resourceId, []);
      }
      commentsByResourceId.get(resourceId)?.push(comment);
    });

    const preferenceProfile = await loadUserResourcePreferenceProfile(params.userId);
    const pendingReview = await getPendingReviewPopup({
      userId: params.userId,
      journeyPathId: params.journeyPathId,
      nextCourseId: params.courseId,
    });

    const resourcesPayload: CourseResourcePayload[] = resources.map((resource) => {
      const resourceId = toStringValue(resource.id);
      const ratings = ratingsByResourceId.get(resourceId) ?? [];
      const commentsForResource = commentsByResourceId.get(resourceId) ?? [];

      const averageRating =
        ratings.length === 0
          ? 0
          : Number(
              (
                ratings.reduce((sum, rating) => sum + toNumberValue(rating.rating), 0) /
                ratings.length
              ).toFixed(1),
            );

      const myRatingRecord = ratings.find(
        (rating) => toStringValue(rating.user_id) === params.userId,
      );

      return {
        id: resourceId,
        resource_option_id: toNullableString(resource.resource_option_id),
        title: toStringValue(resource.title) || "Untitled Resource",
        resource_type: toStringValue(resource.resource_type) || "tutorial",
        provider_name: toStringValue(resource.provider_name) || "Pathly",
        url: toStringValue(resource.url),
        description: toNullableString(resource.description),
        average_rating: averageRating,
        comment_count: commentsForResource.length,
        my_rating: myRatingRecord ? toNumberValue(myRatingRecord.rating) : null,
        comment_previews: commentsForResource.slice(0, 2).map((comment) => ({
          id: toStringValue(comment.id),
          comment_text: toStringValue(comment.comment_text),
          created_at: toStringValue(comment.created_at),
          username: usernameById.get(toStringValue(comment.user_id)) ?? null,
        })),
      };
    });

    const payload: CourseDetailsPayload = {
      id: toStringValue((courseRow as GenericRecord).id),
      journey_path_id: params.journeyPathId,
      title: getCourseTitle(courseRow as GenericRecord),
      description: toNullableString((courseRow as GenericRecord).description),
      estimated_minutes: toNumberValue((courseRow as GenericRecord).estimated_minutes) || null,
      difficulty_level: normalizeCourseDifficulty((courseRow as GenericRecord).difficulty_level),
      skill_tags: [],
      status: normalizeStatus(progressRow?.status ?? "locked"),
      last_test_score:
        toNumberValue(progressRow?.last_test_score) > 0
          ? toNumberValue(progressRow?.last_test_score)
          : null,
      best_test_score:
        toNumberValue(progressRow?.best_test_score) > 0
          ? toNumberValue(progressRow?.best_test_score)
          : null,
      attempt_count: Math.max(0, Math.floor(toNumberValue(progressRow?.attempt_count))),
      passed_at: toNullableString(progressRow?.passed_at),
      last_activity_at: toNullableString(progressRow?.last_activity_at),
      ready_for_test_at: toNullableString(progressRow?.ready_for_test_at),
      current_test_attempt_id: toNullableString(progressRow?.current_test_attempt_id),
      required_test_score: 80,
      can_take_test: (() => {
        const status = normalizeStatus(progressRow?.status ?? "locked");
        return status === "in_progress" || status === "ready_for_test" || status === "passed";
      })(),
      review_popup: {
        should_show: pendingReview.should_show,
        review_session_id: pendingReview.review_session_id,
        score_at_trigger: pendingReview.score_at_trigger,
        question_count: pendingReview.questions.length,
      },
      user_resource_preferences: preferenceProfile.signals.map((signal) => ({
        resource_type: signal.resource_type,
        weighted_score: signal.weighted_score,
        confidence: signal.confidence,
      })),
      resources: resourcesPayload,
    };

    logCourseDetailsStep("compose_course_response_payload:after", {
      resources_count: payload.resources.length,
      status: payload.status,
    });

    return payload;
  } catch (error) {
    const normalizedError = isCourseDetailsError(error)
      ? error
      : createCourseDetailsError({
          step,
          message: "Unable to build course details.",
          details: {
            reason: toErrorMessage(error),
            course_id: params.courseId,
            journey_path_id: params.journeyPathId,
            user_id: params.userId,
          },
          cause: error,
        });

    console.error("[course_details] getCourseDetails:failed", {
      step: normalizedError.step,
      message: normalizedError.message,
      details: normalizedError.details,
      stack: normalizedError.stack,
      cause_message: toErrorMessage(error),
    });

    throw normalizedError;
  }
}

export async function startCourseProgress(params: {
  userId: string;
  journeyPathId: string;
  courseId: string;
  selectedResourceId: string;
}) {
  let step = "read_payload";

  try {
    logStartCourseStep("read_payload", {
      user_id: params.userId,
      journey_path_id: params.journeyPathId,
      course_id: params.courseId,
      selected_resource_id: params.selectedResourceId,
    });

    step = "fetch_progress_row";
    logStartCourseStep("fetch_progress_row:before", {
      user_id: params.userId,
      journey_path_id: params.journeyPathId,
      course_id: params.courseId,
    });
    const progressRow = await ensureProgressRowForCourse({
      userId: params.userId,
      journeyPathId: params.journeyPathId,
      courseId: params.courseId,
    });

    const status = normalizeStatus((progressRow as GenericRecord).status);
    logStartCourseStep("fetch_progress_row:after", {
      progress_id: toStringValue((progressRow as GenericRecord).id),
      status,
      selected_resource_id: toNullableString((progressRow as GenericRecord).selected_resource_id),
      started_at: toNullableString((progressRow as GenericRecord).started_at),
    });

    if (status === "locked") {
      return {
        ok: false as const,
        message: "Please complete previous courses",
      };
    }

    step = "fetch_resource_row";
    logStartCourseStep("fetch_resource_row:before", {
      selected_resource_id: params.selectedResourceId,
      course_id: params.courseId,
      with_is_active_filter: true,
    });

    let resourceRow: GenericRecord | null = null;
    const { data: activeResourceRow, error: activeResourceRowError } = await supabaseAdmin
      .from("course_resources")
      .select("*")
      .eq("id", params.selectedResourceId)
      .eq("course_id", params.courseId)
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();

    if (activeResourceRowError) {
      if (isMissingColumnError(activeResourceRowError, "course_resources", "is_active")) {
        logStartCourseStep("fetch_resource_row:retry_without_is_active", {
          reason: toErrorMessage(activeResourceRowError),
        });

        const { data: fallbackResourceRow, error: fallbackResourceRowError } = await supabaseAdmin
          .from("course_resources")
          .select("*")
          .eq("id", params.selectedResourceId)
          .eq("course_id", params.courseId)
          .limit(1)
          .maybeSingle();

        if (fallbackResourceRowError) {
          throw createStartCourseError({
            step,
            message: "Failed to load selected resource.",
            details: {
              reason: toErrorMessage(fallbackResourceRowError),
              selected_resource_id: params.selectedResourceId,
              course_id: params.courseId,
            },
            cause: fallbackResourceRowError,
          });
        }

        resourceRow = (fallbackResourceRow as GenericRecord | null) ?? null;
      } else {
        throw createStartCourseError({
          step,
          message: "Failed to load selected resource.",
          details: {
            reason: toErrorMessage(activeResourceRowError),
            selected_resource_id: params.selectedResourceId,
            course_id: params.courseId,
          },
          cause: activeResourceRowError,
        });
      }
    } else {
      resourceRow = (activeResourceRow as GenericRecord | null) ?? null;
    }

    if (!resourceRow) {
      throw createStartCourseError({
        step,
        message: "Selected resource not found.",
        details: {
          selected_resource_id: params.selectedResourceId,
          course_id: params.courseId,
        },
      });
    }

    logStartCourseStep("fetch_resource_row:after", {
      resource_id: toStringValue(resourceRow.id),
      course_id: toStringValue(resourceRow.course_id),
      resource_url: toStringValue(resourceRow.url),
    });

    step = "start_learning_course_rpc";
    logStartCourseStep("start_learning_course_rpc:before", {
      user_id: params.userId,
      journey_path_id: params.journeyPathId,
      course_id: params.courseId,
      selected_resource_id: params.selectedResourceId,
      status_before: status,
    });

    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc("start_learning_course", {
      p_user_id: params.userId,
      p_journey_path_id: params.journeyPathId,
      p_course_id: params.courseId,
      p_selected_resource_id: params.selectedResourceId,
    });

    if (rpcError) {
      throw createStartCourseError({
        step,
        message: "Failed to start course.",
        details: {
          reason: toErrorMessage(rpcError),
          user_id: params.userId,
          journey_path_id: params.journeyPathId,
          course_id: params.courseId,
          selected_resource_id: params.selectedResourceId,
        },
        cause: rpcError,
      });
    }

    const rpcRecordRaw = Array.isArray(rpcData) ? (rpcData[0] as GenericRecord | undefined) : (rpcData as GenericRecord | null);
    const rpcRecord = rpcRecordRaw ?? {};
    const rpcResourceUrl =
      toStringValue(rpcRecord.resource_url) ||
      toStringValue(rpcRecord.selected_resource_url) ||
      toStringValue(rpcRecord.url);

    logStartCourseStep("start_learning_course_rpc:after", {
      status: toStringValue(rpcRecord.status),
      selected_resource_id:
        toNullableString(rpcRecord.selected_resource_id) ?? params.selectedResourceId,
      started_at: toNullableString(rpcRecord.started_at),
      last_activity_at: toNullableString(rpcRecord.last_activity_at),
      resource_url_from_rpc: rpcResourceUrl,
    });

    const resourceUrl = (rpcResourceUrl || toStringValue(resourceRow.url)).trim();
    if (!resourceUrl) {
      throw createStartCourseError({
        step: "validate_resource_url",
        message: "Selected resource URL is missing.",
        details: {
          selected_resource_id: params.selectedResourceId,
          course_id: params.courseId,
        },
      });
    }

    await recordUserResourceSelection({
      userId: params.userId,
      journeyPathId: params.journeyPathId,
      courseId: params.courseId,
      legacyResourceId: params.selectedResourceId,
    });

    logStartCourseStep("return_success", {
      resource_url: resourceUrl,
    });

    return {
      ok: true as const,
      resource_url: resourceUrl,
    };
  } catch (error) {
    const normalizedError = isStartCourseError(error)
      ? error
      : createStartCourseError({
          step,
          message: "Unable to start course.",
          details: {
            reason: toErrorMessage(error),
            user_id: params.userId,
            journey_path_id: params.journeyPathId,
            course_id: params.courseId,
            selected_resource_id: params.selectedResourceId,
          },
          cause: error,
        });

    console.error("[start_course] failed", {
      step: normalizedError.step,
      message: normalizedError.message,
      details: normalizedError.details,
      stack: normalizedError.stack,
      cause_message: toErrorMessage(error),
    });

    throw normalizedError;
  }
}

export type CourseTestQuestion = {
  id: string;
  question_order: number;
  question_text: string;
  prompt: string;
  question_type: "single_choice" | "fill_blank" | "essay";
  options: string[];
  score: number;
};

export type CourseTestPayload = {
  course_id: string;
  journey_path_id: string;
  user_test_id: string;
  test_attempt_id: string;
  status: CourseNodeStatus;
  required_score: number;
  questions: CourseTestQuestion[];
};

export type QuestionResultStatus = "correct" | "partial" | "incorrect";

export type CourseTestSubmitResult = {
  user_test_id: string;
  attempt_number: number;
  total_score: number;
  earned_score: number;
  score: number;
  pass_status: "passed" | "failed";
  passed: boolean;
  required_score: number;
  course_completed: boolean;
  attempt_count: number;
  last_test_score: number;
  best_test_score: number | null;
  completion_awarded: boolean;
  feedback_summary: string;
  graded_at: string;
  review_required?: boolean;
  review_session_id?: string | null;
  question_results: Array<{
    question_id: string;
    question_order: number;
    question_type: "single_choice" | "fill_blank" | "essay";
    question_text: string;
    concept_tag: string | null;
    skill_tag: string | null;
    user_answer: string;
    correct_answer: string;
    is_correct: boolean;
    earned_score: number;
    max_score: number;
    result_status: QuestionResultStatus;
    explanation: string;
  }>;
  journey: JourneyPayload;
};

function parseJsonValue(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed;
    }
  }

  return value;
}

async function ensureProgressRowForCourse(params: {
  userId: string;
  journeyPathId: string;
  courseId: string;
}) {
  const { data: existingProgress, error: existingProgressError } = await supabaseAdmin
    .from("user_course_progress")
    .select("*")
    .eq("user_id", params.userId)
    .eq("journey_path_id", params.journeyPathId)
    .eq("course_id", params.courseId)
    .limit(1)
    .maybeSingle();

  if (existingProgressError) {
    throw new Error("Failed to load course progress.");
  }

  if (existingProgress) {
    return existingProgress as GenericRecord;
  }

  const { error: initError } = await supabaseAdmin.rpc("initialize_journey_progress", {
    p_user_id: params.userId,
    p_journey_path_id: params.journeyPathId,
  });

  if (!initError) {
    const { data: initializedProgress, error: initializedProgressError } = await supabaseAdmin
      .from("user_course_progress")
      .select("*")
      .eq("user_id", params.userId)
      .eq("journey_path_id", params.journeyPathId)
      .eq("course_id", params.courseId)
      .limit(1)
      .maybeSingle();

    if (initializedProgressError) {
      throw new Error("Failed to load course progress.");
    }

    if (initializedProgress) {
      return initializedProgress as GenericRecord;
    }
  } else if (!isMissingFunctionError(initError, "initialize_journey_progress")) {
    throw new Error("Failed to initialize journey progress.");
  }

  const { data: pathCoursesRows, error: pathCoursesError } = await supabaseAdmin
    .from("journey_path_courses")
    .select("*")
    .eq("journey_path_id", params.journeyPathId)
    .order("step_number", { ascending: true });

  if (pathCoursesError) {
    throw new Error("Failed to load journey path courses.");
  }

  const pathCourses = (pathCoursesRows ?? []) as GenericRecord[];
  const targetIndex = pathCourses.findIndex(
    (row) => toStringValue(row.course_id) === params.courseId,
  );

  if (targetIndex < 0) {
    throw new Error("Course not in journey.");
  }

  let nextStatus: CourseNodeStatus = targetIndex === 0 ? "unlocked" : "locked";
  if (targetIndex > 0) {
    const previousCourseId = toStringValue(pathCourses[targetIndex - 1]?.course_id);
    const { data: previousProgress } = await supabaseAdmin
      .from("user_course_progress")
      .select("status")
      .eq("user_id", params.userId)
      .eq("journey_path_id", params.journeyPathId)
      .eq("course_id", previousCourseId)
      .limit(1)
      .maybeSingle();

    if (normalizeStatus(previousProgress?.status) === "passed") {
      nextStatus = "unlocked";
    }
  }

  const { data: createdProgress, error: createdProgressError } = await supabaseAdmin
    .from("user_course_progress")
    .insert({
      user_id: params.userId,
      journey_path_id: params.journeyPathId,
      course_id: params.courseId,
      status: nextStatus,
      attempt_count: 0,
    })
    .select("*")
    .limit(1)
    .maybeSingle();

  if (createdProgressError || !createdProgress) {
    throw new Error("Failed to initialize course progress.");
  }

  return createdProgress as GenericRecord;
}

async function unlockNextCourse(params: {
  userId: string;
  journeyPathId: string;
  courseId: string;
}) {
  const { data: pathCoursesRows, error: pathCoursesError } = await supabaseAdmin
    .from("journey_path_courses")
    .select("*")
    .eq("journey_path_id", params.journeyPathId)
    .order("step_number", { ascending: true });

  if (pathCoursesError) {
    throw new Error("Failed to load journey path courses.");
  }

  const pathCourses = (pathCoursesRows ?? []) as GenericRecord[];
  const currentIndex = pathCourses.findIndex(
    (pathCourse) => toStringValue(pathCourse.course_id) === params.courseId,
  );

  if (currentIndex < 0) {
    return;
  }

  const nextPathCourse = pathCourses[currentIndex + 1];
  if (!nextPathCourse) {
    return;
  }

  const nextCourseId = toStringValue(nextPathCourse.course_id);
  if (!nextCourseId) {
    return;
  }

  const nextProgress = await ensureProgressRowForCourse({
    userId: params.userId,
    journeyPathId: params.journeyPathId,
    courseId: nextCourseId,
  });

  const nextStatus = normalizeStatus(nextProgress.status);
  if (nextStatus === "locked") {
    await supabaseAdmin
      .from("user_course_progress")
      .update({ status: "unlocked" })
      .eq("user_id", params.userId)
      .eq("journey_path_id", params.journeyPathId)
      .eq("course_id", nextCourseId);
  }
}

async function getResourceRowForCourse(params: {
  selectedResourceId: string;
  courseId: string;
}) {
  const { data: activeResourceRow, error: activeResourceRowError } = await supabaseAdmin
    .from("course_resources")
    .select("*")
    .eq("id", params.selectedResourceId)
    .eq("course_id", params.courseId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (activeResourceRowError) {
    if (isMissingColumnError(activeResourceRowError, "course_resources", "is_active")) {
      const { data: fallbackResourceRow, error: fallbackResourceRowError } = await supabaseAdmin
        .from("course_resources")
        .select("*")
        .eq("id", params.selectedResourceId)
        .eq("course_id", params.courseId)
        .limit(1)
        .maybeSingle();

      if (fallbackResourceRowError) {
        throw new Error("Failed to load selected resource.");
      }

      return (fallbackResourceRow as GenericRecord | null) ?? null;
    }

    throw new Error("Failed to load selected resource.");
  }

  return (activeResourceRow as GenericRecord | null) ?? null;
}

type AiTemplateQuestionType = "single_choice" | "fill_blank" | "essay";

type AiTemplateQuestion = {
  id: string;
  question_order: number;
  question_type: AiTemplateQuestionType;
  question_text: string;
  options: string[];
  correct_answer_text: string;
  acceptable_answers: string[];
  score: number;
  explanation: string | null;
  skill_tag: string | null;
  concept_tag: string | null;
};

function logAiTestStep(step: string, detail?: Record<string, unknown>) {
  if (detail) {
    console.info(`[ai_test] ${step}`, detail);
    return;
  }
  console.info(`[ai_test] ${step}`);
}

function normalizeAiQuestionType(value: unknown): AiTemplateQuestionType {
  const normalized = toStringValue(value).trim().toLowerCase();
  if (normalized === "essay") {
    return "essay";
  }
  if (normalized === "fill_blank") {
    return "fill_blank";
  }
  return "single_choice";
}

function parseAiOptions(value: unknown) {
  const parsed = parseJsonValue(value);
  if (Array.isArray(parsed)) {
    return parsed.map((item) => toStringValue(item)).filter(Boolean);
  }
  if (typeof parsed === "string") {
    return parsed
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [] as string[];
}

function parseAiAcceptableAnswers(value: unknown, fallback: string) {
  const parsed = parseJsonValue(value);
  const answers: string[] = [];
  if (Array.isArray(parsed)) {
    answers.push(...parsed.map((item) => toStringValue(item).trim()).filter(Boolean));
  } else if (typeof parsed === "string") {
    answers.push(
      ...parsed
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean),
    );
  }
  if (fallback.trim()) {
    answers.push(fallback.trim());
  }
  return Array.from(new Set(answers));
}

function normalizeQuestionResultStatus(value: unknown): QuestionResultStatus | null {
  const normalized = toStringValue(value).trim().toLowerCase();
  if (normalized === "correct" || normalized === "partial" || normalized === "incorrect") {
    return normalized;
  }
  return null;
}

function gradeEssayQuestion13(answerText: string) {
  const lowered = answerText.toLowerCase();
  const checkpoints = [
    "<!doctype html>",
    "<html",
    "<head",
    "<title",
    "<body",
    "<h1",
    "<p",
    "<a",
  ];
  const matched = checkpoints.filter((item) => lowered.includes(item));
  const earned = Math.min(20, matched.length * 2.5);
  const explanation =
    matched.length === checkpoints.length
      ? "Great structure coverage. You included all required HTML core elements."
      : `You included ${matched.length}/${checkpoints.length} required elements. Add missing core tags to strengthen your answer.`;
  return {
    earned,
    explanation,
  };
}

function gradeEssayQuestion14(answerText: string) {
  const lowered = answerText.toLowerCase();
  const listItemCount = (answerText.match(/<li\b/gi) ?? []).length;
  const checkpoints = [
    lowered.includes("<ul"),
    listItemCount >= 3,
    lowered.includes("<img"),
    lowered.includes("alt="),
    lowered.includes("<br"),
  ];
  const matchedCount = checkpoints.filter(Boolean).length;
  const earned = Math.min(20, matchedCount * 4);
  const explanation =
    matchedCount === checkpoints.length
      ? "Great work. You covered list, image accessibility, and line break requirements."
      : `You met ${matchedCount}/${checkpoints.length} rubric checks. Ensure a <ul>, at least 3 <li>, <img> with alt=, and <br> are present.`;
  return {
    earned,
    explanation,
  };
}

async function loadAiTemplateQuestions(templateId: string): Promise<AiTemplateQuestion[]> {
  logAiTestStep("template_questions_lookup:before", {
    template_id: templateId,
  });
  const { data, error } = await supabaseAdmin
    .from("ai_test_template_questions")
    .select("*")
    .eq("template_id", templateId)
    .order("question_order", { ascending: true });

  if (error) {
    throw new Error("Unable to load AI test template questions.");
  }

  const rows = (data ?? []) as GenericRecord[];
  if (rows.length === 0) {
    throw new Error("No AI test questions found for this template.");
  }

  const mapped = rows
    .map((row, index) => {
      const questionOrder = Math.max(1, Math.floor(toNumberValue(row.question_order) || index + 1));
      const questionType = normalizeAiQuestionType(row.question_type);
      const questionText = toStringValue(row.question_text) || `Question ${questionOrder}`;
      const scoreDefault = questionOrder >= 13 ? 20 : 5;
      const score = Math.max(1, Math.floor(toNumberValue(row.score) || scoreDefault));
      const correctAnswerText = toStringValue(row.correct_answer_text);

      return {
        id: toStringValue(row.id),
        question_order: questionOrder,
        question_type: questionType,
        question_text: questionText,
        options: questionType === "single_choice" ? parseAiOptions(row.options_json) : [],
        correct_answer_text: correctAnswerText,
        acceptable_answers: parseAiAcceptableAnswers(row.acceptable_answers_json, correctAnswerText),
        score,
        explanation: toNullableString(row.explanation),
        skill_tag: toNullableString(row.skill_tag),
        concept_tag: toNullableString(row.concept_tag),
      } satisfies AiTemplateQuestion;
    })
    .filter((question) => question.id && question.question_text);

  if (mapped.length === 0) {
    throw new Error("No AI test questions found for this template.");
  }

  logAiTestStep("template_questions_lookup:after", {
    template_id: templateId,
    question_count: mapped.length,
  });
  return mapped;
}

async function resolveJourneyPathIdForCourse(params: {
  userId: string;
  courseId: string;
  journeyPathId?: string | null;
}) {
  const preferred = params.journeyPathId?.trim();
  if (preferred) {
    return preferred;
  }

  const { data, error } = await supabaseAdmin
    .from("user_course_progress")
    .select("journey_path_id, status, last_activity_at, ready_for_test_at, started_at, passed_at")
    .eq("user_id", params.userId)
    .eq("course_id", params.courseId);

  if (error) {
    throw new Error("Unable to resolve journey path for this course.");
  }

  const rows = (data ?? []) as GenericRecord[];
  if (rows.length === 0) {
    throw new Error("Course progress not found.");
  }

  const statusRank = (value: unknown) => {
    const status = normalizeStatus(value);
    if (status === "in_progress") return 5;
    if (status === "ready_for_test") return 4;
    if (status === "unlocked") return 3;
    if (status === "passed") return 2;
    return 1;
  };

  const timestamp = (value: unknown) => {
    const parsed = Date.parse(toNullableString(value) ?? "");
    return Number.isFinite(parsed) ? parsed : 0;
  };

  const sorted = [...rows].sort((a, b) => {
    const rankDiff = statusRank(b.status) - statusRank(a.status);
    if (rankDiff !== 0) {
      return rankDiff;
    }
    const timeA = Math.max(
      timestamp(a.last_activity_at),
      timestamp(a.ready_for_test_at),
      timestamp(a.started_at),
      timestamp(a.passed_at),
    );
    const timeB = Math.max(
      timestamp(b.last_activity_at),
      timestamp(b.ready_for_test_at),
      timestamp(b.started_at),
      timestamp(b.passed_at),
    );
    return timeB - timeA;
  });

  const journeyPathId = toStringValue(sorted[0]?.journey_path_id);
  if (!journeyPathId) {
    throw new Error("Course progress not found.");
  }
  return journeyPathId;
}

export async function prepareCourseTest(params: {
  userId: string;
  journeyPathId: string;
  courseId: string;
  selectedResourceId?: string | null;
}): Promise<CourseTestPayload> {
  logAiTestStep("prepare:start", {
    user_id: params.userId,
    journey_path_id: params.journeyPathId,
    course_id: params.courseId,
  });

  const { data: userRow, error: userError } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("id", params.userId)
    .limit(1)
    .maybeSingle();
  if (userError || !userRow) {
    throw new Error("User not found.");
  }

  const { data: courseRow, error: courseError } = await supabaseAdmin
    .from("courses")
    .select("*")
    .eq("id", params.courseId)
    .limit(1)
    .maybeSingle();
  if (courseError || !courseRow) {
    throw new Error("Course not found.");
  }

  const progressRow = await ensureProgressRowForCourse({
    userId: params.userId,
    journeyPathId: params.journeyPathId,
    courseId: params.courseId,
  });
  const status = normalizeStatus(progressRow.status);
  if (status === "locked") {
    throw new Error("Please complete previous courses");
  }
  if (status === "unlocked") {
    throw new Error("Start learning before taking the AI test.");
  }

  let selectedResourceRow: GenericRecord | null = null;
  if (params.selectedResourceId?.trim()) {
    const resource = await getResourceRowForCourse({
      selectedResourceId: params.selectedResourceId,
      courseId: params.courseId,
    });
    if (!resource) {
      throw new Error("Selected resource not found.");
    }
    selectedResourceRow = resource;
  }

  const { data: latestAttemptRow, error: latestAttemptError } = await supabaseAdmin
    .from("ai_user_tests")
    .select("attempt_number")
    .eq("user_id", params.userId)
    .eq("course_id", params.courseId)
    .order("attempt_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestAttemptError) {
    throw new Error("Unable to load previous AI test attempts.");
  }

  const attemptNumber = Math.max(0, Math.floor(toNumberValue(latestAttemptRow?.attempt_number))) + 1;
  const resourceOptionId = await resolveResourceOptionIdFromLegacyResource({
    courseId: params.courseId,
    legacyResourceId: params.selectedResourceId ?? null,
  });

  const resolvedTemplate = await resolveAiTestTemplateForAttempt({
    userId: params.userId,
    courseId: params.courseId,
    courseTitle: getCourseTitle(courseRow as GenericRecord),
    courseDescription: toNullableString((courseRow as GenericRecord).description),
    selectedResourceOptionId: resourceOptionId,
    selectedResourceTitle: toNullableString(selectedResourceRow?.title),
    selectedResourceType: toNullableString(selectedResourceRow?.resource_type),
    attemptNumber,
  });
  const templateId = resolvedTemplate.templateId;
  const questions = await loadAiTemplateQuestions(templateId);
  logAiTestStep("template_lookup:after", {
    template_id: templateId,
    attempt_number: attemptNumber,
    difficulty_band: resolvedTemplate.difficultyBand,
    variant_no: resolvedTemplate.variantNo,
    reused_existing: resolvedTemplate.reusedExisting,
  });

  const nowIso = new Date().toISOString();

  logAiTestStep("attempt_create:before", {
    course_id: params.courseId,
    template_id: templateId,
    attempt_number: attemptNumber,
  });
  const { data: userTestRow, error: userTestError } = await supabaseAdmin
    .from("ai_user_tests")
    .insert({
      user_id: params.userId,
      course_id: params.courseId,
      template_id: templateId,
      status: "in_progress",
      started_at: nowIso,
      total_score: 100,
      attempt_number: attemptNumber,
    })
    .select("*")
    .limit(1)
    .maybeSingle();

  if (userTestError || !userTestRow) {
    throw new Error("Unable to create AI test attempt right now.");
  }

  const userTestId = toStringValue((userTestRow as GenericRecord).id);
  if (!userTestId) {
    throw new Error("Unable to create AI test attempt right now.");
  }
  logAiTestStep("attempt_create:after", {
    user_test_id: userTestId,
  });

  const { error: progressUpdateError } = await supabaseAdmin
    .from("user_course_progress")
    .update({
      status: status === "passed" ? "passed" : "ready_for_test",
      current_test_attempt_id: userTestId,
      ready_for_test_at: nowIso,
      last_activity_at: nowIso,
    })
    .eq("id", toStringValue(progressRow.id));

  if (progressUpdateError) {
    console.warn("[ai_test] progress mark ready_for_test failed", {
      user_id: params.userId,
      course_id: params.courseId,
      journey_path_id: params.journeyPathId,
      reason: toErrorMessage(progressUpdateError),
    });
  }

  return {
    course_id: params.courseId,
    journey_path_id: params.journeyPathId,
    user_test_id: userTestId,
    test_attempt_id: userTestId,
    status: status === "passed" ? "passed" : "ready_for_test",
    required_score: 60,
    questions: questions.map((question) => ({
      id: question.id,
      question_order: question.question_order,
      question_text: question.question_text,
      prompt: question.question_text,
      question_type: question.question_type,
      options: question.options,
      score: question.score,
    })),
  };
}

export async function submitCourseTest(params: {
  userId: string;
  journeyPathId?: string | null;
  courseId?: string | null;
  testAttemptId: string;
  selectedResourceId?: string | null;
  answers: Array<{
    question_id: string;
    selected_option_index?: number | null;
    answer_text?: string | null;
    user_answer_text?: string | null;
  }>;
}): Promise<CourseTestSubmitResult> {
  logAiTestStep("submit:start", {
    user_id: params.userId,
    user_test_id: params.testAttemptId,
  });

  const { data: userTestRow, error: userTestError } = await supabaseAdmin
    .from("ai_user_tests")
    .select("*")
    .eq("id", params.testAttemptId)
    .eq("user_id", params.userId)
    .limit(1)
    .maybeSingle();

  if (userTestError || !userTestRow) {
    throw new Error("Test attempt not found.");
  }

  if (toStringValue((userTestRow as GenericRecord).status).toLowerCase() === "graded") {
    throw new Error("This test attempt has already been graded.");
  }

  const courseId = params.courseId?.trim() || toStringValue((userTestRow as GenericRecord).course_id);
  if (!courseId) {
    throw new Error("Course not found.");
  }

  const templateId = toStringValue((userTestRow as GenericRecord).template_id);
  if (!templateId) {
    throw new Error("Invalid AI test attempt.");
  }

  const { data: courseRow, error: courseError } = await supabaseAdmin
    .from("courses")
    .select("id, title, description")
    .eq("id", courseId)
    .limit(1)
    .maybeSingle();
  if (courseError || !courseRow) {
    throw new Error("Course not found.");
  }

  const questions = await loadAiTemplateQuestions(templateId);
  const answerMap = new Map(
    params.answers.map((answer) => [
      answer.question_id,
      toStringValue(answer.user_answer_text ?? answer.answer_text ?? "").trim(),
    ]),
  );

  logAiTestStep("answer_save:before", {
    user_test_id: params.testAttemptId,
    answer_count: params.answers.length,
  });
  const { error: deleteAnswersError } = await supabaseAdmin
    .from("ai_user_test_answers")
    .delete()
    .eq("user_test_id", params.testAttemptId);
  if (deleteAnswersError) {
    throw new Error("Unable to save AI test answers.");
  }

  const answerRows = questions.map((question) => ({
    user_test_id: params.testAttemptId,
    question_id: question.id,
    user_answer_text: answerMap.get(question.id) ?? "",
  }));
  if (answerRows.length > 0) {
    const { error: insertAnswersError } = await supabaseAdmin
      .from("ai_user_test_answers")
      .insert(answerRows);
    if (insertAnswersError) {
      throw new Error("Unable to save AI test answers.");
    }
  }
  logAiTestStep("answer_save:after", {
    user_test_id: params.testAttemptId,
  });

  logAiTestStep("grading:start", {
    user_test_id: params.testAttemptId,
    question_count: questions.length,
  });
  const questionResults = questions.map((question) => {
    const userAnswer = (answerMap.get(question.id) ?? "").trim();
    const normalizedAnswer = userAnswer.toLowerCase().replace(/\s+/g, " ").trim();
    const maxScore = Math.max(1, question.score);

    if (question.question_type === "single_choice") {
      const correct = question.correct_answer_text.trim();
      const isCorrect = userAnswer === correct;
      const earnedScore = isCorrect ? maxScore : 0;
      return {
        question_id: question.id,
        question_order: question.question_order,
        question_type: question.question_type,
        question_text: question.question_text,
        concept_tag: question.concept_tag,
        skill_tag: question.skill_tag,
        user_answer: userAnswer,
        correct_answer: correct,
        is_correct: isCorrect,
        earned_score: earnedScore,
        max_score: maxScore,
        result_status: (isCorrect ? "correct" : "incorrect") as QuestionResultStatus,
        explanation: isCorrect
          ? question.explanation ?? "Correct answer."
          : question.explanation ?? "Incorrect. Review the correct option and try again.",
      };
    }

    if (question.question_type === "fill_blank") {
      const acceptableAnswers = question.acceptable_answers
        .map((item) => item.toLowerCase().replace(/\s+/g, " ").trim())
        .filter(Boolean);
      const isCorrect = acceptableAnswers.includes(normalizedAnswer);
      const earnedScore = isCorrect ? maxScore : 0;
      return {
        question_id: question.id,
        question_order: question.question_order,
        question_type: question.question_type,
        question_text: question.question_text,
        concept_tag: question.concept_tag,
        skill_tag: question.skill_tag,
        user_answer: userAnswer,
        correct_answer:
          question.correct_answer_text ||
          question.acceptable_answers[0] ||
          "See explanation.",
        is_correct: isCorrect,
        earned_score: earnedScore,
        max_score: maxScore,
        result_status: (isCorrect ? "correct" : "incorrect") as QuestionResultStatus,
        explanation: isCorrect
          ? question.explanation ?? "Correct answer."
          : question.explanation ?? "Not matched. Compare with acceptable answers and retry.",
      };
    }

    const essay13 = question.question_order === 13 ? gradeEssayQuestion13(userAnswer) : null;
    const essay14 = question.question_order === 14 ? gradeEssayQuestion14(userAnswer) : null;
    const essayEvaluation = essay13 ?? essay14 ?? { earned: 0, explanation: "Essay answer reviewed." };
    const earnedEssay = Math.max(0, Math.min(maxScore, essayEvaluation.earned));
    const status: QuestionResultStatus =
      earnedEssay <= 0 ? "incorrect" : earnedEssay >= maxScore ? "correct" : "partial";
    return {
      question_id: question.id,
      question_order: question.question_order,
      question_type: question.question_type,
      question_text: question.question_text,
      concept_tag: question.concept_tag,
      skill_tag: question.skill_tag,
      user_answer: userAnswer,
      correct_answer: question.correct_answer_text || "Reference answer available in explanation.",
      is_correct: status === "correct",
      earned_score: earnedEssay,
      max_score: maxScore,
      result_status: status,
      explanation: question.explanation ?? essayEvaluation.explanation,
    };
  });

  const persistAnswerResults = async (
    include: { resultStatus: boolean; feedback: boolean },
  ) => {
    for (const item of questionResults) {
      const basePayload: Record<string, unknown> = {
        user_answer_text: item.user_answer,
        earned_score: Math.max(0, Math.floor(item.earned_score)),
      };
      if (include.resultStatus) {
        basePayload.result_status = item.result_status;
      }
      if (include.feedback) {
        basePayload.feedback = item.explanation;
      }

      const { error } = await supabaseAdmin
        .from("ai_user_test_answers")
        .update(basePayload)
        .eq("user_test_id", params.testAttemptId)
        .eq("question_id", item.question_id);
      if (error) {
        return error;
      }
    }
    return null;
  };

  let answerResultsError = await persistAnswerResults({
    resultStatus: true,
    feedback: true,
  });
  if (
    answerResultsError &&
    isMissingColumnError(answerResultsError, "ai_user_test_answers", "feedback")
  ) {
    answerResultsError = await persistAnswerResults({
      resultStatus: true,
      feedback: false,
    });
  }
  if (
    answerResultsError &&
    isMissingColumnError(answerResultsError, "ai_user_test_answers", "result_status")
  ) {
    answerResultsError = await persistAnswerResults({
      resultStatus: false,
      feedback: false,
    });
  }
  if (answerResultsError) {
    throw new Error("Unable to save AI test grading details.");
  }

  const totalScore = 100;
  const earnedScore = Math.max(
    0,
    Math.min(
      totalScore,
      Math.round(questionResults.reduce((sum, item) => sum + Math.max(0, item.earned_score), 0)),
    ),
  );
  const passed = earnedScore >= 60;
  const passStatus: "passed" | "failed" = passed ? "passed" : "failed";
  const nowIso = new Date().toISOString();
  const feedbackSummary = passed
    ? `Great work. You scored ${earnedScore}/100 and passed this course.`
    : `You scored ${earnedScore}/100. You need 60 to pass this course.`;

  const resolvedJourneyPathId = await resolveJourneyPathIdForCourse({
    userId: params.userId,
    courseId,
    journeyPathId: params.journeyPathId,
  });

  const progressRow = await ensureProgressRowForCourse({
    userId: params.userId,
    journeyPathId: resolvedJourneyPathId,
    courseId,
  });
  const previousStatus = normalizeStatus(progressRow.status);
  const wasAlreadyPassed = previousStatus === "passed";
  const completionAlreadyAwarded = Boolean((userTestRow as GenericRecord).completion_awarded);
  const shouldMarkCompletionAwarded = passed && !completionAlreadyAwarded;
  const shouldAwardCompletion = shouldMarkCompletionAwarded && !wasAlreadyPassed;
  const nextProgressStatus: CourseNodeStatus = wasAlreadyPassed
    ? "passed"
    : passed
    ? "passed"
    : "ready_for_test";

  const { error: finalizeError } = await supabaseAdmin
    .from("ai_user_tests")
    .update({
      status: "graded",
      submitted_at: nowIso,
      graded_at: nowIso,
      earned_score: earnedScore,
      pass_status: passStatus,
      completion_awarded: shouldMarkCompletionAwarded ? true : completionAlreadyAwarded,
    })
    .eq("id", params.testAttemptId)
    .eq("user_id", params.userId);

  if (finalizeError) {
    throw new Error("Unable to finalize AI test result.");
  }
  const existingAttemptCount = Math.max(0, Math.floor(toNumberValue(progressRow.attempt_count)));
  const existingBestScore = Math.max(0, Math.floor(toNumberValue(progressRow.best_test_score)));
  const existingPassedAt = toNullableString(progressRow.passed_at);
  const existingCompletedAt = toNullableString(progressRow.completed_at);
  const existingReadyForTestAt = toNullableString(progressRow.ready_for_test_at);

  logAiTestStep("progress_update:before", {
    user_id: params.userId,
    journey_path_id: resolvedJourneyPathId,
    course_id: courseId,
    pass_status: passStatus,
    should_award_completion: shouldAwardCompletion,
    was_already_passed: wasAlreadyPassed,
  });
  const { error: progressError } = await supabaseAdmin
    .from("user_course_progress")
    .update({
      status: nextProgressStatus,
      last_test_score: earnedScore,
      best_test_score: Math.max(existingBestScore, earnedScore),
      attempt_count: existingAttemptCount + 1,
      passed_at: nextProgressStatus === "passed" ? existingPassedAt ?? nowIso : null,
      completed_at: nextProgressStatus === "passed" ? existingCompletedAt ?? nowIso : null,
      ready_for_test_at: nextProgressStatus === "ready_for_test" ? nowIso : existingReadyForTestAt,
      last_activity_at: nowIso,
      current_test_attempt_id: null,
    })
    .eq("id", toStringValue(progressRow.id));
  if (progressError) {
    throw new Error("Unable to update course progress from AI test.");
  }

  if (shouldAwardCompletion) {
    await unlockNextCourse({
      userId: params.userId,
      journeyPathId: resolvedJourneyPathId,
      courseId,
    });
  }
  logAiTestStep("progress_update:after", {
    user_id: params.userId,
    journey_path_id: resolvedJourneyPathId,
    course_id: courseId,
    unlocked_next: shouldAwardCompletion,
  });

  const selectedLegacyResourceId =
    params.selectedResourceId?.trim() || toNullableString(progressRow.selected_resource_id);
  await markUserResourceCompletionAndSuccess({
    userId: params.userId,
    courseId,
    journeyPathId: resolvedJourneyPathId,
    selectedLegacyResourceId,
    userTestId: params.testAttemptId,
    passed,
  });

  const reviewResult = await analyzeWeaknessAndPrepareReview({
    userId: params.userId,
    courseId,
    courseTitle: getCourseTitle((courseRow as GenericRecord) ?? null, "Course"),
    journeyPathId: resolvedJourneyPathId,
    userTestId: params.testAttemptId,
    score: earnedScore,
    questionResults: questionResults.map((item) => ({
      question_id: item.question_id,
      result_status: item.result_status,
      concept_tag: item.concept_tag,
      skill_tag: item.skill_tag,
    })),
  });

  const journey = await getJourneyById({
    userId: params.userId,
    journeyPathId: resolvedJourneyPathId,
  });

  const { data: latestProgressRow } = await supabaseAdmin
    .from("user_course_progress")
    .select("attempt_count, best_test_score, status")
    .eq("id", toStringValue(progressRow.id))
    .limit(1)
    .maybeSingle();
  const attemptNumber = Math.max(
    1,
    Math.floor(toNumberValue((userTestRow as GenericRecord).attempt_number) || 1),
  );
  const latestStatus = normalizeStatus(latestProgressRow?.status ?? nextProgressStatus);
  const courseCompleted = latestStatus === "passed";

  return {
    user_test_id: params.testAttemptId,
    attempt_number: attemptNumber,
    total_score: totalScore,
    earned_score: earnedScore,
    score: earnedScore,
    pass_status: passStatus,
    passed,
    required_score: 60,
    course_completed: courseCompleted,
    attempt_count: Math.max(0, Math.floor(toNumberValue(latestProgressRow?.attempt_count))),
    last_test_score: earnedScore,
    best_test_score: Math.max(0, Math.floor(toNumberValue(latestProgressRow?.best_test_score))) || null,
    completion_awarded: shouldMarkCompletionAwarded,
    feedback_summary: feedbackSummary,
    graded_at: nowIso,
    question_results: questionResults,
    review_required: reviewResult.review_required,
    review_session_id: reviewResult.review_session_id,
    journey,
  };
}

export type CourseTestAttemptSummary = {
  user_test_id: string;
  attempt_number: number;
  earned_score: number;
  total_score: number;
  pass_status: "passed" | "failed";
  graded_at: string | null;
  submitted_at: string | null;
};

export type CourseTestAttemptDetail = {
  user_test_id: string;
  course_id: string;
  course_title: string | null;
  course_description: string | null;
  status: string;
  attempt_number: number;
  total_score: number;
  earned_score: number;
  pass_status: "passed" | "failed";
  required_score: number;
  feedback_summary: string;
  graded_at: string | null;
  submitted_at: string | null;
  question_results: Array<{
    question_id: string;
    question_order: number;
    question_type: "single_choice" | "fill_blank" | "essay";
    question_text: string;
    concept_tag: string | null;
    skill_tag: string | null;
    options: string[];
    user_answer: string;
    correct_answer: string;
    is_correct: boolean;
    earned_score: number;
    max_score: number;
    result_status: QuestionResultStatus;
    explanation: string;
    feedback: string;
  }>;
};

export async function listCourseTestAttempts(params: {
  userId: string;
  courseId: string;
}): Promise<{
  attempts: CourseTestAttemptSummary[];
  best_score: number | null;
  has_any_attempt: boolean;
}> {
  logAiTestStep("attempt_history:list:before", {
    user_id: params.userId,
    course_id: params.courseId,
  });

  const { data, error } = await supabaseAdmin
    .from("ai_user_tests")
    .select("id, attempt_number, earned_score, total_score, pass_status, graded_at, submitted_at")
    .eq("user_id", params.userId)
    .eq("course_id", params.courseId)
    .eq("status", "graded")
    .order("graded_at", { ascending: false, nullsFirst: false })
    .order("attempt_number", { ascending: false, nullsFirst: false });

  if (error) {
    throw new Error("Unable to load test attempt history right now.");
  }

  const attempts = ((data ?? []) as GenericRecord[]).map((row) => {
    const earnedScore = Math.max(0, Math.floor(toNumberValue(row.earned_score)));
    const totalScore = Math.max(1, Math.floor(toNumberValue(row.total_score) || 100));
    const passStatus: "passed" | "failed" = toStringValue(row.pass_status).toLowerCase() === "passed"
      ? "passed"
      : "failed";
    return {
      user_test_id: toStringValue(row.id),
      attempt_number: Math.max(1, Math.floor(toNumberValue(row.attempt_number) || 1)),
      earned_score: Math.min(totalScore, earnedScore),
      total_score: totalScore,
      pass_status: passStatus,
      graded_at: toNullableString(row.graded_at),
      submitted_at: toNullableString(row.submitted_at),
    } satisfies CourseTestAttemptSummary;
  });

  const bestScore = attempts.reduce((max, item) => Math.max(max, item.earned_score), 0);

  const { count: anyAttemptCount, error: anyAttemptCountError } = await supabaseAdmin
    .from("ai_user_tests")
    .select("id", { count: "exact", head: true })
    .eq("user_id", params.userId)
    .eq("course_id", params.courseId);
  if (anyAttemptCountError) {
    throw new Error("Unable to load test attempt history right now.");
  }
  const hasAnyAttempt = Number(anyAttemptCount ?? 0) > 0;

  logAiTestStep("attempt_history:list:after", {
    user_id: params.userId,
    course_id: params.courseId,
    count: attempts.length,
    best_score: bestScore > 0 ? bestScore : null,
    has_any_attempt: hasAnyAttempt,
  });

  return {
    attempts,
    best_score: bestScore > 0 ? bestScore : null,
    has_any_attempt: hasAnyAttempt,
  };
}

export async function getCourseTestAttemptDetail(params: {
  userId: string;
  userTestId: string;
}): Promise<CourseTestAttemptDetail> {
  logAiTestStep("attempt_history:detail:before", {
    user_id: params.userId,
    user_test_id: params.userTestId,
  });

  const { data: rawUserTestRow, error: rawUserTestError } = await supabaseAdmin
    .from("ai_user_tests")
    .select("*")
    .eq("id", params.userTestId)
    .limit(1)
    .maybeSingle();

  if (rawUserTestError) {
    console.error("[ai_test] attempt_history:detail:attempt_lookup_failed", {
      user_id: params.userId,
      user_test_id: params.userTestId,
      reason: toErrorMessage(rawUserTestError),
    });
    throw new Error("Unable to load test attempt detail right now.");
  }

  if (!rawUserTestRow) {
    logAiTestStep("attempt_history:detail:attempt_lookup", {
      user_test_id: params.userTestId,
      found_attempt: false,
      ownership_filtered_out: false,
    });
    throw new Error("Test attempt not found.");
  }

  const attemptOwnerId = toStringValue((rawUserTestRow as GenericRecord).user_id);
  const ownershipFilteredOut = Boolean(attemptOwnerId && attemptOwnerId !== params.userId);
  logAiTestStep("attempt_history:detail:attempt_lookup", {
    user_test_id: params.userTestId,
    found_attempt: true,
    attempt_owner_user_id: attemptOwnerId || null,
    request_user_id: params.userId,
    ownership_filtered_out: ownershipFilteredOut,
  });
  if (ownershipFilteredOut) {
    throw new Error("Not authorized to view this test attempt.");
  }

  const userTestRow = rawUserTestRow as GenericRecord;
  if (toStringValue(userTestRow.status).toLowerCase() !== "graded") {
    throw new Error("This test attempt is not graded yet.");
  }

  const templateId = toStringValue(userTestRow.template_id);
  if (!templateId) {
    throw new Error("Invalid AI test attempt.");
  }
  logAiTestStep("attempt_history:detail:template", {
    user_test_id: params.userTestId,
    template_id: templateId,
  });

  const courseId = toStringValue(userTestRow.course_id);
  let courseTitle: string | null = null;
  let courseDescription: string | null = null;
  if (courseId) {
    const { data: courseRow, error: courseError } = await supabaseAdmin
      .from("courses")
      .select("title, description")
      .eq("id", courseId)
      .limit(1)
      .maybeSingle();
    if (!courseError && courseRow) {
      courseTitle = toNullableString((courseRow as GenericRecord).title);
      courseDescription = toNullableString((courseRow as GenericRecord).description);
    }
  }

  const questions = await loadAiTemplateQuestions(templateId);

  const answerSelect =
    "question_id, user_answer_text, earned_score, result_status, feedback";
  let answerRows: GenericRecord[] = [];
  {
    const { data, error } = await supabaseAdmin
      .from("ai_user_test_answers")
      .select(answerSelect)
      .eq("user_test_id", params.userTestId);

    if (error) {
      const tryFallback = async (select: string) =>
        supabaseAdmin
          .from("ai_user_test_answers")
          .select(select)
          .eq("user_test_id", params.userTestId);

      if (isMissingColumnError(error, "ai_user_test_answers", "result_status")) {
        const { data: fallbackData, error: fallbackError } = await tryFallback(
          "question_id, user_answer_text, earned_score, feedback",
        );
        if (!fallbackError) {
          answerRows = (fallbackData ?? []) as unknown as GenericRecord[];
        } else if (isMissingColumnError(fallbackError, "ai_user_test_answers", "feedback")) {
          const { data: minimalData, error: minimalError } = await tryFallback(
            "question_id, user_answer_text, earned_score",
          );
          if (minimalError) {
            throw new Error("Unable to load test attempt answers.");
          }
          answerRows = (minimalData ?? []) as unknown as GenericRecord[];
        } else {
          throw new Error("Unable to load test attempt answers.");
        }
      } else if (isMissingColumnError(error, "ai_user_test_answers", "feedback")) {
        const { data: fallbackData, error: fallbackError } = await tryFallback(
          "question_id, user_answer_text, earned_score, result_status",
        );
        if (!fallbackError) {
          answerRows = (fallbackData ?? []) as unknown as GenericRecord[];
        } else if (
          isMissingColumnError(fallbackError, "ai_user_test_answers", "result_status")
        ) {
          const { data: minimalData, error: minimalError } = await tryFallback(
            "question_id, user_answer_text, earned_score",
          );
          if (minimalError) {
            throw new Error("Unable to load test attempt answers.");
          }
          answerRows = (minimalData ?? []) as unknown as GenericRecord[];
        } else {
          throw new Error("Unable to load test attempt answers.");
        }
      } else {
        throw new Error("Unable to load test attempt answers.");
      }
    } else {
      answerRows = (data ?? []) as unknown as GenericRecord[];
    }
  }
  logAiTestStep("attempt_history:detail:paper_rows", {
    user_test_id: params.userTestId,
    template_id: templateId,
    question_count: questions.length,
    answer_count: answerRows.length,
  });

  const answersByQuestionId = new Map(
    answerRows.map((row) => [toStringValue(row.question_id), row] as const),
  );

  const questionResults = questions.map((question) => {
    const answerRow = answersByQuestionId.get(question.id) ?? null;
    const maxScore = Math.max(1, question.score);
    const earnedScore = Math.max(0, Math.min(maxScore, Math.floor(toNumberValue(answerRow?.earned_score))));
    const fallbackStatus: QuestionResultStatus =
      earnedScore <= 0 ? "incorrect" : earnedScore >= maxScore ? "correct" : "partial";
    const resultStatus =
      normalizeQuestionResultStatus(answerRow?.result_status) ?? fallbackStatus;
    const correctAnswer =
      question.correct_answer_text ||
      question.acceptable_answers[0] ||
      "See explanation.";

    return {
      question_id: question.id,
      question_order: question.question_order,
      question_type: question.question_type,
      question_text: question.question_text,
      concept_tag: question.concept_tag,
      skill_tag: question.skill_tag,
      options: question.options,
      user_answer: toStringValue(answerRow?.user_answer_text),
      correct_answer: correctAnswer,
      is_correct: resultStatus === "correct",
      earned_score: earnedScore,
      max_score: maxScore,
      result_status: resultStatus,
      feedback:
        toNullableString(answerRow?.feedback) ??
        question.explanation ??
        "Review this question and try again.",
      explanation:
        toNullableString(answerRow?.feedback) ??
        question.explanation ??
        "Review this question and try again.",
    };
  });

  const totalScore = Math.max(1, Math.floor(toNumberValue(userTestRow.total_score) || 100));
  const earnedScore = Math.max(
    0,
    Math.min(totalScore, Math.floor(toNumberValue(userTestRow.earned_score))),
  );
  const passStatus: "passed" | "failed" =
    toStringValue(userTestRow.pass_status).toLowerCase() === "passed"
      ? "passed"
      : earnedScore >= 60
      ? "passed"
      : "failed";

  logAiTestStep("attempt_history:detail:after", {
    user_id: params.userId,
    user_test_id: params.userTestId,
    question_count: questionResults.length,
    earned_score: earnedScore,
    pass_status: passStatus,
  });

  return {
    user_test_id: toStringValue(userTestRow.id),
    course_id: courseId,
    course_title: courseTitle,
    course_description: courseDescription,
    status: toStringValue(userTestRow.status) || "graded",
    attempt_number: Math.max(
      1,
      Math.floor(toNumberValue(userTestRow.attempt_number) || 1),
    ),
    total_score: totalScore,
    earned_score: earnedScore,
    pass_status: passStatus,
    required_score: 60,
    feedback_summary:
      toNullableString(userTestRow.feedback_summary) ??
      (passStatus === "passed"
        ? `Great work. You scored ${earnedScore}/${totalScore} and passed this course.`
        : `You scored ${earnedScore}/${totalScore}. You need 60 to pass this course.`),
    graded_at: toNullableString(userTestRow.graded_at),
    submitted_at: toNullableString(userTestRow.submitted_at),
    question_results: questionResults,
  };
}

export async function completeCourseProgress(params: {
  userId: string;
  journeyPathId: string;
  courseId: string;
}) {
  const { data: pathCoursesRows, error: pathCoursesError } = await supabaseAdmin
    .from("journey_path_courses")
    .select("*")
    .eq("journey_path_id", params.journeyPathId)
    .order("step_number", { ascending: true });

  if (pathCoursesError) {
    throw new Error("Failed to load journey path courses.");
  }

  const pathCourses = (pathCoursesRows ?? []) as GenericRecord[];
  const currentIndex = pathCourses.findIndex(
    (pathCourse) => toStringValue(pathCourse.course_id) === params.courseId,
  );

  if (currentIndex < 0) {
    throw new Error("Course not in journey.");
  }

  const { data: progressRow, error: progressRowError } = await supabaseAdmin
    .from("user_course_progress")
    .select("*")
    .eq("user_id", params.userId)
    .eq("journey_path_id", params.journeyPathId)
    .eq("course_id", params.courseId)
    .limit(1)
    .maybeSingle();

  if (progressRowError || !progressRow) {
    throw new Error("Course progress not found.");
  }

  const status = normalizeStatus((progressRow as GenericRecord).status);
  if (status === "locked") {
    return {
      ok: false as const,
      message: "Please complete previous courses",
    };
  }

  const nowIso = new Date().toISOString();
  const existingBestScore = Math.max(
    0,
    Math.floor(toNumberValue((progressRow as GenericRecord).best_test_score)),
  );
  const existingAttemptCount = Math.max(
    0,
    Math.floor(toNumberValue((progressRow as GenericRecord).attempt_count)),
  );
  const { error: completeError } = await supabaseAdmin
    .from("user_course_progress")
    .update({
      status: "passed",
      last_test_score: Math.max(80, existingBestScore || 80),
      best_test_score: Math.max(80, existingBestScore || 80),
      attempt_count: existingAttemptCount + 1,
      passed_at: nowIso,
      completed_at: nowIso,
    })
    .eq("id", toStringValue((progressRow as GenericRecord).id));

  if (completeError) {
    throw new Error("Failed to complete course.");
  }

  await unlockNextCourse({
    userId: params.userId,
    journeyPathId: params.journeyPathId,
    courseId: params.courseId,
  });

  return {
    ok: true as const,
  };
}
