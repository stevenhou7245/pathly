import type { CourseWithResources, GetCourseResponse } from "@/lib/courseRetrieval/types";

export async function fetchCourseByTopic(topic: string): Promise<{
  source: "cache" | "database" | "ai_generated";
  data: CourseWithResources;
}> {
  const response = await fetch("/api/get-course", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ topic }),
  });

  const payload = (await response.json()) as GetCourseResponse;
  if (!response.ok || !payload.success || !payload.data || !payload.source) {
    throw new Error(payload.message ?? "Unable to fetch course.");
  }

  return {
    source: payload.source,
    data: payload.data,
  };
}
