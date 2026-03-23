import { randomUUID } from "crypto";
import { toSlug } from "@/lib/ai/common";
import {
  type AiGeneratedCoursePackage,
  type Course,
  type CourseResource,
  type CourseWithResources,
} from "@/lib/courseRetrieval/types";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type GenericRecord = Record<string, unknown>;

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

function toDifficultyLabel(value: unknown): Course["difficulty_level"] {
  const normalized = toStringValue(value).trim().toLowerCase();
  if (normalized === "beginner") {
    return "Beginner";
  }
  if (normalized === "intermediate") {
    return "Intermediate";
  }
  if (normalized === "advanced") {
    return "Advanced";
  }
  return null;
}

function toDifficultyStorageValue(value: "Beginner" | "Intermediate" | "Advanced") {
  return value.toLowerCase();
}

function mapCourseRow(row: GenericRecord): Course {
  return {
    id: toStringValue(row.id),
    title: toStringValue(row.title),
    slug: toStringValue(row.slug),
    description: toNullableString(row.description),
    estimated_minutes: Number.isFinite(toNumberValue(row.estimated_minutes))
      ? Math.floor(toNumberValue(row.estimated_minutes))
      : null,
    difficulty_level: toDifficultyLabel(row.difficulty_level),
    created_at: toNullableString(row.created_at),
  };
}

function mapResourceRow(row: GenericRecord): CourseResource {
  return {
    id: toStringValue(row.id),
    course_id: toStringValue(row.course_id),
    title: toStringValue(row.title),
    resource_type: toStringValue(row.resource_type),
    provider: toStringValue(row.provider),
    url: toStringValue(row.url),
    summary: toNullableString(row.summary),
    display_order: Math.max(
      1,
      Math.floor(toNumberValue(row.option_no) || toNumberValue(row.display_order) || 1),
    ),
    created_at: toNullableString(row.created_at),
  };
}

function isDuplicateSlugError(error: unknown) {
  const message = toStringValue((error as { message?: unknown })?.message).toLowerCase();
  return message.includes("duplicate") && message.includes("slug");
}

function buildSlug(base: string) {
  const normalized = toSlug(base) || "generated-course";
  return `${normalized}-${randomUUID().slice(0, 8)}`;
}

async function resolveLearningFieldId(topic: string) {
  const normalizedTopic = topic.trim();
  if (!normalizedTopic) {
    return null;
  }

  const byTitle = await supabaseAdmin
    .from("learning_fields")
    .select("id")
    .ilike("title", normalizedTopic)
    .limit(1)
    .maybeSingle();
  if (!byTitle.error && byTitle.data) {
    return toStringValue((byTitle.data as GenericRecord).id) || null;
  }

  const bySlug = await supabaseAdmin
    .from("learning_fields")
    .select("id")
    .eq("slug", toSlug(normalizedTopic))
    .limit(1)
    .maybeSingle();
  if (!bySlug.error && bySlug.data) {
    return toStringValue((bySlug.data as GenericRecord).id) || null;
  }

  const insertPayloads: Array<Record<string, unknown>> = [
    {
      title: normalizedTopic,
      slug: toSlug(normalizedTopic),
      description: `AI generated learning field for ${normalizedTopic}.`,
      created_at: new Date().toISOString(),
    },
    {
      title: normalizedTopic,
      slug: toSlug(normalizedTopic),
      description: `AI generated learning field for ${normalizedTopic}.`,
    },
    {
      title: normalizedTopic,
      slug: toSlug(normalizedTopic),
    },
    {
      title: normalizedTopic,
    },
  ];

  for (const payload of insertPayloads) {
    const { data, error } = await supabaseAdmin
      .from("learning_fields")
      .insert(payload as never)
      .select("id")
      .limit(1)
      .maybeSingle();
    if (!error && data) {
      return toStringValue((data as GenericRecord).id) || null;
    }
  }

  return null;
}

export async function loadCourseWithResources(courseId: string): Promise<CourseWithResources | null> {
  const { data: courseRow, error: courseError } = await supabaseAdmin
    .from("courses")
    .select("id, title, slug, description, estimated_minutes, difficulty_level, created_at")
    .eq("id", courseId)
    .limit(1)
    .maybeSingle();

  if (courseError) {
    throw new Error("Failed to load course.");
  }
  if (!courseRow) {
    return null;
  }

  let optionRows: GenericRecord[] = [];
  const { data: activeOptions, error: activeOptionsError } = await supabaseAdmin
    .from("course_resource_options")
    .select(
      "id, course_id, option_no, title, resource_type, provider, url, summary, created_at",
    )
    .eq("course_id", courseId)
    .eq("is_active", true)
    .order("option_no", { ascending: true });

  if (activeOptionsError) {
    const { data: fallbackOptions, error: fallbackOptionsError } = await supabaseAdmin
      .from("course_resource_options")
      .select(
        "id, course_id, option_no, title, resource_type, provider, url, summary, created_at",
      )
      .eq("course_id", courseId)
      .order("option_no", { ascending: true });
    if (fallbackOptionsError) {
      throw new Error("Failed to load course resources.");
    }
    optionRows = (fallbackOptions ?? []) as GenericRecord[];
  } else {
    optionRows = (activeOptions ?? []) as GenericRecord[];
  }

  console.info("[resource_read] source_table_used", {
    table: "course_resource_options",
    course_id: courseId,
  });

  return {
    course: mapCourseRow(courseRow as GenericRecord),
    resources: optionRows.map(mapResourceRow),
  };
}

