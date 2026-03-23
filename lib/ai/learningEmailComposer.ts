import { z } from "zod";
import { sha256Hash, toStableJson } from "@/lib/ai/common";
import { generateStructuredJson } from "@/lib/ai/provider";

const learningEmailOutputSchema = z.object({
  subject: z.string().trim().min(8).max(120),
  preheader: z.string().trim().min(8).max(180),
  headline: z.string().trim().min(10).max(160),
  intro: z.string().trim().min(20).max(360),
  action_items: z.array(z.string().trim().min(8).max(180)).min(2).max(3),
  cta_label: z.string().trim().min(2).max(50),
});

export type LearningEmailContext = {
  user_id: string;
  username: string | null;
  email: string;
  learning_field_id: string | null;
  learning_field_title: string;
  current_level: string | null;
  target_level: string | null;
  total_steps: number;
  completed_steps: number;
  progress_percent: number;
  passed_tests_recent: number;
  failed_tests_recent: number;
};

export type LearningEmailComposition = {
  subject: string;
  preheader: string;
  headline: string;
  intro: string;
  action_items: string[];
  cta_label: string;
  provenance: {
    provider: "deepseek" | "deterministic";
    model: string;
    prompt_version: string;
    generated_at: string;
    fallback_used: boolean;
    failure_reason: string | null;
  };
  source_hash: string;
  prompt_input_json: Record<string, unknown>;
};

function buildFallback(context: LearningEmailContext) {
  const percent = Math.max(0, Math.min(100, Math.round(context.progress_percent)));
  const completed = Math.max(0, Math.round(context.completed_steps));
  const total = Math.max(0, Math.round(context.total_steps));
  return {
    subject: `Keep going in ${context.learning_field_title}`,
    preheader: `You are ${percent}% through your current Pathly journey.`,
    headline: `You have completed ${completed} of ${total} steps in ${context.learning_field_title}.`,
    intro:
      percent >= 80
        ? "You are very close to your target. Finish your next lesson and lock in your momentum."
        : "Your consistency is building real progress. A short focused session today will keep your streak strong.",
    action_items: [
      `Review one key concept from your latest ${context.learning_field_title} lesson.`,
      "Complete the next unlocked course step in your dashboard.",
      "Take a quick AI test to check retention and identify weak spots.",
    ],
    cta_label: "Continue Learning",
  };
}

export async function composeLearningNudgeEmail(
  context: LearningEmailContext,
): Promise<LearningEmailComposition> {
  const promptInput = {
    user_id: context.user_id,
    username: context.username,
    learning_field_title: context.learning_field_title,
    current_level: context.current_level,
    target_level: context.target_level,
    total_steps: context.total_steps,
    completed_steps: context.completed_steps,
    progress_percent: context.progress_percent,
    passed_tests_recent: context.passed_tests_recent,
    failed_tests_recent: context.failed_tests_recent,
  };

  const result = await generateStructuredJson({
    feature: "learning_email_nudge",
    promptVersion: "v1",
    systemInstruction: [
      "You are Pathly's learning coach email copywriter.",
      "Return compact, upbeat, actionable copy in JSON.",
      "Keep language clear and practical.",
      "Do not mention internal systems, models, or raw metrics directly in a robotic way.",
      "Action items must be concrete and immediately executable.",
      "Do not include markdown.",
    ].join(" "),
    input: promptInput,
    outputSchema: learningEmailOutputSchema,
    fallback: () => buildFallback(context),
    temperature: 0.4,
    maxOutputTokens: 1100,
  });

  const output = result.output;
  const sourceHash = sha256Hash({
    template_type: "learning_nudge",
    prompt_input: promptInput,
    output,
    prompt_version: result.provenance.prompt_version,
  });

  return {
    ...output,
    provenance: result.provenance,
    source_hash: sourceHash,
    prompt_input_json: JSON.parse(toStableJson(promptInput)) as Record<string, unknown>,
  };
}
