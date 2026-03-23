import { generateStructuredJson } from "@/lib/ai/provider";
import { buildCourseGenerationInput, buildCourseGenerationSystemPrompt } from "@/lib/courseRetrieval/prompt";
import {
  aiGeneratedCoursePackageSchema,
  type AiGeneratedCoursePackage,
  type CourseWithResources,
} from "@/lib/courseRetrieval/types";
import {
  findCourseWithResourcesByTopic,
  insertGeneratedCourseWithResources,
} from "@/lib/courseRetrieval/repository";

type GetOrGenerateCourseResult = {
  source: "cache" | "database" | "ai_generated";
  data: CourseWithResources;
};

type CacheEntry = {
  expires_at: number;
  data: CourseWithResources;
};

const COURSE_CACHE_TTL_MS = 10 * 60 * 1000;
const topicCourseCache = new Map<string, CacheEntry>();

function normalizeTopic(topic: string) {
  return topic.trim().toLowerCase().replace(/\s+/g, " ");
}

function getCachedCourse(topic: string): CourseWithResources | null {
  const key = normalizeTopic(topic);
  const cached = topicCourseCache.get(key);
  if (!cached) {
    return null;
  }
  if (cached.expires_at <= Date.now()) {
    topicCourseCache.delete(key);
    return null;
  }
  return cached.data;
}

function setCachedCourse(topic: string, data: CourseWithResources) {
  topicCourseCache.set(normalizeTopic(topic), {
    data,
    expires_at: Date.now() + COURSE_CACHE_TTL_MS,
  });
}

function buildDeterministicFallback(topic: string): AiGeneratedCoursePackage {
  const cleanTopic = topic.trim() || "General Topic";
  return {
    course: {
      title: `${cleanTopic} Starter Course`,
      slug: `${cleanTopic}-starter-course`.toLowerCase().replace(/\s+/g, "-"),
      description: `A concise, practical ${cleanTopic} course covering fundamentals and guided practice.`,
      difficulty_level: "Beginner",
      estimated_minutes: 90,
    },
    resources: [
      {
        title: `${cleanTopic} Intro Video`,
        resource_type: "video",
        provider: "YouTube",
        url: `https://www.youtube.com/results?search_query=${encodeURIComponent(cleanTopic + " introduction")}`,
        summary: `Overview of ${cleanTopic} concepts.`,
        display_order: 1,
      },
      {
        title: `${cleanTopic} Practical Guide`,
        resource_type: "article",
        provider: "Documentation",
        url: `https://duckduckgo.com/?q=${encodeURIComponent(cleanTopic + " guide")}`,
        summary: `Readable guide with examples for ${cleanTopic}.`,
        display_order: 2,
      },
      {
        title: `${cleanTopic} Hands-on Tutorial`,
        resource_type: "tutorial",
        provider: "Pathly Lab",
        url: `https://duckduckgo.com/?q=${encodeURIComponent(cleanTopic + " tutorial")}`,
        summary: `Hands-on tutorial to practice ${cleanTopic}.`,
        display_order: 3,
      },
    ],
  };
}

async function generateCoursePackageWithAi(topic: string): Promise<AiGeneratedCoursePackage> {
  const { output } = await generateStructuredJson({
    feature: "smart_course_content_generation",
    promptVersion: "smart_course_content_generation_v1",
    systemInstruction: buildCourseGenerationSystemPrompt(),
    input: buildCourseGenerationInput(topic),
    outputSchema: aiGeneratedCoursePackageSchema,
    fallback: () => buildDeterministicFallback(topic),
    temperature: 0.2,
    maxOutputTokens: 2200,
  });

  const parsed = aiGeneratedCoursePackageSchema.safeParse(output);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Generated course JSON is invalid.");
  }
  return parsed.data;
}

export async function getOrGenerateCourseByTopic(topic: string): Promise<GetOrGenerateCourseResult> {
  const normalizedTopic = topic.trim();
  if (!normalizedTopic) {
    throw new Error("Topic is required.");
  }

  // 1) In-memory cache hit short-circuits database/AI work.
  const cached = getCachedCourse(normalizedTopic);
  if (cached) {
    return {
      source: "cache",
      data: cached,
    };
  }

  // 2) Database first: exact/similar topic search.
  const existing = await findCourseWithResourcesByTopic(normalizedTopic);
  if (existing) {
    setCachedCourse(normalizedTopic, existing);
    return {
      source: "database",
      data: existing,
    };
  }

  // 3) No DB match: generate with AI, validate, insert course+resources, then return.
  const generatedPackage = await generateCoursePackageWithAi(normalizedTopic);
  const inserted = await insertGeneratedCourseWithResources({
    topic: normalizedTopic,
    generated: generatedPackage,
  });

  setCachedCourse(normalizedTopic, inserted);
  return {
    source: "ai_generated",
    data: inserted,
  };
}
