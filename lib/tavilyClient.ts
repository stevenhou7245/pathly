import { tavily, type TavilyClient } from "@tavily/core";

let cachedClient: TavilyClient | null = null;

export function getTavilyClient() {
  const apiKey = process.env.TAVILY_API_KEY?.trim() || "";
  if (!apiKey) {
    return null;
  }

  if (!cachedClient) {
    cachedClient = tavily({ apiKey });
  }

  return cachedClient;
}
