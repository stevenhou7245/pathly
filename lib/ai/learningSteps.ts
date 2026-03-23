import { z } from "zod";
import { generateStructuredJson, type AiProvenance } from "@/lib/ai/provider";
import { toSlug } from "@/lib/ai/common";

export type LearningStepResourceType = "video" | "article" | "tutorial" | "interactive" | "document";

export type LearningStepResource = {
  type: LearningStepResourceType;
  title: string;
  url: string;
  provider?: string | null;
  difficulty?: string | null;
  estimated_minutes?: number | null;
  ai_selected?: boolean | null;
  ai_generated_at?: string | null;
  reason?: string | null;
  status?: "valid" | "invalid" | "unavailable";
};

export type GeneratedLearningStep = {
  step_number: number;
  title: string;
  summary: string;
  resources: LearningStepResource[];
};

export type LearningStepsPlan = {
  total_steps: number;
  steps: GeneratedLearningStep[];
  ai_provenance: AiProvenance;
  generation_source: "ai" | "fallback";
  debug: {
    ai_called: boolean;
    raw_ai_response_text: string | null;
    parsed_ai_json: unknown | null;
  };
};

const learningStepsOutputSchema = z.object({
  template_name: z.string().min(1).max(180).default("Learning Journey"),
  total_steps: z.number().int().min(1).max(20),
  steps: z
    .array(
      z.object({
        title: z.string().min(3).max(140),
        description: z.string().min(8).max(320),
        resources: z
          .array(
            z.object({
              name: z.string().min(1).max(140),
              url: z.string().min(1).max(500),
            }),
          )
          .min(3)
          .max(8),
      }),
    )
    .min(1)
    .max(20),
});

function inferResourceType(params: { name: string; url: string }): LearningStepResourceType {
  const normalized = `${params.name} ${params.url}`.toLowerCase();
  if (/youtube|vimeo|video|watch/.test(normalized)) {
    return "video";
  }
  if (/interactive|sandbox|lab|repl|exercise|quiz|practice/.test(normalized)) {
    return "interactive";
  }
  if (/doc|docs|documentation|pdf/.test(normalized)) {
    return "document";
  }
  if (/article|blog|guide|read/.test(normalized)) {
    return "article";
  }
  return "tutorial";
}

