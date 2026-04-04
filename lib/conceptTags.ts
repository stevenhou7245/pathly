type ExtractConceptTagsParams = {
  texts?: Array<string | null | undefined>;
  maxTags?: number;
};

const GENERIC_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "be",
  "by",
  "course",
  "for",
  "from",
  "in",
  "into",
  "is",
  "it",
  "lesson",
  "module",
  "of",
  "on",
  "or",
  "question",
  "resource",
  "section",
  "that",
  "the",
  "this",
  "to",
  "topic",
  "unit",
  "with",
]);

const DISALLOWED_SINGLE_TAGS = new Set([
  "machine",
  "learning",
  "for",
  "course",
  "lesson",
  "concept",
  "question",
  "topic",
  "general",
  "foundation",
  "mathematics",
  "algebra",
  "calculus",
]);

const TOKEN_DROP_WORDS = new Set([
  "machine",
  "learning",
  "for",
  "course",
  "lesson",
  "concept",
  "question",
  "topic",
  "general",
  "foundation",
  "module",
  "unit",
]);

const PHRASE_PATTERNS: Array<{ pattern: RegExp; tag: string }> = [
  { pattern: /\blinear algebra\b/gi, tag: "linear_algebra" },
  { pattern: /\bmatrix multiplication\b/gi, tag: "matrix_multiplication" },
  { pattern: /\bmatrix inverse\b/gi, tag: "matrix_inverse" },
  { pattern: /\beigenvalue(s)?\b/gi, tag: "eigenvalues" },
  { pattern: /\bpartial derivative(s)?\b/gi, tag: "partial_derivatives" },
  { pattern: /\bgradient descent\b/gi, tag: "gradient_descent" },
  { pattern: /\blogistic regression\b/gi, tag: "logistic_regression" },
  { pattern: /\blinear regression\b/gi, tag: "linear_regression" },
  { pattern: /\bdata cleaning\b/gi, tag: "data_cleaning" },
  { pattern: /\bmissing data\b/gi, tag: "missing_data" },
  { pattern: /\bfeature engineering\b/gi, tag: "feature_engineering" },
  { pattern: /\bcross validation\b/gi, tag: "cross_validation" },
  { pattern: /\boverfitting\b/gi, tag: "overfitting" },
  { pattern: /\bunderfitting\b/gi, tag: "underfitting" },
  { pattern: /\bconfusion matrix\b/gi, tag: "confusion_matrix" },
  { pattern: /\bclassification report\b/gi, tag: "classification_metrics" },
  { pattern: /\bpandas\b/gi, tag: "pandas" },
  { pattern: /\bnumpy\b/gi, tag: "numpy" },
  { pattern: /\bdataframe\b/gi, tag: "dataframe_operations" },
  { pattern: /\bgroup by\b/gi, tag: "groupby_aggregation" },
  { pattern: /\bmerge(s|d)?\b/gi, tag: "data_merge" },
  { pattern: /\bjoin(s|ed)?\b/gi, tag: "data_join" },
  { pattern: /\bapi\b/gi, tag: "api_usage" },
  { pattern: /\bdebug(ging)?\b/gi, tag: "debugging" },
  { pattern: /\bcode review\b/gi, tag: "code_review" },
];

const ACRONYM_LABELS = new Map<string, string>([
  ["api", "API"],
  ["sql", "SQL"],
  ["json", "JSON"],
  ["ml", "ML"],
  ["ai", "AI"],
  ["ui", "UI"],
  ["ux", "UX"],
]);

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function toSafeText(value: unknown) {
  return normalizeWhitespace(typeof value === "string" ? value : "");
}

function splitTokens(value: string) {
  return value
    .toLowerCase()
    .replace(/[`~!@#$%^&*()+=[\]{}\\|;:'",.<>/?]/g, " ")
    .replace(/[-_]+/g, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function normalizeConceptTag(value: unknown) {
  const raw = toSafeText(value);
  if (!raw) {
    return "";
  }

  const stripped = raw
    .toLowerCase()
    .replace(/\bconcept\b/g, " ")
    .replace(/\b(skill|topic|lesson|module|question)\b/g, " ")
    .replace(/\b\d+\b/g, " ");

  const tokens = splitTokens(stripped).filter(
    (token) => token.length >= 2 && !GENERIC_STOP_WORDS.has(token),
  );
  if (tokens.length === 0) {
    return "";
  }

  const meaningfulTokens = tokens.filter((token) => !TOKEN_DROP_WORDS.has(token));
  if (meaningfulTokens.length === 0) {
    return "";
  }
  const normalized = meaningfulTokens.slice(0, 3).join("_");
  if (!normalized) {
    return "";
  }
  if (DISALLOWED_SINGLE_TAGS.has(normalized)) {
    return "";
  }

  console.info("[concept] normalized_tag", {
    input: raw,
    normalized_tag: normalized,
  });
  return normalized;
}

export function formatConceptLabel(value: unknown) {
  const normalized = normalizeConceptTag(value);
  if (!normalized) {
    return "Unknown";
  }
  const label = normalized
    .split("_")
    .filter(Boolean)
    .map((part) => {
      const acronym = ACRONYM_LABELS.get(part);
      if (acronym) {
        return acronym;
      }
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(" ");

  console.info("[concept] display_label", {
    concept_tag: normalized,
    display_label: label,
  });
  return label;
}

export function extractConceptTags(params: ExtractConceptTagsParams) {
  const combined = (params.texts ?? [])
    .map((item) => toSafeText(item))
    .filter(Boolean)
    .join(" ");

  if (!combined) {
    console.info("[concept] extracted_tags", { extracted_tags: [] });
    return [] as string[];
  }

  const extracted: string[] = [];
  const pushTag = (rawTag: string) => {
    const normalized = normalizeConceptTag(rawTag);
    if (!normalized || extracted.includes(normalized)) {
      return;
    }
    extracted.push(normalized);
  };

  for (const rule of PHRASE_PATTERNS) {
    if (rule.pattern.test(combined)) {
      pushTag(rule.tag);
    }
  }

  const tokens = splitTokens(combined).filter(
    (token) => token.length >= 3 && !GENERIC_STOP_WORDS.has(token),
  );
  const uniqueTokens = Array.from(new Set(tokens));

  for (const token of uniqueTokens) {
    if (DISALLOWED_SINGLE_TAGS.has(token)) {
      continue;
    }
    pushTag(token);
  }

  for (let index = 0; index < uniqueTokens.length - 1; index += 1) {
    const first = uniqueTokens[index];
    const second = uniqueTokens[index + 1];
    const candidate = normalizeConceptTag(`${first}_${second}`);
    if (!candidate) {
      continue;
    }
    if (!extracted.includes(candidate)) {
      extracted.push(candidate);
    }
  }

  const limited = extracted.slice(0, Math.max(1, params.maxTags ?? 8));
  console.info("[concept] extracted_tags", {
    extracted_tags: limited,
    candidate_count: extracted.length,
  });
  return limited;
}
