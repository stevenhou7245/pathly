import { z } from "zod";
import { generateStructuredJson } from "@/lib/ai/provider";
import { type LearningStepResource, type LearningStepResourceType } from "@/lib/ai/learningSteps";
import { searchAndExtractCandidatesForStep } from "@/lib/tavilySearch";
import { installAiPipelineDebugLogFilter } from "@/lib/aiPipelineDebugLogging";

type TavilyCandidate = Awaited<ReturnType<typeof searchAndExtractCandidatesForStep>>[number];

type DeepseekCandidate = {
  title: string;
  url: string;
  snippet: string;
  source: string;
};

const deepseekResourceSchema = z
  .object({
    resources: z
      .array(
        z
          .object({
            title: z.string().min(1).max(180),
            url: z.string().min(1).max(700),
            resource_type: z.enum(["video", "article", "tutorial", "interactive", "document"]),
            provider: z.string().min(1).max(140),
            summary: z.string().min(1).max(280),
            difficulty: z.enum(["beginner", "intermediate", "advanced"]),
            estimated_minutes: z.number().int().min(5).max(240),
          })
          .strict(),
      )
      .min(1)
      .max(3),
  })
  .strict();

function truncate(text: string, max = 200) {
  const normalized = text.trim().replace(/\s+/g, " ");
  if (normalized.length <= max) {
    return normalized;
  }
  return normalized.slice(0, max);
}

function toSource(url: string) {
  try {
    return new URL(url).hostname || "web";
  } catch {
    return "web";
  }
}

function isDirectHttpUrl(url: string) {
  const normalized = url.trim().toLowerCase();
  if (!/^https?:\/\//.test(normalized)) {
    return false;
  }
  if (/google\.[^/]+\/search|bing\.com\/search|duckduckgo\.com\/\?q=/.test(normalized)) {
    return false;
  }
  if (/example\.com/.test(normalized)) {
    return false;
  }
  return true;
}

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

function normalizeCandidates(candidates: TavilyCandidate[]) {
  return candidates
    .map((candidate) => ({
      title: truncate(candidate.title || "Resource", 140),
      url: candidate.url.trim(),
      snippet: truncate(candidate.content || "", 200),
      source: toSource(candidate.url),
    }))
    .filter((candidate) => isDirectHttpUrl(candidate.url))
    .slice(0, 5);
}

function estimatePromptSize(params: {
  stepTitle: string;
  stepDescription: string;
  candidates: DeepseekCandidate[];
}) {
  const json = JSON.stringify({
    step_title: params.stepTitle,
    step_description: params.stepDescription,
    candidates: params.candidates,
  });
  const charLength = json.length;
  const approxTokens = Math.ceil(charLength / 4);
  return { charLength, approxTokens };
}

function buildPromptInput(params: {
  stepTitle: string;
  stepDescription: string;
  candidates: DeepseekCandidate[];
}) {
  return {
    step_title: params.stepTitle,
    step_description: params.stepDescription,
    candidates: params.candidates,
  };
}

function extractDeepseekOutputKeys(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [] as string[];
  }
  return Object.keys(value as Record<string, unknown>);
}

function isContextLimitError(reason: string | null | undefined) {
  const normalized = (reason || "").toLowerCase();
  return normalized.includes("maximum context length") || normalized.includes("tokens");
}

function mapDeepseekResourcesToLearningResources(resources: z.infer<typeof deepseekResourceSchema>["resources"]) {
  const mapped: Array<LearningStepResource | null> = resources.map((resource) => {
    if (!isDirectHttpUrl(resource.url)) {
      return null;
    }
    return {
      type: resource.resource_type,
      title: resource.title.trim(),
      url: resource.url.trim(),
      provider: resource.provider.trim(),
      difficulty: resource.difficulty.trim(),
      estimated_minutes: Math.max(5, Math.floor(resource.estimated_minutes)),
      ai_selected: true,
      ai_generated_at: new Date().toISOString(),
      reason: truncate(resource.summary, 260),
      status: "valid",
    } satisfies LearningStepResource;
  });
  return mapped
    .filter((resource): resource is LearningStepResource => resource !== null)
    .slice(0, 3);
}

function buildFallbackResources(candidates: DeepseekCandidate[]) {
  return candidates.slice(0, 3).map((candidate) => ({
    type: inferResourceType({ name: candidate.title, url: candidate.url }),
    title: candidate.title,
    url: candidate.url,
    provider: candidate.source || "Tavily",
    difficulty: "intermediate",
    estimated_minutes: 20,
    ai_selected: false,
    ai_generated_at: new Date().toISOString(),
    reason: "Selected directly from Tavily because AI selection was unavailable.",
    status: "valid",
  })) satisfies LearningStepResource[];
}