async function findCourseIdByTopic(topic: string): Promise<string | null> {
  const normalizedTopic = topic.trim();
  if (!normalizedTopic) {
    return null;
  }

  const exactTitle = await supabaseAdmin
    .from("courses")
    .select("id")
    .ilike("title", normalizedTopic)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (exactTitle.error) {
    throw new Error("Failed to query courses by exact title.");
  }
  if (exactTitle.data) {
    return toStringValue((exactTitle.data as GenericRecord).id) || null;
  }

  const fuzzyTitle = await supabaseAdmin
    .from("courses")
    .select("id")
    .ilike("title", `%${normalizedTopic}%`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (fuzzyTitle.error) {
    throw new Error("Failed to query courses by similar title.");
  }
  if (fuzzyTitle.data) {
    return toStringValue((fuzzyTitle.data as GenericRecord).id) || null;
  }

  const fuzzyDescription = await supabaseAdmin
    .from("courses")
    .select("id")
    .ilike("description", `%${normalizedTopic}%`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (fuzzyDescription.error) {
    throw new Error("Failed to query courses by similar description.");
  }
  if (fuzzyDescription.data) {
    return toStringValue((fuzzyDescription.data as GenericRecord).id) || null;
  }

  return null;
}

export async function findCourseWithResourcesByTopic(topic: string): Promise<CourseWithResources | null> {
  const matchedCourseId = await findCourseIdByTopic(topic);
  if (!matchedCourseId) {
    return null;
  }

  return loadCourseWithResources(matchedCourseId);
}

export async function insertGeneratedCourseWithResources(params: {
  topic: string;
  generated: AiGeneratedCoursePackage;
}): Promise<CourseWithResources> {
  const nowIso = new Date().toISOString();
  const learningFieldId = await resolveLearningFieldId(params.topic);
  if (!learningFieldId) {
    throw new Error("Failed to resolve learning field for generated course.");
  }
  const desiredSlug = params.generated.course.slug?.trim() || params.generated.course.title;

  let insertedCourseId = "";
  let insertAttempt = 0;

  while (!insertedCourseId && insertAttempt < 3) {
    insertAttempt += 1;
    const slug = buildSlug(desiredSlug);
    const { data: insertedCourse, error: courseInsertError } = await supabaseAdmin
      .from("courses")
      .insert({
        learning_field_id: learningFieldId,
        title: params.generated.course.title.trim(),
        slug,
        description: params.generated.course.description.trim(),
        estimated_minutes: Math.max(10, Math.floor(params.generated.course.estimated_minutes)),
        difficulty_level: toDifficultyStorageValue(params.generated.course.difficulty_level),
        created_at: nowIso,
      })
      .select("id")
      .limit(1)
      .maybeSingle();

    if (courseInsertError) {
      if (isDuplicateSlugError(courseInsertError)) {
        continue;
      }
      throw new Error("Failed to insert generated course.");
    }

    insertedCourseId = toStringValue((insertedCourse as GenericRecord | null)?.id);
  }

  if (!insertedCourseId) {
    throw new Error("Failed to insert generated course.");
  }

  const normalizedResources = [...params.generated.resources]
    .sort((a, b) => a.display_order - b.display_order)
    .map((resource, index) => ({
      course_id: insertedCourseId,
      option_no: index + 1,
      title: resource.title.trim(),
      resource_type: resource.resource_type,
      provider: resource.provider.trim(),
      url: resource.url.trim(),
      summary: resource.summary.trim(),
      difficulty: params.generated.course.difficulty_level.toLowerCase(),
      estimated_minutes: Math.max(5, Math.floor(params.generated.course.estimated_minutes / 3)),
      ai_selected: true,
      created_at: nowIso,
      ai_generated_at: nowIso,
      is_active: true,
    }));

  const { error: resourceInsertError } = await supabaseAdmin
    .from("course_resource_options")
    .insert(normalizedResources);

  if (resourceInsertError) {
    await supabaseAdmin.from("courses").delete().eq("id", insertedCourseId);
    throw new Error("Failed to insert generated course resources.");
  }

  const inserted = await loadCourseWithResources(insertedCourseId);
  if (!inserted) {
    throw new Error("Generated course was inserted but could not be loaded.");
  }
  return inserted;
}
