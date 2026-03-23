import OpenAI from "openai";

let cachedDeepseekClient: OpenAI | null = null;

export function getDeepseekClient() {
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim() || "";
  if (!apiKey) {
    return null;
  }

  if (!cachedDeepseekClient) {
    cachedDeepseekClient = new OpenAI({
      baseURL: "https://api.deepseek.com",
      apiKey,
    });
  }

  return cachedDeepseekClient;
}
