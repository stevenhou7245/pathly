const ALLOWED_PIPELINE_LOG_PREFIXES = [
  "[tavily]",
  "[deepseek]",
  "[pipeline]",
  "[journey_template]",
  "[resource_options]",
  "[resource_selection]",
] as const;

type ConsoleMethodName = "log" | "info" | "warn" | "error" | "debug";

declare global {
  var __PATHLY_AI_PIPELINE_LOG_FILTER_INSTALLED__: boolean | undefined;
}

export const AI_PIPELINE_DEBUG_ONLY = true;

function shouldAllowLog(args: unknown[]) {
  if (!AI_PIPELINE_DEBUG_ONLY) {
    return true;
  }

  const first = args[0];
  if (typeof first !== "string") {
    return false;
  }

  const text = first.trim();
  return ALLOWED_PIPELINE_LOG_PREFIXES.some((prefix) => text.startsWith(prefix));
}

export function installAiPipelineDebugLogFilter() {
  if (!AI_PIPELINE_DEBUG_ONLY) {
    return;
  }

  if (typeof window !== "undefined") {
    return;
  }

  if (globalThis.__PATHLY_AI_PIPELINE_LOG_FILTER_INSTALLED__) {
    return;
  }

  globalThis.__PATHLY_AI_PIPELINE_LOG_FILTER_INSTALLED__ = true;

  const methods: ConsoleMethodName[] = ["log", "info", "warn", "error", "debug"];
  methods.forEach((methodName) => {
    const original = console[methodName].bind(console);
    const wrapped = (...args: unknown[]) => {
      if (shouldAllowLog(args)) {
        original(...args);
      }
    };
    (console[methodName] as unknown as (...args: unknown[]) => void) = wrapped;
  });
}
