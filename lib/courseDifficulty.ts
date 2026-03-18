export const COURSE_DIFFICULTY_LEVELS = [
  "beginner",
  "basic",
  "intermediate",
  "advanced",
  "expert",
] as const;

export type CourseDifficultyLevel = (typeof COURSE_DIFFICULTY_LEVELS)[number];

const COURSE_DIFFICULTY_SET = new Set<string>(COURSE_DIFFICULTY_LEVELS);

export function normalizeCourseDifficulty(value: unknown): CourseDifficultyLevel | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized || !COURSE_DIFFICULTY_SET.has(normalized)) {
    return null;
  }

  return normalized as CourseDifficultyLevel;
}

export function normalizeCourseDifficultyForWrite(
  value: unknown,
  fallback: CourseDifficultyLevel = "intermediate",
) {
  return normalizeCourseDifficulty(value) ?? fallback;
}

export function formatCourseDifficultyLabel(value: unknown) {
  const normalized = normalizeCourseDifficulty(value);
  if (!normalized) {
    return null;
  }

  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
