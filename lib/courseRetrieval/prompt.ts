export function buildCourseGenerationSystemPrompt() {
  return [
    "You are an expert curriculum and resource designer.",
    "Return valid JSON only. Do not include markdown or any explanation.",
    "Generate one practical course and resource list for the user topic.",
    "The JSON must follow this exact structure:",
    "{",
    '  "course": {',
    '    "title": string,',
    '    "slug": string,',
    '    "description": string,',
    '    "difficulty_level": "Beginner" | "Intermediate" | "Advanced",',
    '    "estimated_minutes": integer',
    "  },",
    '  "resources": [',
    "    {",
    '      "title": string,',
    '      "resource_type": "video" | "article" | "tutorial",',
    '      "provider": string,',
    '      "url": string,',
    '      "summary": string,',
    '      "display_order": integer',
    "    }",
    "  ]",
    "}",
    "Include at least 3 resources.",
    "Keep course descriptions and resource summaries concise and realistic for beginner/intermediate learners.",
  ].join(" ");
}

export function buildCourseGenerationInput(topic: string) {
  return {
    topic,
    requirements: {
      minimum_resource_count: 3,
      output_json_only: true,
      practical_focus: true,
    },
  };
}
