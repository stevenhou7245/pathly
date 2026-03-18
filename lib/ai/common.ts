import { createHash } from "crypto";

export type GenericRecord = Record<string, unknown>;

export function toStringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function toNullableString(value: unknown) {
  return typeof value === "string" ? value : null;
}

export function toNumberValue(value: unknown) {
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

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function stableSortObjectKeys(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map((item) => stableSortObjectKeys(item));
  }

  if (input && typeof input === "object") {
    const objectValue = input as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    Object.keys(objectValue)
      .sort((a, b) => a.localeCompare(b))
      .forEach((key) => {
        sorted[key] = stableSortObjectKeys(objectValue[key]);
      });
    return sorted;
  }

  return input;
}

export function toStableJson(input: unknown) {
  return JSON.stringify(stableSortObjectKeys(input));
}

export function sha256Hash(input: unknown) {
  return createHash("sha256").update(toStableJson(input)).digest("hex");
}

export function normalizeResourceType(value: unknown): ResourceType {
  const normalized = toStringValue(value).trim().toLowerCase();
  if (normalized === "video") {
    return "video";
  }
  if (normalized === "article") {
    return "article";
  }
  if (normalized === "document") {
    return "document";
  }
  if (normalized === "interactive") {
    return "interactive";
  }
  return "tutorial";
}

export type ResourceType = "video" | "article" | "tutorial" | "document" | "interactive";

export function normalizeDifficultyBand(value: unknown): DifficultyBand {
  const normalized = toStringValue(value).trim().toLowerCase();
  if (normalized === "basic") {
    return "basic";
  }
  if (normalized === "intermediate") {
    return "intermediate";
  }
  if (normalized === "advanced") {
    return "advanced";
  }
  if (normalized === "expert") {
    return "expert";
  }
  return "beginner";
}

export type DifficultyBand = "beginner" | "basic" | "intermediate" | "advanced" | "expert";

export function isMissingRelationOrColumnError(error: unknown) {
  const message = toStringValue((error as { message?: unknown })?.message).toLowerCase();
  return (
    message.includes("does not exist") ||
    message.includes("could not find") ||
    message.includes("relation") ||
    message.includes("column")
  );
}

export function toSlug(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}
