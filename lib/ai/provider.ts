import { z } from "zod";
import { toStableJson, toStringValue } from "@/lib/ai/common";

export type AiProvenance = {
  provider: "openai" | "deterministic";
  model: string;
  prompt_version: string;
  generated_at: string;
  fallback_used: boolean;
  failure_reason: string | null;
};

export type StructuredGenerationResult<T> = {
  output: T;
  provenance: AiProvenance;
};

type GenerateStructuredJsonParams<T> = {
  feature: string;
  promptVersion: string;
  systemInstruction: string;
  input: unknown;
  outputSchema: z.ZodType<T>;
  fallback: () => T;
  temperature?: number;
  maxOutputTokens?: number;
};

function extractResponseText(payload: unknown) {
  const root = (payload ?? {}) as Record<string, unknown>;

  const outputArray = Array.isArray(root.output) ? root.output : [];
  for (const outputItem of outputArray) {
    const outputRecord = outputItem as Record<string, unknown>;
    const contentArray = Array.isArray(outputRecord.content) ? outputRecord.content : [];
    for (const contentItem of contentArray) {
      const contentRecord = contentItem as Record<string, unknown>;
      const textCandidate =
        toStringValue(contentRecord.text) ||
        toStringValue(contentRecord.output_text) ||
        toStringValue(contentRecord.value);
      if (textCandidate) {
        return textCandidate;
      }
    }
  }

  const outputText = toStringValue(root.output_text);
  if (outputText) {
    return outputText;
  }

  const text = toStringValue(root.text);
  if (text) {
    return text;
  }

  return "";
}

function asObjectSchema(zodSchema: z.ZodType<unknown>) {
  const jsonSchemaObject = {
    type: "object",
    additionalProperties: true,
  };

  try {
    const jsonSchema = z.toJSONSchema(zodSchema as z.ZodType<unknown>);
    if (jsonSchema && typeof jsonSchema === "object") {
      return {
        ...jsonSchemaObject,
        ...(jsonSchema as Record<string, unknown>),
      };
    }
  } catch {
    return jsonSchemaObject;
  }

  return jsonSchemaObject;
}

export async function generateStructuredJson<T>(
  params: GenerateStructuredJsonParams<T>,
): Promise<StructuredGenerationResult<T>> {
  const nowIso = new Date().toISOString();
  const model = process.env.OPENAI_MODEL?.trim() || "gpt-5.2";
  const openAiKey = process.env.OPENAI_API_KEY?.trim();
  const inputPayload = {
    feature: params.feature,
    prompt_version: params.promptVersion,
    generated_at: nowIso,
    input: params.input,
  };

  if (!openAiKey) {
    return {
      output: params.fallback(),
      provenance: {
        provider: "deterministic",
        model: "deterministic-fallback",
        prompt_version: params.promptVersion,
        generated_at: nowIso,
        fallback_used: true,
        failure_reason: "OPENAI_API_KEY is not configured.",
      },
    };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: params.temperature ?? 0.3,
        max_output_tokens: params.maxOutputTokens ?? 2600,
        input: [
          {
            role: "system",
            content: [{ type: "input_text", text: params.systemInstruction }],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: [
                  "Generate a valid JSON object only.",
                  "Use this input payload:",
                  toStableJson(inputPayload),
                ].join("\n"),
              },
            ],
          },
        ],
        text: {
          format: {
            type: "json_schema",
            name: `${params.feature}_output`,
            strict: true,
            schema: asObjectSchema(params.outputSchema),
          },
        },
      }),
    });

    if (!response.ok) {
      const responseText = await response.text();
      throw new Error(`OpenAI API returned ${response.status}: ${responseText.slice(0, 600)}`);
    }

    const rawPayload = (await response.json()) as unknown;
    const text = extractResponseText(rawPayload);
    const parsedJson = text ? JSON.parse(text) : rawPayload;
    const parsed = params.outputSchema.safeParse(parsedJson);

    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message ?? "Invalid AI JSON schema output.");
    }

    return {
      output: parsed.data,
      provenance: {
        provider: "openai",
        model,
        prompt_version: params.promptVersion,
        generated_at: nowIso,
        fallback_used: false,
        failure_reason: null,
      },
    };
  } catch (error) {
    console.error("[ai_provider] structured_generation_failed", {
      feature: params.feature,
      prompt_version: params.promptVersion,
      model,
      reason: error instanceof Error ? error.message : String(error),
    });
    return {
      output: params.fallback(),
      provenance: {
        provider: "deterministic",
        model: "deterministic-fallback",
        prompt_version: params.promptVersion,
        generated_at: nowIso,
        fallback_used: true,
        failure_reason: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
