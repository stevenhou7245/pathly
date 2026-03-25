export const LEARNING_LEVELS = [
  "Beginner",
  "Basic",
  "Intermediate",
  "Advanced",
  "Expert",
] as const;

export type LearningLevel = (typeof LEARNING_LEVELS)[number];
export type LearningPathStepStatus = "completed" | "current" | "locked";
export const LESSONS_PER_LEVEL_GAP = 4;

const LEVEL_TO_VALUE: Record<LearningLevel, number> = {
  Beginner: 1,
  Basic: 2,
  Intermediate: 3,
  Advanced: 4,
  Expert: 5,
};

const NORMALIZED_LEVEL_MAP: Record<string, LearningLevel> = {
  beginner: "Beginner",
  basic: "Basic",
  intermediate: "Intermediate",
  advanced: "Advanced",
  expert: "Expert",
};

function toFiniteInteger(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }

  return 0;
}

export function normalizeLearningLevel(value: unknown): LearningLevel | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return NORMALIZED_LEVEL_MAP[normalized] ?? null;
}

export function calculateTotalSteps(currentLevel: unknown, targetLevel: unknown) {
  const normalizedCurrent = normalizeLearningLevel(currentLevel) ?? "Beginner";
  const normalizedTarget = normalizeLearningLevel(targetLevel) ?? normalizedCurrent;

  const currentValue = LEVEL_TO_VALUE[normalizedCurrent];
  const targetValue = LEVEL_TO_VALUE[normalizedTarget];

  const levelDistance = Math.max(0, Math.min(4, targetValue - currentValue));
  // Fixed rule: each adjacent level gap always equals 4 lessons.
  // Example: Basic -> Expert => distance 3 => total_steps 12.
  return levelDistance * LESSONS_PER_LEVEL_GAP;
}

export function normalizePathState(totalStepsValue: unknown, currentStepIndexValue: unknown) {
  const fallbackTotal = LESSONS_PER_LEVEL_GAP;
  const parsedTotal = toFiniteInteger(totalStepsValue);
  const totalSteps = parsedTotal > 0 ? parsedTotal : fallbackTotal;

  const parsedCurrent = toFiniteInteger(currentStepIndexValue);
  let currentStepIndex = parsedCurrent > 0 ? parsedCurrent : 1;
  if (currentStepIndex > totalSteps + 1) {
    currentStepIndex = totalSteps + 1;
  }

  return {
    totalSteps,
    currentStepIndex,
  };
}

export function getCompletedStepsCount(totalSteps: number, currentStepIndex: number) {
  if (totalSteps <= 0) {
    return 0;
  }

  return Math.min(totalSteps, Math.max(0, currentStepIndex - 1));
}

export function getPathProgressPercentage(totalSteps: number, currentStepIndex: number) {
  if (totalSteps <= 0) {
    return 0;
  }

  const completed = getCompletedStepsCount(totalSteps, currentStepIndex);
  return Math.round((completed / totalSteps) * 100);
}

export function buildLearningPathSteps(totalSteps: number, currentStepIndex: number) {
  const steps: Array<{
    index: number;
    status: LearningPathStepStatus;
  }> = [];

  for (let index = 1; index <= totalSteps; index += 1) {
    let status: LearningPathStepStatus = "locked";

    if (index < currentStepIndex) {
      status = "completed";
    } else if (index === currentStepIndex && currentStepIndex <= totalSteps) {
      status = "current";
    }

    steps.push({
      index,
      status,
    });
  }

  return steps;
}
