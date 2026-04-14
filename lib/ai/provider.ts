import { z } from "zod";
import { toStableJson, toStringValue } from "@/lib/ai/common";
import { getDeepseekClient } from "@/lib/deepseekClient";
import { installAiPipelineDebugLogFilter } from "@/lib/aiPipelineDebugLogging";

export type AiProvenance = {
  provider: "deepseek" | "deterministic";
  model: string;
  prompt_version: string;
  generated_at: string;
  fallback_used: boolean;
  failure_reason: string | null;
};

export type StructuredGenerationResult<T> = {
  output: T;
  provenance: AiProvenance;
  debug: {
    ai_called: boolean;
    raw_response_text: string | null;
    parsed_output_json: unknown | null;
  };
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

function extractCompletionText(value: unknown) {
  const direct = toStringValue(value);
  if (direct) {
    return direct;
  }

  if (Array.isArray(value)) {
    const text = value
      .map((item) => {
        const record = (item ?? {}) as Record<string, unknown>;
        return toStringValue(record.text) || toStringValue(record.value);
      })
      .join(" ")
      .trim();
    if (text) {
      return text;
    }
  }

  return "";
}

export async function generateStructuredJson<T>(
  params: GenerateStructuredJsonParams<T>,
): Promise<StructuredGenerationResult<T>> {
  installAiPipelineDebugLogFilter();

  const nowIso = new Date().toISOString();
  const model = process.env.DEEPSEEK_MODEL?.trim() || "deepseek-chat";
  const hasDeepseekKey = Boolean(process.env.DEEPSEEK_API_KEY?.trim());
  const client = getDeepseekClient();

  console.info("[deepseek] request_started", {
    feature: params.feature,
    model,
    deepseek_api_key_present: hasDeepseekKey,
  });

  const inputPayload = {
    feature: params.feature,
    prompt_version: params.promptVersion,
    generated_at: nowIso,
    input: params.input,
  };

  if (!client) {
    console.warn("[deepseek] request_failed", {
      feature: params.feature,
      model,
      message: "DEEPSEEK_API_KEY is not configured.",
    });
    const fallbackOutput = params.fallback();
    return {
      output: fallbackOutput,
      provenance: {
        provider: "deterministic",
        model: "deterministic-fallback",
        prompt_version: params.promptVersion,
        generated_at: nowIso,
        fallback_used: true,
        failure_reason: "DEEPSEEK_API_KEY is not configured.",
      },
      debug: {
        ai_called: false,
        raw_response_text: null,
        parsed_output_json: fallbackOutput,
      },
    };
  }

  let rawResponseText: string | null = null;
  let parsedOutputJson: unknown | null = null;
  try {
    const completion = await client.chat.completions.create({
      model,
      temperature: params.temperature ?? 0.3,
      max_tokens: params.maxOutputTokens ?? 2600,
      messages: [
        {
          role: "system",
          content: params.systemInstruction,
        },
        {
          role: "user",
          content: [
            "Generate a valid JSON object only.",
            "Use double quotes for every key and string value.",
            "Escape internal double quotes as \\\" and backslashes as \\\\.",
            "Do not output markdown, comments, or any text outside JSON.",
            "Use this input payload:",
            toStableJson(inputPayload),
          ].join("\n"),
        },
      ],
      response_format: {
        type: "json_object",
      },
    });

    const messageContent = completion.choices?.[0]?.message?.content ?? "";
    const text = extractCompletionText(messageContent);
    rawResponseText = text || null;

    if (!text) {
      throw new Error("DeepSeek returned an empty completion payload.");
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(text) as unknown;
    } catch (parseError) {
      console.error("[deepseek] json_parse_failed", {
        feature: params.feature,
        model,
        message: parseError instanceof Error ? parseError.message : String(parseError),
        raw_response_length: text.length,
        raw_response_head: text.slice(0, 240),
        raw_response_tail: text.slice(Math.max(0, text.length - 240)),
      });
      throw new Error(
        `JSON parse failed: ${
          parseError instanceof Error ? parseError.message : String(parseError)
        }`,
      );
    }
    parsedOutputJson = parsedJson;
    const parsed = params.outputSchema.safeParse(parsedJson);

    if (!parsed.success) {
      throw new Error(parsed.error.issues[0]?.message ?? "Invalid AI JSON schema output.");
    }

    console.info("[deepseek] request_succeeded", {
      feature: params.feature,
      model,
    });

    console.info("[deepseek] raw_response_text", rawResponseText);

    try {
      console.info(
        "[deepseek] parsed_output_json_pretty",
        JSON.stringify(parsedOutputJson, null, 2),
      );
    } catch (error) {
      console.info("[deepseek] parsed_output_json_pretty_failed", {
        reason: error instanceof Error ? error.message : String(error),
      });
    }
    return {
      output: parsed.data,
      provenance: {
        provider: "deepseek",
        model,
        prompt_version: params.promptVersion,
        generated_at: nowIso,
        fallback_used: false,
        failure_reason: null,
      },
      debug: {
        ai_called: true,
        raw_response_text: rawResponseText,
        parsed_output_json: parsedOutputJson,
      },
    };
  } catch (error) {
    const errorRecord = (error ?? {}) as Record<string, unknown>;
    console.error("[deepseek] request_failed", {
      feature: params.feature,
      model,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
      error_code: toStringValue(errorRecord.code) || null,
      error_details: toStringValue(errorRecord.details) || null,
      error_hint: toStringValue(errorRecord.hint) || null,
      raw_response_text: rawResponseText,
    });

    try {
      console.error(
        "[deepseek] parsed_output_json_pretty",
        JSON.stringify(parsedOutputJson, null, 2),
      );
    } catch (prettyError) {
      console.error("[deepseek] parsed_output_json_pretty_failed", {
        reason: prettyError instanceof Error ? prettyError.message : String(prettyError),
      });
    }
    const fallbackOutput = params.fallback();
    return {
      output: fallbackOutput,
      provenance: {
        provider: "deterministic",
        model: "deterministic-fallback",
        prompt_version: params.promptVersion,
        generated_at: nowIso,
        fallback_used: true,
        failure_reason: error instanceof Error ? error.message : String(error),
      },
      debug: {
        ai_called: true,
        raw_response_text: rawResponseText,
        parsed_output_json: parsedOutputJson ?? fallbackOutput,
      },
    };
  }
}