export async function enrichLearningStepResourcesWithSearch(params: {
  userFieldId: string;
  fieldTitle: string;
  userLevel: string;
  steps: Array<{
    step_number: number;
    title: string;
    summary: string;
    resources: LearningStepResource[];
  }>;
}) {
  installAiPipelineDebugLogFilter();

  const enrichedSteps: Array<{
    step_number: number;
    title: string;
    summary: string;
    resources: LearningStepResource[];
  }> = [];
  let tavilySuccess = false;
  let tavilyResultCount = 0;
  let deepseekSuccess = false;
  let deepseekReturnedSteps = 0;
  let deepseekReturnedResources = 0;

  for (const step of params.steps) {
    console.info("[resource_selection] step_started", {
      user_field_id: params.userFieldId,
      step_number: step.step_number,
      step_title: step.title,
    });

    let candidates: TavilyCandidate[] = [];
    try {
      candidates = await searchAndExtractCandidatesForStep({
        userFieldId: params.userFieldId,
        fieldTitle: params.fieldTitle,
        stepTitle: step.title,
        userLevel: params.userLevel,
        maxResults: 5,
      });
      tavilySuccess = true;
    } catch {
      candidates = [];
    }

    console.info("[resource_selection] tavily_results_count", {
      step_number: step.step_number,
      count: candidates.length,
    });

    const normalizedCandidates = normalizeCandidates(candidates);
    tavilyResultCount += normalizedCandidates.length;
    console.info("[resource_selection] trimmed_candidates_count", {
      step_number: step.step_number,
      count: normalizedCandidates.length,
    });

    if (normalizedCandidates.length === 0) {
      enrichedSteps.push({
        ...step,
        resources: step.resources.map((resource) => ({
          ...resource,
          reason: resource.reason ?? "No trusted Tavily candidate was found for this step.",
        })),
      });
      continue;
    }

    const candidateCaps = Array.from(
      new Set([Math.min(5, normalizedCandidates.length), 3, 2].filter((count) => count <= normalizedCandidates.length)),
    );

    let finalResources: LearningStepResource[] = [];
    let lastFailureReason: string | null = null;

    for (const candidateCap of candidateCaps) {
      const candidatesForPrompt = normalizedCandidates.slice(0, candidateCap);
      const promptSize = estimatePromptSize({
        stepTitle: step.title,
        stepDescription: step.summary,
        candidates: candidatesForPrompt,
      });
      console.info("[resource_selection] prompt_size_estimate", {
        step_number: step.step_number,
        candidate_count: candidatesForPrompt.length,
        char_length: promptSize.charLength,
        approx_tokens: promptSize.approxTokens,
      });
      console.info("[resource_selection] candidates_after_trim", {
        step_number: step.step_number,
        count: candidatesForPrompt.length,
      });

      console.info("[resource_selection] deepseek_request_started", {
        step_number: step.step_number,
        candidate_count: candidatesForPrompt.length,
      });

      const { output, provenance, debug } = await generateStructuredJson({
        feature: "deepseek_resource_selection",
        promptVersion: "deepseek_resource_selection_v3",
        systemInstruction: [
          "You are selecting resources for one learning step.",
          "Return JSON only.",
          "Return exactly this shape: {\"resources\":[...]}",
          "Use only provided candidate URLs.",
          "Do not invent links.",
          "Do not return candidate-only fields like snippet or source in output.",
          "Do not output explanation text outside JSON.",
        ].join(" "),
        input: buildPromptInput({
          stepTitle: step.title,
          stepDescription: truncate(step.summary, 200),
          candidates: candidatesForPrompt,
        }),
        outputSchema: deepseekResourceSchema,
        fallback: () => ({
          resources: candidatesForPrompt.slice(0, 3).map((candidate) => ({
            title: candidate.title,
            url: candidate.url,
            resource_type: inferResourceType({ name: candidate.title, url: candidate.url }),
            provider: candidate.source || "Tavily",
            summary: "Selected directly from Tavily because deterministic fallback was triggered.",
            difficulty: "intermediate" as const,
            estimated_minutes: 20,
          })),
        }),
        temperature: 0.2,
        maxOutputTokens: 900,
      });

      console.info("[resource_selection] raw_deepseek_output_keys", {
        step_number: step.step_number,
        keys: extractDeepseekOutputKeys(debug.parsed_output_json),
      });

      if (!provenance.fallback_used) {
        const mappedResources = mapDeepseekResourcesToLearningResources(output.resources);
        if (mappedResources.length > 0) {
          console.info("[resource_selection] normalized_resource_sample", {
            step_number: step.step_number,
            sample: mappedResources[0],
          });
          finalResources = mappedResources;
          console.info("[resource_selection] deepseek_request_succeeded", {
            step_number: step.step_number,
            candidate_count: candidatesForPrompt.length,
            resource_count: mappedResources.length,
          });
          break;
        }
        lastFailureReason = "DeepSeek returned no valid direct resources.";
      } else {
        lastFailureReason = provenance.failure_reason;
        console.warn("[resource_selection] deepseek_request_failed", {
          step_number: step.step_number,
          candidate_count: candidatesForPrompt.length,
          reason: provenance.failure_reason,
        });
        if (!isContextLimitError(provenance.failure_reason) || candidateCap <= 2) {
          break;
        }
      }
    }

    if (finalResources.length === 0) {
      finalResources = buildFallbackResources(normalizedCandidates);
      if (finalResources.length === 0) {
        finalResources = step.resources.slice(0, 3);
      }
      console.warn("[resource_selection] deepseek_request_failed", {
        step_number: step.step_number,
        candidate_count: normalizedCandidates.length,
        reason: lastFailureReason || "DeepSeek unavailable, fallback to Tavily candidates.",
      });
    } else {
      deepseekSuccess = true;
    }

    deepseekReturnedSteps += 1;
    deepseekReturnedResources += finalResources.length;

    enrichedSteps.push({
      step_number: step.step_number,
      title: step.title,
      summary: step.summary,
      resources: finalResources.slice(0, 3),
    });

  }

  console.info("[pipeline] generation_summary", {
    tavily_success: tavilySuccess,
    tavily_result_count: tavilyResultCount,
    deepseek_success: deepseekSuccess,
    deepseek_returned_steps: deepseekReturnedSteps,
    deepseek_returned_resources: deepseekReturnedResources,
  });

  return {
    steps: enrichedSteps,
    summary: {
      tavily_success: tavilySuccess,
      tavily_result_count: tavilyResultCount,
      deepseek_success: deepseekSuccess,
      deepseek_returned_steps: deepseekReturnedSteps,
      deepseek_returned_resources: deepseekReturnedResources,
    },
  };
}
