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
      }),
    )
    .min(1)
    .max(20),
});

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

    steps.push({
      title: stepTitle,
      description: `Step ${stepNumber}: build ${slug} capability from ${params.startLevel} toward ${params.targetLevel} through ${stageLabel.toLowerCase()}.`,
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

    normalized.push({
      step_number: i + 1,
      title,
      summary,
      resources: [],
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
    promptVersion: "learning_steps_plan_v3",
    systemInstruction: [
      "You create topic-specific learning path skeletons.",
      "Return JSON only. Do not include markdown or prose.",
      "Output must be an object with keys: template_name, total_steps, steps.",
      'Each step object must have exactly: "title", "description".',
      "Use concrete topic-specific step names and skill focus.",
      "Avoid placeholders like milestone, generic practice, or numbered filler titles.",
      "Examples for TOEFL style titles: TOEFL Reading Foundations, TOEFL Listening Note-Taking, TOEFL Speaking Task 1 Strategies, TOEFL Independent Writing Basics.",
      "Examples for HTML style titles: HTML Basics, Semantic HTML, Forms and Inputs, HTML Structure Practice.",
      "Do not include detailed resources, links, materials, quizzes, or exercises.",
      "This is a fast skeleton-only generation pass.",
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
