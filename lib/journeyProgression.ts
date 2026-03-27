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
  sortResourceOptionsByPreference,
} from "@/lib/ai/resources";
import { loadUserResourcePreferenceProfile } from "@/lib/ai/preferences";
import { resolveAiTestTemplateForAttempt } from "@/lib/ai/tests";
import { analyzeWeaknessAndPrepareReview, getPendingReviewPopup } from "@/lib/ai/review";
import type { DifficultyBand } from "@/lib/ai/common";

export type CourseNodeStatus =
  | "locked"
  | "unlocked"
  | "in_progress"
  | "ready_for_test"
  | "passed";

export type CourseResourceGenerationStatus =
  | "pending"
  | "generating"
  | "ready"
  | "failed";

type GenericRecord = Record<string, unknown>;
const AI_TEST_PASSING_SCORE = 80;

export type JourneyNode = {
  step_number: number;
  course_id: string;
  title: string;
  status: CourseNodeStatus;
  passed_score: number | null;
};

export type JourneyStepContent = {
  step_number: number;
  course_id: string | null;
  title: string;
  description: string | null;
  objective: string | null;
  difficulty: string | null;
  skill_tags: string[];
  concept_tags: string[];
};

export type JourneyPayload = {
  journey_path_id: string;
  starting_point: string;
  destination: string;
  total_steps: number;
  current_step: number;
  learning_field_id: string;
  steps: JourneyStepContent[];
  nodes: JourneyNode[];
};

export type CourseResourcePayload = {
  id: string;
  resource_option_id: string | null;
  title: string;
  resource_type: string;
  provider: string;
  url: string;
  summary: string | null;
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
  resource_generation_status: CourseResourceGenerationStatus;
  is_resource_generated: boolean;
  resources_generated_at: string | null;
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

function toBoolean(value: unknown) {
  return value === true;
}

function parseStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => toStringValue(item)).filter(Boolean);
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.map((item) => toStringValue(item)).filter(Boolean);
      }
    } catch {
      return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }
  return [] as string[];
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