function normalizeResourceUrl(rawUrl: string, fallbackQuery: string) {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "";
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  if (/^www\./i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return `https://duckduckgo.com/?q=${encodeURIComponent(trimmed || fallbackQuery)}`;
}

function buildFallbackResourceLinks(params: {
  fieldTitle: string;
  stepTitle: string;
}) {
  const keyword = `${params.fieldTitle} ${params.stepTitle}`.trim();
  const encodedKeyword = encodeURIComponent(keyword);
  const encodedTutorial = encodeURIComponent(`${keyword} hands on tutorial`);
  const encodedArticle = encodeURIComponent(`${keyword} guide`);
  return [
    {
      type: "video" as const,
      title: `${params.stepTitle} Video`,
      url: `https://www.youtube.com/results?search_query=${encodedKeyword}`,
      provider: "YouTube",
      difficulty: "Beginner",
      estimated_minutes: 20,
      ai_selected: false,
      ai_generated_at: null,
      reason: "Fallback video resource generated from topic search query.",
      status: "valid" as const,
    },
    {
      type: "article" as const,
      title: `${params.stepTitle} Reading`,
      url: `https://duckduckgo.com/?q=${encodedArticle}`,
      provider: "Web",
      difficulty: "Beginner",
      estimated_minutes: 15,
      ai_selected: false,
      ai_generated_at: null,
      reason: "Fallback article resource generated from topic search query.",
      status: "valid" as const,
    },
    {
      type: "tutorial" as const,
      title: `${params.stepTitle} Practice`,
      url: `https://www.coursera.org/search?query=${encodedTutorial}`,
      provider: "Coursera",
      difficulty: "Beginner",
      estimated_minutes: 25,
      ai_selected: false,
      ai_generated_at: null,
      reason: "Fallback tutorial resource generated from topic search query.",
      status: "valid" as const,
    },
  ];
}

function buildFallbackAiResources(params: { fieldTitle: string; stepTitle: string }) {
  const fallback = buildFallbackResourceLinks({
    fieldTitle: params.fieldTitle,
    stepTitle: params.stepTitle,
  });
  return fallback.map((resource) => ({
    name: resource.title,
    url: resource.url,
  }));
}

function buildDeterministicSteps(params: {
  fieldTitle: string;
  startLevel: string;
  targetLevel: string;
  totalSteps: number;
}) {
  const steps: Array<z.infer<typeof learningStepsOutputSchema>["steps"][number]> = [];
  const slug = toSlug(params.fieldTitle) || "learning";
  const normalizedField = params.fieldTitle.trim().toLowerCase();
  const fallbackTitleCatalog = (() => {
    if (normalizedField.includes("ielts")) {
      return [
        "IELTS Reading Foundations",
        "IELTS Listening Strategies",
        "IELTS Speaking Part 1 Basics",
        "IELTS Task 2 Writing Structure",
        "IELTS Reading Skimming and Scanning",
        "IELTS Listening Distractor Detection",
        "IELTS Speaking Part 2 Story Flow",
        "IELTS Writing Task 1 Data Overview",
        "IELTS Full Mock Test Practice",
      ];
    }
    if (normalizedField.includes("toefl")) {
      return [
        "TOEFL Reading Foundations",
        "TOEFL Listening Note-Taking",
        "TOEFL Speaking Task 1 Strategies",
        "TOEFL Independent Writing Basics",
        "TOEFL Reading Accuracy Drills",
        "TOEFL Listening Detail Recognition",
        "TOEFL Speaking Task 2-4 Fluency",
        "TOEFL Integrated Writing Structure",
        "TOEFL Timed Mock Test Practice",
      ];
    }
    if (normalizedField === "html" || normalizedField.includes("html")) {
      return [
        "HTML Basics",
        "Semantic HTML",
        "Forms and Inputs",
        "HTML Structure Practice",
        "Tables and Media Embeds",
        "Accessible Markup Patterns",
        "HTML Page Layout Workshop",
      ];
    }
    return [];
  })();

  for (let index = 0; index < params.totalSteps; index += 1) {
    const stepNumber = index + 1;
    const stageLabel =
      stepNumber <= 2
        ? "Foundations"
        : stepNumber <= Math.max(3, Math.floor(params.totalSteps * 0.66))
          ? "Guided Practice"
          : "Performance Practice";
    const catalogTitle = fallbackTitleCatalog[index] ?? "";
    const stepTitle = catalogTitle || `${params.fieldTitle} ${stageLabel} ${stepNumber}`;
    const resources = buildFallbackAiResources({
      fieldTitle: params.fieldTitle,
      stepTitle,
    });

    steps.push({
      title: stepTitle,
      description: `Step ${stepNumber}: build ${slug} capability from ${params.startLevel} toward ${params.targetLevel} through ${stageLabel.toLowerCase()}.`,
      resources,
    });
  }

  return {
    template_name: `${params.fieldTitle} Journey`,
    total_steps: params.totalSteps,
    steps,
  };
}

function normalizePlan(params: {
  requestedTotalSteps: number;
  fieldTitle: string;
  output: z.infer<typeof learningStepsOutputSchema>;
}) {
  const targetTotal = Math.max(1, Math.min(20, params.requestedTotalSteps));
  const sorted = [...params.output.steps];
  const normalized: GeneratedLearningStep[] = [];

  for (let i = 0; i < targetTotal; i += 1) {
    const source = sorted[i] ?? sorted[0];
    const title = source?.title?.trim() || `Step ${i + 1}`;
    const summary = source?.description?.trim() || `Complete step ${i + 1}.`;
    let resources: LearningStepResource[] = (source?.resources ?? [])
      .map((item) => {
        const resourceTitle = item.name.trim() || `${title} resource`;
        const normalizedUrl = normalizeResourceUrl(
          item.url,
          `${params.fieldTitle} ${resourceTitle}`,
        );
        if (!normalizedUrl) {
          return null;
        }
        const inferredType = inferResourceType({ name: resourceTitle, url: normalizedUrl });
        return {
          type: inferredType,
          title: resourceTitle,
          url: normalizedUrl,
          provider: "Web",
          difficulty: "Intermediate",
          estimated_minutes: 20,
          ai_selected: true,
          ai_generated_at: new Date().toISOString(),
          status: "valid" as const,
        } satisfies LearningStepResource;
      })
      .filter((item): item is NonNullable<typeof item> => Boolean(item));

    const fallbackResources = buildFallbackResourceLinks({
      fieldTitle: params.fieldTitle,
      stepTitle: title,
    });
    if (resources.length < 3) {
      for (const fallbackResource of fallbackResources) {
        if (resources.length >= 3) {
          break;
        }
        const alreadyIncluded = resources.some(
          (resource) =>
            resource.url === fallbackResource.url || resource.title === fallbackResource.title,
        );
        if (alreadyIncluded) {
          continue;
        }
        resources.push(fallbackResource);
      }
    }
    if (resources.length === 0) {
      resources = fallbackResources;
    } else {
      resources = resources.slice(0, 3);
    }

    normalized.push({
      step_number: i + 1,
      title,
      summary,
      resources,
    });
  }

  return normalized;
}

export async function generateLearningStepsPlan(params: {
  fieldTitle: string;
  startLevel: string;
  targetLevel: string;
  totalSteps: number;
}): Promise<LearningStepsPlan> {
  const boundedTotalSteps = Math.max(1, Math.min(20, Math.floor(params.totalSteps)));
  console.info("[learning_steps_ai] generation_requested", {
    field_title: params.fieldTitle,
    start_level: params.startLevel,
    target_level: params.targetLevel,
    requested_total_steps: boundedTotalSteps,
  });

  const { output, provenance, debug } = await generateStructuredJson({
    feature: "learning_steps_plan",
    promptVersion: "learning_steps_plan_v2",
    systemInstruction: [
      "You create topic-specific learning steps.",
      "Return JSON only. Do not include markdown or prose.",
      "Output must be an object with keys: template_name, total_steps, steps.",
      'Each step object must have exactly: "title", "description", "resources".',
      'Each resource object must have exactly: "name", "url".',
      "Resource url is plain string text (do not enforce uri formatting).",
      "Provide at least 3 resources per step.",
      "Use concrete topic-specific step names and skill focus.",
      "Avoid placeholders like milestone, generic practice, or numbered filler titles.",
      "Examples for TOEFL style titles: TOEFL Reading Foundations, TOEFL Listening Note-Taking, TOEFL Speaking Task 1 Strategies, TOEFL Independent Writing Basics.",
      "Examples for HTML style titles: HTML Basics, Semantic HTML, Forms and Inputs, HTML Structure Practice.",
    ].join(" "),
    input: {
      field_title: params.fieldTitle,
      start_level: params.startLevel,
      target_level: params.targetLevel,
      total_steps: boundedTotalSteps,
    },
    outputSchema: learningStepsOutputSchema,
    fallback: () =>
      buildDeterministicSteps({
        fieldTitle: params.fieldTitle,
        startLevel: params.startLevel,
        targetLevel: params.targetLevel,
        totalSteps: boundedTotalSteps,
      }),
  });
  const normalizedSteps = normalizePlan({
    requestedTotalSteps: boundedTotalSteps,
    fieldTitle: params.fieldTitle,
    output,
  });
  const generationSource: "ai" | "fallback" =
    provenance.provider === "deepseek" && !provenance.fallback_used ? "ai" : "fallback";

  console.info("[learning_steps_ai] generation_result", {
    field_title: params.fieldTitle,
    ai_called: debug.ai_called,
    model: provenance.model,
    provider: provenance.provider,
    fallback_used: provenance.fallback_used,
    generation_source: generationSource,
    raw_ai_response_text: debug.raw_response_text,
    parsed_ai_json: debug.parsed_output_json,
    normalized_step_count: normalizedSteps.length,
  });

  return {
    total_steps: boundedTotalSteps,
    steps: normalizedSteps,
    ai_provenance: provenance,
    generation_source: generationSource,
    debug: {
      ai_called: debug.ai_called,
      raw_ai_response_text: debug.raw_response_text,
      parsed_ai_json: debug.parsed_output_json,
    },
  };
}
