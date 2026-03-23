import { getTavilyClient } from "@/lib/tavilyClient";
import { installAiPipelineDebugLogFilter } from "@/lib/aiPipelineDebugLogging";

export type TavilyCandidateResource = {
  title: string;
  url: string;
  content: string;
  raw_content: string | null;
  score: number;
};

const DEFAULT_EXCLUDED_DOMAINS = ["google.com", "bing.com", "baidu.com", "example.com"];

function normalizeField(value: string) {
  return value.trim().toLowerCase();
}

function preferredDomainsForField(fieldTitle: string) {
  const normalized = normalizeField(fieldTitle);
  if (/(html|css|javascript|react|next\.?js|node\.?js|web)/.test(normalized)) {
    return ["developer.mozilla.org", "w3schools.com", "freecodecamp.org"];
  }
  if (/(toefl|ielts|english|language)/.test(normalized)) {
    return ["ets.org", "cambridgeenglish.org", "britishcouncil.org"];
  }
  if (/(python|java|c\+\+|programming|software)/.test(normalized)) {
    return ["docs.python.org", "oracle.com", "geeksforgeeks.org"];
  }
  return [];
}

function isSearchOrHomepageUrl(url: string) {
  const normalized = url.trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (!/^https?:\/\//.test(normalized)) {
    return true;
  }

  try {
    const parsed = new URL(normalized);
    const isHomepage = (parsed.pathname || "/") === "/" && !parsed.search;
    if (isHomepage) {
      return true;
    }
  } catch {
    return true;
  }

  return (
    /google\.[^/]+\/search/.test(normalized) ||
    /bing\.com\/search/.test(normalized) ||
    /duckduckgo\.com\/\?q=/.test(normalized)
  );
}

type SearchResultShape = {
  title: string;
  url: string;
  content: string;
  rawContent?: string;
  score: number;
};

function toCandidate(result: SearchResultShape): TavilyCandidateResource | null {
  const title = (result.title ?? "").trim();
  const url = (result.url ?? "").trim();
  if (!title || !url) {
    return null;
  }
  return {
    title,
    url,
    content: (result.content ?? "").trim(),
    raw_content: (result.rawContent ?? null) as string | null,
    score: Number.isFinite(result.score) ? result.score : 0,
  };
}

export async function searchAndExtractCandidatesForStep(params: {
  userFieldId: string;
  fieldTitle: string;
  stepTitle: string;
  userLevel: string;
  maxResults?: number;
}) {
  installAiPipelineDebugLogFilter();

  const client = getTavilyClient();
  if (!client) {
    console.warn("[tavily] request_failed", {
      query: `${params.fieldTitle} ${params.stepTitle} ${params.userLevel} tutorial official documentation`,
      field_title: params.fieldTitle,
      step_title: params.stepTitle,
      message: "TAVILY_API_KEY is not configured.",
    });
    return [] as TavilyCandidateResource[];
  }

  const maxResults = Math.max(3, Math.min(5, Math.floor(params.maxResults ?? 5)));
  const query = `${params.fieldTitle} ${params.stepTitle} ${params.userLevel} tutorial official documentation`;
  const includeDomains = preferredDomainsForField(params.fieldTitle);

  console.info("[tavily] request_started", {
    query,
    field_title: params.fieldTitle,
    step_title: params.stepTitle,
    user_level: params.userLevel,
    max_results: maxResults,
  });

  let searchResponse: { results?: SearchResultShape[]; requestId?: string };
  try {
    searchResponse = await client.search(query, {
      maxResults,
      includeRawContent: false,
      includeDomains: includeDomains.length > 0 ? includeDomains : undefined,
      excludeDomains: DEFAULT_EXCLUDED_DOMAINS,
      searchDepth: "advanced",
    });
  } catch (error) {
    console.error("[tavily] request_failed", {
      query,
      field_title: params.fieldTitle,
      step_title: params.stepTitle,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    });
    throw error;
  }

  const initialCandidates = ((searchResponse.results ?? []) as SearchResultShape[])
    .map(toCandidate)
    .filter((candidate): candidate is TavilyCandidateResource => Boolean(candidate))
    .filter((candidate) => !isSearchOrHomepageUrl(candidate.url));

  const uniqueByUrl = new Map<string, TavilyCandidateResource>();
  initialCandidates.forEach((candidate) => {
    if (!uniqueByUrl.has(candidate.url)) {
      uniqueByUrl.set(candidate.url, candidate);
    }
  });

  const candidates = Array.from(uniqueByUrl.values()).slice(0, maxResults);
  console.info("[tavily] request_succeeded", {
    field_title: params.fieldTitle,
    step_title: params.stepTitle,
    request_id: searchResponse.requestId,
    result_count: candidates.length,
  });
  console.info(
    "[tavily] search_results",
    candidates.slice(0, 5).map((candidate) => ({
      title: candidate.title,
      url: candidate.url,
      source: "tavily",
    })),
  );

  return candidates;
}