function normalizeResourceGenerationStatus(value: unknown): CourseResourceGenerationStatus {
  const normalized = toStringValue(value).trim().toLowerCase();
  if (
    normalized === "pending" ||
    normalized === "generating" ||
    normalized === "ready" ||
    normalized === "failed"
  ) {
    return normalized;
  }
  return "pending";
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

function isGenericGeneratedCourseTitle(params: { title: string; fieldTitle: string; stepNumber: number }) {
  const normalized = params.title.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  const normalizedField = params.fieldTitle.trim().toLowerCase();
  return (
    /milestone\s+\d+$/i.test(normalized) ||
    /course\s+\d+$/i.test(normalized) ||
    /applied practice|advanced mastery|guided practice|performance practice/.test(normalized) ||
    /foundations\s+\d+$/.test(normalized) ||
    normalized === `${normalizedField} course ${params.stepNumber}`.trim()
  );
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
        "id, learning_field_id, title, slug, description, estimated_minutes, difficulty_level, resource_generation_status, is_resource_generated, resources_generated_at, created_at",
    },
    {
      table: "journey_paths",
      columns: "id, user_id, learning_field_id, starting_point, destination, total_steps, created_at",
    },
    {
      table: "journey_path_courses",
      columns:
        "id, journey_path_id, course_id, step_number, is_required, title, description, objective, difficulty, skill_tags, concept_tags, created_at",
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

  if (
    normalizedCourses.length >= params.totalSteps &&
    (!params.plannedSteps || params.plannedSteps.length === 0)
  ) {
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
      resource_generation_status: "pending",
      is_resource_generated: false,
      resources_generated_at: null,
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
      const shouldRetitle = isGenericGeneratedCourseTitle({
        title: existingTitle,
        fieldTitle: params.fieldTitle,
        stepNumber: i + 1,
      });

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
  plannedSteps: Array<{
    step_number: number;
    step_title: string;
    step_description: string;
    learning_objective: string;
    difficulty_level: string;
    skill_tags: string[];
    concept_tags: string[];
  }>;
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
  const existingByStep = new Map<number, GenericRecord>();
  existing.forEach((row) => {
    const stepNumber = Math.max(1, Math.floor(toNumberValue(row.step_number) || 1));
    existingByStep.set(stepNumber, row);
  });

  const targetStepCount = Math.max(params.plannedSteps.length, params.courses.length);
  let insertedCount = 0;
  for (let index = 0; index < targetStepCount; index += 1) {
    const stepNumber = index + 1;
    const plannedStep = params.plannedSteps.find((step) => step.step_number === stepNumber) ?? null;
    const mappedCourse = params.courses[index] ?? null;
    const courseId = toStringValue(mappedCourse?.id) || null;
    const payload = {
      journey_path_id: params.journeyPathId,
      course_id: courseId,
      step_number: stepNumber,
      is_required: true,
      title:
        plannedStep?.step_title?.trim() ||
        getCourseTitle(mappedCourse, `Step ${stepNumber}`),
      description:
        plannedStep?.step_description?.trim() ||
        toNullableString(mappedCourse?.description) ||
        null,
      objective: plannedStep?.learning_objective?.trim() || null,
      difficulty: plannedStep?.difficulty_level?.trim() || null,
      skill_tags: plannedStep?.skill_tags ?? [],
      concept_tags: plannedStep?.concept_tags ?? [],
      created_at: new Date().toISOString(),
    };

    const existingRow = existingByStep.get(stepNumber);
    if (existingRow) {
      const { error: updateError } = await supabaseAdmin
        .from("journey_path_courses")
        .update({
          course_id: payload.course_id,
          is_required: payload.is_required,
          title: payload.title,
          description: payload.description,
          objective: payload.objective,
          difficulty: payload.difficulty,
          skill_tags: payload.skill_tags,
          concept_tags: payload.concept_tags,
        })
        .eq("id", toStringValue(existingRow.id));
      if (updateError) {
        console.error("[journey_path_courses] insert_failed", {
          journey_path_id: params.journeyPathId,
          step_number: stepNumber,
          reason: toErrorMessage(updateError),
        });
        throw mapSupabaseError(
          "insert_journey_path_courses",
          updateError,
          "Failed to update journey step content.",
        );
      }
      continue;
    }

    const { error: insertError } = await supabaseAdmin.from("journey_path_courses").insert(payload);
    if (insertError) {
      console.error("[journey_path_courses] insert_failed", {
        journey_path_id: params.journeyPathId,
        step_number: stepNumber,
        reason: toErrorMessage(insertError),
      });
      throw mapSupabaseError(
        "insert_journey_path_courses",
        insertError,
        "Failed to create journey path courses.",
      );
    }
    insertedCount += 1;
  }

  console.info("[journey_path_courses] insert_succeeded", {
    journey_path_id: params.journeyPathId,
    inserted_count: insertedCount,
    total_steps: targetStepCount,
  });

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
  const computedTotalSteps = calculateTotalSteps(
    normalizedCurrentLevel ?? params.startingPoint,
    normalizedTargetLevel ?? params.destination,
  );
  const totalSteps = Math.max(1, computedTotalSteps);
  if (
    params.desiredTotalSteps &&
    Number.isFinite(params.desiredTotalSteps) &&
    Math.floor(params.desiredTotalSteps) !== totalSteps
  ) {
    logJourneyStep("requested_total_steps_ignored_fixed_level_gap_rule", {
      requested_total_steps: Math.floor(params.desiredTotalSteps),
      computed_total_steps: totalSteps,
    });
  }
  const fieldTitle = getFieldTitle(learningField);
  const journeyTemplate = await resolveOrCreateJourneyTemplate({
    userId: params.userId,
    learningFieldId: params.learningFieldId,
    fieldTitle,
    startLevel: normalizedCurrentLevel ?? params.startingPoint,
    targetLevel: normalizedTargetLevel ?? params.destination,
    desiredTotalSteps: totalSteps,
  });
  logJourneyStep("build_ordered_journey_steps:total_steps", {
    total_steps: totalSteps,
    computed_total_steps: computedTotalSteps,
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

  let resolvedCourseRows = courseRows;
  if (resolvedCourseRows.length === 0) {
    const nowIso = new Date().toISOString();
    const fallbackInsertRows = Array.from({ length: totalSteps }).map((_, index) => ({
      learning_field_id: params.learningFieldId,
      title: `${fieldTitle} Foundations ${index + 1}`,
      slug: slugify(`${fieldTitle}-foundations-${index + 1}`) || `course-${Date.now()}-${index + 1}`,
      description: `Step ${index + 1} for ${fieldTitle}.`,
      estimated_minutes: 35,
      difficulty_level: "basic",
      resource_generation_status: "pending",
      is_resource_generated: false,
      resources_generated_at: null,
      created_at: nowIso,
    }));

    const { error: fallbackInsertError } = await supabaseAdmin
      .from("courses")
      .insert(fallbackInsertRows);
    if (fallbackInsertError) {
      throw createJourneyError({
        step: "query_courses",
        code: "MISSING_COURSE_DATA",
        status: 409,
        message: "No courses are available for this learning field.",
        details: {
          learning_field_id: params.learningFieldId,
          reason: toErrorMessage(fallbackInsertError),
        },
      });
    }

    resolvedCourseRows = await ensureCoursesForField({
      learningFieldId: params.learningFieldId,
      totalSteps,
      fieldTitle,
      plannedSteps: journeyTemplate.steps,
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
    console.info("[journey_paths] insert_succeeded", {
      journey_path_id: toStringValue(journeyPath.id),
      user_id: params.userId,
      learning_field_id: params.learningFieldId,
      total_steps: totalSteps,
    });
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

  console.info("[journey_read] loaded_journey_path", {
    journey_path_id: toStringValue(journeyPath.id),
    user_id: params.userId,
    learning_field_id: toStringValue(journeyPath.learning_field_id),
  });

  const journeyPathId = toStringValue(journeyPath.id);
  logJourneyStep("build_journey_sequence:before", {
    journey_path_id: journeyPathId,
  });
  const pathCourses = await ensureJourneyPathCourses({
    journeyPathId,
    courses: resolvedCourseRows,
    plannedSteps: journeyTemplate.steps,
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
  console.info("[journey_read] loaded_journey_steps_count", {
    journey_path_id: params.journeyPathId,
    count: pathCourses.length,
  });
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

  const steps: JourneyStepContent[] = pathCourses.map((pathCourse, index) => {
    const courseId = toNullableString(pathCourse.course_id);
    const courseTitle = getCourseTitle(courseById.get(toStringValue(pathCourse.course_id)) ?? null, "");
    return {
      step_number: Math.max(1, Math.floor(toNumberValue(pathCourse.step_number) || index + 1)),
      course_id: courseId,
      title: toStringValue(pathCourse.title).trim() || courseTitle || `Step ${index + 1}`,
      description: toNullableString(pathCourse.description),
      objective: toNullableString(pathCourse.objective),
      difficulty: toNullableString(pathCourse.difficulty),
      skill_tags: parseStringArray(pathCourse.skill_tags),
      concept_tags: parseStringArray(pathCourse.concept_tags),
    };
  });

  const nodes: JourneyNode[] = steps.map((step, index) => {
    const courseId = step.course_id ?? "";
    const progress = progressByCourseId.get(courseId);
    const status = normalizeStatus(progress?.status ?? (index === 0 ? "unlocked" : "locked"));
    const bestTestScoreValue = Math.max(
      toNumberValue(progress?.best_test_score),
      bestScoreByCourseId.get(courseId) ?? 0,
    );

    return {
      step_number: step.step_number,
      course_id: courseId,
      title: step.title,
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
    starting_point: toStringValue(journeyPath.starting_point),
    destination: toStringValue(journeyPath.destination),
    total_steps: nodes.length,
    current_step: currentStep,
    learning_field_id: toStringValue(journeyPath.learning_field_id),
    steps,
    nodes,
  };
}

type CourseResourceState = {
  status: CourseResourceGenerationStatus;
  isGenerated: boolean;
  generatedAt: string | null;
  supportsStatusColumns: boolean;
};

function readCourseResourceStateFromRow(row: GenericRecord) {
  const supportsStatusColumns =
    Object.prototype.hasOwnProperty.call(row, "resource_generation_status") ||
    Object.prototype.hasOwnProperty.call(row, "is_resource_generated") ||
    Object.prototype.hasOwnProperty.call(row, "resources_generated_at");
  return {
    status: normalizeResourceGenerationStatus(row.resource_generation_status),
    isGenerated: toBoolean(row.is_resource_generated),
    generatedAt: toNullableString(row.resources_generated_at),
    supportsStatusColumns,
  } satisfies CourseResourceState;
}

async function readCourseResourceState(courseId: string): Promise<CourseResourceState> {
  const { data, error } = await supabaseAdmin
    .from("courses")
    .select("resource_generation_status, is_resource_generated, resources_generated_at")
    .eq("id", courseId)
    .limit(1)
    .maybeSingle();

  if (error) {
    if (
      isMissingColumnError(error, "courses", "resource_generation_status") ||
      isMissingColumnError(error, "courses", "is_resource_generated") ||
      isMissingColumnError(error, "courses", "resources_generated_at")
    ) {
      return {
        status: "pending",
        isGenerated: false,
        generatedAt: null,
        supportsStatusColumns: false,
      };
    }
    throw createCourseDetailsError({
      step: "fetch_course_resource_status",
      message: "Failed to load course resource generation status.",
      details: {
        course_id: courseId,
        reason: toErrorMessage(error),
      },
      cause: error,
    });
  }

  return readCourseResourceStateFromRow((data as GenericRecord | null) ?? {});
}

async function updateCourseResourceState(params: {
  courseId: string;
  status: CourseResourceGenerationStatus;
  isGenerated: boolean;
  generatedAt?: string | null;
}) {
  const payload: Record<string, unknown> = {
    resource_generation_status: params.status,
    is_resource_generated: params.isGenerated,
    resources_generated_at: params.generatedAt ?? null,
  };
  const { error } = await supabaseAdmin
    .from("courses")
    .update(payload)
    .eq("id", params.courseId);
  if (error) {
    if (
      isMissingColumnError(error, "courses", "resource_generation_status") ||
      isMissingColumnError(error, "courses", "is_resource_generated") ||
      isMissingColumnError(error, "courses", "resources_generated_at")
    ) {
      return false;
    }
    throw createCourseDetailsError({
      step: "update_course_resource_status",
      message: "Failed to update course resource generation status.",
      details: {
        course_id: params.courseId,
        status: params.status,
        reason: toErrorMessage(error),
      },
      cause: error,
    });
  }
  return true;
}

async function tryClaimCourseResourceGeneration(courseId: string) {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("courses")
    .update({
      resource_generation_status: "generating",
      is_resource_generated: false,
      resources_generated_at: null,
    })
    .eq("id", courseId)
    .eq("is_resource_generated", false)
    .in("resource_generation_status", ["pending", "failed"])
    .select("id")
    .limit(1);

  if (error) {
    if (
      isMissingColumnError(error, "courses", "resource_generation_status") ||
      isMissingColumnError(error, "courses", "is_resource_generated") ||
      isMissingColumnError(error, "courses", "resources_generated_at")
    ) {
      return { claimed: true, supportsStatusColumns: false, nowIso };
    }
    throw createCourseDetailsError({
      step: "claim_course_resource_generation",
      message: "Failed to claim course resource generation.",
      details: {
        course_id: courseId,
        reason: toErrorMessage(error),
      },
      cause: error,
    });
  }

  return {
    claimed: ((data ?? []) as GenericRecord[]).length > 0,
    supportsStatusColumns: true,
    nowIso,
  };
}

async function readCourseResourceRows(courseId: string) {
  const { data: activeOptions, error: activeOptionsError } = await supabaseAdmin
    .from("course_resource_options")
    .select("*")
    .eq("course_id", courseId)
    .eq("is_active", true)
    .order("option_no", { ascending: true })
    .limit(3);

  if (activeOptionsError) {
    if (!isMissingColumnError(activeOptionsError, "course_resource_options", "is_active")) {
      throw createCourseDetailsError({
        step: "fetch_course_resources",
        message: "Failed to load course resource options.",
        details: {
          reason: toErrorMessage(activeOptionsError),
          course_id: courseId,
        },
        cause: activeOptionsError,
      });
    }

    const { data: fallbackOptions, error: fallbackOptionsError } = await supabaseAdmin
      .from("course_resource_options")
      .select("*")
      .eq("course_id", courseId)
      .order("option_no", { ascending: true })
      .limit(3);
    if (fallbackOptionsError) {
      throw createCourseDetailsError({
        step: "fetch_course_resources",
        message: "Failed to load course resource options.",
        details: {
          reason: toErrorMessage(fallbackOptionsError),
          course_id: courseId,
        },
        cause: fallbackOptionsError,
      });
    }
    return (fallbackOptions ?? []) as GenericRecord[];
  }

  return (activeOptions ?? []) as GenericRecord[];
}

function mapAndSortResourceRows(params: {
  courseId: string;
  optionRows: GenericRecord[];
  preferenceProfile: Awaited<ReturnType<typeof loadUserResourcePreferenceProfile>>;
}) {
  const mappedOptions = params.optionRows.map((row, index) => ({
    id: toStringValue(row.id),
    course_id: toStringValue(row.course_id) || params.courseId,
    option_no: Math.max(1, Math.floor(toNumberValue(row.option_no) || index + 1)),
    title: toStringValue(row.title) || `Resource ${index + 1}`,
    resource_type: (toStringValue(row.resource_type) || "tutorial") as
      | "video"
      | "article"
      | "tutorial"
      | "document"
      | "interactive",
    provider: toStringValue(row.provider) || "Unknown",
    url: toStringValue(row.url),
    summary: toNullableString(row.summary),
  }));
  const sorted = sortResourceOptionsByPreference(mappedOptions, params.preferenceProfile);
  const rankById = new Map<string, number>();
  sorted.forEach((item, index) => {
    rankById.set(item.id, index + 1);
  });

  return params.optionRows
    .map((row, index) => {
      const displayOrder = Math.max(1, Math.floor(toNumberValue(row.option_no) || index + 1));
      const optionId = toStringValue(row.id);
      return {
        ...row,
        id: optionId,
        resource_option_id: optionId,
        display_order: displayOrder,
        legacy_resource_id: null,
        option_id: optionId,
        option_no: displayOrder,
        course_id: toStringValue(row.course_id) || params.courseId,
        title: toStringValue(row.title),
        resource_type: toStringValue(row.resource_type),
        url: toStringValue(row.url),
        summary: toNullableString(row.summary),
        provider: toStringValue(row.provider) || "Unknown",
      } satisfies GenericRecord;
    })
    .sort((a, b) => {
      const rankA = rankById.get(toStringValue(a.option_id) || toStringValue(a.id)) ?? 999;
      const rankB = rankById.get(toStringValue(b.option_id) || toStringValue(b.id)) ?? 999;
      if (rankA !== rankB) {
        return rankA - rankB;
      }
      return (
        Math.max(1, Math.floor(toNumberValue(a.display_order) || 1)) -
        Math.max(1, Math.floor(toNumberValue(b.display_order) || 1))
      );
    })
    .slice(0, 3);
}

function sleepMs(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForConcurrentResourceGeneration(params: {
  courseId: string;
  maxAttempts?: number;
  waitMs?: number;
}) {
  const maxAttempts = Math.max(1, params.maxAttempts ?? 15);
  const waitMs = Math.max(200, params.waitMs ?? 800);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const rows = await readCourseResourceRows(params.courseId);
    if (rows.length > 0) {
      return rows;
    }

    const state = await readCourseResourceState(params.courseId);
    if (state.supportsStatusColumns && state.status === "failed") {
      throw createCourseDetailsError({
        step: "wait_concurrent_course_resources",
        message: "Resource generation failed. Please retry this course.",
        details: {
          course_id: params.courseId,
          attempt,
        },
      });
    }
    await sleepMs(waitMs);
  }
  return [] as GenericRecord[];
}

async function ensureThreeResources(params: {
  userId: string;
  journeyPathId: string;
  learningFieldTitle: string;
  courseId: string;
  courseTitle: string;
  courseDescription: string | null;
}) {
  const step = "fetch_course_resources";
  let shouldMarkFailure = false;

  try {
    const preferenceProfile = await loadUserResourcePreferenceProfile(params.userId);

    const existingRows = await readCourseResourceRows(params.courseId);
    if (existingRows.length > 0) {
      await updateCourseResourceState({
        courseId: params.courseId,
        status: "ready",
        isGenerated: true,
        generatedAt: new Date().toISOString(),
      });
      const normalizedRows = mapAndSortResourceRows({
        courseId: params.courseId,
        optionRows: existingRows,
        preferenceProfile,
      });
      logCourseDetailsStep("fetch_course_resources:after", {
        course_id: params.courseId,
        count: normalizedRows.length,
        source_table: "course_resource_options",
        reused_existing: true,
      });
      return normalizedRows;
    }

    const currentState = await readCourseResourceState(params.courseId);
    if (currentState.supportsStatusColumns && currentState.status === "generating") {
      const waitedRows = await waitForConcurrentResourceGeneration({
        courseId: params.courseId,
      });
      if (waitedRows.length > 0) {
        const normalizedRows = mapAndSortResourceRows({
          courseId: params.courseId,
          optionRows: waitedRows,
          preferenceProfile,
        });
        logCourseDetailsStep("fetch_course_resources:after", {
          course_id: params.courseId,
          count: normalizedRows.length,
          source_table: "course_resource_options",
          reused_existing: true,
          waited_for_concurrent_generation: true,
        });
        return normalizedRows;
      }
    }

    const claim = await tryClaimCourseResourceGeneration(params.courseId);
    shouldMarkFailure = claim.claimed && claim.supportsStatusColumns;
    if (!claim.claimed && claim.supportsStatusColumns) {
      const waitedRows = await waitForConcurrentResourceGeneration({
        courseId: params.courseId,
      });
      if (waitedRows.length > 0) {
        const normalizedRows = mapAndSortResourceRows({
          courseId: params.courseId,
          optionRows: waitedRows,
          preferenceProfile,
        });
        logCourseDetailsStep("fetch_course_resources:after", {
          course_id: params.courseId,
          count: normalizedRows.length,
          source_table: "course_resource_options",
          reused_existing: true,
          waited_for_concurrent_generation: true,
        });
        return normalizedRows;
      }
      throw createCourseDetailsError({
        step,
        message: "Resource generation is in progress. Please retry in a moment.",
        details: {
          course_id: params.courseId,
        },
      });
    }

    await ensureCourseResourceOptions({
      userId: params.userId,
      courseId: params.courseId,
      courseTitle: params.courseTitle,
      courseDescription: params.courseDescription,
      learningFieldTitle: params.learningFieldTitle,
      preferenceProfile,
    });

    const generatedRows = await readCourseResourceRows(params.courseId);
    if (generatedRows.length === 0) {
      await updateCourseResourceState({
        courseId: params.courseId,
        status: "failed",
        isGenerated: false,
        generatedAt: null,
      });
      throw createCourseDetailsError({
        step,
        message: "Resource generation returned no results. Please retry this course.",
        details: {
          course_id: params.courseId,
        },
      });
    }

    const nowIso = new Date().toISOString();
    await updateCourseResourceState({
      courseId: params.courseId,
      status: "ready",
      isGenerated: true,
      generatedAt: nowIso,
    });
    const normalizedRows = mapAndSortResourceRows({
      courseId: params.courseId,
      optionRows: generatedRows,
      preferenceProfile,
    });

    logCourseDetailsStep("fetch_course_resources:after", {
      course_id: params.courseId,
      count: normalizedRows.length,
      source_table: "course_resource_options",
      generated_on_demand: true,
    });
    return normalizedRows;
  } catch (error) {
    if (shouldMarkFailure) {
      await updateCourseResourceState({
        courseId: params.courseId,
        status: "failed",
        isGenerated: false,
        generatedAt: null,
      });
    }

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
      courseDescription: toNullableString((courseRow as GenericRecord).description),
    });
    const resourceOptionIds = resources
      .map((resource) => toStringValue(resource.resource_option_id) || toStringValue(resource.id))
      .filter(Boolean);
    const legacyResourceIds = resources
      .filter((resource) => !toStringValue(resource.resource_option_id))
      .map((resource) => toStringValue(resource.id))
      .filter(Boolean);

    console.info("[resource_feedback] read_started", {
      course_id: params.courseId,
      resource_option_count: resourceOptionIds.length,
      legacy_resource_count: legacyResourceIds.length,
      key_mode: "resource_option_id",
    });
    console.info("[resource_feedback] resource_option_id", {
      course_id: params.courseId,
      resource_option_ids: resourceOptionIds,
    });

    logCourseDetailsStep("fetch_course_resources:after", {
      course_id: params.courseId,
      resource_count: resources.length,
      resource_ids_count: resourceOptionIds.length,
    });

    step = "fetch_resource_ratings";
    logCourseDetailsStep("fetch_resource_ratings:before", {
      resource_ids_count: resourceOptionIds.length,
    });
    let ratingRowsByOption: GenericRecord[] = [];
    if (resourceOptionIds.length > 0) {
      const { data, error: ratingRowsError } = await supabaseAdmin
        .from("resource_ratings")
        .select("*")
        .in("resource_option_id", resourceOptionIds);

      if (ratingRowsError) {
        throw createCourseDetailsError({
          step,
          message: "Failed to load resource ratings.",
          details: {
            reason: toErrorMessage(ratingRowsError),
            resource_ids_count: resourceOptionIds.length,
            key_mode: "resource_option_id",
          },
          cause: ratingRowsError,
        });
      }

      ratingRowsByOption = (data ?? []) as GenericRecord[];
    }
    let legacyRatingRows: GenericRecord[] = [];
    if (legacyResourceIds.length > 0) {
      const { data, error: legacyRatingRowsError } = await supabaseAdmin
        .from("resource_ratings")
        .select("*")
        .in("resource_id", legacyResourceIds);

      if (!legacyRatingRowsError) {
        legacyRatingRows = (data ?? []) as GenericRecord[];
      }
    }
    const ratingRows = [...ratingRowsByOption, ...legacyRatingRows];
    console.info("[resource_feedback] rating_aggregate_loaded", {
      key_mode: "resource_option_id",
      option_rows: ratingRowsByOption.length,
      legacy_rows: legacyRatingRows.length,
      total_rows: ratingRows.length,
    });
    logCourseDetailsStep("fetch_resource_ratings:after", {
      rating_count: ratingRows.length,
    });

    step = "fetch_resource_comments";
    logCourseDetailsStep("fetch_resource_comments:before", {
      resource_ids_count: resourceOptionIds.length,
    });
    let commentRowsByOption: GenericRecord[] = [];
    if (resourceOptionIds.length > 0) {
      const { data, error: loadedCommentsError } = await supabaseAdmin
        .from("resource_comments")
        .select("*")
        .in("resource_option_id", resourceOptionIds)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false });

      if (loadedCommentsError) {
        throw createCourseDetailsError({
          step,
          message: "Failed to load resource comments.",
          details: {
            reason: toErrorMessage(loadedCommentsError),
            resource_ids_count: resourceOptionIds.length,
            key_mode: "resource_option_id",
          },
          cause: loadedCommentsError,
        });
      }

      commentRowsByOption = (data ?? []) as GenericRecord[];
    }
    let legacyCommentRows: GenericRecord[] = [];
    if (legacyResourceIds.length > 0) {
      const { data, error: legacyCommentsError } = await supabaseAdmin
        .from("resource_comments")
        .select("*")
        .in("resource_id", legacyResourceIds)
        .eq("is_deleted", false)
        .order("created_at", { ascending: false });
      if (!legacyCommentsError) {
        legacyCommentRows = (data ?? []) as GenericRecord[];
      }
    }
    const commentRows = [...commentRowsByOption, ...legacyCommentRows];
    console.info("[resource_feedback] comment_aggregate_loaded", {
      key_mode: "resource_option_id",
      option_rows: commentRowsByOption.length,
      legacy_rows: legacyCommentRows.length,
      total_rows: commentRows.length,
    });
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
      const resourceId =
        toStringValue(rating.resource_option_id) || toStringValue(rating.resource_id);
      if (!ratingsByResourceId.has(resourceId)) {
        ratingsByResourceId.set(resourceId, []);
      }
      ratingsByResourceId.get(resourceId)?.push(rating);
    });

    const commentsByResourceId = new Map<string, GenericRecord[]>();
    comments.forEach((comment) => {
      const resourceId =
        toStringValue(comment.resource_option_id) || toStringValue(comment.resource_id);
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
    const latestCourseResourceState = await readCourseResourceState(params.courseId);

    const resourcesPayload: CourseResourcePayload[] = resources.map((resource) => {
      const resourceId =
        toStringValue(resource.resource_option_id) || toStringValue(resource.id);
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
        provider: toStringValue(resource.provider) || "Pathly",
        url: toStringValue(resource.url),
        summary: toNullableString(resource.summary),
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
      resource_generation_status: latestCourseResourceState.status,
      is_resource_generated: latestCourseResourceState.isGenerated,
      resources_generated_at: latestCourseResourceState.generatedAt,
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
    console.info("[start_learning] request_received", {
      user_id: params.userId,
      journey_path_id: params.journeyPathId,
      course_id: params.courseId,
      selected_resource_option_id: params.selectedResourceId,
    });
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
    console.info("[start_learning] selected_resource_lookup_started", {
      selected_resource_option_id: params.selectedResourceId,
      selected_course_id: params.courseId,
    });
    logStartCourseStep("fetch_resource_row:before", {
      selected_resource_id: params.selectedResourceId,
      course_id: params.courseId,
      read_source: "course_resource_options_first",
    });

    let resourceRow: GenericRecord | null = null;
    try {
      resourceRow = await getResourceRowForCourse({
        selectedResourceId: params.selectedResourceId,
        courseId: params.courseId,
      });
    } catch (error) {
      throw createStartCourseError({
        step,
        message: "Failed to load selected resource.",
        details: {
          reason: toErrorMessage(error),
          selected_resource_id: params.selectedResourceId,
          course_id: params.courseId,
        },
        cause: error,
      });
    }

    if (!resourceRow) {
      console.warn("[start_learning] selected_resource_lookup_failed", {
        selected_resource_option_id: params.selectedResourceId,
        selected_course_id: params.courseId,
        reason: "resource_not_found",
      });
      throw createStartCourseError({
        step,
        message: "Selected resource not found.",
        details: {
          selected_resource_id: params.selectedResourceId,
          course_id: params.courseId,
        },
      });
    }

    console.info("[start_learning] selected_resource_lookup_succeeded", {
      selected_resource_option_id: params.selectedResourceId,
      selected_course_id: params.courseId,
    });

    logStartCourseStep("fetch_resource_row:after", {
      resource_id: toStringValue(resourceRow.id),
      resource_option_id: toStringValue(resourceRow.resource_option_id) || null,
      legacy_resource_id: toStringValue(resourceRow.legacy_resource_id) || null,
      course_id: toStringValue(resourceRow.course_id),
      resource_url: toStringValue(resourceRow.url),
    });
    console.info("[start_learning] selected_resource_url", {
      selected_course_id: params.courseId,
      selected_resource_url: toStringValue(resourceRow.url),
    });

    const selectedResourceOptionId =
      toStringValue(resourceRow.resource_option_id) || toStringValue(resourceRow.id);
    const selectedLegacyResourceId = toStringValue(resourceRow.legacy_resource_id) || "";
    const existingSelectedResourceId = toNullableString((progressRow as GenericRecord).selected_resource_id);
    const selectedResourceIdForProgress =
      existingSelectedResourceId || selectedResourceOptionId || null;

    step = "progress_write";
    console.info("[start_learning] progress_write_started", {
      user_id: params.userId,
      journey_path_id: params.journeyPathId,
      course_id: params.courseId,
      selected_resource_id: selectedResourceIdForProgress,
      status_before: status,
      legacy_table_access_detected: Boolean(selectedLegacyResourceId),
    });

    let rpcData: unknown = null;
    if (selectedLegacyResourceId) {
      const { data: rpcResponseData, error: rpcError } = await supabaseAdmin.rpc("start_learning_course", {
        p_user_id: params.userId,
        p_journey_path_id: params.journeyPathId,
        p_course_id: params.courseId,
        p_selected_resource_id: selectedLegacyResourceId,
      });
      rpcData = rpcResponseData;

      if (rpcError) {
        const fallbackNow = new Date().toISOString();
        const fallbackStatus = status === "unlocked" ? "in_progress" : status;
        const fallbackPayload: Record<string, unknown> = {
          status: fallbackStatus,
          selected_resource_id: selectedResourceIdForProgress,
          last_activity_at: fallbackNow,
        };
        if (!toNullableString((progressRow as GenericRecord).started_at)) {
          fallbackPayload.started_at = fallbackNow;
        }

        const { error: fallbackUpdateError } = await supabaseAdmin
          .from("user_course_progress")
          .update(fallbackPayload)
          .eq("user_id", params.userId)
          .eq("journey_path_id", params.journeyPathId)
          .eq("course_id", params.courseId);

        if (fallbackUpdateError) {
          console.error("[start_learning] progress_write_failed", {
            reason: toErrorMessage(rpcError),
            fallback_reason: toErrorMessage(fallbackUpdateError),
            selected_resource_id: selectedResourceIdForProgress,
          });
          throw createStartCourseError({
            step,
            message: "Progress write failed.",
            details: {
              reason: toErrorMessage(rpcError),
              fallback_reason: toErrorMessage(fallbackUpdateError),
              user_id: params.userId,
              journey_path_id: params.journeyPathId,
              course_id: params.courseId,
              selected_resource_id: selectedResourceIdForProgress,
            },
            cause: rpcError,
          });
        }

        rpcData = {
          status: fallbackStatus,
          selected_resource_id: selectedResourceIdForProgress,
          started_at: fallbackPayload.started_at ?? (progressRow as GenericRecord).started_at ?? null,
          last_activity_at: fallbackNow,
        };
      }
    } else {
      const fallbackNow = new Date().toISOString();
      const fallbackStatus = status === "unlocked" ? "in_progress" : status;
      const fallbackPayload: Record<string, unknown> = {
        status: fallbackStatus,
        selected_resource_id: selectedResourceIdForProgress,
        last_activity_at: fallbackNow,
      };
      if (!toNullableString((progressRow as GenericRecord).started_at)) {
        fallbackPayload.started_at = fallbackNow;
      }

      const { error: fallbackUpdateError } = await supabaseAdmin
        .from("user_course_progress")
        .update(fallbackPayload)
        .eq("user_id", params.userId)
        .eq("journey_path_id", params.journeyPathId)
        .eq("course_id", params.courseId);
      if (fallbackUpdateError) {
        console.error("[start_learning] progress_write_failed", {
          reason: toErrorMessage(fallbackUpdateError),
          selected_resource_id: selectedResourceIdForProgress,
        });
        throw createStartCourseError({
          step,
          message: "Progress write failed.",
          details: {
            reason: toErrorMessage(fallbackUpdateError),
            user_id: params.userId,
            journey_path_id: params.journeyPathId,
            course_id: params.courseId,
            selected_resource_id: selectedResourceIdForProgress,
          },
          cause: fallbackUpdateError,
        });
      }

      rpcData = {
        status: fallbackStatus,
        selected_resource_id: selectedResourceIdForProgress,
        started_at: fallbackPayload.started_at ?? (progressRow as GenericRecord).started_at ?? null,
        last_activity_at: fallbackNow,
      };
    }

    // Ensure first Start Learning persists selected_resource_id for future AI test/resource flows.
    if (!existingSelectedResourceId && selectedResourceIdForProgress) {
      const persistNow = new Date().toISOString();
      const persistPayload: Record<string, unknown> = {
        selected_resource_id: selectedResourceIdForProgress,
        last_activity_at: persistNow,
      };
      if (!toNullableString((progressRow as GenericRecord).started_at)) {
        persistPayload.started_at = persistNow;
      }
      if (status === "unlocked") {
        persistPayload.status = "in_progress";
      }

      const { error: persistError } = await supabaseAdmin
        .from("user_course_progress")
        .update(persistPayload)
        .eq("id", toStringValue((progressRow as GenericRecord).id));
      if (persistError) {
        console.error("[start_learning] selected_resource_persist_failed", {
          user_id: params.userId,
          journey_path_id: params.journeyPathId,
          course_id: params.courseId,
          selected_resource_id: selectedResourceIdForProgress,
          reason: toErrorMessage(persistError),
        });
        throw createStartCourseError({
          step: "progress_write",
          message: "Progress write failed.",
          details: {
            reason: toErrorMessage(persistError),
            user_id: params.userId,
            journey_path_id: params.journeyPathId,
            course_id: params.courseId,
            selected_resource_id: selectedResourceIdForProgress,
          },
          cause: persistError,
        });
      }
      console.info("[start_learning] selected_resource_persist_succeeded", {
        user_id: params.userId,
        journey_path_id: params.journeyPathId,
        course_id: params.courseId,
        selected_resource_id: selectedResourceIdForProgress,
      });
    }

    console.info("[start_learning] progress_write_succeeded", {
      user_id: params.userId,
      journey_path_id: params.journeyPathId,
      course_id: params.courseId,
      selected_resource_id: selectedResourceIdForProgress,
    });

    const rpcRecordRaw = Array.isArray(rpcData) ? (rpcData[0] as GenericRecord | undefined) : (rpcData as GenericRecord | null);
    const rpcRecord = rpcRecordRaw ?? {};
    const rpcResourceUrl =
      toStringValue(rpcRecord.resource_url) ||
      toStringValue(rpcRecord.selected_resource_url) ||
      toStringValue(rpcRecord.url);

    logStartCourseStep("start_learning_course_rpc:after", {
      status: toStringValue(rpcRecord.status),
      selected_resource_id:
        toNullableString(rpcRecord.selected_resource_id) ??
        selectedResourceIdForProgress ??
        selectedLegacyResourceId ??
        null,
      started_at: toNullableString(rpcRecord.started_at),
      last_activity_at: toNullableString(rpcRecord.last_activity_at),
      resource_url_from_rpc: rpcResourceUrl,
    });

    const resourceUrl = (rpcResourceUrl || toStringValue(resourceRow.url)).trim();
    const hasValidResourceUrl =
      /^https?:\/\//i.test(resourceUrl) &&
      !/example\.com/i.test(resourceUrl) &&
      resourceUrl.toLowerCase() !== "resource_unavailable";
    if (!hasValidResourceUrl) {
      console.error("[start_learning] redirect_failed", {
        selected_course_id: params.courseId,
        selected_resource_url: resourceUrl || null,
      });
      throw createStartCourseError({
        step: "validate_resource_url",
        message: "Selected resource URL is missing or invalid.",
        details: {
          selected_resource_id: selectedResourceOptionId,
          course_id: params.courseId,
          resource_url: resourceUrl || null,
        },
      });
    }
    console.info("[start_learning] redirect_started", {
      selected_course_id: params.courseId,
      selected_resource_url: resourceUrl,
    });

    await recordUserResourceSelection({
      userId: params.userId,
      journeyPathId: params.journeyPathId,
      courseId: params.courseId,
      legacyResourceId: selectedResourceOptionId,
    });

    logStartCourseStep("return_success", {
      resource_url: resourceUrl,
    });

    const { data: updatedProgressRow } = await supabaseAdmin
      .from("user_course_progress")
      .select("id, status, selected_resource_id, started_at, last_activity_at")
      .eq("user_id", params.userId)
      .eq("journey_path_id", params.journeyPathId)
      .eq("course_id", params.courseId)
      .limit(1)
      .maybeSingle();

    return {
      ok: true as const,
      resource_url: resourceUrl,
      progress: updatedProgressRow
        ? {
            id: toStringValue((updatedProgressRow as GenericRecord).id),
            status: normalizeStatus((updatedProgressRow as GenericRecord).status),
            selected_resource_id: toNullableString((updatedProgressRow as GenericRecord).selected_resource_id),
            started_at: toNullableString((updatedProgressRow as GenericRecord).started_at),
            last_activity_at: toNullableString((updatedProgressRow as GenericRecord).last_activity_at),
          }
        : {
            id: toStringValue((progressRow as GenericRecord).id),
            status: status === "unlocked" ? "in_progress" : status,
            selected_resource_id: selectedResourceIdForProgress,
            started_at:
              toNullableString((progressRow as GenericRecord).started_at) ?? new Date().toISOString(),
            last_activity_at: new Date().toISOString(),
          },
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
  question_type: "multiple_choice" | "fill_blank" | "short_answer";
  options: string[];
  score: number;
};

export type CourseTestPayload = {
  course_id: string;
  journey_path_id: string;
  user_test_id: string;
  test_attempt_id: string;
  template_id: string;
  title: string;
  difficulty_band: DifficultyBand;
  test_template: {
    course_id: string;
    course_title: string;
    difficulty_band: DifficultyBand;
    resource_context: {
      selected_resource_option_id: string | null;
      selected_resource_title: string | null;
      selected_resource_type: string | null;
      selected_resource_provider: string | null;
      selected_resource_url: string | null;
      selected_resource_summary: string | null;
    };
    metadata: {
      generated_at: string;
      attempt_number: number;
      variant_no: number;
      prompt_version: string;
      requirements_met: {
        include_concept_and_skill_tags: boolean;
        vary_from_previous_attempts: boolean;
      };
      ai_provider: string | null;
      ai_model: string | null;
      fallback_used: boolean;
      reused_existing: boolean;
    };
    questions: Array<{
      id: string;
      question_order: number;
      question_text: string;
      question_type: "multiple_choice" | "fill_blank" | "short_answer";
      options: string[];
      score: number;
    }>;
  };
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
    question_type: "multiple_choice" | "fill_blank" | "short_answer";
    question_text: string;
    concept_tags: string[];
    skill_tags: string[];
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
  console.info("[start_learning] selected_resource_lookup_started", {
    selected_resource_option_id: params.selectedResourceId,
    selected_course_id: params.courseId,
  });
  const { data: optionRow, error: optionError } = await supabaseAdmin
    .from("course_resource_options")
    .select("*")
    .eq("id", params.selectedResourceId)
    .eq("course_id", params.courseId)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  if (optionError) {
    if (!isMissingColumnError(optionError, "course_resource_options", "is_active")) {
      console.error("[start_learning] selected_resource_lookup_failed", {
        selected_resource_option_id: params.selectedResourceId,
        selected_course_id: params.courseId,
        reason: toErrorMessage(optionError),
      });
      throw new Error("Failed to load selected resource option.");
    }

    const { data: fallbackOptionRow, error: fallbackOptionError } = await supabaseAdmin
      .from("course_resource_options")
      .select("*")
      .eq("id", params.selectedResourceId)
      .eq("course_id", params.courseId)
      .limit(1)
      .maybeSingle();
    if (fallbackOptionError) {
      console.error("[start_learning] selected_resource_lookup_failed", {
        selected_resource_option_id: params.selectedResourceId,
        selected_course_id: params.courseId,
        reason: toErrorMessage(fallbackOptionError),
      });
      throw new Error("Failed to load selected resource option.");
    }
    if (!fallbackOptionRow) {
      return null;
    }
    console.info("[start_learning] source_table_used", {
      selected_course_id: params.courseId,
      table: "course_resource_options",
    });
    console.info("[resource_read] source_table_used", {
      course_id: params.courseId,
      table: "course_resource_options",
    });
    console.info("[start_learning] selected_resource_lookup_succeeded", {
      selected_resource_option_id: params.selectedResourceId,
      selected_course_id: params.courseId,
    });
    return {
      ...(fallbackOptionRow as GenericRecord),
      resource_option_id: toStringValue((fallbackOptionRow as GenericRecord).id),
      legacy_resource_id: null,
      provider: toStringValue((fallbackOptionRow as GenericRecord).provider) || "Unknown",
      summary: toNullableString((fallbackOptionRow as GenericRecord).summary),
    } as GenericRecord;
  }

  if (!optionRow) {
    console.warn("[migration_cleanup] legacy_table_reference_found", {
      table: "course_resources",
      path: "journeyProgression.getResourceRowForCourse",
      action: "not_used",
      selected_resource_option_id: params.selectedResourceId,
      selected_course_id: params.courseId,
    });
    return null;
  }

  console.info("[start_learning] source_table_used", {
    selected_course_id: params.courseId,
    table: "course_resource_options",
  });
  console.info("[resource_read] source_table_used", {
    course_id: params.courseId,
    table: "course_resource_options",
  });
  console.info("[start_learning] selected_resource_lookup_succeeded", {
    selected_resource_option_id: params.selectedResourceId,
    selected_course_id: params.courseId,
  });
  return {
    ...(optionRow as GenericRecord),
    resource_option_id: toStringValue((optionRow as GenericRecord).id),
    legacy_resource_id: null,
    provider: toStringValue((optionRow as GenericRecord).provider) || "Unknown",
    summary: toNullableString((optionRow as GenericRecord).summary),
  } as GenericRecord;
}

type AiTemplateQuestionType =
  | "multiple_choice"
  | "fill_blank"
  | "short_answer";

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
  skill_tags: string[];
  concept_tags: string[];
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
  if (
    normalized === "multiple_choice" ||
    normalized === "single_choice" ||
    normalized === "mcq" ||
    normalized === "true_false" ||
    normalized === "true/false" ||
    normalized === "boolean"
  ) {
    return "multiple_choice";
  }
  if (normalized === "fill_blank" || normalized === "fill-blank" || normalized === "fill in the blank") {
    return "fill_blank";
  }
  if (
    normalized === "short_answer" ||
    normalized === "short-answer" ||
    normalized === "essay"
  ) {
    return "short_answer";
  }
  if (normalized === "matching" || normalized === "match") {
    return "fill_blank";
  }
  return "multiple_choice";
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

function parseAiTagList(value: unknown) {
  const parsed = parseJsonValue(value);
  if (Array.isArray(parsed)) {
    return Array.from(
      new Set(parsed.map((item) => toStringValue(item).trim()).filter(Boolean)),
    );
  }
  if (typeof parsed === "string") {
    return Array.from(
      new Set(
        parsed
          .split(/\r?\n|,/)
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    );
  }
  return [] as string[];
}

function normalizeQuestionResultStatus(value: unknown): QuestionResultStatus | null {
  const normalized = toStringValue(value).trim().toLowerCase();
  if (normalized === "correct" || normalized === "partial" || normalized === "incorrect") {
    return normalized;
  }
  return null;
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
      const normalizedScoreDefault = 20;
      const score = Math.max(1, Math.floor(toNumberValue(row.score) || normalizedScoreDefault));
      const correctAnswerText = toStringValue(row.correct_answer_text);
      const options = questionType === "multiple_choice" ? parseAiOptions(row.options_json) : [];
      const parsedSkillTags = parseAiTagList(row.skill_tags);
      const parsedConceptTags = parseAiTagList(row.concept_tags);

      return {
        id: toStringValue(row.id),
        question_order: questionOrder,
        question_type: questionType,
        question_text: questionText,
        options,
        correct_answer_text: correctAnswerText,
        acceptable_answers: parseAiAcceptableAnswers(row.acceptable_answers_json, correctAnswerText),
        score,
        explanation: toNullableString(row.explanation),
        skill_tags: parsedSkillTags,
        concept_tags: parsedConceptTags,
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
  journeyPathId?: string | null;
  courseId: string;
  selectedResourceId?: string | null;
}): Promise<CourseTestPayload> {
  const resolvedJourneyPathId = await resolveJourneyPathIdForCourse({
    userId: params.userId,
    courseId: params.courseId,
    journeyPathId: params.journeyPathId,
  });
  logAiTestStep("prepare:start", {
    user_id: params.userId,
    journey_path_id: resolvedJourneyPathId,
    course_id: params.courseId,
  });

  const { data: userRow, error: userError } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("id", params.userId)
    .limit(1)
    .maybeSingle();
  if (userError || !userRow) {
    console.error("[ai_test_start] db_lookup_failed", {
      table: "users",
      user_id: params.userId,
      reason: userError ? toErrorMessage(userError) : "row_not_found",
    });
    throw new Error("User not found.");
  }

  const { data: courseRow, error: courseError } = await supabaseAdmin
    .from("courses")
    .select("*")
    .eq("id", params.courseId)
    .limit(1)
    .maybeSingle();
  if (courseError || !courseRow) {
    console.error("[ai_test_start] db_lookup_failed", {
      table: "courses",
      course_id: params.courseId,
      reason: courseError ? toErrorMessage(courseError) : "row_not_found",
    });
    throw new Error("Course not found.");
  }

  const progressRow = await ensureProgressRowForCourse({
    userId: params.userId,
    journeyPathId: resolvedJourneyPathId,
    courseId: params.courseId,
  });
  const status = normalizeStatus(progressRow.status);
  if (status === "locked") {
    throw new Error("Please complete previous courses");
  }
  if (status === "unlocked") {
    throw new Error("Start learning before taking the AI test.");
  }

  const { data: resourceMetadataRows, error: resourceMetadataError } = await supabaseAdmin
    .from("course_resource_options")
    .select("id, title, resource_type, provider, url, summary")
    .eq("course_id", params.courseId)
    .limit(5);
  if (resourceMetadataError) {
    console.warn("[ai_test_template] resource_metadata_lookup_failed", {
      course_id: params.courseId,
      reason: toErrorMessage(resourceMetadataError),
    });
  }
  const normalizedResourceMetadata = ((resourceMetadataRows ?? []) as GenericRecord[]).map((row) => ({
    id: toStringValue(row.id),
    title: toStringValue(row.title),
    resource_type: toStringValue(row.resource_type),
    provider:
      toStringValue(row.provider) ||
      null,
    url: toNullableString(row.url),
    summary:
      toNullableString(row.summary),
  }));

  if (params.selectedResourceId?.trim()) {
    console.info("[ai_test_resource] frontend_selected_resource_ignored", {
      user_id: params.userId,
      course_id: params.courseId,
      frontend_selected_resource_id: params.selectedResourceId,
    });
  }

  console.info("[ai_test_resource] loading_saved_selection_started", {
    user_id: params.userId,
    course_id: params.courseId,
  });
  const { data: savedSelectionRow, error: savedSelectionError } = await supabaseAdmin
    .from("user_course_resource_selections")
    .select("resource_option_id, selected_at")
    .eq("user_id", params.userId)
    .eq("course_id", params.courseId)
    .order("selected_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (savedSelectionError) {
    throw new Error("Failed to load saved resource selection.");
  }

  const selectedResourceOptionIdFromDb = toStringValue(
    (savedSelectionRow as GenericRecord | null)?.resource_option_id,
  );
  console.info("[ai_test_resource] loading_saved_selection_result", {
    user_id: params.userId,
    course_id: params.courseId,
    resource_option_id: selectedResourceOptionIdFromDb || null,
    found: Boolean(savedSelectionRow && selectedResourceOptionIdFromDb),
  });

  if (!selectedResourceOptionIdFromDb) {
    console.info("[ai_test_resource] no_saved_resource_selection", {
      user_id: params.userId,
      course_id: params.courseId,
      resource_option_id: null,
      found: false,
    });
  }

  let selectedResourceRow: GenericRecord | null = null;
  if (selectedResourceOptionIdFromDb) {
    console.info("[ai_test_resource] loading_resource_option_started", {
      user_id: params.userId,
      course_id: params.courseId,
      resource_option_id: selectedResourceOptionIdFromDb,
    });
    const { data: selectedResourceOptionRow, error: selectedResourceOptionError } =
      await supabaseAdmin
        .from("course_resource_options")
        .select("id, course_id, title, resource_type, provider, url, summary")
        .eq("id", selectedResourceOptionIdFromDb)
        .eq("course_id", params.courseId)
        .limit(1)
        .maybeSingle();

    if (selectedResourceOptionError) {
      throw new Error("Failed to load selected resource option.");
    }

    selectedResourceRow = (selectedResourceOptionRow as GenericRecord | null) ?? null;
    console.info("[ai_test_resource] loading_resource_option_result", {
      user_id: params.userId,
      course_id: params.courseId,
      resource_option_id: selectedResourceOptionIdFromDb,
      found: Boolean(selectedResourceRow),
    });
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
  const resourceOptionId = toStringValue(selectedResourceRow?.id) || null;
  const selectedMetadata = selectedResourceRow;

  console.info("[ai_test_resource] using_db_resource_context", {
    user_id: params.userId,
    course_id: params.courseId,
    resource_option_id: resourceOptionId,
    found: Boolean(selectedResourceRow),
  });

  console.info("[ai_test_template] generation_context", {
    course_id: params.courseId,
    selected_resource_option_id: resourceOptionId,
    selected_resource_title: toNullableString(selectedMetadata?.title),
    selected_resource_type: toNullableString(selectedMetadata?.resource_type),
    resource_metadata_count: normalizedResourceMetadata.length,
  });

  const resolvedTemplate = await resolveAiTestTemplateForAttempt({
    userId: params.userId,
    courseId: params.courseId,
    courseTitle: getCourseTitle(courseRow as GenericRecord),
    courseDescription: toNullableString((courseRow as GenericRecord).description),
    selectedResourceOptionId: resourceOptionId,
    selectedResourceTitle: toNullableString(selectedMetadata?.title),
    selectedResourceType: toNullableString(selectedMetadata?.resource_type),
    selectedResourceProvider:
      toNullableString(selectedMetadata?.provider),
    selectedResourceUrl: toNullableString(selectedMetadata?.url),
    selectedResourceSummary:
      toNullableString(selectedMetadata?.summary),
    resourceMetadata: normalizedResourceMetadata,
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

  console.info("[ai_test_template] user_test_insert_started", {
    course_id: params.courseId,
    template_id: templateId,
    attempt_number: attemptNumber,
  });
  const primaryUserTestPayload = {
    user_id: params.userId,
    course_id: params.courseId,
    template_id: templateId,
    status: "started",
    started_at: nowIso,
    total_score: 100,
    attempt_number: attemptNumber,
    completion_awarded: false,
  };
  console.info("[ai_test_template] user_test_insert_payload", primaryUserTestPayload);
  logAiTestStep("attempt_create:before", {
    course_id: params.courseId,
    template_id: templateId,
    attempt_number: attemptNumber,
  });
  let { data: userTestRow, error: userTestError } = await supabaseAdmin
    .from("ai_user_tests")
    .insert(primaryUserTestPayload)
    .select("*")
    .limit(1)
    .maybeSingle();

  if (userTestError) {
    const errorRecord = userTestError as unknown as GenericRecord;
    console.error("[ai_test_template] user_test_insert_failed", {
      payload_keys: Object.keys(primaryUserTestPayload),
      reason: userTestError.message,
      code: errorRecord.code ?? null,
      details: errorRecord.details ?? null,
      hint: errorRecord.hint ?? null,
    });

    const fallbackPayload = {
      ...primaryUserTestPayload,
      status: "in_progress",
    };
    console.info("[ai_test_template] user_test_insert_payload", fallbackPayload);
    const fallbackInsert = await supabaseAdmin
      .from("ai_user_tests")
      .insert(fallbackPayload)
      .select("*")
      .limit(1)
      .maybeSingle();
    userTestRow = fallbackInsert.data;
    userTestError = fallbackInsert.error;

    if (userTestError) {
      const fallbackErrorRecord = userTestError as unknown as GenericRecord;
      console.error("[ai_test_template] user_test_insert_failed", {
        payload_keys: Object.keys(fallbackPayload),
        reason: userTestError.message,
        code: fallbackErrorRecord.code ?? null,
        details: fallbackErrorRecord.details ?? null,
        hint: fallbackErrorRecord.hint ?? null,
      });
    }
  }

  if (userTestError || !userTestRow) {
    throw new Error("Unable to create AI test attempt right now.");
  }

  const userTestId = toStringValue((userTestRow as GenericRecord).id);
  if (!userTestId) {
    throw new Error("Unable to create AI test attempt right now.");
  }
  console.info("[ai_test_template] user_test_insert_succeeded", {
    user_test_id: userTestId,
    template_id: templateId,
    course_id: params.courseId,
    attempt_number: attemptNumber,
  });
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
      journey_path_id: resolvedJourneyPathId,
      reason: toErrorMessage(progressUpdateError),
    });
  }

  const payload: CourseTestPayload = {
    course_id: params.courseId,
    journey_path_id: resolvedJourneyPathId,
    user_test_id: userTestId,
    test_attempt_id: userTestId,
    template_id: templateId,
    title: getCourseTitle(courseRow as GenericRecord),
    difficulty_band: resolvedTemplate.difficultyBand,
    test_template: {
      course_id: params.courseId,
      course_title: getCourseTitle(courseRow as GenericRecord),
      difficulty_band: resolvedTemplate.difficultyBand,
      resource_context: resolvedTemplate.resourceContext,
      metadata: resolvedTemplate.metadata,
      questions: questions.map((question) => ({
        id: question.id,
        question_order: question.question_order,
        question_text: question.question_text,
        question_type: question.question_type,
        options: question.options,
        score: question.score,
      })),
    },
    status: status === "passed" ? "passed" : "ready_for_test",
    required_score: AI_TEST_PASSING_SCORE,
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
  console.info("[ai_test_template] response_payload", {
    success: true,
    user_test_id: payload.user_test_id,
    template_id: payload.template_id,
    course_id: payload.course_id,
    title: payload.title,
    difficulty_band: payload.difficulty_band,
    questions_count: payload.questions.length,
  });
  console.info("[ai_test_template] response_sent", {
    user_test_id: userTestId,
    template_id: templateId,
    course_id: params.courseId,
    questions_count: payload.questions.length,
    difficulty_band: resolvedTemplate.difficultyBand,
  });
  return payload;
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
  const questionResults: CourseTestSubmitResult["question_results"] = questions.map((question) => {
    const userAnswer = (answerMap.get(question.id) ?? "").trim();
    const normalizedAnswer = userAnswer.toLowerCase().replace(/\s+/g, " ").trim();
    const maxScore = Math.max(1, question.score);
    const normalizedQuestionType = normalizeAiQuestionType(question.question_type);

    if (normalizedQuestionType === "multiple_choice") {
      const correct = question.correct_answer_text.trim();
      const isCorrect = userAnswer === correct;
      const earnedScore = isCorrect ? maxScore : 0;
      return {
        question_id: question.id,
        question_order: question.question_order,
        question_type: normalizedQuestionType,
        question_text: question.question_text,
        concept_tags: question.concept_tags,
        skill_tags: question.skill_tags,
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

    if (normalizedQuestionType === "short_answer" || normalizedQuestionType === "fill_blank") {
      const acceptableAnswers = question.acceptable_answers
        .map((item) => item.toLowerCase().replace(/\s+/g, " ").trim())
        .filter(Boolean);
      const isCorrect =
        acceptableAnswers.includes(normalizedAnswer) ||
        question.correct_answer_text.toLowerCase().replace(/\s+/g, " ").trim() === normalizedAnswer;
      const earnedScore = isCorrect ? maxScore : 0;
      return {
        question_id: question.id,
        question_order: question.question_order,
        question_type: normalizedQuestionType,
        question_text: question.question_text,
        concept_tags: question.concept_tags,
        skill_tags: question.skill_tags,
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

    return {
      question_id: question.id,
      question_order: question.question_order,
      question_type: "short_answer",
      question_text: question.question_text,
      concept_tags: question.concept_tags,
      skill_tags: question.skill_tags,
      user_answer: userAnswer,
      correct_answer: question.correct_answer_text || "See explanation.",
      is_correct: false,
      earned_score: 0,
      max_score: maxScore,
      result_status: "incorrect" as QuestionResultStatus,
      explanation: question.explanation ?? "Answer could not be evaluated.",
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
  const passed = earnedScore >= AI_TEST_PASSING_SCORE;
  const passStatus: "passed" | "failed" = passed ? "passed" : "failed";
  const nowIso = new Date().toISOString();
  const feedbackSummary = passed
    ? `Great work. You scored ${earnedScore}/100 and passed this course.`
    : `You scored ${earnedScore}/100. You need ${AI_TEST_PASSING_SCORE} to pass this course.`;

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
      concept_tags: item.concept_tags,
      skill_tags: item.skill_tags,
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
    required_score: AI_TEST_PASSING_SCORE,
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
    question_type: "multiple_choice" | "fill_blank" | "short_answer";
    question_text: string;
    concept_tags: string[];
    skill_tags: string[];
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
      concept_tags: question.concept_tags,
      skill_tags: question.skill_tags,
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
      : earnedScore >= AI_TEST_PASSING_SCORE
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
    required_score: AI_TEST_PASSING_SCORE,
    feedback_summary:
      toNullableString(userTestRow.feedback_summary) ??
      (passStatus === "passed"
        ? `Great work. You scored ${earnedScore}/${totalScore} and passed this course.`
        : `You scored ${earnedScore}/${totalScore}. You need ${AI_TEST_PASSING_SCORE} to pass this course.`),
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
